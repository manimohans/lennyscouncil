import { sql } from './db';
import { OllamaClient } from './ollama';

const ollamaBase = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const embedModel = process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text';

const ollama = new OllamaClient({ baseUrl: ollamaBase, embeddingModel: embedModel });

export interface RetrievedChunk {
	id: number;
	speaker: string;
	title: string;
	date: string;
	text: string;
	tags: string[];
	source_type: 'podcast' | 'newsletter';
	source_file: string;
	timestamp_str: string | null;
	score: number;
}

export interface HybridSearchOptions {
	matchCount?: number;
}

function vecLiteral(v: number[]): string {
	return `[${v.join(',')}]`;
}

export async function embedQuery(query: string): Promise<number[]> {
	const [v] = await ollama.embedMany([query]);
	return v;
}

export async function hybridSearch(
	query: string,
	options: HybridSearchOptions = {}
): Promise<RetrievedChunk[]> {
	const matchCount = options.matchCount ?? 30;
	const embedding = await embedQuery(query);
	const rows = (await sql`
		SELECT id, speaker, title, date, text, tags, source_type, source_file, timestamp_str, score
		FROM hybrid_search(${query}, ${vecLiteral(embedding)}::vector, ${matchCount})
	`) as unknown as Array<RetrievedChunk & { date: string | Date }>;
	return rows.map((r) => ({ ...r, date: toIsoDate(r.date) }));
}

function toIsoDate(d: string | Date | null | undefined): string {
	if (d == null) return '';
	const date = typeof d === 'string' ? new Date(d) : d;
	if (Number.isNaN(date.getTime())) return String(d);
	return date.toISOString().slice(0, 10);
}
