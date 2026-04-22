<script lang="ts">
	interface Axis {
		name: string;
		score: number;
		note: string;
	}
	interface Scorecard {
		axes: Axis[];
		verdict_hint?: 'build' | 'sharpen' | 'kill';
	}

	let { scorecard }: { scorecard: Scorecard } = $props();

	const avg = $derived(
		scorecard.axes.length
			? scorecard.axes.reduce((s, a) => s + a.score, 0) / scorecard.axes.length
			: 0
	);

	// If the model didn't emit a hint, infer one from the average.
	const verdict = $derived<'build' | 'sharpen' | 'kill'>(
		scorecard.verdict_hint ?? (avg >= 7 ? 'build' : avg >= 4.5 ? 'sharpen' : 'kill')
	);

	const VERDICT_MAP = {
		build: { label: 'BUILD IT', tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
		sharpen: { label: 'SHARPEN IT', tone: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
		kill: { label: 'KILL IT', tone: 'bg-red-500/15 text-red-300 border-red-500/30' }
	} as const;

	function scoreTone(score: number): string {
		if (score >= 7) return 'text-emerald-400';
		if (score >= 4.5) return 'text-amber-400';
		return 'text-red-400';
	}
</script>

<div class="mb-4 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
	<div class="mb-3 flex items-center justify-between gap-3">
		<div
			class="rounded-sm border px-2.5 py-1 font-mono text-[11px] font-bold tracking-wider {VERDICT_MAP[
				verdict
			].tone}"
		>
			{VERDICT_MAP[verdict].label}
		</div>
		<div class="font-mono text-[11px] text-[var(--color-text-faint)]">
			avg <span class={scoreTone(avg)}>{avg.toFixed(1)}</span> / 10
		</div>
	</div>

	<ul class="space-y-2">
		{#each scorecard.axes as axis (axis.name)}
			<li class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
				<div class="min-w-0">
					<div class="flex items-center gap-2">
						<span class="text-[13px] font-medium text-[var(--color-text)]">{axis.name}</span>
						<div class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-panel-2)]">
							<div
								class="absolute inset-y-0 left-0 rounded-full transition-all {axis.score >= 7
									? 'bg-emerald-500/70'
									: axis.score >= 4.5
										? 'bg-amber-500/70'
										: 'bg-red-500/70'}"
								style="width: {Math.min(100, Math.max(0, (axis.score / 10) * 100))}%"
							></div>
						</div>
					</div>
					{#if axis.note}
						<p class="mt-1 text-[12px] leading-snug text-[var(--color-text-muted)]">
							{axis.note}
						</p>
					{/if}
				</div>
				<div class="shrink-0 font-mono text-sm tabular-nums {scoreTone(axis.score)}">
					{axis.score.toFixed(0)}
				</div>
			</li>
		{/each}
	</ul>
</div>
