<script lang="ts">
	import { format } from 'date-fns';
	import { renderMarkdown } from '$lib/markdown';
	import { invalidate, goto } from '$app/navigation';
	import { modelStore } from '$lib/stores/model.svelte';
	import { createFrameBatcher } from '$lib/stream-batch';
	import ThinkingDisclosure from '$lib/components/ThinkingDisclosure.svelte';
	import type { CitationData } from '$lib/types';
	import { onDestroy } from 'svelte';

	let { data } = $props();
	let copyState = $state<'idle' | 'copied'>('idle');
	let shareState = $state<'idle' | 'copied'>('idle');

	interface LiveMessage {
		role: 'user' | 'expert';
		content: string;
		thinking: string;
		streaming: boolean;
		citations: CitationData[];
	}
	let live: LiveMessage[] = $state([]);
	let draft = $state('');
	let streaming = $state(false);
	let errorMsg = $state('');
	let abortController: AbortController | null = null;

	// For gap-mode chats we parsed the JSON payload into the synthesis message
	// at persist time. Show it as a real list, not a wall of JSON.
	function parseGapsPayload(raw: string) {
		try {
			const v = JSON.parse(raw);
			if (Array.isArray(v)) return v;
		} catch {
			/* not JSON */
		}
		return null;
	}

	async function copyAsMarkdown() {
		const lines = [`# ${data.chat.title}`, ''];
		for (const m of data.messages) {
			const speaker = m.role === 'user' ? 'You' : (m.expert_name ?? 'Synthesis');
			lines.push(`## ${speaker} ${m.role === 'expert' ? `(round ${m.round})` : ''}`);
			lines.push('');
			lines.push(m.content);
			lines.push('');
			// Append source links — the actionable part of a citation.
			const urls = Array.from(
				new Set(m.citations.map((c) => c.source_url).filter((u): u is string => Boolean(u)))
			);
			if (urls.length > 0) {
				lines.push('');
				lines.push('_Sources:_');
				for (const u of urls) lines.push(`- ${u}`);
				lines.push('');
			}
		}
		await navigator.clipboard.writeText(lines.join('\n'));
		copyState = 'copied';
		setTimeout(() => (copyState = 'idle'), 1500);
	}

	async function copyShareLink() {
		await navigator.clipboard.writeText(window.location.href);
		shareState = 'copied';
		setTimeout(() => (shareState = 'idle'), 1500);
	}

	function fmt(s: string) {
		try {
			return format(new Date(s), 'MMM d, yyyy · HH:mm');
		} catch {
			return s;
		}
	}

	function initialsOf(name: string | null) {
		if (!name) return '∑';
		return name
			.split(/\s+/)
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	function continueInValidate() {
		// Re-open the original artifact in the validate input (users can tweak + re-run).
		if (data.continuation?.kind !== 'validate' || !data.continuation.prevArtifact) return;
		goto(`/validate?prefill=${encodeURIComponent(data.continuation.prevArtifact)}`);
	}

	function continueInPrd() {
		if (data.continuation?.kind !== 'prd' || !data.continuation.prevArtifact) return;
		goto(`/prd?prefill=${encodeURIComponent(data.continuation.prevArtifact)}`);
	}

	function continueInRoundtable() {
		if (data.continuation?.kind !== 'roundtable' || !data.continuation.prevQuestion) return;
		goto(`/roundtable?prefill=${encodeURIComponent(data.continuation.prevQuestion)}`);
	}

	async function sendMentor() {
		if (!data.continuation) return;
		if (data.continuation.kind !== 'mentor' && data.continuation.kind !== 'strategy') return;
		if (!draft.trim() || streaming) return;
		const question = draft.trim();
		draft = '';
		streaming = true;
		errorMsg = '';
		abortController = new AbortController();
		live = [
			...live,
			{ role: 'user', content: question, thinking: '', streaming: false, citations: [] },
			{ role: 'expert', content: '', thinking: '', streaming: true, citations: [] }
		];

		try {
			const res = await fetch('/api/expert-chat/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: data.continuation.kind,
					expertSlug: data.continuation.expertSlug,
					question,
					chatId: data.chat.id,
					model: modelStore.value
				}),
				signal: abortController.signal
			});
			if (!res.ok || !res.body) {
				errorMsg = `Stream failed: ${res.status}`;
				streaming = false;
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			const batch = createFrameBatcher();
			let pendingThinking = '';
			let pendingContent = '';
			const flush = () => {
				const i = live.length - 1;
				if (i < 0 || live[i].role !== 'expert') return;
				if (!pendingThinking && !pendingContent) return;
				live[i] = {
					...live[i],
					thinking: live[i].thinking + pendingThinking,
					content: live[i].content + pendingContent
				};
				pendingThinking = '';
				pendingContent = '';
			};

			while (true) {
				const { value, done } = await reader.read();
				if (done) {
					flush();
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				let nl: number;
				while ((nl = buffer.indexOf('\n\n')) !== -1) {
					const block = buffer.slice(0, nl);
					buffer = buffer.slice(nl + 2);
					if (block.startsWith(':')) continue;
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
					if (eventName === 'thinking') {
						pendingThinking += String(payload.delta);
						batch(flush);
					} else if (eventName === 'content') {
						pendingContent += String(payload.delta);
						batch(flush);
					} else if (eventName === 'turn_end') {
						flush();
						const i = live.length - 1;
						if (i >= 0) {
							live[i] = {
								...live[i],
								streaming: false,
								citations: (payload.citations as CitationData[]) ?? []
							};
						}
					} else if (eventName === 'session_complete' || eventName === 'done') {
						flush();
						await invalidate(`app:chat:${data.chat.id}`);
						await invalidate('app:chats');
						live = [];
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
			abortController = null;
			streaming = false;
		}
	}

	function stop() {
		abortController?.abort();
	}

	onDestroy(() => stop());
</script>

<div class="container-tight py-10">
	<header class="mb-5 flex items-start justify-between gap-3">
		<div class="min-w-0">
			<a
				href="/chats"
				class="font-mono text-xs text-[var(--color-text-faint)] hover:text-[var(--color-accent-hi)]"
			>
				‹ ls chats/
			</a>
			<h1 class="mt-2 text-xl font-semibold tracking-tight">{data.chat.title}</h1>
			<div class="mt-1 font-mono text-[11px] text-[var(--color-text-faint)]">
				[{data.chat.mode}] · {fmt(data.chat.created_at)}
				{#if data.continuation?.expertName}· with {data.continuation.expertName}{/if}
			</div>
		</div>
		<div class="flex shrink-0 gap-2">
			<button onclick={copyShareLink} class="btn-ghost">
				{shareState === 'copied' ? '✓ link copied' : 'share link'}
			</button>
			<button onclick={copyAsMarkdown} class="btn-ghost">
				{copyState === 'copied' ? '✓ copied' : 'copy md'}
			</button>
		</div>
	</header>

	{#each data.messages as m (m.id)}
		{@const gaps = m.role === 'synthesis' && data.chat.mode === 'gaps' ? parseGapsPayload(m.content) : null}
		<article class="border-t border-[var(--color-line)] py-5">
			<header class="mb-3 flex items-center gap-2.5">
				{#if m.role === 'user'}
					<div
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[var(--color-panel-2)] font-mono text-[10px] font-semibold text-[var(--color-text-muted)]"
					>
						You
					</div>
					<span class="text-[13px] font-medium">You</span>
				{:else if m.role === 'synthesis'}
					<div
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[var(--color-accent)] font-mono text-xs font-bold text-[var(--color-bg)]"
					>
						∑
					</div>
					<span class="text-[13px] font-medium">
						{data.chat.mode === 'gaps' ? 'Gaps' : 'Synthesis'}
					</span>
				{:else if m.avatar_url}
					<img src={m.avatar_url} alt={m.expert_name} class="h-7 w-7 rounded-sm" />
					<span class="text-[13px] font-medium">{m.expert_name}</span>
					{#if m.round > 0}
						<span
							class="font-mono text-[10px] tracking-wider text-[var(--color-text-faint)] uppercase"
						>
							r{m.round}
						</span>
					{/if}
				{:else}
					<div
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[var(--color-panel-2)] font-mono text-[10px] font-semibold text-[var(--color-text-muted)]"
					>
						{initialsOf(m.expert_name)}
					</div>
					<span class="text-[13px] font-medium">{m.expert_name}</span>
				{/if}
			</header>

			{#if m.thinking}
				<ThinkingDisclosure thinking={m.thinking} isThinking={false} />
			{/if}

			<div class="md">
				{#if m.role === 'user'}
					<p class="text-[var(--color-text)]" style="white-space: pre-wrap">{m.content}</p>
				{:else if gaps}
					{#each gaps as g, i (i)}
						<div class="mt-3 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3 first:mt-0">
							<div class="flex items-start justify-between gap-3">
								<div class="flex items-baseline gap-2">
									<span class="font-mono text-[11px] text-[var(--color-text-faint)]">
										{String(i + 1).padStart(2, '0')}
									</span>
									<h3 class="text-[14px] font-medium">{g.problem}</h3>
								</div>
								<span class="tag text-[var(--color-accent-hi)]">{g.signals} signals</span>
							</div>
							<p class="mt-1 ml-7 text-[13px] text-[var(--color-text-muted)]">{g.rationale}</p>
						</div>
					{/each}
				{:else}
					{@html renderMarkdown(m.content, m.citations)}
				{/if}
			</div>
		</article>
	{/each}

	{#each live as m, i (`live-${i}-${m.role}`)}
		<article class="border-t border-[var(--color-line)] py-5">
			<header class="mb-3 flex items-center gap-2.5">
				{#if m.role === 'user'}
					<div
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[var(--color-panel-2)] font-mono text-[10px] font-semibold text-[var(--color-text-muted)]"
					>
						You
					</div>
					<span class="text-[13px] font-medium">You</span>
				{:else if data.continuation?.expertAvatar}
					<img
						src={data.continuation.expertAvatar}
						alt={data.continuation.expertName}
						class="h-7 w-7 rounded-sm"
					/>
					<span class="text-[13px] font-medium">{data.continuation?.expertName}</span>
				{/if}
			</header>

			{#if m.role === 'expert'}
				<ThinkingDisclosure thinking={m.thinking} isThinking={m.streaming && m.content.length === 0} />
			{/if}

			<div class="md">
				{#if m.role === 'user'}
					<p class="text-[var(--color-text)]" style="white-space: pre-wrap">{m.content}</p>
				{:else if m.content}
					{@html renderMarkdown(m.content, m.citations)}{#if m.streaming}<span class="caret"></span>{/if}
				{/if}
			</div>
		</article>
	{/each}

	{#if errorMsg}
		<div
			class="mt-4 rounded-md border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10 px-3 py-2 text-xs text-[var(--color-bad)]"
		>
			{errorMsg}
		</div>
	{/if}

	<!-- Continuation UI: mentor/strategy chat inline; other modes bounce to the mode page with prefilled context. -->
	{#if data.continuation?.kind === 'mentor' || data.continuation?.kind === 'strategy'}
		<form
			class="mt-6 flex items-end gap-2 border-t border-[var(--color-line)] pt-5"
			onsubmit={(e) => {
				e.preventDefault();
				sendMentor();
			}}
		>
			<textarea
				bind:value={draft}
				rows="2"
				placeholder="continue with {data.continuation.expertName}…  (⌘↵ to send)"
				disabled={streaming}
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						sendMentor();
					}
				}}
				class="flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
			></textarea>
			{#if streaming}
				<button
					type="button"
					onclick={stop}
					class="rounded-md border border-[var(--color-line)] px-3 py-2 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-bad)] hover:text-[var(--color-bad)]"
				>
					stop
				</button>
			{:else}
				<button type="submit" disabled={!draft.trim()} class="btn-primary">› send</button>
			{/if}
		</form>
	{:else if data.continuation?.kind === 'roundtable' && data.continuation.prevQuestion}
		<div class="mt-6 flex items-center justify-between gap-3 border-t border-[var(--color-line)] pt-5">
			<p class="font-mono text-[11px] text-[var(--color-text-faint)]">
				Roundtables are one-shot. Reuse this prompt to tweak and re-run.
			</p>
			<button type="button" onclick={continueInRoundtable} class="btn-primary">
				› ask another →
			</button>
		</div>
	{:else if data.continuation?.kind === 'validate' && data.continuation.prevArtifact}
		<div class="mt-6 flex items-center justify-between gap-3 border-t border-[var(--color-line)] pt-5">
			<p class="font-mono text-[11px] text-[var(--color-text-faint)]">
				Open the original artifact in the validate page to iterate.
			</p>
			<button type="button" onclick={continueInValidate} class="btn-primary">
				› iterate on this idea →
			</button>
		</div>
	{:else if data.continuation?.kind === 'prd' && data.continuation.prevArtifact}
		<div class="mt-6 flex items-center justify-between gap-3 border-t border-[var(--color-line)] pt-5">
			<p class="font-mono text-[11px] text-[var(--color-text-faint)]">
				Reopen this PRD in the review page to iterate on a new version.
			</p>
			<button type="button" onclick={continueInPrd} class="btn-primary">
				› review new version →
			</button>
		</div>
	{/if}
</div>
