<script lang="ts">
	import { format, parseISO } from 'date-fns';

	let { data } = $props();
	const e = $derived(data.expert);

	function fmtDate(s: string) {
		try {
			const d = typeof s === 'string' ? new Date(s) : s;
			if (Number.isNaN(d.getTime())) return s;
			return format(d, 'MMM d, yyyy');
		} catch {
			return s;
		}
	}

	const initials = $derived(
		e.name
			.split(/\s+/)
			.map((p: string) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);
</script>

<div class="container-tight py-10">
	<a
		href="/experts"
		class="font-mono text-xs text-[var(--color-text-faint)] hover:text-[var(--color-accent-hi)]"
	>
		‹ ls experts/
	</a>

	<header class="mt-3 flex items-start gap-4">
		{#if e.avatar_url}
			<img src={e.avatar_url} alt={e.name} class="h-14 w-14 shrink-0 rounded-md" />
		{:else}
			<div
				class="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-[var(--color-panel-2)] font-mono text-base font-semibold text-[var(--color-text-muted)]"
			>
				{initials}
			</div>
		{/if}
		<div class="min-w-0 flex-1">
			<h1 class="text-2xl font-semibold tracking-tight text-[var(--color-text)]">
				{e.name}
			</h1>
			<div class="mt-1 font-mono text-[11px] text-[var(--color-text-faint)]">
				{e.appearance_count} excerpts &middot; {fmtDate(e.first_seen)} → {fmtDate(e.last_seen)}
			</div>
			{#if e.domains.length > 0}
				<div class="mt-2 flex flex-wrap gap-1">
					{#each e.domains as d}
						<span class="tag">{d}</span>
					{/each}
				</div>
			{/if}
		</div>
	</header>

	{#if e.bio}
		<section class="mt-8">
			<div class="section-label">about</div>
			<p class="mt-2 text-sm leading-relaxed text-[var(--color-text)]">{e.bio}</p>
		</section>
	{/if}

	{#if e.voice_summary}
		<section class="mt-6">
			<div class="section-label">voice</div>
			<p class="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)] italic">{e.voice_summary}</p>
		</section>
	{/if}

	{#if e.frameworks?.length > 0}
		<section class="mt-8">
			<div class="section-label">frameworks</div>
			<ul class="mt-2 space-y-1 text-sm text-[var(--color-text)]">
				{#each e.frameworks as f}
					<li class="flex gap-2">
						<span class="font-mono text-[var(--color-text-faint)]">›</span>
						<span>{f}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if e.signature_quotes?.length > 0}
		<section class="mt-8">
			<div class="section-label">signature quotes</div>
			<div class="mt-2 space-y-3">
				{#each e.signature_quotes as q}
					<div
						class="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3"
					>
						<blockquote class="text-[13px] leading-relaxed text-[var(--color-text)] italic">
							"{q.quote}"
						</blockquote>
						<footer class="mt-2 font-mono text-[10px] text-[var(--color-text-faint)]">
							— {q.title || 'untitled'}{q.date ? ` · ${fmtDate(q.date)}` : ''}
						</footer>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<section class="mt-8">
		<div class="section-label">appearances ({data.appearances.length})</div>
		<ul
			class="mt-2 divide-y divide-[var(--color-line)] rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]"
		>
			{#each data.appearances as a}
				<li class="flex items-center justify-between gap-3 px-3 py-2">
					<div class="min-w-0 flex-1">
						<div class="truncate text-[13px] text-[var(--color-text)]">{a.title}</div>
					</div>
					<div class="shrink-0 font-mono text-[10px] text-[var(--color-text-faint)]">
						{a.source_type} · {fmtDate(a.date)}
					</div>
				</li>
			{/each}
		</ul>
	</section>

	<div class="mt-10 flex justify-end">
		<a href="/mentor?expert={e.slug}" class="btn-primary">› chat with {e.name}</a>
	</div>
</div>
