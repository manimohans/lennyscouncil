import { OllamaClient, MODELS, type OllamaChatEvent } from '../ollama';
import { hybridSearch, type RetrievedChunk } from '../retrieval';

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
	}>;
}

export type GapEvent =
	| { kind: 'searching'; query_count: number }
	| { kind: 'searched'; chunk_count: number }
	| { kind: 'thinking'; delta: string }
	| { kind: 'content'; delta: string }
	| { kind: 'gaps'; gaps: GapCandidate[] }
	| { kind: 'done' }
	| { kind: 'error'; message: string };

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
- Each problem must be supported by 2+ chunk_ids from the excerpts.
- Use ONLY chunk IDs that appear below.

EXCERPTS:
${excerpts}`;
}

export async function* scanGapsStream(
	topic: string,
	limit = 8,
	model: string = MODELS.synthesis
): AsyncGenerator<GapEvent> {
	try {
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
			yield { kind: 'gaps', gaps: [] };
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

		// Stream with thinking enabled so the user sees reasoning. Content is JSON.
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

		const cleaned = reply.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
		const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
		if (!match) {
			yield { kind: 'gaps', gaps: [] };
			yield { kind: 'done' };
			return;
		}

		let parsed: Array<{ problem: string; rationale: string; supporting_chunk_ids: number[] }>;
		try {
			parsed = JSON.parse(match[0]);
		} catch {
			yield { kind: 'gaps', gaps: [] };
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
						date: String(c.date)
					}));
				return {
					problem: g.problem,
					rationale: g.rationale,
					signals: supporting.length,
					supporting
				};
			})
			.filter((g) => g.signals >= 1)
			.slice(0, limit);

		yield { kind: 'gaps', gaps };
		yield { kind: 'done' };
	} catch (err) {
		yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
	}
}

// Backward-compat wrapper for any non-streaming callers (none currently, but kept tidy).
export async function scanGaps(
	topic: string,
	limit = 8,
	model: string = MODELS.synthesis
): Promise<GapCandidate[]> {
	for await (const ev of scanGapsStream(topic, limit, model)) {
		if (ev.kind === 'gaps') return ev.gaps;
		if (ev.kind === 'error') throw new Error(ev.message);
	}
	return [];
}
