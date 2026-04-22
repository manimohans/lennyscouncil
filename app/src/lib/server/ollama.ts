import { z } from 'zod';

const EmbeddingResponse = z.object({
	embeddings: z.array(z.array(z.number()))
});

const ChatStreamChunk = z.object({
	model: z.string().optional(),
	message: z
		.object({
			role: z.string(),
			content: z.string().optional(),
			thinking: z.string().optional()
		})
		.optional(),
	done: z.boolean().optional(),
	done_reason: z.string().optional()
});

export type OllamaRole = 'system' | 'user' | 'assistant';

export interface OllamaMessage {
	role: OllamaRole;
	content: string;
}

export interface OllamaChatOptions {
	model: string;
	messages: OllamaMessage[];
	temperature?: number;
	maxTokens?: number;
	stop?: string[];
	think?: boolean;
}

export type OllamaChatEvent =
	| { kind: 'thinking'; delta: string }
	| { kind: 'content'; delta: string }
	| { kind: 'done'; reason?: string };

export interface OllamaConfig {
	baseUrl: string;
	embeddingModel: string;
}

export class OllamaClient {
	constructor(private readonly config: OllamaConfig) {}

	async embed(text: string): Promise<number[]> {
		const vecs = await this.embedMany([text]);
		return vecs[0];
	}

	async embedMany(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		const res = await fetch(`${this.config.baseUrl}/api/embed`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: this.config.embeddingModel,
				input: texts,
				options: { num_ctx: 8192 }
			})
		});

		if (!res.ok) {
			const body = await res.text();
			throw new Error(
				`Ollama embed failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`
			);
		}

		return EmbeddingResponse.parse(await res.json()).embeddings;
	}

	async embedBatch(texts: string[], batchSize = 16): Promise<number[][]> {
		const out: number[][] = [];
		for (let i = 0; i < texts.length; i += batchSize) {
			const batch = texts.slice(i, i + batchSize);
			const vecs = await this.embedMany(batch);
			out.push(...vecs);
		}
		return out;
	}

	async *chatStream(opts: OllamaChatOptions): AsyncGenerator<OllamaChatEvent, void, unknown> {
		const reqBody: Record<string, unknown> = {
			model: opts.model,
			messages: opts.messages,
			stream: true,
			options: {
				temperature: opts.temperature ?? 0.7,
				num_predict: opts.maxTokens,
				stop: opts.stop
			}
		};
		if (opts.think !== undefined) reqBody.think = opts.think;

		const res = await fetch(`${this.config.baseUrl}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(reqBody)
		});

		if (!res.ok || !res.body) {
			const body = await res.text();
			throw new Error(
				`Ollama chat failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`
			);
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let nlIndex: number;
			while ((nlIndex = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, nlIndex).trim();
				buffer = buffer.slice(nlIndex + 1);
				if (!line) continue;
				let parsed;
				try {
					parsed = ChatStreamChunk.parse(JSON.parse(line));
				} catch {
					continue;
				}
				const thinking = parsed.message?.thinking;
				if (thinking) yield { kind: 'thinking', delta: thinking };
				const content = parsed.message?.content;
				if (content) yield { kind: 'content', delta: content };
				if (parsed.done) {
					yield { kind: 'done', reason: parsed.done_reason };
					return;
				}
			}
		}
	}

	async chat(opts: OllamaChatOptions): Promise<string> {
		let out = '';
		for await (const ev of this.chatStream(opts)) {
			if (ev.kind === 'content') out += ev.delta;
		}
		return out;
	}

	async health(): Promise<{
		ok: boolean;
		embeddingModelAvailable: boolean;
		chatModelAvailable: (model: string) => boolean;
		models: string[];
	}> {
		try {
			const res = await fetch(`${this.config.baseUrl}/api/tags`, {
				signal: AbortSignal.timeout(3000)
			});
			if (!res.ok)
				return {
					ok: false,
					embeddingModelAvailable: false,
					chatModelAvailable: () => false,
					models: []
				};
			const json = (await res.json()) as { models?: Array<{ name: string }> };
			const models = (json.models ?? []).map((m) => m.name);
			return {
				ok: true,
				embeddingModelAvailable: models.some((m) => m.startsWith(this.config.embeddingModel)),
				chatModelAvailable: (model) => models.includes(model),
				models
			};
		} catch {
			return {
				ok: false,
				embeddingModelAvailable: false,
				chatModelAvailable: () => false,
				models: []
			};
		}
	}
}

export const MODELS = {
	router: 'glm-5.1:cloud',
	// glm-5.1 chosen as default after kimi-k2.6 was observed going into infinite
	// thinking mode on complex multi-expert prompts (1500+ thinking tokens, zero
	// content). glm-5.1 reliably transitions thinking → content in ~5-10s and
	// streams cleanly via the local Ollama daemon proxy.
	expert: 'glm-5.1:cloud',
	synthesis: 'glm-5.1:cloud'
} as const;
