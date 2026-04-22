import { sql } from './db';
import { embedQuery, hybridSearch, type RetrievedChunk } from './retrieval';

export interface SelectedExpert {
	expert_id: string;
	name: string;
	slug: string;
	domains: string[];
	avatar_url: string | null;
	matching_chunks: number;
	avg_score: number;
	most_recent: string;
	grounding_quotes: Array<{
		chunk_id: number;
		text: string;
		title: string;
		date: string;
		timestamp_str: string | null;
		source_url: string | null;
	}>;
	why_selected: string;
}

export interface SelectExpertsOptions {
	topK?: number;
	excludeHosts?: boolean;
	chunkPool?: number;
	/** Optional pre-computed embedding to avoid redundant Ollama round-trip. */
	embedding?: number[];
}

export interface SelectExpertsResult {
	experts: SelectedExpert[];
	embedding: number[];
}

function vecLiteral(v: number[]): string {
	return `[${v.join(',')}]`;
}

function buildWhySelected(name: string, domains: string[], chunkCount: number): string {
	const topDomains = domains.slice(0, 3).join(', ');
	const what = topDomains ? `expertise in ${topDomains}` : 'broad coverage';
	return `${chunkCount} relevant excerpt${chunkCount === 1 ? '' : 's'} from ${name}'s ${what}.`;
}

export async function selectExperts(
	query: string,
	options: SelectExpertsOptions = {}
): Promise<SelectedExpert[]> {
	const result = await selectExpertsWithEmbedding(query, options);
	return result.experts;
}

/**
 * Variant that also returns the embedding used for selection, so callers
 * (e.g. orchestrators) can reuse it for per-expert retrieval instead of
 * embedding the query twice.
 */
export async function selectExpertsWithEmbedding(
	query: string,
	options: SelectExpertsOptions = {}
): Promise<SelectExpertsResult> {
	const topK = options.topK ?? 4;
	const chunkPool = options.chunkPool ?? 80;
	const excludeHosts = options.excludeHosts ?? true;
	const embedding = options.embedding ?? (await embedQuery(query));

	const ranked = (await sql`
		SELECT expert_id, name, slug, domains, avatar_url,
		       matching_chunks, avg_score, most_recent, representative_chunk_ids
		FROM rank_experts_for_query(
			${query},
			${vecLiteral(embedding)}::vector,
			${topK},
			${chunkPool},
			${excludeHosts}
		)
	`) as unknown as Array<{
		expert_id: string;
		name: string;
		slug: string;
		domains: string[];
		avatar_url: string | null;
		matching_chunks: number;
		avg_score: number;
		most_recent: string;
		representative_chunk_ids: number[];
	}>;

	if (ranked.length === 0) return { experts: [], embedding };

	const allRepIds = ranked.flatMap((r) => r.representative_chunk_ids ?? []);
	const chunkRows =
		allRepIds.length === 0
			? []
			: ((await sql`
					SELECT id, text, title, date, timestamp_str, source_url
					FROM chunks
					WHERE id = ANY(${allRepIds})
				`) as unknown as Array<{
					id: number;
					text: string;
					title: string;
					date: string;
					timestamp_str: string | null;
					source_url: string | null;
				}>);

	const chunkById = new Map(chunkRows.map((c) => [c.id, c]));

	const experts = ranked.map((r) => ({
		expert_id: r.expert_id,
		name: r.name,
		slug: r.slug,
		domains: r.domains,
		avatar_url: r.avatar_url,
		matching_chunks: r.matching_chunks,
		avg_score: r.avg_score,
		most_recent: toIsoDate(r.most_recent),
		grounding_quotes: (r.representative_chunk_ids ?? [])
			.map((id) => chunkById.get(id))
			.filter((c): c is NonNullable<typeof c> => Boolean(c))
			.map((c) => ({
				chunk_id: c.id,
				text: c.text,
				title: c.title,
				date: toIsoDate(c.date),
				timestamp_str: c.timestamp_str,
				source_url: c.source_url
			})),
		why_selected: buildWhySelected(r.name, r.domains, r.matching_chunks)
	}));

	return { experts, embedding };
}

function toIsoDate(d: string | Date | null | undefined): string {
	if (d == null) return '';
	const date = typeof d === 'string' ? new Date(d) : d;
	if (Number.isNaN(date.getTime())) return String(d);
	return date.toISOString().slice(0, 10);
}

// Re-export for convenience
export type { RetrievedChunk };
export { hybridSearch };
