<script lang="ts">
	import { format } from 'date-fns';

	let { data } = $props();

	const modeColor: Record<string, string> = {
		roundtable: 'text-[var(--color-accent)]',
		validate: 'text-blue-400',
		prd: 'text-emerald-400',
		mentor: 'text-amber-400',
		strategy: 'text-rose-400'
	};

	function fmt(s: string) {
		try {
			return format(new Date(s), 'MMM d · HH:mm');
		} catch {
			return s;
		}
	}
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
			no chats yet — start a <a href="/roundtable" class="text-[var(--color-accent-hi)] underline">roundtable</a>
		</div>
	{:else}
		<ul
			class="divide-y divide-[var(--color-line)] overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]"
		>
			{#each data.chats as c}
				<li>
					<a
						href="/chats/{c.id}"
						class="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--color-panel-2)]"
					>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="font-mono text-[10px] {modeColor[c.mode] ?? 'text-[var(--color-text-muted)]'}"
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
</div>
