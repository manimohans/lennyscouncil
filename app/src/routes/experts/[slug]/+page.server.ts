import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { sql } from '$lib/server/db';

export const load: PageServerLoad = async ({ params }) => {
	const expertRows = (await sql`
		SELECT id, slug, name, bio, domains, signature_quotes, frameworks, voice_summary,
		       appearance_count, total_words, first_seen, last_seen, avatar_url, is_host
		FROM experts WHERE slug = ${params.slug} LIMIT 1
	`) as unknown as Array<{
		id: string;
		slug: string;
		name: string;
		bio: string | null;
		domains: string[];
		signature_quotes: Array<{ chunk_id: number; quote: string; title: string; date: string }>;
		frameworks: string[];
		voice_summary: string | null;
		appearance_count: number;
		total_words: number;
		first_seen: string;
		last_seen: string;
		avatar_url: string | null;
		is_host: boolean;
	}>;

	if (expertRows.length === 0) throw error(404, 'Expert not found');
	const expert = expertRows[0];

	const appearances = (await sql`
		SELECT DISTINCT title, date, source_type, source_file
		FROM chunks
		WHERE speaker = ${expert.name}
		ORDER BY date DESC
		LIMIT 25
	`) as unknown as Array<{
		title: string;
		date: string;
		source_type: 'podcast' | 'newsletter';
		source_file: string;
	}>;

	return {
		expert: {
			...expert,
			first_seen: String(expert.first_seen),
			last_seen: String(expert.last_seen)
		},
		appearances: appearances.map((a) => ({ ...a, date: String(a.date) }))
	};
};
