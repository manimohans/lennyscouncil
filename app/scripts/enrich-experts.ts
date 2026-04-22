#!/usr/bin/env bun
// Enrich expert profiles with bio + frameworks + voice_summary.
//
// GROUND TRUTH STRATEGY (replaces previous web-search/LLM-prior approach):
// The corpus already contains Lenny's spoken intro at the start of each
// podcast ("Today my guest is X. X is the [role] at [company]. Before that…").
// That's the authoritative source for "who they were AT THE TIME OF RECORDING".
//
// We pull the first ~5 Lenny Rachitsky chunks from each of the guest's podcast
// source_files (chronologically ordered), plus the guest's own top quotes for
// style / recurring frameworks. The LLM is instructed to ground every factual
// claim in those intros — no training priors allowed.
//
// Usage:
//   bun run enrich-experts                 # all experts that need it
//   bun run enrich-experts --force         # re-enrich everyone
//   bun run enrich-experts --limit 5       # testing
//   bun run enrich-experts --concurrency 3

import postgres from 'postgres';
import { parseArgs } from 'node:util';
import { OllamaClient, MODELS } from '../src/lib/server/ollama';

const { values } = parseArgs({
	options: {
		force: { type: 'boolean', default: false },
		limit: { type: 'string' },
		concurrency: { type: 'string', default: '3' },
		model: { type: 'string' }
	}
});

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

const sql = postgres(dbUrl, { max: 5 });
const ollama = new OllamaClient({
	baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
	embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text'
});

const MODEL = values.model ?? MODELS.expert;

const HOST_CANONICAL = 'Lenny Rachitsky';

interface ExpertRow {
	id: string;
	slug: string;
	name: string;
	domains: string[];
	appearance_count: number;
	bio: string | null;
}

interface AppearanceIntro {
	source_file: string;
	title: string;
	date: string;
	intro_text: string;
}

interface EnrichedProfile {
	bio: string;
	frameworks: string[];
	voice_summary: string;
}

const SYSTEM_PROMPT = `You profile a real-world expert based on (1) LENNY'S INTRO of them from one or more podcast appearances, and (2) their own quotes. Output ONE JSON object with EXACTLY these three keys: bio, frameworks, voice_summary. NOTHING ELSE. No markdown fences. No prose before or after.

Required output shape:
{"bio": "...", "frameworks": ["...", "..."], "voice_summary": "..."}

CRITICAL ACCURACY RULES — real users (PMs, founders) will read this. Zero hallucination tolerance:
- Every factual claim (role, company, school, publication, year, number) MUST appear in Lenny's intro or the guest's own quotes. If not in the source, DO NOT write it. Not even to fill in the bio.
- DO NOT use prior training knowledge to fill in current role or past employers. Only what's in the sources.
- If Lenny introduced them across multiple appearances, phrase the bio around what was true AT THE TIME of the earliest / most recent appearance (e.g. "At the time of her 2024 appearance, she was VP of Product at…").
- When multiple appearances show a role change over time, note the progression.
- If Lenny's intro didn't state their current role/company clearly, describe them by what they DO (from their quotes / frameworks), not a fabricated title.

Field rules:
- bio: 2-3 sentences in THIRD PERSON. Lead with what Lenny said about them (role/company at time), then their signature POV from their quotes.
- frameworks: 3-6 short strings (≤ 12 words each), each grounded in their quotes.
- voice_summary: 1-2 sentences on HOW they speak — tone, characteristic moves.

Schema is strict. NO extra keys.`;

async function loadExpertsToProcess(): Promise<ExpertRow[]> {
	const limit = values.limit ? Number.parseInt(values.limit) : null;
	const force = values.force;
	const limitClause = limit ? sql`LIMIT ${limit}` : sql``;
	const whereClause = force
		? sql`NOT is_host`
		: sql`NOT is_host AND (bio IS NULL OR bio = '')`;
	const rows = (await sql`
		SELECT id, slug, name, domains, appearance_count, bio
		FROM experts
		WHERE ${whereClause}
		ORDER BY appearance_count DESC
		${limitClause}
	`) as unknown as ExpertRow[];
	return rows;
}

async function loadAppearanceIntros(name: string): Promise<AppearanceIntro[]> {
	// For each podcast where this expert is the guest (identified via chunks where
	// they speak), grab the first ~5 Lenny Rachitsky chunks — those contain the intro.
	const rows = (await sql`
		WITH guest_files AS (
			SELECT DISTINCT source_file, title, date
			FROM chunks
			WHERE speaker = ${name}
			  AND source_type = 'podcast'
		),
		intros AS (
			SELECT
				c.source_file,
				c.text,
				c.id,
				ROW_NUMBER() OVER (PARTITION BY c.source_file ORDER BY c.id) AS rn
			FROM chunks c
			JOIN guest_files gf USING (source_file)
			WHERE c.speaker = ${HOST_CANONICAL}
		)
		SELECT gf.source_file, gf.title, gf.date::text AS date,
		       string_agg(i.text, E'\n\n' ORDER BY i.id) AS intro_text
		FROM guest_files gf
		LEFT JOIN intros i ON i.source_file = gf.source_file AND i.rn <= 5
		GROUP BY gf.source_file, gf.title, gf.date
		ORDER BY gf.date
	`) as unknown as AppearanceIntro[];
	return rows.filter((r) => r.intro_text && r.intro_text.trim().length > 0);
}

async function loadOwnQuotes(name: string, max = 4): Promise<string[]> {
	const rows = (await sql`
		SELECT text FROM (
			SELECT text, token_count,
			       ROW_NUMBER() OVER (ORDER BY token_count DESC) AS rn
			FROM chunks WHERE speaker = ${name}
		) t WHERE rn <= ${max}
	`) as unknown as Array<{ text: string }>;
	return rows.map((r) => r.text.replace(/\s+/g, ' ').slice(0, 500));
}

function tryParseJson(s: string): EnrichedProfile | null {
	const cleaned = s
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/```\s*$/i, '')
		.trim();
	const match = cleaned.match(/\{[\s\S]*\}/);
	if (!match) return null;
	try {
		const parsed = JSON.parse(match[0]);
		if (
			typeof parsed.bio === 'string' &&
			Array.isArray(parsed.frameworks) &&
			typeof parsed.voice_summary === 'string'
		) {
			return {
				bio: parsed.bio.trim(),
				frameworks: parsed.frameworks
					.map((f: unknown) => String(f).trim())
					.filter((f: string) => f.length > 0)
					.slice(0, 6),
				voice_summary: parsed.voice_summary.trim()
			};
		}
		return null;
	} catch {
		return null;
	}
}

async function enrichOne(e: ExpertRow): Promise<EnrichedProfile | null> {
	const [intros, ownQuotes] = await Promise.all([
		loadAppearanceIntros(e.name),
		loadOwnQuotes(e.name)
	]);

	// Newsletter-only speakers (no podcast intros) — skip for now.
	// Host is already excluded.
	if (intros.length === 0 && ownQuotes.length === 0) return null;

	const introBlock =
		intros.length === 0
			? '(no podcast intros — this person only appears in newsletters)'
			: intros
					.map(
						(a) =>
							`=== ${a.date} — "${a.title}" ===\n${a.intro_text.replace(/\s+/g, ' ').slice(0, 2000)}`
					)
					.join('\n\n');

	const quoteBlock =
		ownQuotes.length === 0
			? '(no guest quotes)'
			: ownQuotes.map((q, i) => `[${i + 1}] ${q}`).join('\n\n');

	const userPrompt = [
		`Profile this person: ${e.name}`,
		`Appearances in the archive: ${intros.length} podcast${intros.length === 1 ? '' : 's'}`,
		'',
		"LENNY'S INTRO(S) — the authoritative source for role/company AT TIME OF RECORDING:",
		introBlock,
		'',
		'THEIR OWN QUOTES — use for style, POV, and recurring frameworks:',
		quoteBlock
	].join('\n');

	// `think: false` — JSON output reliability depends on the model spending
	// its budget on content rather than reasoning.
	const reply = await ollama.chat({
		model: MODEL,
		messages: [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: userPrompt }
		],
		temperature: 0.25,
		maxTokens: 2500,
		think: false
	});
	return tryParseJson(reply);
}

async function persist(e: ExpertRow, p: EnrichedProfile): Promise<void> {
	await sql`
		UPDATE experts
		SET bio = ${p.bio},
		    frameworks = ${p.frameworks},
		    voice_summary = ${p.voice_summary},
		    updated_at = now()
		WHERE id = ${e.id}
	`;
}

async function main() {
	const targets = await loadExpertsToProcess();
	console.log(`${targets.length} experts to enrich (model: ${MODEL})`);
	if (targets.length === 0) {
		await sql.end();
		return;
	}

	const concurrency = Number.parseInt(values.concurrency!);
	let cursor = 0;
	let done = 0;
	let failed = 0;
	let skipped = 0;
	const failedNames: string[] = [];
	const startedAt = Date.now();

	function status() {
		const elapsed = (Date.now() - startedAt) / 1000;
		const rate = done / Math.max(elapsed, 1);
		const eta = rate > 0 ? Math.round((targets.length - done) / rate) : 0;
		process.stdout.write(
			`\r  [${done}/${targets.length}] ok=${done - failed - skipped} failed=${failed} skipped=${skipped}  ${rate.toFixed(2)}/s  eta=${eta}s   `
		);
	}

	const worker = async () => {
		while (cursor < targets.length) {
			const idx = cursor++;
			const e = targets[idx];
			try {
				const profile = await enrichOne(e);
				if (profile) {
					await persist(e, profile);
				} else {
					skipped++;
				}
			} catch (err) {
				failed++;
				failedNames.push(`${e.name} (${(err as Error).message.slice(0, 60)})`);
			}
			done++;
			status();
		}
	};

	await Promise.all(Array.from({ length: concurrency }, worker));

	process.stdout.write('\n');
	console.log(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
	console.log(`  succeeded: ${done - failed - skipped}`);
	console.log(`  skipped (newsletter-only or no quotes): ${skipped}`);
	console.log(`  failed:    ${failed}`);
	if (failedNames.length > 0 && failedNames.length <= 20) {
		failedNames.forEach((n) => console.log(`    - ${n}`));
	}

	await sql.end();
}

main().catch((err) => {
	console.error('\nEnrichment failed:', err);
	process.exit(1);
});
