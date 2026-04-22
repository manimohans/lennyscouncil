#!/usr/bin/env bun
import postgres from 'postgres';
import { slugifyName, HOST_CANONICAL } from '../src/lib/server/ingest/speaker-normalizer';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

const sql = postgres(dbUrl, { max: 5 });

interface SpeakerStats {
	speaker: string;
	chunk_count: number;
	total_words: number;
	first_seen: string;
	last_seen: string;
	tag_freq: Record<string, number>;
	rep_chunks: Array<{ id: number; text: string; title: string; date: string }>;
}

function deterministicAvatar(name: string): string {
	// data: URI for an SVG with initials on a hashed colour.
	const initials = name
		.split(/\s+/)
		.map((p) => p[0]?.toUpperCase() ?? '')
		.slice(0, 2)
		.join('');
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
	const hue = Math.abs(hash) % 360;
	const bg = `hsl(${hue}, 55%, 45%)`;
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='${bg}'/><text x='50%' y='50%' dy='.35em' text-anchor='middle' fill='white' font-family='ui-sans-serif,system-ui,sans-serif' font-size='26' font-weight='600'>${initials}</text></svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function topDomains(tagFreq: Record<string, number>, k = 5): string[] {
	return Object.entries(tagFreq)
		.sort((a, b) => b[1] - a[1])
		.slice(0, k)
		.map(([t]) => t);
}

async function main() {
	console.log('Aggregating speaker stats from chunks…');
	const stats = (await sql`
		WITH agg AS (
			SELECT
				speaker,
				COUNT(*)::int AS chunk_count,
				SUM(token_count)::int AS total_words,
				MIN(date) AS first_seen,
				MAX(date) AS last_seen
			FROM chunks
			GROUP BY speaker
		)
		SELECT * FROM agg
	`) as unknown as Array<{
		speaker: string;
		chunk_count: number;
		total_words: number;
		first_seen: string;
		last_seen: string;
	}>;

	console.log(`  ${stats.length} unique speakers found`);

	// Per-speaker tag frequencies (separate query to avoid expensive cross-join)
	const tagRows = (await sql`
		SELECT speaker, tag, COUNT(*)::int AS freq
		FROM chunks, unnest(tags) AS tag
		GROUP BY speaker, tag
	`) as unknown as Array<{ speaker: string; tag: string; freq: number }>;

	const tagFreqBySpeaker = new Map<string, Record<string, number>>();
	for (const r of tagRows) {
		const m = tagFreqBySpeaker.get(r.speaker) ?? {};
		m[r.tag] = r.freq;
		tagFreqBySpeaker.set(r.speaker, m);
	}

	// Top representative chunks per speaker (longest 5)
	const repRows = (await sql`
		SELECT id, speaker, text, title, date FROM (
			SELECT id, speaker, text, title, date,
			       ROW_NUMBER() OVER (PARTITION BY speaker ORDER BY token_count DESC) AS rn
			FROM chunks
		) t
		WHERE rn <= 5
	`) as unknown as Array<{
		id: number;
		speaker: string;
		text: string;
		title: string;
		date: string;
	}>;

	const repBySpeaker = new Map<string, Array<{ id: number; text: string; title: string; date: string }>>();
	for (const r of repRows) {
		const arr = repBySpeaker.get(r.speaker) ?? [];
		arr.push({ id: r.id, text: r.text, title: r.title, date: String(r.date) });
		repBySpeaker.set(r.speaker, arr);
	}

	console.log('Upserting expert rows…');
	let inserted = 0;
	let updated = 0;
	for (const s of stats) {
		const slug = slugifyName(s.speaker);
		if (!slug) continue;
		const tagFreq = tagFreqBySpeaker.get(s.speaker) ?? {};
		const domains = topDomains(tagFreq).filter((d) => !['podcast', 'newsletter'].includes(d));
		const quotes = (repBySpeaker.get(s.speaker) ?? []).map((c) => ({
			chunk_id: c.id,
			quote: c.text.slice(0, 280),
			title: c.title,
			date: c.date
		}));
		const isHost = s.speaker === HOST_CANONICAL;
		const avatar = deterministicAvatar(s.speaker);

		const result = await sql`
			INSERT INTO experts (
				slug, name, domains, signature_quotes, appearance_count, total_words,
				first_seen, last_seen, avatar_url, is_host, updated_at
			) VALUES (
				${slug}, ${s.speaker}, ${domains}, ${sql.json(quotes)},
				${s.chunk_count}, ${s.total_words},
				${s.first_seen}, ${s.last_seen}, ${avatar}, ${isHost}, now()
			)
			ON CONFLICT (slug) DO UPDATE SET
				name = EXCLUDED.name,
				domains = EXCLUDED.domains,
				signature_quotes = EXCLUDED.signature_quotes,
				appearance_count = EXCLUDED.appearance_count,
				total_words = EXCLUDED.total_words,
				first_seen = EXCLUDED.first_seen,
				last_seen = EXCLUDED.last_seen,
				avatar_url = COALESCE(experts.avatar_url, EXCLUDED.avatar_url),
				is_host = EXCLUDED.is_host,
				updated_at = now()
			RETURNING (xmax = 0) AS was_insert
		`;
		const wasInsert = (result[0] as unknown as { was_insert: boolean })?.was_insert;
		if (wasInsert) inserted++;
		else updated++;
	}

	const [{ total }] = (await sql`SELECT COUNT(*)::int AS total FROM experts`) as unknown as Array<{
		total: number;
	}>;
	const [{ host_count }] = (await sql`SELECT COUNT(*)::int AS host_count FROM experts WHERE is_host`) as unknown as Array<{
		host_count: number;
	}>;
	console.log(`\nDone — ${inserted} inserted, ${updated} updated`);
	console.log(`  experts total: ${total}`);
	console.log(`  hosts (excluded from selection): ${host_count}`);

	await sql.end();
}

main().catch((err) => {
	console.error('Failed:', err);
	process.exit(1);
});
