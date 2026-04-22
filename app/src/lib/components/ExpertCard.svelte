<script lang="ts">
	import type { ExpertCardData } from '$lib/types';
	let {
		expert,
		removable = false,
		onRemove
	}: {
		expert: ExpertCardData;
		removable?: boolean;
		onRemove?: () => void;
	} = $props();

	const initials = $derived(
		expert.name
			.split(/\s+/)
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);
</script>

<div
	class="group relative rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3 transition-colors hover:border-[var(--color-line-2)]"
>
	<div class="flex items-start gap-2.5">
		{#if expert.avatar_url}
			<img src={expert.avatar_url} alt={expert.name} class="h-8 w-8 shrink-0 rounded-sm" />
		{:else}
			<div
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[var(--color-panel-2)] font-mono text-[11px] font-semibold text-[var(--color-text-muted)]"
			>
				{initials}
			</div>
		{/if}
		<div class="min-w-0 flex-1">
			<div class="flex items-center justify-between gap-2">
				<div class="truncate text-[13px] font-medium text-[var(--color-text)]">
					{expert.name}
				</div>
				{#if removable}
					<button
						type="button"
						onclick={() => onRemove?.()}
						class="font-mono text-xs text-[var(--color-text-faint)] hover:text-[var(--color-bad)]"
						aria-label="Remove {expert.name}"
					>
						✕
					</button>
				{/if}
			</div>
			{#if expert.domains.length > 0}
				<div class="mt-1 flex flex-wrap gap-1">
					{#each expert.domains.slice(0, 4) as d}
						<span class="tag">{d}</span>
					{/each}
				</div>
			{/if}
			<p class="mt-1.5 font-mono text-[11px] text-[var(--color-text-faint)]">
				{expert.matching_chunks} excerpts &middot; {expert.why_selected.replace(
					/^\d+ relevant excerpts? from .+? expertise/,
					''
				)}
			</p>
			{#if expert.grounding_quotes.length > 0}
				<blockquote
					class="mt-2 border-l border-[var(--color-line-2)] pl-2 text-[12px] leading-relaxed text-[var(--color-text-muted)] italic"
				>
					"{expert.grounding_quotes[0].text.slice(0, 200)}…"
				</blockquote>
			{/if}
		</div>
	</div>
</div>
