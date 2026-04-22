<script lang="ts">
	import SingleExpertChat from '$lib/components/SingleExpertChat.svelte';
	let { data } = $props();
</script>

<SingleExpertChat
	mode="mentor"
	title="Career mentor"
	expertSuggestions={data.suggestions}
	preselect={data.preselect}
/>
