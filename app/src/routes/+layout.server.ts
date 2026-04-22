import type { LayoutServerLoad } from './$types';
import { sql } from '$lib/server/db';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// Mark as depending on the 'app:chats' tag so any client-side invalidate('app:chats')
	// (e.g. when a new chat starts streaming) re-runs this loader and refreshes the sidebar.
	depends('app:chats');

	const recentChats = (await sql`
		SELECT id, title, mode, last_active_at
		FROM chats
		WHERE user_id = ${locals.user.id}
		ORDER BY last_active_at DESC
		LIMIT 12
	`) as unknown as Array<{
		id: string;
		title: string;
		mode: string;
		last_active_at: string;
	}>;
	return {
		user: locals.user,
		recentChats: recentChats.map((c) => ({ ...c, last_active_at: String(c.last_active_at) }))
	};
};
