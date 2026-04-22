<script lang="ts">
	import PanelStream from '$lib/components/PanelStream.svelte';
	import { page } from '$app/state';

	const prefill = $derived(page.url.searchParams.get('prefill') ?? '');
</script>

<PanelStream
	mode="validate"
	cmd="validate --idea"
	title="Validate idea"
	placeholder="Describe the product or startup idea. Include the user, the problem, your proposed solution, and what's distinctive. The more detail, the sharper the critique."
	minChars={50}
	prefillArtifact={prefill}
/>
