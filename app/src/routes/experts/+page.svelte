<script lang="ts">
	import { goto } from '$app/navigation';
	let { data } = $props();

	let q = $state('');
	let tag = $state('');
	$effect(() => {
		q = data.query;
		tag = data.tag;
	});

	function applyFilter() {
		const params = new URLSearchParams();
		if (q.trim()) params.set('q', q.trim());
		if (tag) params.set('tag', tag);
		const qs = params.toString();
		goto(`/experts${qs ? '?' + qs : ''}`);
	}

	function initialsOf(name: string) {
		return name
			.split(/\s+/)
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}
</script>

<div class="container-tight py-10">
	<header class="mb-5">
		<div class="font-mono text-xs text-[var(--color-text-faint)]">
			<span class="text-[var(--color-accent)]">$</span> ls experts/
			<span class="text-[var(--color-text-faint)]">| wc -l</span>
			<span class="text-[var(--color-text-muted)]">→ {data.experts.length}</span>
		</div>
		<h1 class="mt-2 text-xl font-semibold tracking-tight">Experts</h1>
		<p class="mt-1 text-xs text-[var(--color-text-muted)]">
			Every named guest from Lenny's archive. Click in for excerpts and appearances.
		</p>
	</header>

	<div class="mb-4 flex flex-wrap items-center gap-2">
		<input
			type="search"
			bind:value={q}
			placeholder="search by name…"
			onkeydown={(e) => e.key === 'Enter' && applyFilter()}
			class="min-w-[200px] flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-1.5 font-mono text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)] focus:outline-none"
		/>
		<select
			bind:value={tag}
			onchange={applyFilter}
			class="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-1.5 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
		>
			<option value="">all domains</option>
			{#each data.tags as t}
				<option value={t}>{t}</option>
			{/each}
		</select>
		<button type="button" onclick={applyFilter} class="btn-primary">› apply</button>
	</div>

	<div
		class="grid gap-px overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 md:grid-cols-3"
	>
		{#each data.experts as e (e.id)}
			<a
				href="/experts/{e.slug}"
				class="group flex items-start gap-2.5 bg-[var(--color-panel)] p-2.5 transition-colors hover:bg-[var(--color-panel-2)]"
			>
				{#if e.avatar_url}
					<img src={e.avatar_url} alt={e.name} class="h-8 w-8 shrink-0 rounded-sm" />
				{:else}
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[var(--color-panel-2)] font-mono text-[10px] font-semibold text-[var(--color-text-muted)]"
					>
						{initialsOf(e.name)}
					</div>
				{/if}
				<div class="min-w-0 flex-1">
					<div
						class="truncate text-[13px] font-medium text-[var(--color-text)] group-hover:text-[var(--color-accent-hi)]"
					>
						{e.name}
					</div>
					<div class="mt-0.5 font-mono text-[10px] text-[var(--color-text-faint)]">
						{e.appearance_count} excerpts
					</div>
					{#if e.domains.length > 0}
						<div class="mt-1 flex flex-wrap gap-1">
							{#each e.domains.slice(0, 3) as d}
								<span class="tag">{d}</span>
							{/each}
						</div>
					{/if}
				</div>
			</a>
		{/each}
	</div>
</div>
