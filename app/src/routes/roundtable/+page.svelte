<script lang="ts">
	import ExpertCard from '$lib/components/ExpertCard.svelte';
	import RoundtableTurn from '$lib/components/RoundtableTurn.svelte';
	import type { ExpertCardData, TurnState } from '$lib/types';
	import { modelStore } from '$lib/stores/model.svelte';
	import { createFrameBatcher } from '$lib/stream-batch';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';

	let question = $state(page.url.searchParams.get('prefill') ?? '');
	let rounds = $state(3);
	let phase: 'idle' | 'selecting' | 'reviewing' | 'streaming' | 'done' = $state('idle');
	let experts: ExpertCardData[] = $state([]);
	let turns: TurnState[] = $state([]);
	let errorMsg = $state('');
	let abortController: AbortController | null = $state(null);
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	const avatarById = $derived(new Map(experts.map((e) => [e.expert_id, e.avatar_url])));

	// Pretty labels for the rounds slider so users don't guess what "3" means.
	const ROUND_LABELS: Record<number, string> = {
		2: 'Quick take (≈1 min)',
		3: 'Standard (≈2 min)',
		4: 'Deep (≈3 min)',
		5: 'Thorough (≈4 min)'
	};

	const EXAMPLES = [
		'How do I price my B2B SaaS entering a competitive market?',
		"What's the most important habit of a great PM?",
		'How should a Series A founder think about hiring their first VP of Eng?',
		"What's the right way to structure a positioning workshop?"
	];

	function stopStream() {
		try {
			reader?.cancel();
		} catch {
			/* ignore */
		}
		abortController?.abort();
		abortController = null;
		reader = null;
		phase = 'done';
	}

	async function selectExperts() {
		if (!question.trim()) return;
		errorMsg = '';
		phase = 'selecting';
		try {
			const res = await fetch('/api/experts/select', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ question })
			});
			if (!res.ok) {
				errorMsg = await res.text();
				phase = 'idle';
				return;
			}
			const data = await res.json();
			experts = data.experts;
			phase = experts.length === 0 ? 'idle' : 'reviewing';
			if (experts.length === 0) errorMsg = 'No experts matched. Try rephrasing.';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
			phase = 'idle';
		}
	}

	function removeExpert(id: string) {
		experts = experts.filter((e) => e.expert_id !== id);
	}

	async function startRoundtable() {
		phase = 'streaming';
		turns = [];
		abortController = new AbortController();
		const res = await fetch('/api/roundtable/stream', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			signal: abortController.signal,
			body: JSON.stringify({
				question,
				expertIds: experts.map((e) => e.expert_id),
				rounds,
				model: modelStore.value
			})
		}).catch((err) => {
			if (err.name === 'AbortError') return null;
			throw err;
		});
		if (!res) return;
		if (!res.ok || !res.body) {
			errorMsg = `Stream failed: ${res.status}`;
			phase = 'reviewing';
			return;
		}
		reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		const batch = createFrameBatcher();

		// Pending deltas accumulate on the latest turn between frames.
		// Applied in one batched update per animation frame to keep streaming
		// smooth (otherwise marked.parse runs 30-100 times/sec).
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

		try {
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
					for (const line of lines) {
						if (line.startsWith('event: ')) eventName = line.slice(7).trim();
						else if (line.startsWith('data: ')) dataStr += line.slice(6);
					}
					if (!dataStr) continue;
					let payload: Record<string, unknown>;
					try {
						payload = JSON.parse(dataStr);
					} catch {
						continue;
					}
					if (eventName === 'chat_created') {
						invalidate('app:chats');
					} else if (eventName === 'turn_start') {
						flushDeltas();
						const newTurn: TurnState = {
							expertId: String(payload.expertId),
							expertName: String(payload.expertName),
							role: payload.role as TurnState['role'],
							round: Number(payload.round),
							turnNumber: Number(payload.turnNumber),
							thinking: '',
							content: '',
							done: false,
							citations: []
						};
						turns = [...turns, newTurn];
					} else if (eventName === 'thinking') {
						pendingThinking += String(payload.delta);
						batch(flushDeltas);
					} else if (eventName === 'content') {
						pendingContent += String(payload.delta);
						batch(flushDeltas);
					} else if (eventName === 'turn_end' && turns.length > 0) {
						flushDeltas();
						const i = turns.length - 1;
						turns[i] = {
							...turns[i],
							done: true,
							citations: (payload.citations as TurnState['citations']) ?? []
						};
					} else if (eventName === 'error') {
						errorMsg = String(payload.message);
						phase = 'done';
					} else if (eventName === 'done' || eventName === 'session_complete') {
						flushDeltas();
						phase = 'done';
						invalidate('app:chats');
					}
				}
			}
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				errorMsg = 'Connection dropped. Try again.';
				phase = 'done';
			}
		} finally {
			try {
				reader?.cancel();
			} catch {
				/* ignore */
			}
			reader = null;
		}
	}

	function reset() {
		phase = 'idle';
		question = '';
		experts = [];
		turns = [];
		errorMsg = '';
	}
</script>

<div class="container-tight py-10">
	<header class="mb-6">
		<div class="font-mono text-xs text-[var(--color-text-faint)]">
			<span class="text-[var(--color-accent)]">$</span> roundtable
			<span class="text-[var(--color-text-faint)]">--multi-expert --3-rounds</span>
		</div>
		<h1 class="mt-2 text-xl font-semibold tracking-tight">Roundtable</h1>
		<p class="mt-1 text-xs text-[var(--color-text-muted)]">
			We pick experts who'd actually have something to say, then run multiple rounds + synthesis with citations.
		</p>
	</header>

	{#if phase === 'idle' || phase === 'selecting'}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				selectExperts();
			}}
		>
			<label class="block">
				<span class="section-label">prompt</span>
				<textarea
					bind:value={question}
					rows="4"
					placeholder="Ask anything…"
					class="mt-1.5 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)] focus:outline-none"
				></textarea>
			</label>
			<div class="mt-2 flex flex-wrap items-center gap-2">
				<span class="font-mono text-[11px] text-[var(--color-text-faint)]">try:</span>
				{#each EXAMPLES as ex}
					<button
						type="button"
						onclick={() => (question = ex)}
						class="rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent-hi)]"
					>
						{ex.length > 50 ? ex.slice(0, 50) + '…' : ex}
					</button>
				{/each}
			</div>
			<div class="mt-4 flex items-center justify-end gap-3">
				{#if errorMsg}
					<span class="text-xs text-[var(--color-bad)]">{errorMsg}</span>
				{/if}
				<button
					type="submit"
					disabled={phase === 'selecting' || !question.trim()}
					class="btn-primary"
				>
					{phase === 'selecting' ? '› picking experts…' : '› find experts'}
				</button>
			</div>
		</form>
	{/if}

	{#if phase === 'reviewing'}
		<div class="space-y-4">
			<div
				class="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5 text-sm"
			>
				<div class="section-label mb-1">prompt</div>
				<div class="text-[var(--color-text)]">{question}</div>
			</div>

			<div>
				<div class="section-label mb-2">selected experts ({experts.length})</div>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each experts as e (e.expert_id)}
						<ExpertCard expert={e} removable onRemove={() => removeExpert(e.expert_id)} />
					{/each}
				</div>
			</div>

			<div class="flex items-center justify-between gap-3">
				<label class="flex items-center gap-2 font-mono text-[11px] text-[var(--color-text-muted)]">
					depth:
					<select
						bind:value={rounds}
						class="rounded border border-[var(--color-line-2)] bg-[var(--color-panel)] px-2 py-0.5 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
					>
						<option value={2}>{ROUND_LABELS[2]}</option>
						<option value={3}>{ROUND_LABELS[3]}</option>
						<option value={4}>{ROUND_LABELS[4]}</option>
						<option value={5}>{ROUND_LABELS[5]}</option>
					</select>
				</label>
				<div class="flex items-center gap-3">
					<button type="button" onclick={reset} class="btn-ghost">cancel</button>
					<button
						type="button"
						onclick={startRoundtable}
						disabled={experts.length === 0}
						class="btn-primary"
					>
						› start →
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if phase === 'streaming' || phase === 'done'}
		<div>
			<div
				class="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5 text-sm"
			>
				<div class="section-label mb-1">prompt</div>
				<div class="text-[var(--color-text)]">{question}</div>
			</div>
			<div class="mt-2">
				{#each turns as t (t.turnNumber)}
					<RoundtableTurn turn={t} expertAvatar={avatarById.get(t.expertId) ?? null} />
				{/each}
			</div>
			{#if errorMsg}
				<div
					class="mt-4 rounded-md border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10 px-3 py-2 text-sm text-[var(--color-bad)]"
				>
					{errorMsg}
				</div>
			{/if}
			{#if phase === 'streaming'}
				<div class="sticky bottom-4 mt-6 flex justify-center">
					<button
						type="button"
						onclick={stopStream}
						class="rounded-md border border-[var(--color-line-2)] bg-[var(--color-panel)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] shadow-lg backdrop-blur transition-colors hover:border-[var(--color-bad)] hover:text-[var(--color-bad)]"
					>
						■ stop streaming
					</button>
				</div>
			{/if}
			{#if phase === 'done'}
				<div class="mt-6 flex justify-end">
					<button type="button" onclick={reset} class="btn-primary">› ask another</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
