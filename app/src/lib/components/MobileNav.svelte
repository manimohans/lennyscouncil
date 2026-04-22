<script lang="ts">
	import { page } from '$app/state';

	const modes = [
		{ href: '/roundtable', label: 'rt' },
		{ href: '/validate', label: 'validate' },
		{ href: '/prd', label: 'prd' },
		{ href: '/mentor', label: 'mentor' },
		{ href: '/strategy', label: 'strat' },
		{ href: '/gaps', label: 'gaps' },
		{ href: '/experts', label: 'experts' },
		{ href: '/chats', label: 'chats' }
	];
	const isActive = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(href + '/');
</script>

<header
	class="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-panel)]/95 px-3 py-2 backdrop-blur lg:hidden"
>
	<a href="/" class="font-mono text-sm font-semibold tracking-tight shrink-0">
		<span class="text-[var(--color-accent)]">$</span>
		<span class="text-[var(--color-accent-hi)]">council</span>
	</a>
	<nav class="flex flex-1 items-center gap-1 overflow-x-auto">
		{#each modes as m}
			<a
				href={m.href}
				class="shrink-0 rounded px-2 py-1 font-mono text-[11px] transition-colors
				{isActive(m.href)
					? 'bg-[var(--color-accent-faint)] text-[var(--color-accent-hi)]'
					: 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
			>
				{m.label}
			</a>
		{/each}
	</nav>
</header>
