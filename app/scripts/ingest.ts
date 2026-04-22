#!/usr/bin/env bun
import { readdir, readFile } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import matter from 'gray-matter';
import postgres from 'postgres';
import { parseArgs } from 'node:util';
import { OllamaClient } from '../src/lib/server/ollama';
import { chunkPodcast, chunkNewsletter, type Chunk } from '../src/lib/server/ingest/chunker';

const { values } = parseArgs({
	options: {
		limit: { type: 'string' },
		'source-type': { type: 'string' },
		concurrency: { type: 'string', default: '4' },
		'batch-size': { type: 'string', default: '100' }
	}
});

const limit = values.limit ? Number.parseInt(values.limit) : undefined;
const sourceFilter = values['source-type'] as 'podcast' | 'newsletter' | undefined;
const concurrency = Number.parseInt(values.concurrency!);
const batchSize = Number.parseInt(values['batch-size']!);

const dbUrl = process.env.DATABASE_URL;
const corpusPath = process.env.CORPUS_PATH ?? '../lennys-newsletterpodcastdata-all';
const ollamaBase = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const embedModel = process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text';

if (!dbUrl) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

const sql = postgres(dbUrl, { max: 5 });
const ollama = new OllamaClient({ baseUrl: ollamaBase, embeddingModel: embedModel });

interface FileTask {
	path: string;
	type: 'podcast' | 'newsletter';
}

async function gatherFiles(root: string): Promise<FileTask[]> {
	const out: FileTask[] = [];
	if (!sourceFilter || sourceFilter === 'podcast') {
		const podcasts = await readdir(join(root, 'podcasts'));
		for (const f of podcasts) {
			if (f.endsWith('.md')) out.push({ path: join(root, 'podcasts', f), type: 'podcast' });
		}
	}
	if (!sourceFilter || sourceFilter === 'newsletter') {
		const news = await readdir(join(root, 'newsletters'));
		for (const f of news) {
			if (f.endsWith('.md')) out.push({ path: join(root, 'newsletters', f), type: 'newsletter' });
		}
	}
	out.sort((a, b) => a.path.localeCompare(b.path));
	return out;
}

interface FrontmatterPodcast {
	title: string;
	date: string;
	tags: string[];
	guest: string;
}
interface FrontmatterNewsletter {
	title: string;
	date: string;
	tags: string[];
}

function parseFile(file: FileTask, raw: string): Chunk[] {
	const parsed = matter(raw);
	const fm = parsed.data as Record<string, unknown>;
	const relPath = `${file.type === 'podcast' ? 'podcasts' : 'newsletters'}/${basename(file.path)}`;

	if (file.type === 'podcast') {
		const pfm: FrontmatterPodcast = {
			title: String(fm.title ?? ''),
			date: String(fm.date ?? '1970-01-01'),
			tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
			guest: String(fm.guest ?? '')
		};
		return chunkPodcast(relPath, parsed.content, pfm);
	}
	const nfm: FrontmatterNewsletter = {
		title: String(fm.title ?? ''),
		date: String(fm.date ?? '1970-01-01'),
		tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : []
	};
	return chunkNewsletter(relPath, parsed.content, nfm);
}

async function existingHashes(hashes: string[]): Promise<Set<string>> {
	if (hashes.length === 0) return new Set();
	const rows = (await sql`
		SELECT content_hash FROM chunks WHERE content_hash = ANY(${hashes})
	`) as unknown as Array<{ content_hash: string }>;
	return new Set(rows.map((r) => r.content_hash));
}

async function embedChunks(chunks: Chunk[]): Promise<Array<Chunk & { embedding: number[] }>> {
	const texts = chunks.map((c) => c.text);
	const vectors = await ollama.embedBatch(texts, concurrency);
	return chunks.map((c, i) => ({ ...c, embedding: vectors[i] }));
}

function vecLiteral(v: number[]): string {
	return `[${v.join(',')}]`;
}

async function insertBatch(rows: Array<Chunk & { embedding: number[] }>) {
	if (rows.length === 0) return 0;
	const values = rows.map((r) => ({
		source_file: r.source_file,
		source_type: r.source_type,
		speaker: r.speaker,
		title: r.title,
		date: r.date,
		tags: r.tags,
		text: r.text,
		embedding: vecLiteral(r.embedding),
		token_count: r.token_count,
		content_hash: r.content_hash,
		timestamp_str: r.timestamp_str ?? null,
		heading_trail: r.heading_trail ?? null
	}));
	const result = await sql`
		INSERT INTO chunks ${sql(values)}
		ON CONFLICT (content_hash) DO NOTHING
	`;
	return result.count;
}

function progressBar(done: number, total: number, label: string) {
	const pct = total === 0 ? 0 : Math.floor((done / total) * 100);
	const bar = '█'.repeat(Math.floor(pct / 5)).padEnd(20, '░');
	process.stdout.write(`\r  ${bar} ${pct.toString().padStart(3)}% [${done}/${total}] ${label}`);
}

async function main() {
	const root = resolve(corpusPath);
	console.log(`Corpus: ${root}\n`);

	const files = await gatherFiles(root);
	const limited = limit ? files.slice(0, limit) : files;
	console.log(`Files: ${limited.length}${limit ? ` (limited from ${files.length})` : ''}\n`);

	let totalChunks = 0;
	let totalNew = 0;
	let totalSkipped = 0;
	const startedAt = Date.now();

	for (let i = 0; i < limited.length; i++) {
		const file = limited[i];
		const raw = await readFile(file.path, 'utf8');
		const chunks = parseFile(file, raw);
		totalChunks += chunks.length;
		const label = `${basename(file.path)} (${chunks.length} chunks)`;

		const existing = await existingHashes(chunks.map((c) => c.content_hash));
		const fresh = chunks.filter((c) => !existing.has(c.content_hash));
		totalSkipped += chunks.length - fresh.length;

		if (fresh.length === 0) {
			progressBar(i + 1, limited.length, `skipped ${label}`);
			continue;
		}

		// Embed in batches to bound memory
		for (let j = 0; j < fresh.length; j += batchSize) {
			const batch = fresh.slice(j, j + batchSize);
			const embedded = await embedChunks(batch);
			const inserted = await insertBatch(embedded);
			totalNew += inserted;
			progressBar(i + 1, limited.length, `${label}, +${totalNew} new`);
		}
	}

	process.stdout.write('\n');
	const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
	console.log(`\nDone in ${elapsed}s`);
	console.log(`  files processed:  ${limited.length}`);
	console.log(`  chunks generated: ${totalChunks}`);
	console.log(`  inserted new:     ${totalNew}`);
	console.log(`  skipped (dup):    ${totalSkipped}`);

	const [{ count }] = (await sql`SELECT COUNT(*)::int AS count FROM chunks`) as unknown as Array<{
		count: number;
	}>;
	console.log(`  total in DB:      ${count}`);

	await sql.end();
}

main().catch((err) => {
	console.error('\nIngest failed:', err);
	process.exit(1);
});
