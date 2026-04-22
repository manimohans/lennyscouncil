<script lang="ts">
	import { onMount } from 'svelte';
	import { modelStore, DEFAULT_MODEL } from '$lib/stores/model.svelte';

	interface ListedModel {
		name: string;
		family: string;
		size_mb: number;
		param_size: string;
		is_embedding: boolean;
	}

	let models: ListedModel[] = $state([]);
	let loading = $state(true);
	let open = $state(false);
	let error = $state('');

	onMount(async () => {
		try {
			const res = await fetch('/api/models');
			const data = await res.json();
			models = data.models ?? [];
			if (data.error) error = data.error;
			// If our selected model is no longer available, fall back to the first listed.
			if (models.length > 0 && !models.some((m) => m.name === modelStore.value)) {
				modelStore.set(models[0].name);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	});

	function shortName(name: string): string {
		// "kimi-k2.6:cloud" -> "kimi-k2.6"
		return name.split(':')[0];
	}

	function tagFor(name: string): string {
		const tag = name.split(':')[1];
		if (!tag) return '';
		if (tag === 'latest') return '';
		return tag;
	}

	function pick(name: string) {
		modelStore.set(name);
		open = false;
	}

	let containerEl: HTMLElement;
	function onDocClick(e: MouseEvent) {
		if (open && containerEl && !containerEl.contains(e.target as Node)) open = false;
	}
</script>

<svelte:window onclick={onDocClick} />

<div bind:this={containerEl} class="relative">
	<button
		type="button"
		onclick={() => (open = !open)}
		class="flex items-center gap-1.5 rounded border border-[var(--color-line-2)] bg-[var(--color-panel)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-text-faint)] hover:text-[var(--color-text)]"
		title="Pick the model used for chat / synthesis"
	>
		<span class="h-1.5 w-1.5 rounded-full bg-[var(--color-good)]"></span>
		<span class="text-[var(--color-text)]">{shortName(modelStore.value)}</span>
		{#if tagFor(modelStore.value)}
			<span class="text-[var(--color-text-faint)]">:{tagFor(modelStore.value)}</span>
		{/if}
		<span class="text-[var(--color-text-faint)]">▾</span>
	</button>

	{#if open}
		<div
			class="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-md border border-[var(--color-line-2)] bg-[var(--color-panel)] shadow-lg"
		>
			<div
				class="border-b border-[var(--color-line)] px-3 py-1.5 font-mono text-[10px] tracking-wider text-[var(--color-text-faint)] uppercase"
			>
				ollama models
			</div>
			{#if loading}
				<div class="px-3 py-2 font-mono text-xs text-[var(--color-text-faint)]">loading…</div>
			{:else if models.length === 0}
				<div class="px-3 py-3 font-mono text-xs text-[var(--color-bad)]">
					{error || 'no models found — is ollama running?'}
				</div>
			{:else}
				<ul class="max-h-72 overflow-y-auto">
					{#each models as m}
						<li>
							<button
								type="button"
								onclick={() => pick(m.name)}
								class="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors hover:bg-[var(--color-panel-2)]
								{m.name === modelStore.value ? 'bg-[var(--color-accent-faint)]' : ''}"
							>
								<span class="flex items-center gap-2 min-w-0">
									{#if m.name === modelStore.value}
										<span class="text-[var(--color-accent)]">›</span>
									{:else}
										<span class="text-[var(--color-text-faint)]">·</span>
									{/if}
									<span class="font-mono text-xs truncate {m.name === modelStore.value ? 'text-[var(--color-accent-hi)]' : 'text-[var(--color-text)]'}">
										{m.name}
									</span>
								</span>
								<span class="shrink-0 font-mono text-[10px] text-[var(--color-text-faint)]">
									{m.param_size || ''}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
