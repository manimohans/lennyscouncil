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
	}>;
	why_selected: string;
}

export interface CitationData {
	chunk_id: number;
	quote?: string;
	title?: string;
	speaker?: string;
	timestamp_str?: string | null;
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
}
