import type { PageServerLoad } from './$types';
import { sql } from '$lib/server/db';

export const load: PageServerLoad = async ({ locals }) => {
	const rows = (await sql`
		SELECT c.id, c.title, c.mode, c.created_at, c.last_active_at,
		       (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) AS message_count
		FROM chats c
		WHERE c.user_id = ${locals.user.id}
		ORDER BY c.last_active_at DESC
	`) as unknown as Array<{
		id: string;
		title: string;
		mode: string;
		created_at: string;
		last_active_at: string;
		message_count: string;
	}>;

	return {
		chats: rows.map((r) => ({
			...r,
			created_at: String(r.created_at),
			last_active_at: String(r.last_active_at),
			message_count: Number(r.message_count)
		}))
	};
};
