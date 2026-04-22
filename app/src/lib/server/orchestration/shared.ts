import { sql } from '../db';
import type { RetrievedChunk } from '../retrieval';

export interface CitationRef {
	chunk_id: number;
	source_url: string | null;
	speaker: string | null;
	title: string | null;
	date: string | null;
	timestamp_str: string | null;
}

/** Extract `[c:N]` tokens from streamed LLM content. */
export function deriveCitationIds(content: string): number[] {
	const ids = new Set<number>();
	for (const m of content.matchAll(/\[c:(\d+)\]/g)) ids.add(Number.parseInt(m[1]));
	return [...ids];
}

/**
 * Given a pre-known pool of candidate chunks (the ones we showed the LLM) and
 * a list of chunk_ids the LLM cited, produce denormalised citation refs with
 * the article URL populated. Only cites the LLM used from the pool are
 * returned — hallucinated IDs are silently dropped.
 */
export function materializeCitations(
	citedIds: number[],
	candidatePool: RetrievedChunk[]
): CitationRef[] {
	if (citedIds.length === 0) return [];
	const byId = new Map(candidatePool.map((c) => [Number(c.id), c]));
	const out: CitationRef[] = [];
	for (const id of citedIds) {
		const c = byId.get(Number(id));
		if (!c) continue;
		out.push({
			chunk_id: Number(c.id),
			source_url: c.source_url ?? null,
			speaker: c.speaker ?? null,
			title: c.title ?? null,
			date: c.date ?? null,
			timestamp_str: c.timestamp_str ?? null
		});
	}
	return out;
}

export interface PersistTurnInput {
	chatId: string;
	role: 'user' | 'expert' | 'synthesis' | 'moderator';
	expertId?: string | null;
	content: string;
	thinking?: string | null;
	round: number;
	turnNumber: number;
	citations?: CitationRef[];
}

/**
 * Persist a message + its citations + bump chat activity, all in one
 * transaction. Returns the new message id.
 */
export async function persistTurn(input: PersistTurnInput): Promise<string> {
	const messageId = await sql.begin(async (tx) => {
		const rows = (await tx`
			INSERT INTO messages (chat_id, role, expert_id, content, thinking, round, turn_number)
			VALUES (
				${input.chatId}, ${input.role}, ${input.expertId ?? null},
				${input.content}, ${input.thinking ?? null}, ${input.round}, ${input.turnNumber}
			)
			RETURNING id
		`) as unknown as Array<{ id: string }>;
		const mid = rows[0].id;

		const cites = input.citations ?? [];
		if (cites.length > 0) {
			const inserts = cites.map((c) => ({
				message_id: mid,
				chunk_id: c.chunk_id,
				quote: '',
				timestamp_str: c.timestamp_str ?? null,
				source_url: c.source_url ?? null,
				speaker: c.speaker ?? null,
				title: c.title ?? null,
				cited_date: c.date ?? null
			}));
			await tx`INSERT INTO citations ${tx(inserts)}`;
		}

		await tx`UPDATE chats SET last_active_at = now() WHERE id = ${input.chatId}`;
		return mid;
	});
	return messageId as string;
}

export function autoTitle(text: string, maxLen = 80): string {
	const firstLine = text.split('\n')[0].trim();
	if (firstLine.length <= maxLen) return firstLine;
	return firstLine.slice(0, maxLen - 3) + '…';
}

/**
 * Strip any leaked internal directives from model output before it's shown to
 * the user (defence-in-depth — a well-behaved model never emits these, but
 * prompt-injected ones sometimes do).
 */
export function sanitizeModelOutput(content: string): string {
	return content
		.replace(/^SYSTEM:.*$/gim, '')
		.replace(/<\/?system>/gi, '')
		.replace(/<\|.*?\|>/g, '')
		.trim();
}
