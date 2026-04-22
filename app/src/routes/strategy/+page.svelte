<script lang="ts">
	import SingleExpertChat from '$lib/components/SingleExpertChat.svelte';
	let { data } = $props();
</script>

<SingleExpertChat
	mode="strategy"
	title="Strategy advisor"
	expertSuggestions={data.suggestions}
	preselect={data.preselect}
/>
