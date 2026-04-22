import type { Handle } from '@sveltejs/kit';
import { getCurrentUser } from '$lib/server/current-user';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await getCurrentUser();
	return resolve(event);
};
