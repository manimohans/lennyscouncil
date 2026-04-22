<script lang="ts">
	// Five voices in council. Topmost = synthesis (larger). Others at 72°.
	// `size` is in px; colour is inherited via `currentColor` so callers can
	// tint with any text-color class.
	let { size = 16, title = "Lenny's Council" }: { size?: number; title?: string } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 64 64"
	role="img"
	aria-label={title}
	style="display:inline-block; vertical-align:-0.125em;"
>
	<title>{title}</title>
	<circle cx="32" cy="11" r="7" fill="currentColor" />
	<circle cx="52" cy="26" r="5" fill="currentColor" fill-opacity="0.9" />
	<circle cx="44" cy="50" r="5" fill="currentColor" fill-opacity="0.9" />
	<circle cx="20" cy="50" r="5" fill="currentColor" fill-opacity="0.9" />
	<circle cx="12" cy="26" r="5" fill="currentColor" fill-opacity="0.9" />
</svg>
