import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { runSingleExpertChat } from '$lib/server/orchestration/single-expert-chat';

const schema = z.object({
	mode: z.enum(['mentor', 'strategy']),
	expertSlug: z.string().min(1),
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
				for await (const ev of runSingleExpertChat({
					userId: locals.user.id,
					mode: parsed.data.mode,
					expertSlug: parsed.data.expertSlug,
					question: parsed.data.question,
					chatId: parsed.data.chatId ?? undefined,
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
