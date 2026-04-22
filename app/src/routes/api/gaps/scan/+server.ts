import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { scanGapsStream, type GapEvent } from '$lib/server/orchestration/gap-scanner';
import { resolveModel } from '$lib/server/model-allowlist';
import { sseResponse } from '$lib/server/sse';

const schema = z.object({
	topic: z.string().min(2).max(120),
	model: z.string().min(1).max(100).nullish()
});

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

	const generator: AsyncIterable<GapEvent> = scanGapsStream({
		topic: parsed.data.topic,
		limit: 8,
		model,
		userId: locals.user.id
	});

	return sseResponse(generator as unknown as AsyncIterable<{ kind: string }>, {
		logLabel: '[api/gaps/scan]',
		clientErrorMessage: 'Gap scan hit an error. Try again.'
	});
};
