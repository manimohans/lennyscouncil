import type { PageServerLoad } from './$types';
import { sql } from '$lib/server/db';

const MENTOR_TAGS = ['career', 'leadership', 'organization'];

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
		  AND domains && ${MENTOR_TAGS}
		ORDER BY appearance_count DESC
		LIMIT 8
	`) as unknown as ExpertSuggestion[];

	// If a specific expert was requested via ?expert=slug (e.g. from the expert
	// detail page), make sure they're in the suggestions so the picker can
	// pre-select them — even if they're not in the default leadership list.
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
