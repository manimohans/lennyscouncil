#!/usr/bin/env bun
/**
 * Re-reads every file in the corpus, extracts the article URL from frontmatter
 * (podcast: youtube_url, newsletter: post_url), and UPDATEs the matching
 * chunks + citations in place. Idempotent — safe to re-run.
 *
 * Use when migrating an existing database to the 0004 schema without
 * re-embedding the whole corpus.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';
import postgres from 'postgres';

const dbUrl = process.env.DATABASE_URL;
const corpusPath = process.env.CORPUS_PATH ?? '../lennys-newsletterpodcastdata-all';

if (!dbUrl) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

const sql = postgres(dbUrl, { max: 4 });

interface FileEntry {
	relPath: string;
	absPath: string;
	url: string | null;
}

async function gather(root: string): Promise<FileEntry[]> {
	const out: FileEntry[] = [];
	for (const [sub, key] of [
		['podcasts', 'youtube_url'],
		['newsletters', 'post_url']
	] as const) {
		const dir = join(root, sub);
		const files = await readdir(dir);
		for (const f of files) {
			if (!f.endsWith('.md')) continue;
			const abs = join(dir, f);
			const raw = await readFile(abs, 'utf8');
			const { data } = matter(raw);
			const url = typeof data[key] === 'string' ? (data[key] as string) : null;
			out.push({ relPath: `${sub}/${f}`, absPath: abs, url });
		}
	}
	return out;
}

async function main() {
	const root = resolve(corpusPath);
	console.log(`Corpus: ${root}\n`);

	const files = await gather(root);
	console.log(`Files: ${files.length}`);
	const withUrl = files.filter((f) => f.url);
	console.log(`With URL: ${withUrl.length}`);
	console.log(`Without URL: ${files.length - withUrl.length}\n`);

	let updatedChunks = 0;
	let updatedCitations = 0;

	for (const f of withUrl) {
		const r = await sql`
			UPDATE chunks
			   SET source_url = ${f.url}
			 WHERE source_file = ${f.relPath}
			   AND (source_url IS NULL OR source_url <> ${f.url})
		`;
		updatedChunks += r.count;
	}

	// Backfill citations from chunks (denormalised copy).
	const ci = await sql`
		UPDATE citations ci
		   SET source_url = c.source_url,
		       speaker    = COALESCE(ci.speaker, c.speaker),
		       title      = COALESCE(ci.title, c.title),
		       cited_date = COALESCE(ci.cited_date, c.date)
		  FROM chunks c
		 WHERE c.id = ci.chunk_id
		   AND (ci.source_url IS DISTINCT FROM c.source_url
		     OR ci.speaker IS NULL OR ci.title IS NULL OR ci.cited_date IS NULL)
	`;
	updatedCitations = ci.count;

	// Also make sure speaker_id is populated (harmless if already set).
	const sr = await sql`
		UPDATE chunks c
		   SET speaker_id = e.id
		  FROM experts e
		 WHERE c.speaker_id IS NULL
		   AND e.name = c.speaker
	`;

	console.log(`Updated chunks:    ${updatedChunks}`);
	console.log(`Updated citations: ${updatedCitations}`);
	console.log(`speaker_id filled: ${sr.count}`);

	await sql`ANALYZE chunks`;
	console.log('ANALYZE chunks done.');

	await sql.end();
}

main().catch((err) => {
	console.error('Backfill failed:', err);
	process.exit(1);
});
