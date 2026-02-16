<script>
	import InspectorEditor from './InspectorEditor.svelte';
	import SchemaPreview from './SchemaPreview.svelte';

	let { componentJson, onInspectorInputChange, onRequiredChange, onTypeChange, onOptionsChange, onFieldsChange, onSourceChange } = $props();

	function createInputChangeHandler() {
		return (inputKey, field, value) => {
			if (onInspectorInputChange) {
				onInspectorInputChange('properties', inputKey, field, value);
			}
		};
	}

	function createRequiredChangeHandler() {
		return (inputKey, required) => {
			if (onRequiredChange) {
				onRequiredChange('properties', inputKey, required);
			}
		};
	}

	function createTypeChangeHandler() {
		return (inputKey, newType) => {
			if (onTypeChange) {
				onTypeChange('properties', inputKey, newType);
			}
		};
	}

	function createOptionsChangeHandler() {
		return (inputKey, options) => {
			if (onOptionsChange) {
				onOptionsChange('properties', inputKey, options);
			}
		};
	}

	function createFieldsChangeHandler() {
		return (inputKey, fields) => {
			if (onFieldsChange) {
				onFieldsChange('properties', inputKey, fields);
			}
		};
	}

	function createSourceChangeHandler() {
		return (inputKey, source) => {
			if (onSourceChange) {
				onSourceChange('properties', inputKey, source);
			}
		};
	}
</script>

<div class="port-section">
	{#if componentJson.properties?.inspector}
		<InspectorEditor
			inspector={componentJson.properties.inspector}
			schema={componentJson.properties.schema}
			onInputChange={createInputChangeHandler()}
			onRequiredChange={createRequiredChangeHandler()}
			onTypeChange={createTypeChangeHandler()}
			onOptionsChange={createOptionsChangeHandler()}
			onFieldsChange={createFieldsChangeHandler()}
			onSourceChange={createSourceChangeHandler()}
		/>
	{:else if componentJson.properties?.schema}
		<div class="schema-section">
			<SchemaPreview schema={componentJson.properties.schema} />
		</div>
	{/if}
</div>

<style>
	.port-section {
		/* No padding here - InspectorEditor handles its own */
	}

	.schema-section {
		padding: 16px;
	}
</style>
