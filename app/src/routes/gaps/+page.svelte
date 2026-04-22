<script lang="ts">
	import { modelStore } from '$lib/stores/model.svelte';
	import ThinkingDisclosure from '$lib/components/ThinkingDisclosure.svelte';

	interface Gap {
		problem: string;
		rationale: string;
		signals: number;
		supporting: Array<{
			chunk_id: number;
			quote: string;
			speaker: string;
			title: string;
			date: string;
		}>;
	}

	let topic = $state('');
	let gaps: Gap[] = $state([]);
	let loading = $state(false);
	let phase = $state<'idle' | 'searching' | 'searched' | 'thinking' | 'streaming' | 'done'>('idle');
	let chunkCount = $state(0);
	let thinking = $state('');
	let errorMsg = $state('');

	const SUGGESTED = [
		'B2B SaaS pricing',
		'PM hiring',
		'developer tools',
		'AI product UX',
		'growth experimentation'
	];

	const isThinking = $derived(phase === 'searching' || phase === 'searched' || phase === 'thinking');

	async function scan() {
		if (!topic.trim()) return;
		loading = true;
		errorMsg = '';
		gaps = [];
		thinking = '';
		chunkCount = 0;
		phase = 'searching';

		try {
			const res = await fetch('/api/gaps/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ topic, model: modelStore.value })
			});
			if (!res.ok || !res.body) {
				errorMsg = `Scan failed: ${res.status}`;
				loading = false;
				return;
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let nl: number;
				while ((nl = buffer.indexOf('\n\n')) !== -1) {
					const block = buffer.slice(0, nl);
					buffer = buffer.slice(nl + 2);
					const lines = block.split('\n');
					let eventName = 'message';
					let dataStr = '';
					for (const l of lines) {
						if (l.startsWith('event: ')) eventName = l.slice(7).trim();
						else if (l.startsWith('data: ')) dataStr += l.slice(6);
					}
					if (!dataStr) continue;
					let payload: any;
					try {
						payload = JSON.parse(dataStr);
					} catch {
						continue;
					}
					if (eventName === 'searched') {
						chunkCount = payload.chunk_count;
						phase = 'searched';
					} else if (eventName === 'thinking') {
						thinking += payload.delta;
						phase = 'thinking';
					} else if (eventName === 'content') {
						phase = 'streaming';
					} else if (eventName === 'gaps') {
						gaps = payload.gaps;
						if (gaps.length === 0) errorMsg = 'No clear gaps surfaced. Try a more specific topic.';
					} else if (eventName === 'done') {
						phase = 'done';
					} else if (eventName === 'error') {
						errorMsg = payload.message;
						phase = 'done';
					}
				}
			}
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}
</script>

<div class="container-tight py-10">
	<header class="mb-5">
		<div class="font-mono text-xs text-[var(--color-text-faint)]">
			<span class="text-[var(--color-accent)]">$</span> gaps --scan
		</div>
		<h1 class="mt-2 text-xl font-semibold tracking-tight">Gap scanner</h1>
		<p class="mt-1 text-xs text-[var(--color-text-muted)]">
			Mines the corpus for unsolved problems practitioners keep complaining about — startup-idea fuel.
		</p>
	</header>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			scan();
		}}
	>
		<input
			type="text"
			bind:value={topic}
			placeholder="topic: B2B SaaS pricing, AI product UX, PM hiring…"
			class="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)] focus:outline-none"
		/>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<span class="font-mono text-[11px] text-[var(--color-text-faint)]">try:</span>
			{#each SUGGESTED as s}
				<button
					type="button"
					onclick={() => {
						topic = s;
						scan();
					}}
					class="rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent-hi)]"
				>
					{s}
				</button>
			{/each}
			<button
				type="submit"
				disabled={loading || !topic.trim()}
				class="btn-primary ml-auto"
			>
				{loading ? '› scanning…' : '› scan'}
			</button>
		</div>
	</form>

	{#if phase !== 'idle' && phase !== 'done'}
		<div class="mt-5 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3">
			<div class="flex items-center gap-2 font-mono text-[11px] text-[var(--color-text-muted)]">
				<span class="dot-pulse"></span>
				{#if phase === 'searching'}
					searching corpus for complaint patterns…
				{:else if phase === 'searched'}
					found {chunkCount} candidate chunks · waiting for model to start…
				{:else if phase === 'thinking'}
					reasoning over {chunkCount} chunks…
				{:else if phase === 'streaming'}
					assembling gaps…
				{/if}
			</div>
			<ThinkingDisclosure {thinking} {isThinking} />
		</div>
	{/if}

	{#if errorMsg}
		<div
			class="mt-5 rounded-md border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10 px-3 py-2 text-sm text-[var(--color-bad)]"
		>
			{errorMsg}
		</div>
	{/if}

	{#if gaps.length > 0}
		<div class="mt-6 space-y-2">
			{#each gaps as g, i (i)}
				<article
					class="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4 transition-colors hover:border-[var(--color-line-2)]"
				>
					<div class="flex items-start justify-between gap-3">
						<div class="flex items-baseline gap-2">
							<span class="font-mono text-[11px] text-[var(--color-text-faint)]"
								>{String(i + 1).padStart(2, '0')}</span
							>
							<h3 class="text-[14px] font-medium text-[var(--color-text)]">{g.problem}</h3>
						</div>
						<span class="tag shrink-0 text-[var(--color-accent-hi)]">{g.signals} signals</span>
					</div>
					<p class="mt-2 ml-8 text-[13px] leading-relaxed text-[var(--color-text-muted)]">
						{g.rationale}
					</p>
					{#if g.supporting.length > 0}
						<details class="mt-2 ml-8">
							<summary
								class="cursor-pointer font-mono text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent-hi)]"
							>
								view supporting quotes
							</summary>
							<div class="mt-2 space-y-2">
								{#each g.supporting as s}
									<blockquote
										class="border-l border-[var(--color-line-2)] pl-2 text-[12px] text-[var(--color-text-muted)]"
									>
										"{s.quote}"
										<footer class="mt-1 font-mono text-[10px] text-[var(--color-text-faint)]">
											— {s.speaker} · {s.title} · {s.date}
										</footer>
									</blockquote>
								{/each}
							</div>
						</details>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</div>

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
		0%, 100% { opacity: 0.4; transform: scale(0.85); }
		50% { opacity: 1; transform: scale(1.1); }
	}
</style>
