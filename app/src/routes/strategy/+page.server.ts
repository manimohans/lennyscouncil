import type { PageServerLoad } from './$types';
import { sql } from '$lib/server/db';

const STRATEGY_TAGS = ['strategy', 'product-management', 'startups', 'go-to-market'];

interface ExpertSuggestion {
	slug: string;
	name: string;
	avatar_url: string | null;
	domains: string[];
}

export const load: PageServerLoad = async ({ url }) => {
	const suggestions = (await sql`
		SELECT slug, name, avatar_url, domains
		FROM experts
		WHERE NOT is_host
		  AND domains && ${STRATEGY_TAGS}
		ORDER BY appearance_count DESC
		LIMIT 8
	`) as unknown as ExpertSuggestion[];

	const requested = url.searchParams.get('expert');
	let preselect = '';
	if (requested) {
		const inList = suggestions.some((s) => s.slug === requested);
		if (!inList) {
			const extra = (await sql`
				SELECT slug, name, avatar_url, domains
				FROM experts
				WHERE slug = ${requested} AND NOT is_host
				LIMIT 1
			`) as unknown as ExpertSuggestion[];
			if (extra[0]) suggestions.unshift(extra[0]);
		}
		preselect = requested;
	}

	return { suggestions, preselect };
};
