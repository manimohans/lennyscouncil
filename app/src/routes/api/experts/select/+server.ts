import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { selectExperts } from '$lib/server/expert-selector';
import type { RequestHandler } from './$types';

const schema = z.object({
	question: z.string().min(3).max(2000),
	topK: z.number().int().min(1).max(8).optional()
});

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid json');
	}
	const parsed = schema.safeParse(body);
	if (!parsed.success) throw error(400, parsed.error.message);

	const experts = await selectExperts(parsed.data.question, {
		topK: parsed.data.topK ?? 4,
		excludeHosts: true
	});
	return json({ experts });
};
