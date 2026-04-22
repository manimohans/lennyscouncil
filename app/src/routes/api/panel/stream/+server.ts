import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { runExpertPanel, VALIDATE_MODE, PRD_MODE, type PanelMode } from '$lib/server/orchestration/expert-panel';

const schema = z.object({
	mode: z.enum(['validate', 'prd']),
	artifact: z.string().min(20).max(20000),
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

	const mode = MODE_MAP[parsed.data.mode];
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			let clientAlive = true;
			const send = (event: string, data: unknown) => {
				if (!clientAlive) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					clientAlive = false;
				}
			};
			try {
				for await (const ev of runExpertPanel({
					userId: locals.user.id,
					mode,
					artifact: parsed.data.artifact,
					model: parsed.data.model ?? undefined
				})) {
					send(ev.kind, ev);
				}
				send('done', {});
			} catch (err) {
				send('error', { message: err instanceof Error ? err.message : String(err) });
			} finally {
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
