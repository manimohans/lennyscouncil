import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { sql } from '$lib/server/db';

export const load: PageServerLoad = async ({ params, locals, depends }) => {
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
		metadata: Record<string, unknown> | null;
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
					SELECT c.message_id, c.chunk_id, c.timestamp_str, c.source_url,
					       COALESCE(c.speaker,    ch.speaker) AS speaker,
					       COALESCE(c.title,      ch.title)   AS title,
					       COALESCE(c.cited_date, ch.date)    AS date,
					       COALESCE(c.source_url, ch.source_url) AS resolved_url
					FROM citations c
					LEFT JOIN chunks ch ON ch.id = c.chunk_id
					WHERE c.message_id = ANY(${messageIds})
				`) as unknown as Array<{
					message_id: string;
					chunk_id: string;
					timestamp_str: string | null;
					source_url: string | null;
					resolved_url: string | null;
					speaker: string | null;
					title: string | null;
					date: string | Date | null;
				}>);

	const citesByMsg = new Map<string, typeof citations>();
	for (const c of citations) {
		const arr = citesByMsg.get(c.message_id) ?? [];
		arr.push(c);
		citesByMsg.set(c.message_id, arr);
	}

	// Build a continuation block for every supported mode. We always include
	// enough context so the chat detail page can re-submit into the right
	// stream endpoint without having to re-derive anything.
	interface Continuation {
		kind: 'mentor' | 'strategy' | 'roundtable' | 'validate' | 'prd';
		expertSlug?: string;
		expertName?: string;
		expertAvatar?: string | null;
		prevQuestion?: string;
		prevArtifact?: string;
	}

	let continuation: Continuation | null = null;
	if (chat.mode === 'mentor' || chat.mode === 'strategy') {
		const expertId = (chat.metadata as { expert_id?: string })?.expert_id;
		if (expertId) {
			const rows = (await sql`
				SELECT slug, name, avatar_url FROM experts WHERE id = ${expertId} LIMIT 1
			`) as unknown as Array<{ slug: string; name: string; avatar_url: string | null }>;
			if (rows[0]) {
				continuation = {
					kind: chat.mode,
					expertSlug: rows[0].slug,
					expertName: rows[0].name,
					expertAvatar: rows[0].avatar_url
				};
			}
		}
	} else if (chat.mode === 'roundtable') {
		const prev = (chat.metadata as { question?: string })?.question;
		continuation = { kind: 'roundtable', prevQuestion: prev };
	} else if (chat.mode === 'validate' || chat.mode === 'prd') {
		const prev = (chat.metadata as { artifact?: string })?.artifact;
		continuation = { kind: chat.mode, prevArtifact: prev };
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
				chunk_id: Number(c.chunk_id),
				source_url: c.resolved_url ?? c.source_url ?? null,
				speaker: c.speaker ?? null,
				title: c.title ?? null,
				date: c.date ? String(c.date).slice(0, 10) : null,
				timestamp_str: c.timestamp_str ?? null
			}))
		})),
		continuation
	};
};
