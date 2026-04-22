<script lang="ts">
	import type { TurnState } from '$lib/types';
	import { renderMarkdown } from '$lib/markdown';
	import ThinkingDisclosure from './ThinkingDisclosure.svelte';
	import ScorecardCard from './ScorecardCard.svelte';

	let { turn, expertAvatar = null }: { turn: TurnState; expertAvatar?: string | null } = $props();

	// For validate mode we strip the raw <scorecard> JSON from the body so users
	// see a clean critique. The scorecard itself renders as a visual component.
	const visibleContent = $derived(turn.content.replace(/<scorecard>[\s\S]*?<\/scorecard>\s*/i, ''));
	const html = $derived(renderMarkdown(visibleContent, turn.citations));
	const isThinking = $derived(!turn.done && turn.content.length === 0);

	const initials = $derived(
		turn.expertName
			.split(/\s+/)
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);
</script>

<article class="border-t border-[var(--color-line)] py-5">
	<header class="mb-3 flex items-center gap-2.5">
		{#if turn.role === 'synthesis'}
			<div
				class="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[var(--color-accent)] font-mono text-xs font-bold text-[var(--color-bg)]"
			>
				∑
			</div>
		{:else if expertAvatar}
			<img src={expertAvatar} alt={turn.expertName} class="h-7 w-7 shrink-0 rounded-sm" />
		{:else}
			<div
				class="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[var(--color-panel-2)] font-mono text-[10px] font-semibold text-[var(--color-text-muted)]"
			>
				{initials}
			</div>
		{/if}
		<div class="flex min-w-0 flex-1 items-baseline gap-2">
			<span class="text-[13px] font-medium text-[var(--color-text)]">{turn.expertName}</span>
			<span class="font-mono text-[10px] tracking-wider text-[var(--color-text-faint)] uppercase">
				{turn.role === 'synthesis' ? 'synthesis' : `r${turn.round}`}
			</span>
		</div>
	</header>

	<ThinkingDisclosure thinking={turn.thinking} {isThinking} />

	{#if turn.scorecard}
		<ScorecardCard scorecard={turn.scorecard} />
	{/if}

	{#if visibleContent}
		<div class="md">
			{@html html}{#if !turn.done}<span class="caret"></span>{/if}
		</div>
	{/if}
</article>
