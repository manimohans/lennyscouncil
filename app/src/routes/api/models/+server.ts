import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ollamaBase = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

interface OllamaTagsModel {
	name: string;
	model: string;
	size: number;
	details?: {
		parameter_size?: string;
		families?: string[];
	};
}

export interface ListedModel {
	name: string;
	family: string;
	size_mb: number;
	param_size: string;
	is_embedding: boolean;
}

const EMBEDDING_FAMILIES = new Set(['nomic-bert', 'bert', 'embedding']);

export const GET: RequestHandler = async () => {
	try {
		const res = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(4000) });
		if (!res.ok) return json({ models: [], error: `ollama tags ${res.status}` }, { status: 200 });
		const data = (await res.json()) as { models?: OllamaTagsModel[] };
		const models: ListedModel[] = (data.models ?? [])
			.map((m) => {
				const family = m.details?.families?.[0] ?? '';
				return {
					name: m.name,
					family,
					size_mb: Math.round(m.size / (1024 * 1024)),
					param_size: m.details?.parameter_size ?? '',
					is_embedding: EMBEDDING_FAMILIES.has(family)
				};
			})
			// Hide embedding-only models from the picker; they're not chat models
			.filter((m) => !m.is_embedding);
		return json({ models });
	} catch (err) {
		return json(
			{ models: [], error: err instanceof Error ? err.message : String(err) },
			{ status: 200 }
		);
	}
};
