import { sql } from '../db';
import { OllamaClient, MODELS, type OllamaChatEvent } from '../ollama';
import { selectExpertsWithEmbedding, type SelectedExpert } from '../expert-selector';
import { hybridSearch, type RetrievedChunk } from '../retrieval';
import {
	buildExpertSystemPrompt,
	buildModeratorSynthesisPrompt
} from '../persona-prompt';
import {
	autoTitle,
	deriveCitationIds,
	materializeCitations,
	persistTurn,
	sanitizeModelOutput,
	type CitationRef
} from './shared';

const ollamaBase = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const ollama = new OllamaClient({
	baseUrl: ollamaBase,
	embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text'
});

export const DEFAULT_ROUNDS = 3;
export const MIN_ROUNDS = 2;
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
			citations: CitationRef[];
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
		        ${sql.json({ model: opts.model, rounds: opts.rounds, question: opts.question })})
		RETURNING id
	`) as unknown as Array<{ id: string }>;
	return rows[0].id;
}

interface ExpertContext {
	selected: SelectedExpert;
	profile: ExpertProfileRow;
	chunks: RetrievedChunk[];
	/** Chunks the expert sees, keyed for fast lookup during citation materialization. */
	chunkPool: RetrievedChunk[];
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

		// Select experts (or accept override from UI) — reusing the embedding
		// the selector computed, so we don't embed the query twice.
		let selected: SelectedExpert[];
		let embedding: number[];
		if (opts.expertOverride && opts.expertOverride.length > 0) {
			selected = opts.expertOverride;
			// Still need an embedding for per-speaker retrieval below.
			const result = await selectExpertsWithEmbedding(opts.question, { topK: 0 });
			embedding = result.embedding;
		} else {
			const result = await selectExpertsWithEmbedding(opts.question, {
				topK: opts.maxExperts ?? 4,
				excludeHosts: true
			});
			selected = result.experts;
			embedding = result.embedding;
		}

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

		// Retrieve per-expert at the SQL layer (no more client-side speaker filter
		// that silently dropped chunks when the top-80 was dominated by other guests).
		const expertContexts: ExpertContext[] = [];
		for (const s of selected) {
			const profile = profiles.get(s.expert_id);
			if (!profile) continue;
			const expertChunks = await hybridSearch(opts.question, {
				matchCount: 8,
				speakerIds: [s.expert_id],
				embedding
			});
			expertContexts.push({
				selected: s,
				profile,
				chunks: expertChunks,
				chunkPool: expertChunks
			});
		}

		// Persist the user question first so partial transcripts survive a crash.
		await persistTurn({
			chatId,
			role: 'user',
			content: opts.question,
			round: 0,
			turnNumber: 0
		});

		const fullTranscript: Array<{ speakerName: string; round: number; content: string }> = [];
		let turnNumber = 1;
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
					totalRounds: rounds,
					otherExperts: expertContexts
						.filter((c) => c.profile.id !== ctx.profile.id)
						.map((c) => c.profile.name)
				});
				const userPrompt =
					fullTranscript.length === 0
						? opts.question
						: 'Continue the conversation. Either respond to specific points other experts raised (naming them) or sharpen your own POV — whichever is most useful to the user.';
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
				content = sanitizeModelOutput(content);

				if (content.trim().length === 0) {
					consecutiveEmpty++;
					if (consecutiveEmpty >= 2) {
						yield {
							kind: 'error',
							message: `Model returned empty responses for ${consecutiveEmpty} consecutive turns. Try switching to a different model in the top-right picker.`
						};
						return;
					}
				} else {
					consecutiveEmpty = 0;
				}

				const citedIds = deriveCitationIds(content);
				const citations = materializeCitations(citedIds, ctx.chunkPool);
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
				yield {
					kind: 'turn_end',
					expertId: ctx.profile.id,
					content,
					thinking,
					messageId,
					citations
				};
				fullTranscript.push({ speakerName: ctx.profile.name, round, content });
				turnNumber++;
			}
		}

		// Synthesis — the moderator sees every chunk from every expert so it
		// can cite any of them.
		yield {
			kind: 'turn_start',
			expertId: 'synthesis',
			expertName: 'Synthesis',
			role: 'synthesis',
			round: rounds + 1,
			turnNumber,
			totalRounds: rounds
		};
		const synthesisPool = expertContexts.flatMap((c) => c.chunkPool);
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
		synthContent = sanitizeModelOutput(synthContent);
		const synthCitedIds = deriveCitationIds(synthContent);
		const synthCitations = materializeCitations(synthCitedIds, synthesisPool);
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
		// Log the real error server-side; send something safe to the browser.
		console.error('[runRoundtable]', err);
		yield {
			kind: 'error',
			message: 'The roundtable hit an error. Check server logs or try again.'
		};
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
		maxTokens: 4500,
		think: true
	});
}
