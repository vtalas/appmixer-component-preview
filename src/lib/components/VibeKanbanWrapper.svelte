<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	let container;
	let root = null;

	onMount(async () => {
		if (!browser) return;

		const React = await import('react');
		const ReactDOM = await import('react-dom/client');
		const { VibeKanbanWebCompanion } = await import('vibe-kanban-web-companion');

		root = ReactDOM.createRoot(container);
		root.render(React.createElement(VibeKanbanWebCompanion));
	});

	onDestroy(() => {
		if (root) {
			root.unmount();
		}
	});
</script>

<div bind:this={container} style="display: contents;"></div>
