<script>
	import * as Tabs from '$lib/components/ui/tabs';
	import { Separator } from '$lib/components/ui/separator';
	import { Badge } from '$lib/components/ui/badge';
	import InspectorEditor from './InspectorEditor.svelte';
	import SchemaPreview from './SchemaPreview.svelte';

	let { componentJson, onInspectorInputChange, onRequiredChange, onTypeChange, onOptionsChange, onFieldsChange, onSourceChange } = $props();

	let hasProperties = $derived(
		componentJson.properties?.inspector || componentJson.properties?.schema
	);
	let hasInPorts = $derived(componentJson.inPorts && componentJson.inPorts.length > 0);
	let hasOutPorts = $derived(componentJson.outPorts && componentJson.outPorts.length > 0);

	// Default tab
	let defaultTab = $derived(hasInPorts ? 'inputs' : hasProperties ? 'properties' : 'outputs');

	// Create handler for input changes
	function createInputChangeHandler(portName) {
		return (inputKey, field, value) => {
			if (onInspectorInputChange) {
				onInspectorInputChange(portName, inputKey, field, value);
			}
		};
	}

	// Create handler for required changes
	function createRequiredChangeHandler(portName) {
		return (inputKey, required) => {
			if (onRequiredChange) {
				onRequiredChange(portName, inputKey, required);
			}
		};
	}

	// Create handler for type changes
	function createTypeChangeHandler(portName) {
		return (inputKey, newType) => {
			if (onTypeChange) {
				onTypeChange(portName, inputKey, newType);
			}
		};
	}

	// Create handler for options changes
	function createOptionsChangeHandler(portName) {
		return (inputKey, options) => {
			if (onOptionsChange) {
				onOptionsChange(portName, inputKey, options);
			}
		};
	}

	// Create handler for fields changes (expression)
	function createFieldsChangeHandler(portName) {
		return (inputKey, fields) => {
			if (onFieldsChange) {
				onFieldsChange(portName, inputKey, fields);
			}
		};
	}

	// Create handler for source changes (dynamic options)
	function createSourceChangeHandler(portName) {
		return (inputKey, source) => {
			if (onSourceChange) {
				onSourceChange(portName, inputKey, source);
			}
		};
	}
</script>

<div class="component-editor">
	<Tabs.Root value={defaultTab}>
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
			<Tabs.Trigger value="json">JSON</Tabs.Trigger>
		</Tabs.List>

		{#if hasInPorts}
			<Tabs.Content value="inputs" class="editor-content">
				{#each componentJson.inPorts || [] as port}
					<div class="port-section">
						{#if componentJson.inPorts && componentJson.inPorts.length > 1}
							<div class="port-header">
								<span class="port-name">Port: {port.name}</span>
							</div>
						{/if}
						{#if port.inspector}
							<InspectorEditor
								inspector={port.inspector}
								schema={port.schema}
								portName={port.name}
								onInputChange={createInputChangeHandler(port.name)}
								onRequiredChange={createRequiredChangeHandler(port.name)}
								onTypeChange={createTypeChangeHandler(port.name)}
								onOptionsChange={createOptionsChangeHandler(port.name)}
								onFieldsChange={createFieldsChangeHandler(port.name)}
								onSourceChange={createSourceChangeHandler(port.name)}
							/>
						{:else if port.schema}
							<div class="schema-section">
								<SchemaPreview schema={port.schema} />
							</div>
						{:else}
							<p class="no-content">No inspector or schema defined</p>
						{/if}
					</div>
				{/each}
			</Tabs.Content>
		{/if}

		{#if hasProperties}
			<Tabs.Content value="properties" class="editor-content">
				<div class="port-section">
					{#if componentJson.properties?.inspector}
						<InspectorEditor
							inspector={componentJson.properties.inspector}
							schema={componentJson.properties.schema}
							onInputChange={createInputChangeHandler('properties')}
							onRequiredChange={createRequiredChangeHandler('properties')}
							onTypeChange={createTypeChangeHandler('properties')}
							onOptionsChange={createOptionsChangeHandler('properties')}
							onFieldsChange={createFieldsChangeHandler('properties')}
							onSourceChange={createSourceChangeHandler('properties')}
						/>
					{:else if componentJson.properties?.schema}
						<div class="schema-section">
							<SchemaPreview schema={componentJson.properties.schema} />
						</div>
					{/if}
				</div>
			</Tabs.Content>
		{/if}

		{#if hasOutPorts}
			<Tabs.Content value="outputs" class="editor-content">
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
			</Tabs.Content>
		{/if}

		<Tabs.Content value="json" class="editor-content">
			<div class="json-section">
				<pre class="json-content">{JSON.stringify(componentJson, null, 2)}</pre>
			</div>
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

	.port-section {
		/* No padding here - InspectorEditor handles its own */
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

	.json-section {
		padding: 16px;
	}

	.json-content {
		background: var(--color-muted);
		padding: 16px;
		border-radius: var(--radius-md);
		font-size: 12px;
		overflow: auto;
		max-height: 500px;
		margin: 0;
	}
</style>
