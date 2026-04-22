import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import {
	runSingleExpertChat,
	type SingleExpertEvent
} from '$lib/server/orchestration/single-expert-chat';
import { resolveModel } from '$lib/server/model-allowlist';
import { sseResponse } from '$lib/server/sse';

const schema = z.object({
	mode: z.enum(['mentor', 'strategy']),
	expertSlug: z
		.string()
		.min(1)
		.max(120)
		// slugs are a-z0-9 + dash only — the route regex is lenient so we harden here
		.regex(/^[a-z0-9-]+$/, 'invalid expert slug'),
	question: z.string().min(3).max(4000),
	chatId: z.string().uuid().nullish(),
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

	const generator: AsyncIterable<SingleExpertEvent> = runSingleExpertChat({
		userId: locals.user.id,
		mode: parsed.data.mode,
		expertSlug: parsed.data.expertSlug,
		question: parsed.data.question,
		chatId: parsed.data.chatId ?? undefined,
		model
	});

	return sseResponse(generator as unknown as AsyncIterable<{ kind: string }>, {
		logLabel: `[api/expert-chat/stream:${parsed.data.mode}]`,
		clientErrorMessage: 'The chat hit an error. Try again.'
	});
};
