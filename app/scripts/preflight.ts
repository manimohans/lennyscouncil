#!/usr/bin/env bun
import { OllamaClient } from '../src/lib/server/ollama';
import postgres from 'postgres';

interface CheckResult {
	name: string;
	ok: boolean;
	detail: string;
}

const env = {
	databaseUrl: process.env.DATABASE_URL,
	ollamaBase: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
	embedModel: process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text',
	chatModel: process.env.OLLAMA_CHAT_MODEL ?? 'kimi-k2.6:cloud',
	authSecret: process.env.AUTH_SECRET
};

function envChecks(): CheckResult[] {
	return [
		{
			name: 'env.DATABASE_URL',
			ok: Boolean(env.databaseUrl),
			detail: env.databaseUrl ? 'set' : 'MISSING'
		},
		{
			name: 'env.AUTH_SECRET',
			ok: Boolean(env.authSecret && env.authSecret.length >= 32),
			detail: env.authSecret
				? `${env.authSecret.length} chars`
				: 'MISSING (need ≥ 32 chars)'
		}
	];
}

async function checkPostgres(): Promise<CheckResult[]> {
	if (!env.databaseUrl) {
		return [{ name: 'postgres.reachable', ok: false, detail: 'DATABASE_URL missing' }];
	}
	const sql = postgres(env.databaseUrl, { max: 1, connect_timeout: 5 });
	const results: CheckResult[] = [];
	try {
		const [{ now }] = await sql`SELECT NOW() as now`;
		results.push({ name: 'postgres.reachable', ok: true, detail: String(now) });
		const exts =
			(await sql`SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','pg_trgm')`) as unknown as Array<{
				extname: string;
				extversion: string;
			}>;
		const has = (n: string) => exts.find((e) => e.extname === n);
		results.push({
			name: 'postgres.ext.vector',
			ok: Boolean(has('vector')),
			detail: has('vector')?.extversion ? `v${has('vector')!.extversion}` : 'NOT INSTALLED'
		});
		results.push({
			name: 'postgres.ext.pg_trgm',
			ok: Boolean(has('pg_trgm')),
			detail: has('pg_trgm')?.extversion ? `v${has('pg_trgm')!.extversion}` : 'NOT INSTALLED'
		});
	} catch (err) {
		results.push({
			name: 'postgres.reachable',
			ok: false,
			detail: err instanceof Error ? err.message : String(err)
		});
	} finally {
		await sql.end({ timeout: 1 });
	}
	return results;
}

async function checkOllama(): Promise<CheckResult[]> {
	const client = new OllamaClient({
		baseUrl: env.ollamaBase,
		embeddingModel: env.embedModel
	});
	const health = await client.health();
	const results: CheckResult[] = [
		{
			name: 'ollama.reachable',
			ok: health.ok,
			detail: health.ok ? `${env.ollamaBase} (${health.models.length} models)` : 'unreachable'
		},
		{
			name: `ollama.model.${env.embedModel}`,
			ok: health.embeddingModelAvailable,
			detail: health.embeddingModelAvailable ? 'pulled' : 'not pulled'
		},
		{
			name: `ollama.model.${env.chatModel}`,
			ok: health.chatModelAvailable(env.chatModel),
			detail: health.chatModelAvailable(env.chatModel) ? 'pulled' : 'not pulled'
		}
	];

	if (health.ok && health.embeddingModelAvailable) {
		try {
			const vec = await client.embed('preflight test');
			results.push({
				name: 'ollama.embed.dim',
				ok: vec.length === 768,
				detail: `${vec.length} dims (expected 768)`
			});
		} catch (err) {
			results.push({
				name: 'ollama.embed.dim',
				ok: false,
				detail: err instanceof Error ? err.message : String(err)
			});
		}
	}

	if (health.ok && health.chatModelAvailable(env.chatModel)) {
		try {
			const reply = await client.chat({
				model: env.chatModel,
				messages: [{ role: 'user', content: "Reply with the single word 'pong'." }],
				maxTokens: 200
			});
			const ok = reply.toLowerCase().includes('pong');
			results.push({
				name: 'ollama.chat.smoketest',
				ok,
				detail: ok ? `reply: ${reply.trim().slice(0, 60)}` : `unexpected: ${reply.slice(0, 100)}`
			});
		} catch (err) {
			results.push({
				name: 'ollama.chat.smoketest',
				ok: false,
				detail: err instanceof Error ? err.message : String(err)
			});
		}
	}

	return results;
}

async function main() {
	console.log('Running preflight…\n');
	const groups: CheckResult[] = [];
	groups.push(...envChecks());
	groups.push(...(await checkPostgres()));
	groups.push(...(await checkOllama()));

	const pad = Math.max(...groups.map((g) => g.name.length));
	for (const g of groups) {
		const icon = g.ok ? '✓' : '✗';
		console.log(`  ${icon}  ${g.name.padEnd(pad)}  ${g.detail}`);
	}

	const failed = groups.filter((g) => !g.ok);
	console.log(`\n${groups.length - failed.length} / ${groups.length} checks passed`);
	process.exit(failed.length === 0 ? 0 : 1);
}

main();
