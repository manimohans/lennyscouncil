import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { sql } from '$lib/server/db';

export const load: PageServerLoad = async ({ params, locals, depends }) => {
	// Re-runnable from the client (e.g. after a continuation message arrives).
	depends(`app:chat:${params.id}`);

	const chatRows = (await sql`
		SELECT id, title, mode, created_at, last_active_at, metadata
		FROM chats
		WHERE id = ${params.id} AND user_id = ${locals.user.id}
		LIMIT 1
	`) as unknown as Array<{
		id: string;
		title: string;
		mode: string;
		created_at: string;
		last_active_at: string;
		metadata: { expert_id?: string } | null;
	}>;
	if (chatRows.length === 0) throw error(404, 'Chat not found');
	const chat = chatRows[0];

	const messages = (await sql`
		SELECT m.id, m.role, m.content, m.thinking, m.round, m.turn_number,
		       e.id AS expert_id, e.slug AS expert_slug, e.name AS expert_name, e.avatar_url
		FROM messages m
		LEFT JOIN experts e ON e.id = m.expert_id
		WHERE m.chat_id = ${params.id}
		ORDER BY m.turn_number
	`) as unknown as Array<{
		id: string;
		role: string;
		content: string;
		thinking: string | null;
		round: number;
		turn_number: number;
		expert_id: string | null;
		expert_slug: string | null;
		expert_name: string | null;
		avatar_url: string | null;
	}>;

	const messageIds = messages.map((m) => m.id);
	const citations =
		messageIds.length === 0
			? []
			: ((await sql`
					SELECT c.message_id, c.chunk_id, c.quote, c.timestamp_str, ch.speaker, ch.title
					FROM citations c
					JOIN chunks ch ON ch.id = c.chunk_id
					WHERE c.message_id = ANY(${messageIds})
				`) as unknown as Array<{
					message_id: string;
					chunk_id: string;
					quote: string;
					timestamp_str: string | null;
					speaker: string;
					title: string;
				}>);

	const citesByMsg = new Map<string, typeof citations>();
	for (const c of citations) {
		const arr = citesByMsg.get(c.message_id) ?? [];
		arr.push(c);
		citesByMsg.set(c.message_id, arr);
	}

	// For mentor / strategy chats, look up the expert_slug we'll need to continue
	// the conversation (the chat's metadata stores the expert_id).
	let continuationExpertSlug: string | null = null;
	let continuationExpertName: string | null = null;
	let continuationExpertAvatar: string | null = null;
	if (chat.mode === 'mentor' || chat.mode === 'strategy') {
		const expertId = chat.metadata?.expert_id;
		if (expertId) {
			const rows = (await sql`
				SELECT slug, name, avatar_url FROM experts WHERE id = ${expertId} LIMIT 1
			`) as unknown as Array<{ slug: string; name: string; avatar_url: string | null }>;
			if (rows[0]) {
				continuationExpertSlug = rows[0].slug;
				continuationExpertName = rows[0].name;
				continuationExpertAvatar = rows[0].avatar_url;
			}
		}
	}

	return {
		chat: {
			...chat,
			created_at: String(chat.created_at),
			last_active_at: String(chat.last_active_at)
		},
		messages: messages.map((m) => ({
			...m,
			citations: (citesByMsg.get(m.id) ?? []).map((c) => ({
				...c,
				chunk_id: Number(c.chunk_id)
			}))
		})),
		continuation: continuationExpertSlug
			? {
					mode: chat.mode as 'mentor' | 'strategy',
					expertSlug: continuationExpertSlug,
					expertName: continuationExpertName!,
					expertAvatar: continuationExpertAvatar
				}
			: null
	};
};
