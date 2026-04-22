import type { PageServerLoad } from './$types';
import { sql } from '$lib/server/db';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q')?.trim() ?? '';
	const tag = url.searchParams.get('tag') ?? '';

	const rows = (await sql`
		SELECT id, slug, name, domains, avatar_url, appearance_count, total_words, last_seen
		FROM experts
		WHERE NOT is_host
		  AND (${q} = '' OR name ILIKE '%' || ${q} || '%')
		  AND (${tag} = '' OR ${tag} = ANY(domains))
		ORDER BY appearance_count DESC
		LIMIT 400
	`) as unknown as Array<{
		id: string;
		slug: string;
		name: string;
		domains: string[];
		avatar_url: string | null;
		appearance_count: number;
		total_words: number;
		last_seen: string;
	}>;

	const allTags = (await sql`
		SELECT DISTINCT tag FROM (
			SELECT unnest(domains) AS tag FROM experts WHERE NOT is_host
		) t
		WHERE tag NOT IN ('podcast', 'newsletter')
		ORDER BY tag
	`) as unknown as Array<{ tag: string }>;

	return {
		experts: rows.map((r) => ({ ...r, last_seen: String(r.last_seen) })),
		query: q,
		tag,
		tags: allTags.map((t) => t.tag)
	};
};
