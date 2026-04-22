<script lang="ts">
	import PanelStream from '$lib/components/PanelStream.svelte';
</script>

<PanelStream
	mode="prd"
	cmd="prd --review"
	title="PRD review"
	placeholder="Paste your PRD. The expert panel surfaces gaps, recommends fixes, and proposes the smallest shippable v1."
	minChars={100}
/>
