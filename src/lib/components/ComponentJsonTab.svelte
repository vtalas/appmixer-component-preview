<script>
	let { componentJson, onJsonChange } = $props();

	let editing = $state(false);
	let editText = $state('');
	let parseError = $state('');

	function highlightJson(json) {
		const str = JSON.stringify(json, null, 2);
		return str
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"([^"\\]*(\\.[^"\\]*)*)"\s*:/g, '<span class="json-key">"$1"</span>:')
			.replace(/:\s*"([^"\\]*(\\.[^"\\]*)*)"/g, ': <span class="json-string">"$1"</span>')
			.replace(/:\s*(\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
			.replace(/:\s*(true|false)/g, ': <span class="json-boolean">$1</span>')
			.replace(/:\s*(null)/g, ': <span class="json-null">$1</span>');
	}

	function startEditing() {
		editText = JSON.stringify(componentJson, null, 2);
		parseError = '';
		editing = true;
	}

	function stopEditing() {
		editing = false;
		parseError = '';
	}

	function applyChanges() {
		try {
			const parsed = JSON.parse(editText);
			parseError = '';
			editing = false;
			if (onJsonChange) {
				onJsonChange(parsed);
			}
		} catch (e) {
			parseError = e.message;
		}
	}

	function handleKeydown(event) {
		const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
		const modifier = isMac ? event.metaKey : event.ctrlKey;
		if (modifier && event.key === 's') {
			event.preventDefault();
			event.stopPropagation();
			applyChanges();
		}
		if (event.key === 'Escape') {
			stopEditing();
		}
	}

	function handleBlur() {
		applyChanges();
	}
</script>

<div class="json-section">
	<div class="json-toolbar">
		{#if editing}
			<button class="json-btn" onclick={stopEditing}>Cancel</button>
			<button class="json-btn json-btn-primary" onclick={applyChanges}>Apply</button>
		{:else}
			<button class="json-btn" onclick={startEditing}>Edit</button>
		{/if}
	</div>

	{#if editing}
		<textarea
			class="json-textarea {parseError ? 'json-textarea-error' : ''}"
			bind:value={editText}
			onkeydown={handleKeydown}
			onblur={handleBlur}
			spellcheck="false"
		></textarea>
		{#if parseError}
			<div class="json-error">{parseError}</div>
		{/if}
	{:else}
		<pre class="json-content json-highlighted">{@html highlightJson(componentJson)}</pre>
	{/if}
</div>

<style>
	.json-section {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.json-toolbar {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
	}

	.json-btn {
		padding: 4px 12px;
		font-size: 12px;
		font-weight: 500;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
		cursor: pointer;
		color: var(--color-foreground);
		transition: all 0.15s ease;
	}

	.json-btn:hover {
		background: var(--color-muted);
	}

	.json-btn-primary {
		background: var(--color-primary);
		color: var(--color-primary-foreground);
		border-color: var(--color-primary);
	}

	.json-btn-primary:hover {
		opacity: 0.9;
	}

	.json-content {
		background: var(--color-muted);
		padding: 16px;
		border-radius: var(--radius-md);
		font-size: 12px;
		margin: 0;
		overflow: auto;
	}

	.json-highlighted :global(.json-key) {
		color: #7c3aed;
	}

	.json-highlighted :global(.json-string) {
		color: #16a34a;
	}

	.json-highlighted :global(.json-number) {
		color: #ea580c;
	}

	.json-highlighted :global(.json-boolean) {
		color: #dc2626;
	}

	.json-highlighted :global(.json-null) {
		color: #6b7280;
	}

	.json-textarea {
		width: 100%;
		min-height: 400px;
		padding: 16px;
		font-family: "SF Mono", "Fira Code", monospace;
		font-size: 12px;
		line-height: 1.5;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-muted);
		color: var(--color-foreground);
		resize: vertical;
		tab-size: 2;
	}

	.json-textarea:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.15);
	}

	.json-textarea-error {
		border-color: #ef4444;
	}

	.json-textarea-error:focus {
		border-color: #ef4444;
		box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.15);
	}

	.json-error {
		font-size: 12px;
		color: #ef4444;
		padding: 6px 10px;
		background: #fef2f2;
		border-radius: var(--radius-sm);
		border: 1px solid #fecaca;
	}
</style>
