<script>
	import { onMount } from 'svelte';

	let { componentPath = '' } = $props();

	let jsContent = $state('');
	let loading = $state(false);
	let error = $state(null);
	let editing = $state(false);
	let editText = $state('');
	let saving = $state(false);
	let saveError = $state(null);

	// Derive the JS filename from the component path (last segment + .js)
	let jsFileName = $derived(componentPath.split('/').pop() + '.js');

	async function loadJsFile() {
		if (!componentPath) return;
		loading = true;
		error = null;
		try {
			const response = await fetch('/api/shell', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ command: `cat "${componentPath}/${jsFileName}" 2>/dev/null || echo "[No ${jsFileName} file found]"` })
			});
			const data = await response.json();
			jsContent = data.stdout || data.stderr || '';
		} catch (err) {
			error = `Failed to load: ${err}`;
		} finally {
			loading = false;
		}
	}

	function startEditing() {
		editText = jsContent;
		saveError = null;
		editing = true;
	}

	function cancelEditing() {
		editing = false;
		saveError = null;
	}

	async function saveFile() {
		saving = true;
		saveError = null;
		try {
			// Write via shell (base64 to avoid escaping issues)
			const encoded = btoa(unescape(encodeURIComponent(editText)));
			const response = await fetch('/api/shell', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ command: `echo "${encoded}" | base64 -d > "${componentPath}/${jsFileName}"` })
			});
			const data = await response.json();
			if (data.code !== 0) {
				saveError = data.stderr || 'Failed to save';
				return;
			}
			jsContent = editText;
			editing = false;
		} catch (err) {
			saveError = `Failed to save: ${err}`;
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		if (componentPath) {
			loadJsFile();
		}
	});

	function highlightJs(code) {
		return code
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			// Strings
			.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, '<span class="js-string">$&</span>')
			// Comments (single-line)
			.replace(/(\/\/.*$)/gm, '<span class="js-comment">$&</span>')
			// Keywords
			.replace(/\b(const|let|var|function|async|await|return|if|else|for|while|try|catch|throw|new|class|extends|import|export|from|default|require|module|this|null|undefined|true|false|typeof|instanceof)\b/g, '<span class="js-keyword">$&</span>')
			// Numbers
			.replace(/\b(\d+\.?\d*)\b/g, '<span class="js-number">$&</span>');
	}
</script>

<div class="behavior-tab">
	<div class="behavior-toolbar">
		<span class="behavior-filename">{jsFileName}</span>
		<div class="behavior-actions">
			{#if editing}
				<button class="behavior-btn" onclick={cancelEditing}>Cancel</button>
				<button class="behavior-btn behavior-btn-primary" onclick={saveFile} disabled={saving}>
					{saving ? 'Saving...' : 'Save'}
				</button>
			{:else}
				<button class="behavior-btn" onclick={() => loadJsFile()}>Reload</button>
				<button class="behavior-btn" onclick={startEditing}>Edit</button>
			{/if}
		</div>
	</div>
	{#if saveError}
		<div class="behavior-error">{saveError}</div>
	{/if}
	{#if loading}
		<div class="behavior-loading">Loading...</div>
	{:else if error}
		<div class="behavior-error">{error}</div>
	{:else if editing}
		<textarea
			class="behavior-editor"
			bind:value={editText}
			spellcheck="false"
		></textarea>
	{:else}
		<pre class="behavior-code"><code>{@html highlightJs(jsContent)}</code></pre>
	{/if}
</div>

<style>
	.behavior-tab {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.behavior-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 16px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-muted);
		flex-shrink: 0;
	}

	.behavior-filename {
		font-size: 12px;
		font-weight: 600;
		font-family: "SF Mono", "Fira Code", monospace;
		color: var(--color-muted-foreground);
	}

	.behavior-actions {
		display: flex;
		gap: 6px;
	}

	.behavior-btn {
		padding: 4px 12px;
		font-size: 12px;
		font-weight: 500;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-card);
		color: var(--color-foreground);
		cursor: pointer;
	}

	.behavior-btn:hover {
		background: var(--color-muted);
	}

	.behavior-btn-primary {
		background: #3b82f6;
		color: white;
		border-color: #3b82f6;
	}

	.behavior-btn-primary:hover {
		background: #2563eb;
	}

	.behavior-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.behavior-loading {
		padding: 24px;
		text-align: center;
		color: var(--color-muted-foreground);
		font-size: 13px;
	}

	.behavior-error {
		padding: 8px 16px;
		font-size: 12px;
		color: #ef4444;
		background: #fef2f2;
		border-bottom: 1px solid var(--color-border);
	}

	.behavior-code {
		flex: 1;
		overflow: auto;
		margin: 0;
		padding: 16px;
		font-family: "SF Mono", "Fira Code", monospace;
		font-size: 12px;
		line-height: 1.6;
		background: #0d1117;
		color: #c9d1d9;
		tab-size: 4;
	}

	.behavior-code code {
		display: block;
	}

	.behavior-editor {
		flex: 1;
		width: 100%;
		margin: 0;
		padding: 16px;
		font-family: "SF Mono", "Fira Code", monospace;
		font-size: 12px;
		line-height: 1.6;
		background: #0d1117;
		color: #c9d1d9;
		border: none;
		resize: none;
		outline: none;
		tab-size: 4;
		box-sizing: border-box;
	}

	:global(.js-keyword) { color: #ff7b72; }
	:global(.js-string) { color: #a5d6ff; }
	:global(.js-number) { color: #79c0ff; }
	:global(.js-comment) { color: #8b949e; font-style: italic; }
</style>
