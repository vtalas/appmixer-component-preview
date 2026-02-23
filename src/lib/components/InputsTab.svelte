<script>
	import InspectorEditor from './InspectorEditor.svelte';
	import SchemaPreview from './SchemaPreview.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import {
		Play, Square, Loader2, ChevronDown, ChevronRight,
		CheckCircle2, XCircle, Clock, Copy, Check,
		RotateCw, Pencil, Trash2, ExternalLink
	} from 'lucide-svelte';
	import { stripAnsi } from '$lib/utils/commandRunner.svelte.js';

	let {
		componentJson,
		onInspectorInputChange, onRequiredChange, onTypeChange,
		onOptionsChange, onFieldsChange, onSourceChange,
		onRunTest, onStopTest, testRunning = false,
		hasTick = false,
		testResults = [],
		onRerunCommand, onDeleteCommand, onEditCommand, onShowInPopup,
		runningCommand = null
	} = $props();

	// Collect form values from all ports: { portName: { key: val } }
	let portFormValues = $state({});

	// Test options
	let tickPeriod = $state('');
	let showOptions = $state(false);

	// Track expanded test result entries
	let expandedResults = $state(new Set());

	// Edit modal state
	let editingCmd = $state(null); // { cmdIndex, inputJson, error }

	// Copy feedback
	let copiedCmd = $state(null);

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

	function createFormValueChangeHandler(portName) {
		return (key, value) => {
			if (!portFormValues[portName]) {
				portFormValues[portName] = {};
			}
			portFormValues[portName][key] = value;
		};
	}

	function handleRunTest() {
		if (!onRunTest) return;
		onRunTest({
			portValues: portFormValues,
			tickPeriod
		});
	}

	function toggleResult(index) {
		const newSet = new Set(expandedResults);
		if (newSet.has(index)) newSet.delete(index);
		else newSet.add(index);
		expandedResults = newSet;
	}

	function formatDuration(ms) {
		if (!ms) return '';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	// ── Command helpers ──────────────────────────────────────────────

	/** Find the balanced JSON object after a flag (e.g. `-i`, `-p`) in a command string. */
	function extractJsonRange(cmdStr, flag) {
		const re = new RegExp(`${flag}\\s+'?`);
		const flagMatch = cmdStr.match(re);
		if (!flagMatch) return null;
		let start = flagMatch.index + flagMatch[0].length;
		if (cmdStr[start] !== '{') return null;
		let depth = 0;
		let inString = false;
		let escape = false;
		for (let i = start; i < cmdStr.length; i++) {
			const ch = cmdStr[i];
			if (escape) { escape = false; continue; }
			if (ch === '\\' && inString) { escape = true; continue; }
			if (ch === '"') { inString = !inString; continue; }
			if (inString) continue;
			if (ch === '{') depth++;
			else if (ch === '}') {
				depth--;
				if (depth === 0) return { start, end: i + 1, flagStart: flagMatch.index };
			}
		}
		return null;
	}

	function extractInputJsonRange(cmdStr) {
		return extractJsonRange(cmdStr, '-i');
	}

	function parseJsonFlag(cmdStr, flag) {
		const range = extractJsonRange(cmdStr, flag);
		if (!range) return null;
		const raw = cmdStr.slice(range.start, range.end);
		try {
			return JSON.stringify(JSON.parse(raw), null, 2);
		} catch {
			return raw;
		}
	}

	function parseInputJson(cmdStr) {
		return parseJsonFlag(cmdStr, '-i');
	}

	/** Extract a simple flag value like `-t 10000` */
	function parseSimpleFlag(cmdStr, flag) {
		const re = new RegExp(`${flag}\\s+(\\S+)`);
		const m = cmdStr.match(re);
		return m ? m[1] : '';
	}

	function getBaseCommand(cmdStr) {
		let result = cmdStr;
		// Strip -i JSON
		const iRange = extractJsonRange(result, '-i');
		if (iRange) {
			let end = iRange.end;
			if (result[end] === "'") end++;
			result = result.slice(0, iRange.flagStart) + result.slice(end);
		}
		// Strip -p JSON
		const pRange = extractJsonRange(result, '-p');
		if (pRange) {
			let end = pRange.end;
			if (result[end] === "'") end++;
			result = result.slice(0, pRange.flagStart) + result.slice(end);
		}
		// Strip -t value
		result = result.replace(/-t\s+\S+/, '');
		return result.replace(/\s+/g, ' ').trim();
	}

	async function copyCommand(cmd, cmdKey) {
		const text = cmd.cmd || cmd.command || '';
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			copiedCmd = cmdKey;
			setTimeout(() => {
				if (copiedCmd === cmdKey) copiedCmd = null;
			}, 1500);
		} catch { /* ignore */ }
	}

	function openEditCommand(cmdIndex) {
		const cmd = testResults[cmdIndex];
		if (!cmd) return;
		const fullCmd = cmd.cmd || cmd.command || '';
		const inputJson = parseInputJson(fullCmd);
		const propsJson = parseJsonFlag(fullCmd, '-p');
		const tickValue = parseSimpleFlag(fullCmd, '-t');
		editingCmd = {
			cmdIndex,
			inputJson: inputJson || '{}',
			propsJson: propsJson || '',
			tickValue: tickValue || '',
			error: null
		};
	}

	function saveEditedCommand() {
		if (!editingCmd || !onEditCommand) return;
		const { cmdIndex, inputJson, propsJson, tickValue } = editingCmd;
		// Validate -i JSON
		try {
			JSON.parse(inputJson);
		} catch {
			editingCmd = { ...editingCmd, error: 'Invalid -i JSON. Please fix the syntax.' };
			return;
		}
		// Validate -p JSON if provided
		if (propsJson.trim()) {
			try {
				JSON.parse(propsJson);
			} catch {
				editingCmd = { ...editingCmd, error: 'Invalid -p JSON. Please fix the syntax.' };
				return;
			}
		}
		onEditCommand(cmdIndex, inputJson, propsJson.trim() || null, tickValue.trim() || null);
		editingCmd = null;
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
				onFormValueChange={createFormValueChangeHandler(port.name)}
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

{#if onRunTest}
	<div class="run-test-section">
		{#if hasTick}
			<button class="test-options-toggle" onclick={() => showOptions = !showOptions}>
				{#if showOptions}
					<ChevronDown class="h-3.5 w-3.5" />
				{:else}
					<ChevronRight class="h-3.5 w-3.5" />
				{/if}
				<span>Test Options</span>
			</button>

			{#if showOptions}
				<div class="test-options">
					<div class="test-option">
						<label class="test-option-label">
							Tick Period (-t)
							<Input
								type="number"
								placeholder="10000"
								bind:value={tickPeriod}
								class="test-option-input"
							/>
						</label>
					</div>
				</div>
			{/if}
		{/if}

		<div class="test-actions">
			{#if testRunning}
				<Button variant="destructive" size="sm" onclick={onStopTest}>
					<Square class="h-4 w-4 mr-1" /> Stop
				</Button>
				<span class="test-running-label">
					<Loader2 class="h-4 w-4 spinning" /> Running...
				</span>
			{:else}
				<Button variant="default" size="sm" onclick={handleRunTest}>
					<Play class="h-4 w-4 mr-1" /> Run Test
				</Button>
			{/if}
		</div>
	</div>

	<!-- Test Results -->
	{#if testResults.length > 0}
		<div class="test-results-section">
			<div class="test-results-header">
				<span class="test-results-title">Test Results</span>
				<Badge variant="outline" class="test-results-count">{testResults.length}</Badge>
			</div>
			<div class="test-results-list">
				{#each testResults as cmd, i}
					{@const index = testResults.length - 1 - i}
					{@const entry = testResults[index]}
					{@const cmdKey = `cmd-${index}`}
					{@const isRunningCmd = entry.exitCode === null}
					<div class="test-result-item">
						<div class="test-result-row">
							<button class="test-result-toggle" onclick={() => toggleResult(index)}>
								{#if expandedResults.has(index)}
									<ChevronDown class="h-3.5 w-3.5" />
								{:else}
									<ChevronRight class="h-3.5 w-3.5" />
								{/if}
							</button>
							<span class="test-result-status">
								{#if isRunningCmd}
									<Loader2 class="h-3.5 w-3.5 spinning running-icon" />
								{:else if entry.exitCode === 0}
									<span class="exit-mark success">✓</span>
								{:else}
									<span class="exit-mark error">✗</span>
								{/if}
							</span>
							<code class="test-result-cmd">{entry.cmd || entry.command || ''}</code>
							<div class="test-result-meta">
								{#if isRunningCmd}
									<Badge variant="secondary" class="running-badge">running…</Badge>
								{:else}
									{#if entry.duration}
										<span class="test-result-duration">{formatDuration(entry.duration)}</span>
									{/if}
									<span class="test-result-exit-code">exit {entry.exitCode}</span>
								{/if}
								<button
									class="cmd-action"
									onclick={() => copyCommand(entry, cmdKey)}
									title="Copy command"
								>
									{#if copiedCmd === cmdKey}
										<Check class="h-3 w-3" />
									{:else}
										<Copy class="h-3 w-3" />
									{/if}
								</button>
								<button
									class="cmd-action"
									onclick={() => onShowInPopup?.(index)}
									disabled={isRunningCmd && !entry.stdout && !entry.stderr}
									title="Show output in popup window"
								>
									<ExternalLink class="h-3 w-3" />
								</button>
								<button
									class="cmd-action"
									onclick={() => onRerunCommand?.(index)}
									disabled={runningCommand !== null || isRunningCmd}
									title="Re-run this command"
								>
									{#if runningCommand === cmdKey}
										<Loader2 class="h-3 w-3 spinning" />
									{:else}
										<RotateCw class="h-3 w-3" />
									{/if}
								</button>
								<button
									class="cmd-action"
									onclick={() => openEditCommand(index)}
									disabled={isRunningCmd}
									title="Edit -i input JSON"
								>
									<Pencil class="h-3 w-3" />
								</button>
								<button
									class="cmd-action cmd-action-delete"
									onclick={() => onDeleteCommand?.(index)}
									disabled={isRunningCmd}
									title="Remove this command"
								>
									<Trash2 class="h-3 w-3" />
								</button>
							</div>
						</div>
						{#if expandedResults.has(index) || isRunningCmd}
							<div class="test-result-output-section">
								{#if entry.stdout}
									<div class="output-block">
										<div class="output-label">stdout</div>
										<pre class="output-pre">{stripAnsi(entry.stdout)}</pre>
									</div>
								{/if}
								{#if entry.stderr}
									<div class="output-block">
										<div class="output-label stderr">stderr</div>
										<pre class="output-pre stderr">{stripAnsi(entry.stderr)}</pre>
									</div>
								{/if}
								{#if isRunningCmd && !entry.stdout && !entry.stderr}
									<div class="cmd-waiting">
										<Loader2 class="h-3.5 w-3.5 spinning" />
										<span>Waiting for output…</span>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
{/if}

<!-- Edit Command Modal -->
{#if editingCmd}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="edit-modal-overlay" onclick={() => editingCmd = null}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="edit-modal" onclick={(e) => e.stopPropagation()}>
			<div class="edit-modal-header">
				<span class="edit-modal-title">Edit Command Input</span>
				<button class="edit-modal-close" onclick={() => editingCmd = null}>&times;</button>
			</div>
			<div class="edit-modal-body">
				<label class="edit-modal-label">Base command</label>
				<code class="edit-modal-base-cmd">{getBaseCommand(
					testResults[editingCmd.cmdIndex]?.cmd ||
					testResults[editingCmd.cmdIndex]?.command || ''
				)}</code>
				{#if editingCmd.error}
					<div class="edit-modal-error">{editingCmd.error}</div>
				{/if}
				<label class="edit-modal-label">-i JSON input</label>
				<textarea
					class="edit-modal-textarea"
					rows="12"
					bind:value={editingCmd.inputJson}
					spellcheck="false"
				></textarea>
				<label class="edit-modal-label edit-modal-label-gap">-p Properties JSON <span class="edit-modal-optional">(optional)</span></label>
				<textarea
					class="edit-modal-textarea"
					rows="4"
					bind:value={editingCmd.propsJson}
					spellcheck="false"
					placeholder={'{"key": "value"}'}
				></textarea>
				<label class="edit-modal-label edit-modal-label-gap">-t Tick Period <span class="edit-modal-optional">(optional, ms)</span></label>
				<input
					class="edit-modal-input"
					type="text"
					bind:value={editingCmd.tickValue}
					placeholder="10000"
				/>
			</div>
			<div class="edit-modal-footer">
				<button class="edit-modal-btn edit-modal-btn-cancel" onclick={() => editingCmd = null}>Cancel</button>
				<button class="edit-modal-btn edit-modal-btn-save" onclick={saveEditedCommand}>Save</button>
			</div>
		</div>
	</div>
{/if}

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

	.run-test-section {
		border-top: 1px solid var(--color-border);
		background: var(--color-muted);
	}

	.test-options-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 8px 16px;
		background: none;
		border: none;
		border-bottom: 1px solid var(--color-border);
		cursor: pointer;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-muted-foreground);
		text-align: left;
	}

	.test-options-toggle:hover {
		color: var(--color-foreground);
		background: var(--color-accent);
	}

	.test-options {
		padding: 8px 16px 4px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.test-option-label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: var(--color-muted-foreground);
		font-weight: 500;
	}

	:global(.test-option-input) {
		height: 32px;
		font-size: 12px;
	}

	.test-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
	}

	.test-running-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--color-muted-foreground);
	}

	:global(.test-running-label .spinning) {
		animation: spin 1s linear infinite;
	}

	:global(.spinning) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	/* Test Results */
	.test-results-section {
		border-top: 1px solid var(--color-border);
	}

	.test-results-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		background: var(--color-muted);
		border-bottom: 1px solid var(--color-border);
	}

	.test-results-title {
		font-size: 13px;
		font-weight: 600;
	}

	:global(.test-results-count) {
		font-size: 10px;
	}

	.test-results-list {
		display: flex;
		flex-direction: column;
	}

	.test-result-item {
		border-bottom: 1px solid var(--color-border);
	}

	.test-result-item:last-child {
		border-bottom: none;
	}

	.test-result-row {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 12px;
		font-size: 12px;
		color: var(--color-foreground);
	}

	.test-result-row:hover {
		background: var(--color-muted);
	}

	.test-result-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		cursor: pointer;
		padding: 2px;
		color: var(--color-muted-foreground);
		flex-shrink: 0;
	}

	.test-result-toggle:hover {
		color: var(--color-foreground);
	}

	.test-result-status {
		flex-shrink: 0;
		display: flex;
		align-items: center;
	}

	.exit-mark {
		font-weight: 700;
		font-size: 12px;
	}

	.exit-mark.success {
		color: #22c55e;
	}

	.exit-mark.error {
		color: #ef4444;
	}

	:global(.running-icon) {
		color: #3b82f6;
	}

	.test-result-cmd {
		flex: 1;
		font-family: monospace;
		font-size: 10px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--color-muted-foreground);
		user-select: text;
		cursor: text;
	}

	.test-result-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.test-result-duration {
		font-size: 10px;
		color: var(--color-muted-foreground);
		font-family: monospace;
	}

	.test-result-exit-code {
		font-size: 10px;
		font-family: monospace;
		color: var(--color-muted-foreground);
	}

	:global(.running-badge) {
		font-size: 10px;
		height: 18px;
		padding: 0 6px;
	}

	/* Action buttons */
	.cmd-action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: var(--radius-sm);
		color: var(--color-muted-foreground);
		opacity: 0;
		transition: opacity 0.15s, color 0.15s, background 0.15s;
	}

	.test-result-row:hover .cmd-action {
		opacity: 1;
	}

	.cmd-action:hover {
		background: var(--color-muted);
		color: var(--color-foreground);
	}

	.cmd-action-delete:hover {
		color: #ef4444;
		background: #fef2f2;
	}

	.cmd-action:disabled {
		opacity: 0.3;
		cursor: default;
	}

	/* Output section */
	.test-result-output-section {
		border-top: 1px solid var(--color-border);
	}

	.output-block {
		padding: 0;
	}

	.output-label {
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 4px 12px 2px;
		color: var(--color-muted-foreground);
	}

	.output-label.stderr {
		color: #ef4444;
	}

	.output-pre {
		font-family: monospace;
		font-size: 10px;
		line-height: 1.4;
		padding: 4px 12px 8px;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-y: auto;
		max-height: 300px;
		background: #0d1117;
		color: #c9d1d9;
	}

	.output-pre.stderr {
		color: #f87171;
		background: #1a0000;
	}

	.cmd-waiting {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 12px;
		color: var(--color-muted-foreground);
		font-size: 11px;
	}

	.cmd-waiting :global(svg) {
		color: #3b82f6;
	}

	/* Edit Modal */
	.edit-modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.edit-modal {
		background: var(--color-card, #fff);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg, 8px);
		width: 560px;
		max-width: 90vw;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
	}

	.edit-modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--color-border);
	}

	.edit-modal-title {
		font-size: 14px;
		font-weight: 600;
	}

	.edit-modal-close {
		background: none;
		border: none;
		font-size: 20px;
		cursor: pointer;
		color: var(--color-muted-foreground);
		padding: 0 4px;
		line-height: 1;
	}

	.edit-modal-close:hover {
		color: var(--color-foreground);
	}

	.edit-modal-body {
		padding: 16px;
		overflow-y: auto;
		flex: 1;
	}

	.edit-modal-error {
		font-size: 12px;
		color: #ef4444;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: var(--radius-sm, 4px);
		padding: 6px 10px;
		margin-bottom: 8px;
	}

	.edit-modal-label {
		display: block;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted-foreground);
		margin-bottom: 4px;
	}

	.edit-modal-base-cmd {
		display: block;
		font-family: monospace;
		font-size: 11px;
		padding: 6px 8px;
		background: var(--color-muted);
		border-radius: var(--radius-sm, 4px);
		margin-bottom: 12px;
		word-break: break-all;
		color: var(--color-muted-foreground);
	}

	.edit-modal-label-gap {
		margin-top: 12px;
	}

	.edit-modal-optional {
		font-weight: 400;
		color: var(--color-muted-foreground);
		opacity: 0.7;
		text-transform: none;
		letter-spacing: normal;
	}

	.edit-modal-input {
		width: 100%;
		font-family: "SF Mono", "Fira Code", monospace;
		font-size: 12px;
		padding: 6px 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		background: var(--color-card);
		color: var(--color-foreground);
		box-sizing: border-box;
	}

	.edit-modal-input:focus {
		outline: none;
		border-color: #3b82f6;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
	}

	.edit-modal-textarea {
		width: 100%;
		font-family: "SF Mono", "Fira Code", monospace;
		font-size: 12px;
		line-height: 1.5;
		padding: 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		background: #0d1117;
		color: #c9d1d9;
		resize: vertical;
		box-sizing: border-box;
	}

	.edit-modal-textarea:focus {
		outline: none;
		border-color: #3b82f6;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
	}

	.edit-modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 16px;
		border-top: 1px solid var(--color-border);
	}

	.edit-modal-btn {
		padding: 6px 16px;
		border-radius: var(--radius-sm, 4px);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		border: 1px solid var(--color-border);
	}

	.edit-modal-btn-cancel {
		background: transparent;
		color: var(--color-foreground);
	}

	.edit-modal-btn-cancel:hover {
		background: var(--color-muted);
	}

	.edit-modal-btn-save {
		background: #3b82f6;
		color: white;
		border-color: #3b82f6;
	}

	.edit-modal-btn-save:hover {
		background: #2563eb;
		border-color: #2563eb;
	}
</style>
