<script lang="ts">
	let { data } = $props();

	const modes = [
		{
			href: '/roundtable',
			cmd: 'roundtable',
			title: 'Multi-expert debate',
			desc: 'Ask. We pick 3-5 experts who answer, push back on each other, then synthesize.',
			kbd: '⌘R'
		},
		{
			href: '/validate',
			cmd: 'validate',
			title: 'Idea validation',
			desc: 'Brutal multi-axis critique of a product or startup idea.',
			kbd: '⌘V'
		},
		{
			href: '/prd',
			cmd: 'prd',
			title: 'PRD review',
			desc: 'Paste a doc. Panel surfaces gaps and recommends a v1.',
			kbd: '⌘P'
		},
		{
			href: '/mentor',
			cmd: 'mentor',
			title: 'Career mentor',
			desc: 'One-on-one with a leadership coach. Persistent conversation.',
			kbd: '⌘M'
		},
		{
			href: '/strategy',
			cmd: 'strategy',
			title: 'Strategy advisor',
			desc: 'Stress-test a product strategy with one focused expert.',
			kbd: '⌘S'
		},
		{
			href: '/gaps',
			cmd: 'gaps',
			title: 'Gap scanner',
			desc: 'Mine the corpus for unsolved problems in a topic area.',
			kbd: '⌘G'
		}
	];
</script>

<div class="container-tight py-12">
	<header class="mb-10">
		<div class="font-mono text-xs text-[var(--color-text-faint)]">
			<span class="text-[var(--color-accent)]">$</span> council --convene
		</div>
		<h1 class="mt-3 text-3xl font-semibold tracking-tight text-[var(--color-text)]">
			Lenny's Council
		</h1>
		<p class="mt-1.5 text-sm text-[var(--color-text-muted)]">
			293 experts from <a
				href="https://www.lennyspodcast.com"
				target="_blank"
				rel="noreferrer"
				class="underline decoration-[var(--color-line-2)] underline-offset-2 hover:decoration-[var(--color-accent)]"
				>Lenny's archive</a
			>, on tap. Pick a mode.
		</p>
	</header>

	<div class="grid gap-px overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2">
		{#each modes as m, i}
			<a
				href={m.href}
				class="group block bg-[var(--color-panel)] p-4 transition-colors hover:bg-[var(--color-panel-2)]"
			>
				<div class="flex items-baseline justify-between gap-3">
					<div class="font-mono text-xs text-[var(--color-text-faint)]">
						<span class="text-[var(--color-accent)]">$</span>
						<span class="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-hi)]"
							>{m.cmd}</span
						>
					</div>
					<span class="kbd opacity-0 group-hover:opacity-100">{m.kbd}</span>
				</div>
				<div class="mt-2 text-[13px] font-medium text-[var(--color-text)]">{m.title}</div>
				<p class="mt-0.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
					{m.desc}
				</p>
			</a>
		{/each}
	</div>

	<div class="mt-px grid gap-px overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2">
		<a
			href="/experts"
			class="group block bg-[var(--color-panel)] p-4 transition-colors hover:bg-[var(--color-panel-2)]"
		>
			<div class="font-mono text-xs text-[var(--color-text-faint)]">
				<span class="text-[var(--color-accent)]">$</span>
				<span class="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-hi)]"
					>ls experts/</span
				>
			</div>
			<div class="mt-2 text-[13px] font-medium text-[var(--color-text)]">Experts directory</div>
			<p class="mt-0.5 text-xs text-[var(--color-text-muted)]">Browse all 293+ experts and their domains.</p>
		</a>
		<a
			href="/chats"
			class="group block bg-[var(--color-panel)] p-4 transition-colors hover:bg-[var(--color-panel-2)]"
		>
			<div class="font-mono text-xs text-[var(--color-text-faint)]">
				<span class="text-[var(--color-accent)]">$</span>
				<span class="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-hi)]"
					>ls chats/</span
				>
			</div>
			<div class="mt-2 text-[13px] font-medium text-[var(--color-text)]">Saved chats</div>
			<p class="mt-0.5 text-xs text-[var(--color-text-muted)]">Resume a past session.</p>
		</a>
	</div>
</div>
