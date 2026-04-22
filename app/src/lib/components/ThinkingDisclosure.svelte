<script lang="ts">
	// Claude / ChatGPT-style reasoning disclosure.
	//
	// Shows immediately when `isThinking` flips true (even with empty thinking)
	// so users get instant feedback during model first-byte latency.
	//
	// Lifecycle:
	//   - isThinking=true, thinking="" → "● thinking 0s" pulse, no body
	//   - isThinking=true, thinking="..." → expanded by default, live text
	//   - isThinking=false, thinking="..." → collapsed "▸ thought for Xs"
	//   - isThinking=false, thinking="" → renders nothing
	import { onDestroy } from 'svelte';

	let {
		thinking,
		isThinking
	}: {
		thinking: string;
		isThinking: boolean;
	} = $props();

	let userToggled = $state(false);
	let userExpanded = $state(false);

	let startMs = $state<number | null>(null);
	let frozenSeconds = $state<number | null>(null);
	let now = $state(Date.now());
	let timerHandle: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		// Start timer the moment isThinking goes true (don't wait for first token).
		if (isThinking && !startMs) {
			startMs = Date.now();
			now = Date.now();
			frozenSeconds = null;
			timerHandle = setInterval(() => (now = Date.now()), 250);
		}
		// Freeze when thinking ends.
		if (!isThinking && startMs && frozenSeconds === null) {
			frozenSeconds = Math.max(1, Math.round((Date.now() - startMs) / 1000));
			if (timerHandle) clearInterval(timerHandle);
			timerHandle = null;
		}
	});

	onDestroy(() => {
		if (timerHandle) clearInterval(timerHandle);
	});

	const defaultOpen = $derived(isThinking);
	const open = $derived(userToggled ? userExpanded : defaultOpen);
	const elapsed = $derived(
		frozenSeconds ?? (startMs ? Math.max(0, Math.round((now - startMs) / 1000)) : 0)
	);
	const visible = $derived(isThinking || (thinking && thinking.length > 0));

	function toggle() {
		userToggled = true;
		userExpanded = !open;
	}

	// Auto-scroll the thinking pane to the bottom as new tokens arrive,
	// so the user always sees the latest reasoning.
	let preEl: HTMLPreElement | undefined = $state();
	$effect(() => {
		if (preEl && isThinking) {
			// Track on `thinking` so this re-runs as text grows.
			thinking;
			preEl.scrollTop = preEl.scrollHeight;
		}
	});
</script>

{#if visible}
	<div class="my-2">
		<button
			type="button"
			onclick={toggle}
			class="group flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 py-1 font-mono text-[11px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-line-2)] hover:text-[var(--color-text)]"
			aria-expanded={open}
		>
			{#if isThinking}
				<span class="dot-pulse" aria-hidden="true"></span>
				<span class="text-[var(--color-accent-hi)]">thinking</span>
				<span class="text-[var(--color-text-faint)]">{elapsed}s</span>
			{:else}
				<span class="text-[var(--color-text-faint)]">{open ? '▾' : '▸'}</span>
				<span>thought for {elapsed}s</span>
			{/if}
		</button>

		{#if open && thinking}
			<pre
				bind:this={preEl}
				class="mt-1.5 max-h-64 overflow-auto rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--color-text-muted)]">{thinking}</pre>
		{/if}
	</div>
{/if}

<style>
	.dot-pulse {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-accent);
		animation: pulse 1s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% {
			opacity: 0.4;
			transform: scale(0.85);
		}
		50% {
			opacity: 1;
			transform: scale(1.1);
		}
	}
</style>
