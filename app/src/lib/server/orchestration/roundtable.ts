import { sql } from '../db';
import { OllamaClient, MODELS, type OllamaChatEvent } from '../ollama';
import { selectExperts, type SelectedExpert } from '../expert-selector';
import { hybridSearch, type RetrievedChunk } from '../retrieval';
import {
	buildExpertSystemPrompt,
	buildModeratorSynthesisPrompt
} from '../persona-prompt';

const ollamaBase = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const ollama = new OllamaClient({
	baseUrl: ollamaBase,
	embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text'
});

export const DEFAULT_ROUNDS = 3;
export const MIN_ROUNDS = 3;
export const MAX_ROUNDS = 5;

export type RoundtableEvent =
	| { kind: 'chat_created'; chatId: string }
	| { kind: 'experts_selected'; experts: SelectedExpert[] }
	| {
			kind: 'turn_start';
			expertId: string;
			expertName: string;
			role: 'expert' | 'synthesis';
			round: number;
			turnNumber: number;
			totalRounds: number;
	  }
	| { kind: 'thinking'; delta: string }
	| { kind: 'content'; delta: string }
	| {
			kind: 'turn_end';
			expertId: string;
			content: string;
			thinking: string;
			messageId?: string;
			citations?: Array<{ chunk_id: number }>;
	  }
	| { kind: 'session_complete'; chatId: string }
	| { kind: 'error'; message: string };

export interface RunRoundtableOptions {
	userId: string;
	question: string;
	chatId?: string;
	expertOverride?: SelectedExpert[];
	maxExperts?: number;
	rounds?: number;
	model?: string;
}

interface ExpertProfileRow {
	id: string;
	name: string;
	domains: string[];
	bio: string | null;
	frameworks: string[];
	voice_summary: string | null;
}

async function loadExpertProfiles(ids: string[]): Promise<Map<string, ExpertProfileRow>> {
	if (ids.length === 0) return new Map();
	const rows = (await sql`
		SELECT id, name, domains, bio, frameworks, voice_summary
		FROM experts
		WHERE id = ANY(${ids})
	`) as unknown as ExpertProfileRow[];
	return new Map(rows.map((r) => [r.id, r]));
}

function deriveCitations(content: string): Array<{ chunk_id: number }> {
	const ids = new Set<number>();
	for (const m of content.matchAll(/\[c:(\d+)\]/g)) ids.add(Number.parseInt(m[1]));
	return [...ids].map((chunk_id) => ({ chunk_id }));
}

function autoTitle(question: string): string {
	const firstLine = question.split('\n')[0].trim();
	if (firstLine.length <= 80) return firstLine;
	return firstLine.slice(0, 77) + '…';
}

async function ensureChat(opts: {
	userId: string;
	chatId?: string;
	question: string;
	model: string;
	rounds: number;
}): Promise<string> {
	if (opts.chatId) return opts.chatId;
	const rows = (await sql`
		INSERT INTO chats (user_id, mode, title, metadata)
		VALUES (${opts.userId}, 'roundtable', ${autoTitle(opts.question)},
		        ${sql.json({ model: opts.model, rounds: opts.rounds })})
		RETURNING id
	`) as unknown as Array<{ id: string }>;
	return rows[0].id;
}

async function persistTurn(input: {
	chatId: string;
	role: 'user' | 'expert' | 'synthesis';
	expertId?: string;
	content: string;
	thinking?: string;
	round: number;
	turnNumber: number;
	citations?: Array<{ chunk_id: number }>;
}): Promise<string> {
	const rows = (await sql`
		INSERT INTO messages (chat_id, role, expert_id, content, thinking, round, turn_number)
		VALUES (
			${input.chatId}, ${input.role}, ${input.expertId ?? null},
			${input.content}, ${input.thinking ?? null}, ${input.round}, ${input.turnNumber}
		)
		RETURNING id
	`) as unknown as Array<{ id: string }>;
	const messageId = rows[0].id;

	const citations = input.citations ?? [];
	if (citations.length > 0) {
		const chunkIds = citations.map((c) => c.chunk_id);
		const chunkRows = (await sql`
			SELECT id, text, timestamp_str FROM chunks WHERE id = ANY(${chunkIds})
		`) as unknown as Array<{ id: number | string; text: string; timestamp_str: string | null }>;
		const byId = new Map(chunkRows.map((c) => [Number(c.id), c]));
		const inserts = chunkIds
			.map((cid) => byId.get(cid))
			.filter((c): c is { id: number | string; text: string; timestamp_str: string | null } => Boolean(c))
			.map((c) => ({
				message_id: messageId,
				chunk_id: Number(c.id),
				quote: c.text.slice(0, 400),
				timestamp_str: c.timestamp_str ?? null
			}));
		if (inserts.length > 0) await sql`INSERT INTO citations ${sql(inserts)}`;
	}

	await sql`UPDATE chats SET last_active_at = now() WHERE id = ${input.chatId}`;
	return messageId;
}

interface ExpertContext {
	selected: SelectedExpert;
	profile: ExpertProfileRow;
	chunks: RetrievedChunk[];
}

export async function* runRoundtable(opts: RunRoundtableOptions): AsyncGenerator<RoundtableEvent> {
	try {
		const model = opts.model ?? MODELS.expert;
		const rounds = Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, opts.rounds ?? DEFAULT_ROUNDS));

		const chatId = await ensureChat({
			userId: opts.userId,
			chatId: opts.chatId,
			question: opts.question,
			model,
			rounds
		});

		// Emit early so the sidebar can show the chat immediately,
		// before any LLM calls have started.
		yield { kind: 'chat_created', chatId };

		const selected =
			opts.expertOverride ??
			(await selectExperts(opts.question, { topK: opts.maxExperts ?? 4, excludeHosts: true }));

		if (selected.length === 0) {
			yield {
				kind: 'error',
				message:
					'No experts matched this question. Try rephrasing or broadening the topic — the corpus covers product, growth, leadership, design, AI, GTM, pricing, careers, and engineering.'
			};
			return;
		}

		yield { kind: 'experts_selected', experts: selected };

		const profiles = await loadExpertProfiles(selected.map((s) => s.expert_id));
		const allChunks = await hybridSearch(opts.question, { matchCount: 80 });

		const expertContexts: ExpertContext[] = [];
		for (const s of selected) {
			const profile = profiles.get(s.expert_id);
			if (!profile) continue;
			const speakerChunks = allChunks.filter((c) => c.speaker === s.name).slice(0, 6);
			expertContexts.push({ selected: s, profile, chunks: speakerChunks });
		}

		await persistTurn({
			chatId,
			role: 'user',
			content: opts.question,
			round: 0,
			turnNumber: 0
		});

		const fullTranscript: Array<{ speakerName: string; round: number; content: string }> = [];
		let turnNumber = 1;

		// Expert rounds — every speaker sees ALL prior turns (across rounds AND
		// earlier speakers in the current round), so a true conversation builds.
		// The very first speaker in round 1 sees nothing and gives a cold take.
		let consecutiveEmpty = 0;
		for (let round = 1; round <= rounds; round++) {
			for (const ctx of expertContexts) {
				yield {
					kind: 'turn_start',
					expertId: ctx.profile.id,
					expertName: ctx.profile.name,
					role: 'expert',
					round,
					turnNumber,
					totalRounds: rounds
				};
				const sys = buildExpertSystemPrompt({
					expert: ctx.profile,
					question: opts.question,
					groundingChunks: ctx.chunks,
					priorTurns: fullTranscript.slice(),
					round,
					totalRounds: rounds
				});
				const userPrompt =
					fullTranscript.length === 0
						? opts.question
						: 'Continue the conversation. Either respond to specific points other experts raised, or sharpen your own POV — whichever is most useful to the user.';
				let content = '';
				let thinking = '';
				for await (const ev of streamExpert(model, sys, userPrompt)) {
					if (ev.kind === 'thinking') {
						thinking += ev.delta;
						yield ev;
					} else if (ev.kind === 'content') {
						content += ev.delta;
						yield ev;
					}
				}

				// Detect silent failure (model returned no content at all). After 2
				// in a row we abort the whole roundtable rather than waste cycles.
				if (content.trim().length === 0) {
					consecutiveEmpty++;
					if (consecutiveEmpty >= 2) {
						yield {
							kind: 'error',
							message: `Model "${model}" returned empty responses for ${consecutiveEmpty} consecutive turns. This usually means the model was throttled, hit a quota, or doesn't support \`think: true\`. Try switching to a different model in the top-right picker (kimi-k2.6:cloud is recommended).`
						};
						return;
					}
				} else {
					consecutiveEmpty = 0;
				}

				const citations = deriveCitations(content);
				const messageId = await persistTurn({
					chatId,
					role: 'expert',
					expertId: ctx.profile.id,
					content,
					thinking,
					round,
					turnNumber,
					citations
				});
				yield { kind: 'turn_end', expertId: ctx.profile.id, content, thinking, messageId, citations };
				fullTranscript.push({ speakerName: ctx.profile.name, round, content });
				turnNumber++;
			}
		}

		// Synthesis
		yield {
			kind: 'turn_start',
			expertId: 'synthesis',
			expertName: 'Synthesis',
			role: 'synthesis',
			round: rounds + 1,
			turnNumber,
			totalRounds: rounds
		};
		const synthSys = buildModeratorSynthesisPrompt(opts.question, fullTranscript);
		let synthContent = '';
		let synthThinking = '';
		for await (const ev of ollama.chatStream({
			model,
			messages: [
				{ role: 'system', content: synthSys },
				{ role: 'user', content: 'Produce the synthesis now.' }
			],
			temperature: 0.5,
			maxTokens: 3500,
			think: true
		})) {
			if (ev.kind === 'thinking') {
				synthThinking += ev.delta;
				yield ev;
			} else if (ev.kind === 'content') {
				synthContent += ev.delta;
				yield ev;
			}
		}
		const synthCitations = deriveCitations(synthContent);
		await persistTurn({
			chatId,
			role: 'synthesis',
			content: synthContent,
			thinking: synthThinking,
			round: rounds + 1,
			turnNumber,
			citations: synthCitations
		});
		yield {
			kind: 'turn_end',
			expertId: 'synthesis',
			content: synthContent,
			thinking: synthThinking,
			citations: synthCitations
		};

		yield { kind: 'session_complete', chatId };
	} catch (err) {
		yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
	}
}

async function* streamExpert(
	model: string,
	systemPrompt: string,
	userPrompt: string
): AsyncGenerator<OllamaChatEvent> {
	yield* ollama.chatStream({
		model,
		messages: [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		],
		temperature: 0.75,
		// Headroom for kimi-k2.6's reasoning (~2.5K tokens of thinking) + a single
		// paragraph of content (~250 tokens). Empirical floor: ~3000 was too tight
		// on edge cases.
		maxTokens: 4500,
		think: true
	});
}
