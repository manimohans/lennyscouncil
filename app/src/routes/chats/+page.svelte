<script lang="ts">
	import { format } from 'date-fns';

	let { data } = $props();

	const modeColor: Record<string, string> = {
		roundtable: 'text-[var(--color-accent)]',
		validate: 'text-blue-400',
		prd: 'text-emerald-400',
		mentor: 'text-amber-400',
		strategy: 'text-rose-400',
		gaps: 'text-fuchsia-400'
	};

	function fmt(s: string) {
		try {
			return format(new Date(s), 'MMM d · HH:mm');
		} catch {
			return s;
		}
	}

	// Live history search + mode filter — flat lists stop being useful after ~30 chats.
	let q = $state('');
	let activeMode = $state<string | null>(null);

	const availableModes = $derived(
		Array.from(new Set(data.chats.map((c) => c.mode))).sort()
	);

	const filtered = $derived(
		data.chats.filter((c) => {
			if (activeMode && c.mode !== activeMode) return false;
			if (!q.trim()) return true;
			const needle = q.trim().toLowerCase();
			return (
				c.title.toLowerCase().includes(needle) || c.mode.toLowerCase().includes(needle)
			);
		})
	);

	const MODE_LABELS: Record<string, string> = {
		roundtable: 'Roundtable',
		validate: 'Validate',
		prd: 'PRD',
		mentor: 'Mentor',
		strategy: 'Strategy',
		gaps: 'Gaps'
	};
</script>

<div class="container-tight py-10">
	<header class="mb-5">
		<div class="font-mono text-xs text-[var(--color-text-faint)]">
			<span class="text-[var(--color-accent)]">$</span> ls chats/
			<span class="text-[var(--color-text-muted)]">→ {data.chats.length}</span>
		</div>
		<h1 class="mt-2 text-xl font-semibold tracking-tight">Saved chats</h1>
	</header>

	{#if data.chats.length === 0}
		<div
			class="rounded-md border border-dashed border-[var(--color-line-2)] bg-[var(--color-panel)] p-10 text-center font-mono text-xs text-[var(--color-text-faint)]"
		>
			no chats yet — start a
			<a href="/roundtable" class="text-[var(--color-accent-hi)] underline">roundtable</a>
		</div>
	{:else}
		<div class="mb-3 flex flex-wrap items-center gap-2">
			<input
				type="search"
				bind:value={q}
				placeholder="search title or mode…"
				class="flex-1 min-w-[200px] rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-1.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)] focus:outline-none"
			/>
			<div class="flex flex-wrap gap-1">
				<button
					type="button"
					onclick={() => (activeMode = null)}
					class="rounded border px-2 py-0.5 font-mono text-[11px] transition-colors
						{activeMode === null
						? 'border-[var(--color-accent)] text-[var(--color-accent-hi)]'
						: 'border-[var(--color-line)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)]'}"
				>
					all
				</button>
				{#each availableModes as m (m)}
					<button
						type="button"
						onclick={() => (activeMode = activeMode === m ? null : m)}
						class="rounded border px-2 py-0.5 font-mono text-[11px] transition-colors
							{activeMode === m
							? 'border-[var(--color-accent)] text-[var(--color-accent-hi)]'
							: 'border-[var(--color-line)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)]'}"
					>
						{MODE_LABELS[m] ?? m}
					</button>
				{/each}
			</div>
		</div>

		{#if filtered.length === 0}
			<div
				class="rounded-md border border-dashed border-[var(--color-line-2)] bg-[var(--color-panel)] p-6 text-center font-mono text-xs text-[var(--color-text-faint)]"
			>
				no chats match "{q}"
			</div>
		{:else}
			<ul
				class="divide-y divide-[var(--color-line)] overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]"
			>
				{#each filtered as c (c.id)}
					<li>
						<a
							href="/chats/{c.id}"
							class="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--color-panel-2)]"
						>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span
										class="font-mono text-[10px] {modeColor[c.mode] ?? 'text-[var(--color-text-muted)]'}"
										>[{c.mode}]</span
									>
									<span class="font-mono text-[10px] text-[var(--color-text-faint)]"
										>{c.message_count} msg</span
									>
								</div>
								<div class="mt-0.5 truncate text-[13px] text-[var(--color-text)]">{c.title}</div>
							</div>
							<time
								class="shrink-0 font-mono text-[10px] text-[var(--color-text-faint)]"
								datetime={c.last_active_at}>{fmt(c.last_active_at)}</time
							>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
