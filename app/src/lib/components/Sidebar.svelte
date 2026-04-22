<script lang="ts">
	import { page } from '$app/state';
	import LogoMark from './LogoMark.svelte';
	let {
		user,
		recentChats = []
	}: {
		user: { display_name: string | null; email: string };
		recentChats?: Array<{ id: string; title: string; mode: string; last_active_at: string }>;
	} = $props();

	const modes = [
		{ href: '/roundtable', label: 'roundtable', kbd: 'R' },
		{ href: '/validate', label: 'validate', kbd: 'V' },
		{ href: '/prd', label: 'prd review', kbd: 'P' },
		{ href: '/mentor', label: 'mentor', kbd: 'M' },
		{ href: '/strategy', label: 'strategy', kbd: 'S' },
		{ href: '/gaps', label: 'gap scanner', kbd: 'G' }
	];

	const isActive = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(href + '/');
</script>

<aside
	class="hidden h-screen w-56 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-panel)] lg:flex"
>
	<a
		href="/"
		class="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-3 font-mono text-sm font-semibold tracking-tight"
	>
		<span class="text-[var(--color-accent)]"><LogoMark size={18} /></span>
		<span>
			<span class="text-[var(--color-text)]">lenny's</span>
			<span class="text-[var(--color-accent-hi)]">council</span>
		</span>
	</a>

	<div class="flex-1 overflow-y-auto">
		<div class="px-3 pt-4 pb-1.5">
			<div class="section-label">modes</div>
		</div>
		<nav class="px-1.5">
			{#each modes as m}
				<a
					href={m.href}
					class="group flex items-center justify-between rounded px-2 py-1 font-mono text-xs transition-colors
				{isActive(m.href)
						? 'bg-[var(--color-accent-faint)] text-[var(--color-accent-hi)]'
						: 'text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]'}"
				>
					<span class="flex items-center gap-2">
						<span
							class="text-[var(--color-text-faint)] {isActive(m.href)
								? 'text-[var(--color-accent)]'
								: 'group-hover:text-[var(--color-text-muted)]'}">›</span
						>
						{m.label}
					</span>
					<span class="kbd">⌘{m.kbd}</span>
				</a>
			{/each}
		</nav>

		<div class="px-3 pt-4 pb-1.5">
			<div class="section-label">archive</div>
		</div>
		<nav class="px-1.5">
			<a
				href="/experts"
				class="block rounded px-2 py-1 font-mono text-xs transition-colors
			{isActive('/experts')
					? 'bg-[var(--color-accent-faint)] text-[var(--color-accent-hi)]'
					: 'text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]'}"
			>
				<span class="text-[var(--color-text-faint)]">›</span> experts
			</a>
			<a
				href="/chats"
				class="block rounded px-2 py-1 font-mono text-xs transition-colors
			{isActive('/chats')
					? 'bg-[var(--color-accent-faint)] text-[var(--color-accent-hi)]'
					: 'text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]'}"
			>
				<span class="text-[var(--color-text-faint)]">›</span> chats
			</a>
		</nav>

		{#if recentChats.length > 0}
			<div class="px-3 pt-4 pb-1.5">
				<div class="section-label">recent</div>
			</div>
			<nav class="px-1.5 pb-3">
				{#each recentChats as c}
					<a
						href="/chats/{c.id}"
						class="block truncate rounded px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
						title={c.title}
					>
						{c.title}
					</a>
				{/each}
			</nav>
		{/if}
	</div>

	<div
		class="border-t border-[var(--color-line)] px-3 py-3 font-mono text-[11px] text-[var(--color-text-faint)]"
	>
		<div class="flex items-center gap-1.5">
			<span class="h-1.5 w-1.5 rounded-full bg-[var(--color-good)]"></span>
			<span class="truncate" title={user.email}>
				{user.display_name?.toLowerCase() ?? user.email}
			</span>
		</div>
	</div>
</aside>
