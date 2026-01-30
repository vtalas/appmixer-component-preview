<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import VibeKanbanWrapper from '$lib/components/VibeKanbanWrapper.svelte';
	import { dev } from '$app/environment';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

{#if dev}
	<VibeKanbanWrapper />
{/if}
