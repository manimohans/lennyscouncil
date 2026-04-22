import { sql } from '../db';
import { OllamaClient, MODELS, type OllamaChatEvent } from '../ollama';
import { hybridSearch, type RetrievedChunk } from '../retrieval';
import { persistTurn, sanitizeModelOutput } from './shared';

const ollama = new OllamaClient({
	baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
	embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text'
});

const PAIN_PATTERNS = [
	"unsolved problem we still don't have a good way to",
	'I wish there was a tool that',
	'the biggest pain point is still',
	'no one has cracked',
	'still missing in the market',
	'I keep running into',
	'still really hard to'
];

export interface GapCandidate {
	problem: string;
	rationale: string;
	signals: number;
	supporting: Array<{
		chunk_id: number;
		quote: string;
		speaker: string;
		title: string;
		date: string;
		source_url: string | null;
		timestamp_str: string | null;
	}>;
	recency_score: number;
}

export type GapEvent =
	| { kind: 'chat_created'; chatId: string }
	| { kind: 'searching'; query_count: number }
	| { kind: 'searched'; chunk_count: number }
	| { kind: 'thinking'; delta: string }
	| { kind: 'content'; delta: string }
	| { kind: 'gaps'; gaps: GapCandidate[]; chatId?: string }
	| { kind: 'done' }
	| { kind: 'error'; message: string };

export interface ScanGapsOptions {
	topic: string;
	limit?: number;
	model?: string;
	userId?: string;
}

interface ChunkWithKey extends RetrievedChunk {
	key: string;
}

function dedupeByKey(chunks: ChunkWithKey[]): ChunkWithKey[] {
	const seen = new Set<string>();
	const out: ChunkWithKey[] = [];
	for (const c of chunks) {
		if (seen.has(c.key)) continue;
		seen.add(c.key);
		out.push(c);
	}
	return out;
}

function buildSystemPrompt(topic: string, limit: number, excerpts: string): string {
	return `You scan podcast/newsletter excerpts and surface UNSOLVED PROBLEMS practitioners keep complaining about — the kind that could become startup ideas.

You will be given excerpts about: "${topic}"

Output ONLY a JSON array (no other text, no markdown fences). Schema:
[
  {
    "problem": "1-sentence crisp statement of the unsolved problem (frame it as a NEED, not a feature)",
    "rationale": "1-2 sentences on why this is real and underserved, drawn from the excerpts",
    "supporting_chunk_ids": [123, 456]
  }
]

Rules:
- Distinct, non-overlapping problems only. ${limit} max.
- Skip generic complaints ("things move too fast"). Only specific, unmet needs.
- Skip already-solved problems with mature tools.
- Each problem MUST be supported by at least 2 chunk_ids.
- Use ONLY chunk IDs that appear below.

EXCERPTS:
${excerpts}`;
}

async function ensureChat(userId: string, topic: string): Promise<string> {
	const rows = (await sql`
		INSERT INTO chats (user_id, mode, title, metadata)
		VALUES (${userId}, 'gaps', ${'Gap scan: ' + topic.slice(0, 60)},
		        ${sql.json({ topic })})
		RETURNING id
	`) as unknown as Array<{ id: string }>;
	return rows[0].id;
}

/**
 * Recency score for a gap: more recent supporting chunks bump it up.
 * Max 1.0 (all supports within last year). 0.0 = all older than 5 years.
 */
function computeRecency(dates: string[]): number {
	if (dates.length === 0) return 0;
	const now = Date.now();
	const yearMs = 365.25 * 24 * 3600 * 1000;
	let total = 0;
	for (const d of dates) {
		const t = new Date(d).getTime();
		if (Number.isNaN(t)) continue;
		const yearsOld = (now - t) / yearMs;
		total += Math.max(0, 1 - yearsOld / 5);
	}
	return total / dates.length;
}

export async function* scanGapsStream(opts: ScanGapsOptions): AsyncGenerator<GapEvent> {
	try {
		const topic = opts.topic;
		const limit = opts.limit ?? 8;
		const model = opts.model ?? MODELS.synthesis;

		let chatId: string | undefined;
		if (opts.userId) {
			chatId = await ensureChat(opts.userId, topic);
			yield { kind: 'chat_created', chatId };
			await persistTurn({
				chatId,
				role: 'user',
				content: topic,
				round: 0,
				turnNumber: 0
			});
		}

		const queries = PAIN_PATTERNS.map((p) => `${p} ${topic}`).concat([topic]);
		yield { kind: 'searching', query_count: queries.length };

		const all: ChunkWithKey[] = [];
		for (const q of queries) {
			const rows = await hybridSearch(q, { matchCount: 12 });
			for (const r of rows) all.push({ ...r, key: String(r.id) });
		}
		const candidates = dedupeByKey(all).slice(0, 60);
		yield { kind: 'searched', chunk_count: candidates.length };

		if (candidates.length === 0) {
			if (chatId) {
				await persistTurn({
					chatId,
					role: 'synthesis',
					content: '_No excerpts matched this topic._',
					round: 1,
					turnNumber: 1
				});
			}
			yield { kind: 'gaps', gaps: [], chatId };
			yield { kind: 'done' };
			return;
		}

		const excerpts = candidates
			.map(
				(c) =>
					`[c:${c.id}] (${c.speaker}, ${c.date}): ${c.text.replace(/\s+/g, ' ').slice(0, 400)}`
			)
			.join('\n');

		const systemPrompt = buildSystemPrompt(topic, limit, excerpts);

		let reply = '';
		for await (const ev of ollama.chatStream({
			model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: 'Output the JSON array now.' }
			],
			temperature: 0.3,
			maxTokens: 5000,
			think: true
		}) as AsyncGenerator<OllamaChatEvent>) {
			if (ev.kind === 'thinking') {
				yield { kind: 'thinking', delta: ev.delta };
			} else if (ev.kind === 'content') {
				reply += ev.delta;
				yield { kind: 'content', delta: ev.delta };
			}
		}

		reply = sanitizeModelOutput(reply);
		const cleaned = reply.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
		const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
		if (!match) {
			yield { kind: 'gaps', gaps: [], chatId };
			yield { kind: 'done' };
			return;
		}

		let parsed: Array<{ problem: string; rationale: string; supporting_chunk_ids: number[] }>;
		try {
			parsed = JSON.parse(match[0]);
		} catch {
			yield { kind: 'gaps', gaps: [], chatId };
			yield { kind: 'done' };
			return;
		}

		const byId = new Map(candidates.map((c) => [Number(c.id), c]));
		const gaps: GapCandidate[] = parsed
			.map((g) => {
				const supporting = (g.supporting_chunk_ids ?? [])
					.map((id) => byId.get(Number(id)))
					.filter((c): c is ChunkWithKey => Boolean(c))
					.map((c) => ({
						chunk_id: Number(c.id),
						quote: c.text.replace(/\s+/g, ' ').slice(0, 300),
						speaker: c.speaker,
						title: c.title,
						date: String(c.date),
						source_url: c.source_url ?? null,
						timestamp_str: c.timestamp_str ?? null
					}));
				return {
					problem: g.problem,
					rationale: g.rationale,
					signals: supporting.length,
					supporting,
					recency_score: computeRecency(supporting.map((s) => s.date))
				};
			})
			.filter((g) => g.signals >= 2)
			.sort(
				(a, b) =>
					// Prefer more signals, break ties with recency.
					b.signals - a.signals || b.recency_score - a.recency_score
			)
			.slice(0, limit);

		if (chatId) {
			await persistTurn({
				chatId,
				role: 'synthesis',
				content: JSON.stringify(gaps),
				round: 1,
				turnNumber: 1
			});
		}
		yield { kind: 'gaps', gaps, chatId };
		yield { kind: 'done' };
	} catch (err) {
		console.error('[scanGapsStream]', err);
		yield { kind: 'error', message: 'Gap scan hit an error. Try again.' };
	}
}
