import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { scanGapsStream } from '$lib/server/orchestration/gap-scanner';

const schema = z.object({
	topic: z.string().min(2).max(120),
	model: z.string().min(1).max(100).nullish()
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

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: string, data: unknown) =>
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			try {
				for await (const ev of scanGapsStream(parsed.data.topic, 8, parsed.data.model ?? undefined)) {
					send(ev.kind, ev);
				}
			} catch (err) {
				send('error', { message: err instanceof Error ? err.message : String(err) });
			} finally {
				controller.close();
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
