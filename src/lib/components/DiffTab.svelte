<script>
	let { componentPath = '' } = $props();

	let diffContent = $state('');
	let loading = $state(false);
	let error = $state(null);
	let diffMode = $state('unified'); // 'unified' | 'split'

	async function loadDiff() {
		if (!componentPath) return;
		loading = true;
		error = null;
		try {
			const response = await fetch('/api/shell', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ command: `git diff -- "${componentPath}/" 2>/dev/null; git diff --cached -- "${componentPath}/" 2>/dev/null` })
			});
			const data = await response.json();
			diffContent = data.stdout || '';
			if (!diffContent.trim()) {
				diffContent = '';
			}
		} catch (err) {
			error = `Failed to load diff: ${err}`;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (componentPath) {
			loadDiff();
		}
	});

	/** Parse unified diff into split (side-by-side) lines */
	function parseSplitDiff(text) {
		const lines = text.split('\n');
		const result = [];
		let leftNum = 0;
		let rightNum = 0;

		for (const line of lines) {
			if (line.startsWith('@@')) {
				const match = line.match(/@@ -(\d+)/);
				if (match) leftNum = parseInt(match[1]) - 1;
				const match2 = line.match(/\+(\d+)/);
				if (match2) rightNum = parseInt(match2[1]) - 1;
				result.push({ type: 'hunk', text: line });
				continue;
			}
			if (line.startsWith('diff ') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ')) {
				result.push({ type: 'meta', text: line });
				continue;
			}
			if (line.startsWith('-')) {
				leftNum++;
				result.push({ type: 'del', left: { num: leftNum, text: line.slice(1) }, right: null });
			} else if (line.startsWith('+')) {
				// Try to pair with previous unpaired del
				const last = result[result.length - 1];
				if (last && last.type === 'del' && last.right === null) {
					rightNum++;
					last.type = 'change';
					last.right = { num: rightNum, text: line.slice(1) };
				} else {
					rightNum++;
					result.push({ type: 'add', left: null, right: { num: rightNum, text: line.slice(1) } });
				}
			} else if (line.startsWith(' ')) {
				leftNum++;
				rightNum++;
				result.push({ type: 'context', left: { num: leftNum, text: line.slice(1) }, right: { num: rightNum, text: line.slice(1) } });
			}
		}
		return result;
	}

	let splitLines = $derived(diffContent ? parseSplitDiff(diffContent) : []);

	function highlightDiff(text) {
		return text
			.split('\n')
			.map(line => {
				const escaped = line
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;');
				if (line.startsWith('+++') || line.startsWith('---')) {
					return `<span class="diff-meta">${escaped}</span>`;
				}
				if (line.startsWith('@@')) {
					return `<span class="diff-hunk">${escaped}</span>`;
				}
				if (line.startsWith('+')) {
					return `<span class="diff-add">${escaped}</span>`;
				}
				if (line.startsWith('-')) {
					return `<span class="diff-del">${escaped}</span>`;
				}
				if (line.startsWith('diff ')) {
					return `<span class="diff-header">${escaped}</span>`;
				}
				return escaped;
			})
			.join('\n');
	}
</script>

<div class="diff-tab">
	<div class="diff-toolbar">
		<span class="diff-label">Git Diff</span>
		<div class="diff-toolbar-right">
			<div class="diff-mode-switch">
				<button class="diff-mode-btn" class:active={diffMode === 'unified'} onclick={() => diffMode = 'unified'}>Unified</button>
				<button class="diff-mode-btn" class:active={diffMode === 'split'} onclick={() => diffMode = 'split'}>Split</button>
			</div>
			<button class="diff-btn" onclick={loadDiff}>Refresh</button>
		</div>
	</div>
	{#if loading}
		<div class="diff-loading">Loading diff...</div>
	{:else if error}
		<div class="diff-error">{error}</div>
	{:else if !diffContent}
		<div class="diff-empty">No changes detected</div>
	{:else if diffMode === 'unified'}
		<pre class="diff-code">{@html highlightDiff(diffContent)}</pre>
	{:else}
		<div class="diff-split-wrapper">
			<table class="diff-split-table">
				{#each splitLines as line}
					{#if line.type === 'meta' || line.type === 'hunk'}
						<tr class="diff-split-meta-row">
							<td colspan="4" class="diff-split-meta">{line.text}</td>
						</tr>
					{:else}
						<tr class="diff-split-row" class:diff-split-change={line.type === 'change'} class:diff-split-del={line.type === 'del'} class:diff-split-add={line.type === 'add'}>
							<td class="diff-split-num diff-split-num-left">{line.left?.num ?? ''}</td>
							<td class="diff-split-code diff-split-left" class:diff-split-del-bg={line.type === 'del' || line.type === 'change'}>{line.left?.text ?? ''}</td>
							<td class="diff-split-num diff-split-num-right">{line.right?.num ?? ''}</td>
							<td class="diff-split-code diff-split-right" class:diff-split-add-bg={line.type === 'add' || line.type === 'change'}>{line.right?.text ?? ''}</td>
						</tr>
					{/if}
				{/each}
			</table>
		</div>
	{/if}
</div>

<style>
	.diff-tab {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.diff-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 16px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-muted);
		flex-shrink: 0;
	}

	.diff-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-muted-foreground);
	}

	.diff-toolbar-right {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.diff-mode-switch {
		display: flex;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.diff-mode-btn {
		padding: 3px 10px;
		font-size: 11px;
		font-weight: 500;
		border: none;
		background: var(--color-card);
		color: var(--color-muted-foreground);
		cursor: pointer;
		transition: all 0.1s;
	}

	.diff-mode-btn:not(:last-child) {
		border-right: 1px solid var(--color-border);
	}

	.diff-mode-btn.active {
		background: var(--color-foreground);
		color: var(--color-background);
	}

	.diff-mode-btn:hover:not(.active) {
		background: var(--color-muted);
	}

	.diff-btn {
		padding: 4px 12px;
		font-size: 12px;
		font-weight: 500;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-card);
		color: var(--color-foreground);
		cursor: pointer;
	}

	.diff-btn:hover {
		background: var(--color-muted);
	}

	.diff-loading, .diff-empty {
		padding: 24px;
		text-align: center;
		color: var(--color-muted-foreground);
		font-size: 13px;
	}

	.diff-error {
		padding: 16px;
		color: #ef4444;
		font-size: 13px;
	}

	.diff-code {
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

	:global(.diff-add) { color: #3fb950; background: rgba(63, 185, 80, 0.1); display: inline-block; width: 100%; }
	:global(.diff-del) { color: #f85149; background: rgba(248, 81, 73, 0.1); display: inline-block; width: 100%; }
	:global(.diff-hunk) { color: #79c0ff; }
	:global(.diff-meta) { color: #8b949e; font-weight: 600; }
	:global(.diff-header) { color: #d2a8ff; font-weight: 600; }

	/* Split diff */
	.diff-split-wrapper {
		flex: 1;
		overflow: auto;
		background: #0d1117;
	}

	.diff-split-table {
		width: 100%;
		border-collapse: collapse;
		font-family: "SF Mono", "Fira Code", monospace;
		font-size: 12px;
		line-height: 1.6;
		table-layout: fixed;
	}

	.diff-split-meta-row .diff-split-meta {
		padding: 4px 12px;
		color: #8b949e;
		font-weight: 600;
		background: #161b22;
		border-bottom: 1px solid #21262d;
	}

	.diff-split-row {
		border-bottom: 1px solid #21262d;
	}

	.diff-split-num {
		width: 40px;
		padding: 0 8px;
		text-align: right;
		color: #484f58;
		user-select: none;
		vertical-align: top;
		flex-shrink: 0;
	}

	.diff-split-code {
		padding: 0 12px;
		white-space: pre-wrap;
		word-break: break-all;
		color: #c9d1d9;
		vertical-align: top;
	}

	.diff-split-left {
		border-right: 1px solid #21262d;
	}

	.diff-split-del-bg {
		background: rgba(248, 81, 73, 0.1);
		color: #f85149;
	}

	.diff-split-add-bg {
		background: rgba(63, 185, 80, 0.1);
		color: #3fb950;
	}
</style>
