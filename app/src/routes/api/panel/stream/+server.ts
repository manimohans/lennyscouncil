import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import {
	runExpertPanel,
	VALIDATE_MODE,
	PRD_MODE,
	type PanelMode,
	type PanelEvent
} from '$lib/server/orchestration/expert-panel';
import { resolveModel } from '$lib/server/model-allowlist';
import { sseResponse } from '$lib/server/sse';

const schema = z.object({
	mode: z.enum(['validate', 'prd']),
	artifact: z.string().min(20).max(20_000),
	model: z.string().min(1).max(100).nullish()
});

const MODE_MAP: Record<string, PanelMode> = {
	validate: VALIDATE_MODE,
	prd: PRD_MODE
};

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
	const mode = MODE_MAP[parsed.data.mode];

	const generator: AsyncIterable<PanelEvent> = runExpertPanel({
		userId: locals.user.id,
		mode,
		artifact: parsed.data.artifact,
		model
	});

	return sseResponse(generator as unknown as AsyncIterable<{ kind: string }>, {
		logLabel: `[api/panel/stream:${parsed.data.mode}]`,
		clientErrorMessage: 'The panel review hit an error. Try again.'
	});
};
