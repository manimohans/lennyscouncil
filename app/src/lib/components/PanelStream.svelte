<script lang="ts">
	import RoundtableTurn from './RoundtableTurn.svelte';
	import type { ExpertCardData, TurnState } from '$lib/types';
	import { modelStore } from '$lib/stores/model.svelte';
	import { createFrameBatcher } from '$lib/stream-batch';
	import { invalidate } from '$app/navigation';

	let {
		mode,
		title,
		cmd,
		placeholder,
		minChars = 20
	}: {
		mode: 'validate' | 'prd';
		title: string;
		cmd: string;
		placeholder: string;
		minChars?: number;
	} = $props();

	let artifact = $state('');
	let phase: 'idle' | 'streaming' | 'done' = $state('idle');
	let experts: ExpertCardData[] = $state([]);
	let turns: TurnState[] = $state([]);
	let errorMsg = $state('');
	const avatarById = $derived(new Map(experts.map((e) => [e.expert_id, e.avatar_url])));

	function initialsOf(name: string) {
		return name
			.split(/\s+/)
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	async function start() {
		if (artifact.trim().length < minChars) return;
		phase = 'streaming';
		experts = [];
		turns = [];
		errorMsg = '';

		const res = await fetch('/api/panel/stream', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mode, artifact, model: modelStore.value })
		});
		if (!res.ok || !res.body) {
			errorMsg = `Stream failed: ${res.status}`;
			phase = 'idle';
			return;
		}
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		const batch = createFrameBatcher();
		let pendingThinking = '';
		let pendingContent = '';
		const flushDeltas = () => {
			if (turns.length === 0) return;
			if (!pendingThinking && !pendingContent) return;
			const i = turns.length - 1;
			turns[i] = {
				...turns[i],
				thinking: turns[i].thinking + pendingThinking,
				content: turns[i].content + pendingContent
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
				const lines = block.split('\n');
				let eventName = 'message';
				let dataStr = '';
				for (const line of lines) {
					if (line.startsWith('event: ')) eventName = line.slice(7).trim();
					else if (line.startsWith('data: ')) dataStr += line.slice(6);
				}
				if (!dataStr) continue;
				let payload: any;
				try {
					payload = JSON.parse(dataStr);
				} catch {
					continue;
				}
				if (eventName === 'chat_created') {
					invalidate('app:chats');
				} else if (eventName === 'experts_selected') {
					experts = payload.experts;
				} else if (eventName === 'turn_start') {
					flushDeltas();
					const newTurn: TurnState = {
						expertId: payload.expertId,
						expertName: payload.expertName,
						role: payload.role,
						round: 1,
						turnNumber: payload.turnNumber,
						thinking: '',
						content: '',
						done: false,
						citations: []
					};
					turns = [...turns, newTurn];
				} else if (eventName === 'thinking') {
					pendingThinking += payload.delta;
					batch(flushDeltas);
				} else if (eventName === 'content') {
					pendingContent += payload.delta;
					batch(flushDeltas);
				} else if (eventName === 'turn_end' && turns.length > 0) {
					flushDeltas();
					const i = turns.length - 1;
					turns[i] = { ...turns[i], done: true, citations: payload.citations ?? [] };
				} else if (eventName === 'error') {
					errorMsg = payload.message;
					phase = 'done';
				} else if (eventName === 'done' || eventName === 'session_complete') {
					flushDeltas();
					phase = 'done';
					invalidate('app:chats');
				}
			}
		}
	}

	function reset() {
		phase = 'idle';
		artifact = '';
		experts = [];
		turns = [];
		errorMsg = '';
	}
</script>

<div class="container-tight py-10">
	<header class="mb-5">
		<div class="font-mono text-xs text-[var(--color-text-faint)]">
			<span class="text-[var(--color-accent)]">$</span>
			{cmd}
		</div>
		<h1 class="mt-2 text-xl font-semibold tracking-tight">{title}</h1>
	</header>

	{#if phase === 'idle'}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				start();
			}}
		>
			<label class="block">
				<span class="section-label">input</span>
				<textarea
					bind:value={artifact}
					rows="10"
					{placeholder}
					class="mt-1.5 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)] focus:outline-none"
				></textarea>
			</label>
			<div class="mt-3 flex items-center justify-between">
				<span class="font-mono text-[11px] text-[var(--color-text-faint)]">
					{artifact.trim().length} / {minChars} min chars
				</span>
				<button type="submit" disabled={artifact.trim().length < minChars} class="btn-primary">
					› run review →
				</button>
			</div>
		</form>
	{/if}

	{#if phase === 'streaming' || phase === 'done'}
		<div>
			{#if experts.length > 0}
				<div class="mb-5">
					<div class="section-label mb-2">reviewers</div>
					<div class="flex flex-wrap gap-2">
						{#each experts as e}
							<div
								class="flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-muted)]"
							>
								{#if e.avatar_url}
									<img src={e.avatar_url} alt={e.name} class="h-4 w-4 rounded-sm" />
								{:else}
									<span class="font-mono text-[9px]">{initialsOf(e.name)}</span>
								{/if}
								<span class="text-[var(--color-text)]">{e.name}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#each turns as t (t.turnNumber)}
				<RoundtableTurn turn={t} expertAvatar={avatarById.get(t.expertId) ?? null} />
			{/each}

			{#if errorMsg}
				<div
					class="mt-4 rounded-md border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10 px-3 py-2 text-sm text-[var(--color-bad)]"
				>
					{errorMsg}
				</div>
			{/if}

			{#if phase === 'done'}
				<div class="mt-6 flex justify-end">
					<button type="button" onclick={reset} class="btn-primary">› run another</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
