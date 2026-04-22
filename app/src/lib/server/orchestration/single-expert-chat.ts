import { sql } from '../db';
import { OllamaClient, MODELS, type OllamaChatEvent } from '../ollama';
import { hybridSearch } from '../retrieval';

const ollama = new OllamaClient({
	baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
	embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text'
});

export type SingleExpertEvent =
	| { kind: 'chat_created'; chatId: string }
	| { kind: 'turn_start'; expertId: string; expertName: string; turnNumber: number }
	| { kind: 'thinking'; delta: string }
	| { kind: 'content'; delta: string }
	| {
			kind: 'turn_end';
			content: string;
			thinking: string;
			messageId: string;
			citations: Array<{ chunk_id: number }>;
	  }
	| { kind: 'session_complete'; chatId: string }
	| { kind: 'error'; message: string };

interface ExpertProfile {
	id: string;
	name: string;
	bio: string | null;
	domains: string[];
	frameworks: string[];
	voice_summary: string | null;
}

export interface SingleExpertChatOptions {
	userId: string;
	mode: 'mentor' | 'strategy';
	expertSlug: string;
	question: string;
	chatId?: string;
	model?: string;
}

const PERSONA_BASE = `You are role-playing as a real product / career expert in a 1:1 advisory conversation. Stay in first person as the named expert. Sound like them — not like an AI summarizing them.

Rules:
1. Ground concrete claims, frameworks, examples, and stories in the SOURCE EXCERPTS. Cite as [c:CHUNK_ID].
2. Never invent specifics — no fabricated numbers, employers, dates, or stories. If the excerpts don't support a specific claim, speak in general terms.
3. Be opinionated. Real advisors push back, ask clarifying questions, share specific stories. Avoid corporate hedging like "it depends" without saying what it depends on.
4. Keep it conversational: 1–3 short paragraphs. Don't lecture. End with a sharp follow-up question OR an actionable next step.
5. If the user shares context (role, situation, stage), acknowledge it explicitly before giving advice.`;

const MODE_GUIDANCE = {
	mentor:
		'This is a CAREER MENTORING conversation. Treat the user like a mentee. Ask about their context (role, level, situation) before giving prescriptive advice if it would help. Calibrate to their level.',
	strategy:
		'This is a PRODUCT STRATEGY conversation. Be a thinking partner — surface assumptions, propose alternative framings, stress-test their thesis. Push past surface-level answers.'
};

async function loadExpertBySlug(slug: string): Promise<ExpertProfile | null> {
	const rows = (await sql`
		SELECT id, name, bio, domains, frameworks, voice_summary
		FROM experts
		WHERE slug = ${slug} AND NOT is_host
		LIMIT 1
	`) as unknown as ExpertProfile[];
	return rows[0] ?? null;
}

async function loadConversation(chatId: string) {
	const rows = (await sql`
		SELECT role, content, turn_number FROM messages
		WHERE chat_id = ${chatId}
		ORDER BY turn_number
	`) as unknown as Array<{ role: string; content: string; turn_number: number }>;
	return rows;
}

function deriveCitations(content: string): Array<{ chunk_id: number }> {
	const ids = new Set<number>();
	for (const m of content.matchAll(/\[c:(\d+)\]/g)) ids.add(Number.parseInt(m[1]));
	return [...ids].map((chunk_id) => ({ chunk_id }));
}

function autoTitle(question: string, expertName: string): string {
	const first = question.split('\n')[0].trim().slice(0, 60);
	return `${first} — with ${expertName}`;
}

async function ensureChat(opts: {
	userId: string;
	mode: string;
	chatId?: string;
	expertId: string;
	question: string;
	expertName: string;
}): Promise<string> {
	if (opts.chatId) return opts.chatId;
	const rows = (await sql`
		INSERT INTO chats (user_id, mode, title, metadata)
		VALUES (${opts.userId}, ${opts.mode}, ${autoTitle(opts.question, opts.expertName)},
		       ${sql.json({ expert_id: opts.expertId })})
		RETURNING id
	`) as unknown as Array<{ id: string }>;
	return rows[0].id;
}

async function persistTurn(input: {
	chatId: string;
	role: 'user' | 'expert';
	expertId?: string;
	content: string;
	thinking?: string;
	turnNumber: number;
	citations?: Array<{ chunk_id: number }>;
}): Promise<string> {
	const rows = (await sql`
		INSERT INTO messages (chat_id, role, expert_id, content, thinking, turn_number)
		VALUES (
			${input.chatId}, ${input.role}, ${input.expertId ?? null},
			${input.content}, ${input.thinking ?? null}, ${input.turnNumber}
		)
		RETURNING id
	`) as unknown as Array<{ id: string }>;
	const messageId = rows[0].id;

	const citations = input.citations ?? [];
	if (citations.length > 0) {
		const chunkIds = citations.map((c) => c.chunk_id);
		const chunkRows = (await sql`
			SELECT id, text, timestamp_str FROM chunks WHERE id = ANY(${chunkIds})
		`) as unknown as Array<{ id: string | number; text: string; timestamp_str: string | null }>;
		const byId = new Map(chunkRows.map((c) => [Number(c.id), c]));
		const inserts = chunkIds
			.map((cid) => byId.get(cid))
			.filter((c): c is { id: string | number; text: string; timestamp_str: string | null } => Boolean(c))
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

export async function* runSingleExpertChat(
	opts: SingleExpertChatOptions
): AsyncGenerator<SingleExpertEvent> {
	try {
		const expert = await loadExpertBySlug(opts.expertSlug);
		if (!expert) {
			yield { kind: 'error', message: `Expert "${opts.expertSlug}" not found.` };
			return;
		}

		const chatId = await ensureChat({
			userId: opts.userId,
			mode: opts.mode,
			chatId: opts.chatId,
			expertId: expert.id,
			question: opts.question,
			expertName: expert.name
		});
		yield { kind: 'chat_created', chatId };

		const prior = opts.chatId ? await loadConversation(opts.chatId) : [];
		const turnNumber = prior.length;
		await persistTurn({ chatId, role: 'user', content: opts.question, turnNumber });

		// Pull grounding chunks from THIS expert that relate to the question
		const allChunks = await hybridSearch(opts.question, { matchCount: 50 });
		const expertChunks = allChunks.filter((c) => c.speaker === expert.name).slice(0, 8);

		const profileBlock = [
			`EXPERT: ${expert.name}`,
			expert.domains.length > 0 ? `DOMAINS: ${expert.domains.join(', ')}` : '',
			expert.bio ? `BIO: ${expert.bio}` : '',
			expert.frameworks?.length ? `FRAMEWORKS: ${expert.frameworks.join('; ')}` : '',
			expert.voice_summary ? `VOICE: ${expert.voice_summary}` : ''
		]
			.filter(Boolean)
			.join('\n');

		const excerpts =
			expertChunks.length === 0
				? '(no source excerpts available — speak from general knowledge of this expert\'s public work)'
				: expertChunks
						.map(
							(c) =>
								`[c:${c.id}] from "${c.title}" (${c.date})${c.timestamp_str ? ` @ ${c.timestamp_str}` : ''}\n${c.text.slice(0, 1000)}`
						)
						.join('\n\n');

		const conversationBlock =
			prior.length === 0
				? ''
				: `\nPRIOR CONVERSATION:\n${prior.map((m) => `${m.role === 'user' ? 'User' : expert.name}: ${m.content}`).join('\n\n')}\n`;

		const systemPrompt = [
			PERSONA_BASE,
			'',
			MODE_GUIDANCE[opts.mode],
			'',
			profileBlock,
			conversationBlock,
			'SOURCE EXCERPTS YOU MAY DRAW FROM (cite by chunk_id):',
			excerpts
		].join('\n');

		yield {
			kind: 'turn_start',
			expertId: expert.id,
			expertName: expert.name,
			turnNumber: turnNumber + 1
		};

		let content = '';
		let thinking = '';
		const stream = ollama.chatStream({
			model: opts.model ?? MODELS.expert,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: opts.question }
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
			expertId: expert.id,
			content,
			thinking,
			turnNumber: turnNumber + 1,
			citations
		});
		yield { kind: 'turn_end', content, thinking, messageId, citations };
		yield { kind: 'session_complete', chatId };
	} catch (err) {
		yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
	}
}
