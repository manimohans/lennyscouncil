import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { runRoundtable, MIN_ROUNDS, MAX_ROUNDS } from '$lib/server/orchestration/roundtable';

const schema = z.object({
	question: z.string().min(3).max(2000),
	chatId: z.string().uuid().nullish(),
	expertIds: z.array(z.string().uuid()).max(8).nullish(),
	rounds: z.number().int().min(MIN_ROUNDS).max(MAX_ROUNDS).nullish(),
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
			// `clientAlive` lets the orchestration keep running (and persisting to DB)
			// even after the client disconnects. Each turn writes to DB on completion,
			// so users can navigate away and come back to see whatever was completed.
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
				for await (const ev of runRoundtable({
					userId: locals.user.id,
					question: parsed.data.question,
					chatId: parsed.data.chatId ?? undefined,
					rounds: parsed.data.rounds ?? undefined,
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
