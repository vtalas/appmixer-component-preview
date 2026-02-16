<script>
	import InspectorEditor from './InspectorEditor.svelte';
	import SchemaPreview from './SchemaPreview.svelte';

	let { componentJson, onInspectorInputChange, onRequiredChange, onTypeChange, onOptionsChange, onFieldsChange, onSourceChange } = $props();

	function createInputChangeHandler(portName) {
		return (inputKey, field, value) => {
			if (onInspectorInputChange) {
				onInspectorInputChange(portName, inputKey, field, value);
			}
		};
	}

	function createRequiredChangeHandler(portName) {
		return (inputKey, required) => {
			if (onRequiredChange) {
				onRequiredChange(portName, inputKey, required);
			}
		};
	}

	function createTypeChangeHandler(portName) {
		return (inputKey, newType) => {
			if (onTypeChange) {
				onTypeChange(portName, inputKey, newType);
			}
		};
	}

	function createOptionsChangeHandler(portName) {
		return (inputKey, options) => {
			if (onOptionsChange) {
				onOptionsChange(portName, inputKey, options);
			}
		};
	}

	function createFieldsChangeHandler(portName) {
		return (inputKey, fields) => {
			if (onFieldsChange) {
				onFieldsChange(portName, inputKey, fields);
			}
		};
	}

	function createSourceChangeHandler(portName) {
		return (inputKey, source) => {
			if (onSourceChange) {
				onSourceChange(portName, inputKey, source);
			}
		};
	}
</script>

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

<style>
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
</style>
