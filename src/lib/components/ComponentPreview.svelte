<script>
	import * as Tabs from '$lib/components/ui/tabs';
	import InputsTab from './InputsTab.svelte';
	import PropertiesTab from './PropertiesTab.svelte';
	import OutputsTab from './OutputsTab.svelte';
	import ComponentJsonTab from './ComponentJsonTab.svelte';

	let { componentJson, onInspectorInputChange, onRequiredChange, onTypeChange, onOptionsChange, onFieldsChange, onSourceChange, onJsonChange } = $props();

	let hasProperties = $derived(
		componentJson.properties?.inspector || componentJson.properties?.schema
	);
	let hasInPorts = $derived(componentJson.inPorts && componentJson.inPorts.length > 0);
	let hasOutPorts = $derived(componentJson.outPorts && componentJson.outPorts.length > 0);

	// Default tab
	let defaultTab = $derived(hasInPorts ? 'inputs' : hasProperties ? 'properties' : 'outputs');
</script>

<div class="component-editor">
	<Tabs.Root value={defaultTab} class="tabs-root">
		<Tabs.List class="editor-tabs">
			{#if hasInPorts}
				<Tabs.Trigger value="inputs">Inputs</Tabs.Trigger>
			{/if}
			{#if hasProperties}
				<Tabs.Trigger value="properties">Properties</Tabs.Trigger>
			{/if}
			{#if hasOutPorts}
				<Tabs.Trigger value="outputs">Outputs</Tabs.Trigger>
			{/if}
			<Tabs.Trigger value="component-json">Component JSON</Tabs.Trigger>
		</Tabs.List>

		{#if hasInPorts}
			<Tabs.Content value="inputs" class="editor-content">
				<InputsTab
					{componentJson}
					{onInspectorInputChange}
					{onRequiredChange}
					{onTypeChange}
					{onOptionsChange}
					{onFieldsChange}
					{onSourceChange}
				/>
			</Tabs.Content>
		{/if}

		{#if hasProperties}
			<Tabs.Content value="properties" class="editor-content">
				<PropertiesTab
					{componentJson}
					{onInspectorInputChange}
					{onRequiredChange}
					{onTypeChange}
					{onOptionsChange}
					{onFieldsChange}
					{onSourceChange}
				/>
			</Tabs.Content>
		{/if}

		{#if hasOutPorts}
			<Tabs.Content value="outputs" class="editor-content">
				<OutputsTab {componentJson} />
			</Tabs.Content>
		{/if}

		<Tabs.Content value="component-json" class="editor-content">
			<ComponentJsonTab {componentJson} {onJsonChange} />
		</Tabs.Content>
	</Tabs.Root>
</div>

<style>
	.component-editor {
		height: 100%;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--color-card);
		min-height: 0;
	}

	:global(.tabs-root) {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	:global(.editor-tabs) {
		border-bottom: 1px solid var(--color-border);
		border-radius: 0;
		padding: 0 8px;
		background: var(--color-muted);
	}

	:global(.editor-content) {
		flex: 1;
		overflow: auto;
		margin: 0 !important;
	}
</style>
