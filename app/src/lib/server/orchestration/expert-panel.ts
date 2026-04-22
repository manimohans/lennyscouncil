import { sql } from '../db';
import { OllamaClient, MODELS, type OllamaChatEvent } from '../ollama';
import { selectExperts, type SelectedExpert } from '../expert-selector';
import { hybridSearch, type RetrievedChunk } from '../retrieval';

const ollama = new OllamaClient({
	baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
	embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text'
});

export type PanelEvent =
	| { kind: 'chat_created'; chatId: string }
	| { kind: 'experts_selected'; experts: SelectedExpert[] }
	| {
			kind: 'turn_start';
			expertId: string;
			expertName: string;
			role: 'expert' | 'synthesis';
			turnNumber: number;
	  }
	| { kind: 'thinking'; delta: string }
	| { kind: 'content'; delta: string }
	| {
			kind: 'turn_end';
			expertId: string;
			content: string;
			thinking: string;
			messageId?: string;
			citations: Array<{ chunk_id: number }>;
	  }
	| { kind: 'session_complete'; chatId: string }
	| { kind: 'error'; message: string };

export interface PanelMode {
	id: string;
	expertSystemPrompt: (input: PromptInput) => string;
	synthesisSystemPrompt: (artifact: string, transcript: TurnLine[]) => string;
	titlePrefix: string;
}

interface PromptInput {
	expert: { name: string; domains: string[]; bio: string | null; frameworks: string[]; voice_summary: string | null };
	artifact: string;
	groundingChunks: RetrievedChunk[];
}

interface TurnLine {
	speakerName: string;
	content: string;
}

const SHARED_PERSONA_RULES = `You are role-playing as the named real-world expert. Stay in first person. Sound like them, not like an AI.

- Cite source excerpts as [c:CHUNK_ID].
- Never invent specifics — no fabricated employers, numbers, dates, or stories. If the excerpts don't support a specific claim, speak in general terms.
- Be sharp and specific — no generic advice. Take stances. Avoid corporate hedging.
- Speak the way you actually speak in your podcasts and writing.`;

function formatExcerpts(chunks: RetrievedChunk[]): string {
	if (chunks.length === 0) return '(no source excerpts available)';
	return chunks
		.map(
			(c) =>
				`[c:${c.id}] from "${c.title}" (${c.date})${c.timestamp_str ? ` @ ${c.timestamp_str}` : ''}\n${c.text.slice(0, 1000)}`
		)
		.join('\n\n');
}

function profileLines(p: PromptInput['expert']): string {
	return [
		`EXPERT: ${p.name}`,
		p.domains.length ? `DOMAINS: ${p.domains.join(', ')}` : '',
		p.bio ? `BIO: ${p.bio}` : '',
		p.frameworks?.length ? `FRAMEWORKS: ${p.frameworks.join('; ')}` : '',
		p.voice_summary ? `VOICE: ${p.voice_summary}` : ''
	]
		.filter(Boolean)
		.join('\n');
}

export const VALIDATE_MODE: PanelMode = {
	id: 'validate',
	titlePrefix: 'Idea validation',
	expertSystemPrompt: (i) =>
		[
			SHARED_PERSONA_RULES,
			'',
			`You are critiquing a product/startup IDEA the user is considering. Score it BRUTALLY along these axes (0-10) and explain each:
- Problem severity & demand reality
- Wedge / smallest-possible-MVP
- Positioning & differentiation
- Distribution / GTM
- Pricing / monetization plausibility
- Defensibility / moat`,
			'',
			'Format your reply as a markdown list with the axis name, score, and 1-2 sentences of WHY. End with one paragraph: "What I would change if I were you" — concrete and specific.',
			'',
			profileLines(i.expert),
			'',
			`USER\'S IDEA:\n${i.artifact}`,
			'',
			'SOURCE EXCERPTS YOU MAY DRAW FROM (cite by chunk_id):',
			formatExcerpts(i.groundingChunks)
		].join('\n'),
	synthesisSystemPrompt: (artifact, transcript) =>
		[
			'You are the moderator. The expert panel just critiqued a startup idea. Synthesize a final verdict for the user.',
			'',
			'Output:',
			'1. Single-sentence verdict ("Build it / Sharpen it / Kill it") with one-line reason.',
			'2. The strongest reason FOR pursuing.',
			'3. The strongest reason AGAINST.',
			'4. The 1-3 changes that would most increase odds of success — concrete, today-actionable.',
			'5. Preserve [c:NNN] citations.',
			'',
			`USER'S IDEA:\n${artifact}`,
			'',
			'EXPERT PANEL TRANSCRIPT:',
			transcript.map((t) => `--- ${t.speakerName} ---\n${t.content}`).join('\n\n')
		].join('\n')
};

export const PRD_MODE: PanelMode = {
	id: 'prd',
	titlePrefix: 'PRD review',
	expertSystemPrompt: (i) =>
		[
			SHARED_PERSONA_RULES,
			'',
			'You are reviewing a PRD (product requirements doc). Identify the 3-5 most important issues with it — what is missing, weak, or wrong. For each issue: quote (or paraphrase) the line/section, explain the issue, propose the fix.',
			'',
			'End with: "What I would actually ship first" — your scoped-down v1 if you owned this.',
			'',
			profileLines(i.expert),
			'',
			`PRD CONTENT:\n${i.artifact}`,
			'',
			'SOURCE EXCERPTS YOU MAY DRAW FROM (cite by chunk_id):',
			formatExcerpts(i.groundingChunks)
		].join('\n'),
	synthesisSystemPrompt: (artifact, transcript) =>
		[
			'You are the moderator. The expert panel just reviewed a PRD. Synthesize the most important takeaways.',
			'',
			'Output:',
			'1. The 3 issues every reviewer flagged (or close to it).',
			'2. The single biggest gap or risk.',
			'3. A consensus "minimum shippable v1" recommendation.',
			'4. Preserve [c:NNN] citations.',
			'',
			`PRD CONTENT (truncated):\n${artifact.slice(0, 1500)}`,
			'',
			'EXPERT REVIEW TRANSCRIPT:',
			transcript.map((t) => `--- ${t.speakerName} ---\n${t.content}`).join('\n\n')
		].join('\n')
};

interface ExpertProfile {
	id: string;
	name: string;
	domains: string[];
	bio: string | null;
	frameworks: string[];
	voice_summary: string | null;
}

async function loadProfiles(ids: string[]): Promise<Map<string, ExpertProfile>> {
	if (ids.length === 0) return new Map();
	const rows = (await sql`
		SELECT id, name, domains, bio, frameworks, voice_summary
		FROM experts WHERE id = ANY(${ids})
	`) as unknown as ExpertProfile[];
	return new Map(rows.map((r) => [r.id, r]));
}

function deriveCitations(content: string): Array<{ chunk_id: number }> {
	const ids = new Set<number>();
	for (const m of content.matchAll(/\[c:(\d+)\]/g)) ids.add(Number.parseInt(m[1]));
	return [...ids].map((chunk_id) => ({ chunk_id }));
}

function autoTitle(prefix: string, artifact: string): string {
	const first = artifact.split('\n')[0].trim().slice(0, 60);
	return `${prefix}: ${first}`;
}

async function ensureChat(
	userId: string,
	mode: string,
	title: string
): Promise<string> {
	const rows = (await sql`
		INSERT INTO chats (user_id, mode, title)
		VALUES (${userId}, ${mode}, ${title})
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

export interface RunPanelOptions {
	userId: string;
	mode: PanelMode;
	artifact: string;
	maxExperts?: number;
	model?: string;
}

export async function* runExpertPanel(opts: RunPanelOptions): AsyncGenerator<PanelEvent> {
	try {
		const selected = await selectExperts(opts.artifact, {
			topK: opts.maxExperts ?? 4,
			excludeHosts: true
		});
		if (selected.length === 0) {
			yield { kind: 'error', message: 'No experts matched. Try giving more detail.' };
			return;
		}

		yield { kind: 'experts_selected', experts: selected };

		const profiles = await loadProfiles(selected.map((s) => s.expert_id));
		const chatId = await ensureChat(opts.userId, opts.mode.id, autoTitle(opts.mode.titlePrefix, opts.artifact));
		yield { kind: 'chat_created', chatId };

		await persistTurn({ chatId, role: 'user', content: opts.artifact, round: 0, turnNumber: 0 });

		const allChunks = await hybridSearch(opts.artifact, { matchCount: 60 });
		const transcript: TurnLine[] = [];
		let turnNumber = 1;

		for (const s of selected) {
			const profile = profiles.get(s.expert_id);
			if (!profile) continue;
			const expertChunks = allChunks.filter((c) => c.speaker === s.name).slice(0, 8);
			yield {
				kind: 'turn_start',
				expertId: profile.id,
				expertName: profile.name,
				role: 'expert',
				turnNumber
			};
			const sys = opts.mode.expertSystemPrompt({
				expert: profile,
				artifact: opts.artifact,
				groundingChunks: expertChunks
			});
			let content = '';
			let thinking = '';
			const stream = ollama.chatStream({
				model: opts.model ?? MODELS.expert,
				messages: [
					{ role: 'system', content: sys },
					{ role: 'user', content: 'Give your review now.' }
				],
				temperature: 0.7,
				maxTokens: 5000,
				think: true
			});
			for await (const ev of stream) {
				if (ev.kind === 'thinking') {
					thinking += ev.delta;
					yield { kind: 'thinking', delta: ev.delta };
				} else if (ev.kind === 'content') {
					content += ev.delta;
					yield { kind: 'content', delta: ev.delta };
				}
			}
			const citations = deriveCitations(content);
			const messageId = await persistTurn({
				chatId,
				role: 'expert',
				expertId: profile.id,
				content,
				thinking,
				round: 1,
				turnNumber,
				citations
			});
			yield { kind: 'turn_end', expertId: profile.id, content, thinking, messageId, citations };
			transcript.push({ speakerName: profile.name, content });
			turnNumber++;
		}

		yield {
			kind: 'turn_start',
			expertId: 'synthesis',
			expertName: 'Synthesis',
			role: 'synthesis',
			turnNumber
		};
		const synthSys = opts.mode.synthesisSystemPrompt(opts.artifact, transcript);
		let synthContent = '';
		let synthThinking = '';
		const synthStream = ollama.chatStream({
			model: opts.model ?? MODELS.synthesis,
			messages: [
				{ role: 'system', content: synthSys },
				{ role: 'user', content: 'Produce the synthesis now.' }
			],
			temperature: 0.5,
			maxTokens: 3500,
			think: true
		});
		for await (const ev of synthStream) {
			if (ev.kind === 'thinking') {
				synthThinking += ev.delta;
				yield { kind: 'thinking', delta: ev.delta };
			} else if (ev.kind === 'content') {
				synthContent += ev.delta;
				yield { kind: 'content', delta: ev.delta };
			}
		}
		const synthCitations = deriveCitations(synthContent);
		await persistTurn({
			chatId,
			role: 'synthesis',
			content: synthContent,
			thinking: synthThinking,
			round: 2,
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
