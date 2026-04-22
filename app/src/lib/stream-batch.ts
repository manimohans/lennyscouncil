// Coalesces high-frequency state mutations into one render per animation frame.
// Use it on the client when handling SSE delta storms — the model emits ~30-100
// tokens/sec; without batching, every char re-renders the whole turn list and
// re-parses markdown, which feels choppy.
//
// Usage:
//   const flush = createFrameBatcher();
//   flush(() => { turns[i] = { ...turns[i], content: turns[i].content + delta } });
//
// Returns a function that schedules `update` to run on the next animation frame.
// Multiple calls within the same frame collapse to one.
export function createFrameBatcher() {
	let pending: Array<() => void> = [];
	let scheduled = false;

	function flush() {
		const queue = pending;
		pending = [];
		scheduled = false;
		for (const fn of queue) fn();
	}

	return function batch(update: () => void) {
		pending.push(update);
		if (!scheduled) {
			scheduled = true;
			if (typeof requestAnimationFrame !== 'undefined') {
				requestAnimationFrame(flush);
			} else {
				// SSR fallback — flush synchronously
				flush();
			}
		}
	};
}
