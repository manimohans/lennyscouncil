export interface ExpertCardData {
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
		source_url?: string | null;
	}>;
	why_selected: string;
}

export interface CitationData {
	chunk_id: number;
	/** Article URL (YouTube for podcasts, newsletter post URL for newsletters). */
	source_url?: string | null;
	/** Denormalised fields for hovercards — populated at citation write time. */
	speaker?: string | null;
	title?: string | null;
	date?: string | null;
	timestamp_str?: string | null;
	/** Legacy: not rendered any more (we don't surface chunk quotes in the UI). */
	quote?: string;
}

export interface TurnState {
	expertId: string;
	expertName: string;
	role: 'expert' | 'moderator' | 'synthesis';
	round: number;
	turnNumber: number;
	thinking: string;
	content: string;
	done: boolean;
	citations: CitationData[];
	/** Only populated for validate-mode expert turns. */
	scorecard?: {
		axes: Array<{ name: string; score: number; note: string }>;
		verdict_hint?: 'build' | 'sharpen' | 'kill';
	} | null;
}
