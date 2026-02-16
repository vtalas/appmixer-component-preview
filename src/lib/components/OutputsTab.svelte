<script>
	import { Badge } from '$lib/components/ui/badge';
	import SchemaPreview from './SchemaPreview.svelte';

	let { componentJson } = $props();
</script>

{#each componentJson.outPorts || [] as port}
	<div class="port-section">
		{#if componentJson.outPorts && componentJson.outPorts.length > 1}
			<div class="port-header">
				<span class="port-name">Port: {port.name}</span>
			</div>
		{/if}
		{#if port.options}
			<div class="output-options">
				{#each port.options as option}
					<div class="output-option">
						<span class="option-label">{option.label}</span>
						<code class="option-value">{option.value}</code>
					</div>
				{/each}
			</div>
		{:else if port.source}
			<div class="dynamic-output">
				<Badge variant="outline">Dynamic Output</Badge>
				<code class="source-url">{port.source.url}</code>
			</div>
		{:else if port.schema}
			<div class="schema-section">
				<SchemaPreview schema={port.schema} />
			</div>
		{:else}
			<p class="no-content">No output schema defined</p>
		{/if}
	</div>
{/each}

<style>
	.port-section {
		/* No padding here */
	}

	.port-header {
		padding: 12px 16px;
		background: var(--color-muted);
		border-bottom: 1px solid var(--color-border);
	}

	.port-name {
		font-weight: 600;
		font-size: 13px;
	}

	.schema-section {
		padding: 16px;
	}

	.no-content {
		padding: 24px 16px;
		text-align: center;
		color: var(--color-muted-foreground);
		font-size: 13px;
	}

	.output-options {
		display: flex;
		flex-direction: column;
	}

	.output-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 16px;
		border-bottom: 1px solid var(--color-border);
		font-size: 13px;
	}

	.output-option:last-child {
		border-bottom: none;
	}

	.option-label {
		font-weight: 500;
	}

	.option-value {
		font-family: monospace;
		font-size: 12px;
		color: var(--color-muted-foreground);
		background: var(--color-muted);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.dynamic-output {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.source-url {
		font-family: monospace;
		font-size: 12px;
		color: var(--color-muted-foreground);
		word-break: break-all;
	}
</style>
