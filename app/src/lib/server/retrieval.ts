import { sql } from './db';
import { OllamaClient } from './ollama';

const ollamaBase = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const embedModel = process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text';

const ollama = new OllamaClient({ baseUrl: ollamaBase, embeddingModel: embedModel });

export interface RetrievedChunk {
	id: number;
	speaker: string;
	speaker_id: string | null;
	title: string;
	date: string;
	text: string;
	tags: string[];
	source_type: 'podcast' | 'newsletter';
	source_file: string;
	source_url: string | null;
	timestamp_str: string | null;
	score: number;
}

export interface HybridSearchOptions {
	matchCount?: number;
	/** Optional list of expert UUIDs to constrain retrieval to. */
	speakerIds?: string[];
	/** Optional pre-computed embedding (to avoid a second Ollama round-trip). */
	embedding?: number[];
}

function vecLiteral(v: number[]): string {
	return `[${v.join(',')}]`;
}

export async function embedQuery(query: string): Promise<number[]> {
	const [v] = await ollama.embedMany([query]);
	return v;
}

/**
 * pgvector's HNSW default `ef_search=40` tanks recall at our scale (45k
 * vectors, 768 dim). We bump to 100 for the query. Wrapped in a tx so the
 * `SET LOCAL` actually applies to the subsequent SELECT (postgres-js runs
 * each `sql` outside a tx by default).
 */
export async function hybridSearch(
	query: string,
	options: HybridSearchOptions = {}
): Promise<RetrievedChunk[]> {
	const matchCount = options.matchCount ?? 30;
	const embedding = options.embedding ?? (await embedQuery(query));
	const speakerIds = options.speakerIds && options.speakerIds.length > 0 ? options.speakerIds : null;

	const rows = (await sql.begin(async (tx) => {
		try {
			await tx`SET LOCAL hnsw.ef_search = 100`;
		} catch {
			// pgvector < 0.5 — ignore.
		}
		return tx`
			SELECT id, speaker, speaker_id, title, date, text, tags,
			       source_type, source_file, source_url, timestamp_str, score
			FROM hybrid_search(
				${query},
				${vecLiteral(embedding)}::vector,
				${matchCount},
				60,
				${speakerIds}::uuid[]
			)
		`;
	})) as unknown as Array<RetrievedChunk & { date: string | Date }>;
	return rows.map((r) => ({ ...r, date: toIsoDate(r.date) }));
}

function toIsoDate(d: string | Date | null | undefined): string {
	if (d == null) return '';
	const date = typeof d === 'string' ? new Date(d) : d;
	if (Number.isNaN(date.getTime())) return String(d);
	return date.toISOString().slice(0, 10);
}
