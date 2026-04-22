// Single-user shim for local dev.
// When migrating to Supabase, replace with real auth — the rest of the app
// just calls `getCurrentUser()` and doesn't care how the user is identified.

import { sql } from './db';

const LOCAL_EMAIL = 'local@lennysroundtable.dev';
const LOCAL_NAME = 'Local User';
// Stable placeholder hash: real auth disabled in local mode.
const LOCAL_PASSWORD_HASH = 'local-dev-no-auth';

export interface User {
	id: string;
	email: string;
	display_name: string | null;
	created_at: string;
}

let cached: User | null = null;

export async function getCurrentUser(): Promise<User> {
	if (cached) return cached;

	const existing = (await sql`
		SELECT id, email, display_name, created_at FROM users WHERE email = ${LOCAL_EMAIL} LIMIT 1
	`) as unknown as User[];

	if (existing.length > 0) {
		cached = existing[0];
		return cached;
	}

	const inserted = (await sql`
		INSERT INTO users (email, display_name, password_hash)
		VALUES (${LOCAL_EMAIL}, ${LOCAL_NAME}, ${LOCAL_PASSWORD_HASH})
		RETURNING id, email, display_name, created_at
	`) as unknown as User[];

	cached = inserted[0];
	return cached;
}
