#!/usr/bin/env bun
import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

const sql = postgres(url, { max: 1 });

async function ensureMigrationsTable() {
	await sql`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name        text PRIMARY KEY,
			applied_at  timestamptz NOT NULL DEFAULT now()
		)
	`;
}

async function main() {
	await ensureMigrationsTable();

	const applied = (await sql`SELECT name FROM schema_migrations`) as unknown as Array<{
		name: string;
	}>;
	const appliedSet = new Set(applied.map((r) => r.name));

	const files = (await readdir(migrationsDir))
		.filter((f) => f.endsWith('.sql'))
		.sort();

	const pending = files.filter((f) => !appliedSet.has(f));

	if (pending.length === 0) {
		console.log(`Up to date — ${applied.length} migration(s) applied.`);
		await sql.end();
		return;
	}

	console.log(`Applying ${pending.length} migration(s)…\n`);
	for (const file of pending) {
		const path = join(migrationsDir, file);
		const text = await readFile(path, 'utf8');
		console.log(`→ ${file}`);
		try {
			await sql.begin(async (tx) => {
				await tx.unsafe(text);
				await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
			});
			console.log(`  ✓ applied`);
		} catch (err) {
			console.error(`  ✗ failed: ${err instanceof Error ? err.message : err}`);
			await sql.end();
			process.exit(1);
		}
	}
	console.log(`\nDone — ${pending.length} new migration(s) applied.`);
	await sql.end();
}

main();
