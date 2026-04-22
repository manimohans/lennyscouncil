<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';
	import { modelStore } from '$lib/stores/model.svelte';
	import ThinkingDisclosure from './ThinkingDisclosure.svelte';
	import { createFrameBatcher } from '$lib/stream-batch';
	import { invalidate } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import type { CitationData } from '$lib/types';

	let {
		mode,
		title,
		expertSuggestions,
		preselect = ''
	}: {
		mode: 'mentor' | 'strategy';
		title: string;
		expertSuggestions: Array<{
			slug: string;
			name: string;
			avatar_url: string | null;
			domains: string[];
		}>;
		preselect?: string;
	} = $props();

	interface ChatMessage {
		role: 'user' | 'expert';
		content: string;
		thinking: string;
		streaming: boolean;
		citations: CitationData[];
	}

	let selectedSlug = $state('');
	$effect(() => {
		if (preselect) selectedSlug = preselect;
	});
	let chatId = $state<string | null>(null);
	let history: ChatMessage[] = $state([]);
	let draft = $state('');
	let streaming = $state(false);
	let errorMsg = $state('');
	let abortController: AbortController | null = null;
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

	const expertById = $derived(new Map(expertSuggestions.map((e) => [e.slug, e])));
	const expert = $derived(expertById.get(selectedSlug));

	function initialsOf(name: string) {
		return name
			.split(/\s+/)
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	async function send() {
		if (!selectedSlug || !draft.trim() || streaming) return;
		const userMsg: ChatMessage = {
			role: 'user',
			content: draft.trim(),
			thinking: '',
			streaming: false,
			citations: []
		};
		history = [
			...history,
			userMsg,
			{ role: 'expert', content: '', thinking: '', streaming: true, citations: [] }
		];
		const question = draft;
		draft = '';
		streaming = true;
		errorMsg = '';
		abortController = new AbortController();

		try {
			const res = await fetch('/api/expert-chat/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode,
					expertSlug: selectedSlug,
					question,
					chatId,
					model: modelStore.value
				}),
				signal: abortController.signal
			});
			if (!res.ok || !res.body) {
				errorMsg = `Stream failed: ${res.status}`;
				streaming = false;
				return;
			}
			reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			const batch = createFrameBatcher();
			let pendingThinking = '';
			let pendingContent = '';
			const flushDeltas = () => {
				const i = history.length - 1;
				if (i < 0 || history[i].role !== 'expert') return;
				if (!pendingThinking && !pendingContent) return;
				history[i] = {
					...history[i],
					thinking: history[i].thinking + pendingThinking,
					content: history[i].content + pendingContent
				};
				pendingThinking = '';
				pendingContent = '';
			};

			while (true) {
				const { value, done } = await reader.read();
				if (done) {
					flushDeltas();
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				let nl: number;
				while ((nl = buffer.indexOf('\n\n')) !== -1) {
					const block = buffer.slice(0, nl);
					buffer = buffer.slice(nl + 2);
					if (block.startsWith(':')) continue; // heartbeat
					const lines = block.split('\n');
					let eventName = 'message';
					let dataStr = '';
					for (const l of lines) {
						if (l.startsWith('event: ')) eventName = l.slice(7).trim();
						else if (l.startsWith('data: ')) dataStr += l.slice(6);
					}
					if (!dataStr) continue;
					let payload: Record<string, unknown>;
					try {
						payload = JSON.parse(dataStr);
					} catch {
						continue;
					}
					if (eventName === 'chat_created') {
						if (!chatId) chatId = String(payload.chatId);
						invalidate('app:chats');
					} else if (eventName === 'thinking') {
						pendingThinking += String(payload.delta);
						batch(flushDeltas);
					} else if (eventName === 'content') {
						pendingContent += String(payload.delta);
						batch(flushDeltas);
					} else if (eventName === 'turn_end') {
						flushDeltas();
						const i = history.length - 1;
						if (i >= 0) {
							history[i] = {
								...history[i],
								streaming: false,
								citations: (payload.citations as CitationData[]) ?? []
							};
						}
					} else if (eventName === 'session_complete') {
						if (!chatId) chatId = String(payload.chatId);
						invalidate('app:chats');
					} else if (eventName === 'error') {
						errorMsg = String(payload.message);
					}
				}
			}
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				errorMsg = 'Connection dropped. Try again.';
			}
		} finally {
			try {
				reader?.cancel();
			} catch {
				/* ignore */
			}
			reader = null;
			abortController = null;
			streaming = false;
		}
	}

	function stop() {
		if (abortController) abortController.abort();
	}

	onDestroy(() => stop());
</script>

<div class="container-tight py-10">
	<header class="mb-5">
		<div class="font-mono text-xs text-[var(--color-text-faint)]">
			<span class="text-[var(--color-accent)]">$</span>
			{mode}
		</div>
		<h1 class="mt-2 text-xl font-semibold tracking-tight">{title}</h1>
	</header>

	{#if !selectedSlug}
		<div>
			<div class="section-label mb-2">pick a {mode === 'mentor' ? 'mentor' : 'strategy advisor'}</div>
			<div
				class="grid gap-px overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2"
			>
				{#each expertSuggestions as e (e.slug)}
					<button
						type="button"
						onclick={() => (selectedSlug = e.slug)}
						class="group flex items-start gap-2.5 bg-[var(--color-panel)] p-3 text-left transition-colors hover:bg-[var(--color-panel-2)]"
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
						<div class="min-w-0">
							<div class="text-[13px] font-medium text-[var(--color-text)] group-hover:text-[var(--color-accent-hi)]">
								{e.name}
							</div>
							<div class="mt-0.5 font-mono text-[10px] text-[var(--color-text-faint)]">
								{e.domains.slice(0, 3).join(' · ')}
							</div>
						</div>
					</button>
				{/each}
			</div>
			<div class="mt-3 font-mono text-[11px] text-[var(--color-text-faint)]">
				or <a href="/experts" class="text-[var(--color-accent-hi)] underline">pick anyone from the directory</a>
			</div>
		</div>
	{:else}
		<div
			class="mb-4 flex items-center gap-2.5 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2"
		>
			{#if expert?.avatar_url}
				<img src={expert.avatar_url} alt={expert?.name} class="h-7 w-7 rounded-sm" />
			{/if}
			<div class="text-[13px] font-medium">talking to {expert?.name}</div>
			<button
				onclick={() => {
					stop();
					selectedSlug = '';
					chatId = null;
					history = [];
				}}
				class="ml-auto font-mono text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent-hi)]"
			>
				switch
			</button>
		</div>

		<div class="space-y-3">
			{#each history as m, i (`${m.role}-${i}`)}
				{#if m.role === 'user'}
					<div class="flex justify-end">
						<div
							class="max-w-[80%] rounded-md bg-[var(--color-accent-faint)] px-3 py-2 text-sm text-[var(--color-text)]"
							style="white-space: pre-wrap; overflow-wrap: anywhere;"
						>
							{m.content}
						</div>
					</div>
				{:else}
					<div
						class="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5"
					>
						<ThinkingDisclosure
							thinking={m.thinking}
							isThinking={m.streaming && m.content.length === 0}
						/>
						{#if m.content}
							<div class="md">
								{@html renderMarkdown(m.content, m.citations)}{#if m.streaming}<span class="caret"></span>{/if}
							</div>
						{/if}
					</div>
				{/if}
			{/each}
		</div>

		{#if errorMsg}
			<div
				class="mt-4 rounded-md border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10 px-3 py-2 text-xs text-[var(--color-bad)]"
			>
				{errorMsg}
			</div>
		{/if}

		<form
			class="mt-5 flex items-end gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				send();
			}}
		>
			<textarea
				bind:value={draft}
				rows="2"
				placeholder="ask {expert?.name} anything…  (⌘↵ to send)"
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						send();
					}
				}}
				class="flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)] focus:outline-none"
			></textarea>
			{#if streaming}
				<button type="button" onclick={stop} class="rounded-md border border-[var(--color-line)] px-3 py-2 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-bad)] hover:text-[var(--color-bad)]">
					stop
				</button>
			{:else}
				<button type="submit" disabled={!draft.trim()} class="btn-primary">› send</button>
			{/if}
		</form>
	{/if}
</div>
