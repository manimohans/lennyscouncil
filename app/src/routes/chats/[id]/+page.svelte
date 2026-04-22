<script lang="ts">
	import { format } from 'date-fns';
	import { renderMarkdown } from '$lib/markdown';
	import { invalidate } from '$app/navigation';
	import { modelStore } from '$lib/stores/model.svelte';
	import { createFrameBatcher } from '$lib/stream-batch';
	import ThinkingDisclosure from '$lib/components/ThinkingDisclosure.svelte';

	let { data } = $props();
	let copyState = $state<'idle' | 'copied'>('idle');

	// In-flight continuation messages live in this array; on session_complete
	// we invalidate so the server-loaded `data.messages` picks them up canonically.
	interface LiveMessage {
		role: 'user' | 'expert';
		content: string;
		thinking: string;
		streaming: boolean;
	}
	let live: LiveMessage[] = $state([]);
	let draft = $state('');
	let streaming = $state(false);
	let errorMsg = $state('');

	async function copyAsMarkdown() {
		const lines = [`# ${data.chat.title}`, ''];
		for (const m of data.messages) {
			const speaker = m.role === 'user' ? 'You' : (m.expert_name ?? 'Synthesis');
			lines.push(`## ${speaker} ${m.role === 'expert' ? `(round ${m.round})` : ''}`);
			lines.push('');
			lines.push(m.content);
			lines.push('');
		}
		await navigator.clipboard.writeText(lines.join('\n'));
		copyState = 'copied';
		setTimeout(() => (copyState = 'idle'), 1500);
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

	async function send() {
		if (!data.continuation || !draft.trim() || streaming) return;
		const question = draft.trim();
		draft = '';
		streaming = true;
		errorMsg = '';
		live = [
			...live,
			{ role: 'user', content: question, thinking: '', streaming: false },
			{ role: 'expert', content: '', thinking: '', streaming: true }
		];

		const res = await fetch('/api/expert-chat/stream', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				mode: data.continuation.mode,
				expertSlug: data.continuation.expertSlug,
				question,
				chatId: data.chat.id,
				model: modelStore.value
			})
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
				const lines = block.split('\n');
				let eventName = 'message';
				let dataStr = '';
				for (const l of lines) {
					if (l.startsWith('event: ')) eventName = l.slice(7).trim();
					else if (l.startsWith('data: ')) dataStr += l.slice(6);
				}
				if (!dataStr) continue;
				let payload: any;
				try {
					payload = JSON.parse(dataStr);
				} catch {
					continue;
				}
				if (eventName === 'thinking') {
					pendingThinking += payload.delta;
					batch(flush);
				} else if (eventName === 'content') {
					pendingContent += payload.delta;
					batch(flush);
				} else if (eventName === 'turn_end') {
					flush();
					const i = live.length - 1;
					if (i >= 0) live[i] = { ...live[i], streaming: false };
				} else if (eventName === 'session_complete' || eventName === 'done') {
					flush();
					await invalidate(`app:chat:${data.chat.id}`);
					await invalidate('app:chats');
					live = [];
				} else if (eventName === 'error') {
					errorMsg = payload.message;
				}
			}
		}
		streaming = false;
	}
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
				{#if data.continuation}
					· with {data.continuation.expertName}
				{/if}
			</div>
		</div>
		<button onclick={copyAsMarkdown} class="btn-ghost shrink-0">
			{copyState === 'copied' ? '✓ copied' : 'copy md'}
		</button>
	</header>

	{#each data.messages as m (m.id)}
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
					<span class="text-[13px] font-medium">Synthesis</span>
				{:else if m.avatar_url}
					<img src={m.avatar_url} alt={m.expert_name} class="h-7 w-7 rounded-sm" />
					<span class="text-[13px] font-medium">{m.expert_name}</span>
					{#if m.round > 0}
						<span class="font-mono text-[10px] tracking-wider text-[var(--color-text-faint)] uppercase"
							>r{m.round}</span
						>
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
				{:else}
					{@html renderMarkdown(m.content)}
				{/if}
			</div>
		</article>
	{/each}

	{#each live as m, i (i)}
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
					<img src={data.continuation.expertAvatar} alt={data.continuation.expertName} class="h-7 w-7 rounded-sm" />
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
					{@html renderMarkdown(m.content)}{#if m.streaming}<span class="caret"></span>{/if}
				{/if}
			</div>
		</article>
	{/each}

	{#if data.continuation}
		{#if errorMsg}
			<div
				class="mt-4 rounded-md border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10 px-3 py-2 text-xs text-[var(--color-bad)]"
			>
				{errorMsg}
			</div>
		{/if}
		<form
			class="mt-6 flex items-end gap-2 border-t border-[var(--color-line)] pt-5"
			onsubmit={(e) => {
				e.preventDefault();
				send();
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
						send();
					}
				}}
				class="flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
			></textarea>
			<button type="submit" disabled={streaming || !draft.trim()} class="btn-primary">› send</button>
		</form>
	{/if}
</div>
