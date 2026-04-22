<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import MobileNav from '$lib/components/MobileNav.svelte';
	import ModelPicker from '$lib/components/ModelPicker.svelte';
	import { goto } from '$app/navigation';

	let { data, children } = $props();

	function onKey(e: KeyboardEvent) {
		if (!(e.metaKey || e.ctrlKey)) return;
		const t = e.target as HTMLElement | null;
		// Don't hijack typing in inputs
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
		const map: Record<string, string> = {
			r: '/roundtable',
			v: '/validate',
			p: '/prd',
			m: '/mentor',
			s: '/strategy',
			g: '/gaps'
		};
		const target = map[e.key.toLowerCase()];
		if (target) {
			e.preventDefault();
			goto(target);
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Lenny's Council</title>
	<link rel="preconnect" href="https://rsms.me/" />
	<link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<svelte:window on:keydown={onKey} />

<div class="flex min-h-screen">
	<Sidebar user={data.user} recentChats={data.recentChats} />
	<main class="relative min-w-0 flex-1">
		<MobileNav />
		<div class="absolute top-3 right-4 z-10 hidden lg:block">
			<ModelPicker />
		</div>
		{@render children()}
	</main>
</div>
