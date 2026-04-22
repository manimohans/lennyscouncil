import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import {
	runRoundtable,
	MIN_ROUNDS,
	MAX_ROUNDS,
	type RoundtableEvent
} from '$lib/server/orchestration/roundtable';
import { sql } from '$lib/server/db';
import { resolveModel } from '$lib/server/model-allowlist';
import { sseResponse } from '$lib/server/sse';

const schema = z.object({
	question: z.string().min(3).max(2000),
	chatId: z.string().uuid().nullish(),
	expertIds: z.array(z.string().uuid()).max(8).nullish(),
	rounds: z.number().int().min(MIN_ROUNDS).max(MAX_ROUNDS).nullish(),
	model: z.string().min(1).max(100).nullish()
});

interface SelectedExpertRow {
	expert_id: string;
	name: string;
	slug: string;
	domains: string[];
	avatar_url: string | null;
}

/** Hydrate an expertIds list into the SelectedExpert shape runRoundtable expects. */
async function hydrateExperts(ids: string[]) {
	if (ids.length === 0) return [];
	const rows = (await sql`
		SELECT id AS expert_id, name, slug, domains, avatar_url
		FROM experts
		WHERE id = ANY(${ids}) AND NOT is_host
	`) as unknown as SelectedExpertRow[];
	return rows.map((r) => ({
		expert_id: r.expert_id,
		name: r.name,
		slug: r.slug,
		domains: r.domains,
		avatar_url: r.avatar_url,
		matching_chunks: 0,
		avg_score: 0,
		most_recent: '',
		grounding_quotes: [],
		why_selected: 'User-selected expert.'
	}));
}

export const POST: RequestHandler = async ({ request, locals }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid json');
	}
	const parsed = schema.safeParse(body);
	if (!parsed.success) throw error(400, parsed.error.message);

	const model = await resolveModel(parsed.data.model);
	const expertOverride = parsed.data.expertIds?.length
		? await hydrateExperts(parsed.data.expertIds)
		: undefined;

	const generator: AsyncIterable<RoundtableEvent> = runRoundtable({
		userId: locals.user.id,
		question: parsed.data.question,
		chatId: parsed.data.chatId ?? undefined,
		expertOverride,
		rounds: parsed.data.rounds ?? undefined,
		model
	});

	return sseResponse(generator as unknown as AsyncIterable<{ kind: string }>, {
		logLabel: '[api/roundtable/stream]',
		clientErrorMessage:
			'The roundtable hit an error. Try again, or switch models in the top-right picker.'
	});
};
