/**
 * Validates a user-supplied model name against what the Ollama daemon
 * actually has installed. Prevents arbitrary model-name strings flowing
 * into the Ollama `model` field (which would otherwise trigger a pull).
 *
 * Cached for 30s so the allowlist check doesn't add a round-trip to
 * every stream endpoint.
 */
import { OllamaClient, MODELS } from './ollama';

const ollama = new OllamaClient({
	baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
	embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text'
});

const TTL_MS = 30_000;
let cachedAt = 0;
let cachedModels: Set<string> = new Set();

async function refresh(): Promise<Set<string>> {
	const now = Date.now();
	if (now - cachedAt < TTL_MS && cachedModels.size > 0) return cachedModels;
	try {
		const health = await ollama.health();
		cachedModels = new Set(health.models);
		cachedAt = now;
	} catch {
		// Leave the cache as-is; don't block requests on a transient health failure.
	}
	return cachedModels;
}

/**
 * Returns the requested model if it's installed, otherwise the default.
 * Never throws — a bad model name silently falls back to the default so
 * a demo doesn't explode because of a typo.
 */
export async function resolveModel(
	requested: string | null | undefined,
	fallback: string = MODELS.expert
): Promise<string> {
	if (!requested) return fallback;
	const models = await refresh();
	if (models.has(requested)) return requested;
	// Graceful fallback — log it so we notice misuse, but don't fail the request.
	console.warn(`[model-allowlist] requested "${requested}" not installed; using "${fallback}"`);
	return fallback;
}
