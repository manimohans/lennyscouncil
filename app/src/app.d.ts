// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type { User } from '$lib/server/current-user';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: User;
		}
		interface PageData {
			user: User;
			recentChats?: Array<{
				id: string;
				title: string;
				mode: string;
				last_active_at: string;
			}>;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
