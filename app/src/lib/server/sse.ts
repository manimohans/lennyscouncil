/**
 * Shared SSE helper:
 *   - Wraps an async iterable of `{ kind, ...payload }` events into a
 *     text/event-stream Response.
 *   - Emits a 15-second heartbeat comment so Cloudflare / Cloud Run /
 *     corporate proxies don't sever the connection mid-run.
 *   - Catches thrown errors and emits a sanitized `error` event. Real
 *     error details go to server logs; the client sees a safe message.
 *   - Stops the orchestrator only when the client is alive; if the client
 *     disconnects we let the generator keep running so partial results
 *     still land in the DB, then close cleanly.
 */

export interface SseEvent {
	kind: string;
	[k: string]: unknown;
}

export interface SseStreamOptions {
	/** Log-line prefix for thrown errors — e.g. "[api/roundtable]". */
	logLabel: string;
	/** Safe message shown to the user when the orchestrator throws. */
	clientErrorMessage?: string;
	/** Heartbeat interval in ms; set 0 to disable. */
	heartbeatMs?: number;
}

export function sseResponse(
	generator: AsyncIterable<SseEvent>,
	options: SseStreamOptions
): Response {
	const encoder = new TextEncoder();
	const heartbeatMs = options.heartbeatMs ?? 15_000;
	const clientErr = options.clientErrorMessage ?? 'Something went wrong on our end.';

	const stream = new ReadableStream({
		async start(controller) {
			let clientAlive = true;

			const send = (event: string, data: unknown) => {
				if (!clientAlive) return;
				try {
					controller.enqueue(
						encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
					);
				} catch {
					clientAlive = false;
				}
			};

			const heartbeat =
				heartbeatMs > 0
					? setInterval(() => {
							if (!clientAlive) return;
							try {
								controller.enqueue(encoder.encode(`: heartbeat\n\n`));
							} catch {
								clientAlive = false;
							}
						}, heartbeatMs)
					: null;

			try {
				for await (const ev of generator) {
					// Keep `kind` in the payload too — existing clients parse it.
					send(String(ev.kind), ev);
				}
				send('done', {});
			} catch (err) {
				console.error(options.logLabel, err);
				send('error', { message: clientErr });
			} finally {
				if (heartbeat) clearInterval(heartbeat);
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
}
