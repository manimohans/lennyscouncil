// Direct client for Ollama Cloud REST endpoints (web_search, web_fetch).
// These are NOT exposed by the local daemon proxy and require the cloud API key.
import { z } from 'zod';

const SearchResult = z.object({
	title: z.string(),
	url: z.string(),
	content: z.string()
});
const SearchResponse = z.object({
	results: z.array(SearchResult)
});
export type WebSearchResult = z.infer<typeof SearchResult>;

const FetchResponse = z.object({
	title: z.string().optional(),
	content: z.string(),
	links: z.array(z.string()).optional()
});

export interface OllamaCloudConfig {
	apiKey: string;
	baseUrl?: string;
}

export class OllamaCloudClient {
	private readonly baseUrl: string;
	constructor(private readonly config: OllamaCloudConfig) {
		this.baseUrl = config.baseUrl ?? 'https://ollama.com';
	}

	async webSearch(query: string, maxResults = 5): Promise<WebSearchResult[]> {
		const res = await fetch(`${this.baseUrl}/api/web_search`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.config.apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ query, max_results: Math.max(1, Math.min(10, maxResults)) })
		});
		if (!res.ok) {
			const body = await res.text();
			throw new Error(
				`web_search ${res.status} ${res.statusText} — ${body.slice(0, 200)}`
			);
		}
		return SearchResponse.parse(await res.json()).results;
	}

	async webFetch(url: string): Promise<{ title?: string; content: string; links?: string[] }> {
		const res = await fetch(`${this.baseUrl}/api/web_fetch`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.config.apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ url })
		});
		if (!res.ok) {
			const body = await res.text();
			throw new Error(`web_fetch ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
		}
		return FetchResponse.parse(await res.json());
	}
}
