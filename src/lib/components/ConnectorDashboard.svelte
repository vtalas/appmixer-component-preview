<script>
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Package, FlaskConical, Box, Sparkles, Loader2, X, MessageSquare, Workflow } from 'lucide-svelte';
	import TestPlanViewer from '$lib/components/TestPlanViewer.svelte';
	import AiChatPanel from '$lib/components/AiChatPanel.svelte';
	import E2EFlowsPanel from '$lib/components/E2EFlowsPanel.svelte';
	import { onMount } from 'svelte';

	let {
		connector,
		testPlanData = null,
		testPlanLoading = false,
		testPlanConnector = null,
		connectorsDir = '',
		isConnected = false,
		onComponentSelect,
		onTestPlanUpdated,
		onReloadTestPlan,
		onGenerateTestPlan,
		planningRunning = false,
		planningOutput = '',
		planningError = null,
		onClearPlanning,
		onRefreshTree,
		onOpenSettings
	} = $props();

	let showTestPlan = $state(false);
	let showE2EFlows = $state(false);
	let showClaudeChat = $state(false);

	// Resizable chat panel
	const PANEL_STORAGE_KEY = 'appmixer-claude-panel-width';
	const PANEL_MIN = 320;
	const PANEL_MAX = 900;
	const PANEL_DEFAULT = 480;
	let chatPanelWidth = $state(PANEL_DEFAULT);
	let isResizing = $state(false);

	// Restore saved width
	onMount(() => {
		fetchGitInfo();
		try {
			const saved = localStorage.getItem(PANEL_STORAGE_KEY);
			if (saved) chatPanelWidth = Math.max(PANEL_MIN, Math.min(PANEL_MAX, Number(saved)));
		} catch { /* */ }
	});

	function onResizeStart(e) {
		e.preventDefault();
		isResizing = true;
		const startX = e.clientX;
		const startWidth = chatPanelWidth;

		function onMove(e) {
			const delta = startX - e.clientX;
			chatPanelWidth = Math.max(PANEL_MIN, Math.min(PANEL_MAX, startWidth + delta));
		}

		function onUp() {
			isResizing = false;
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			try { localStorage.setItem(PANEL_STORAGE_KEY, String(chatPanelWidth)); } catch { /* */ }
		}

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	// Git/GitHub info for Claude context
	let gitInfo = $state(null);

	async function fetchGitInfo() {
		try {
			const response = await fetch('/api/git-info');
			if (response.ok) {
				gitInfo = await response.json();
			}
		} catch { /* */ }
	}


	// Build context string for Claude Code about this connector
	let claudeContext = $derived.by(() => {
		const modules = connector.modules.map(m => ({
			name: m.name,
			components: m.components.map(c => c.name)
		}));

		let ctx = `You are working on the Appmixer connector "${connector.name}" (label: "${connector.label || connector.name}").
This connector has ${stats.totalComponents} components across ${stats.totalModules} modules.

Modules and components:
${modules.map(m => `- ${m.name}/: ${m.components.join(', ')}`).join('\n')}

The connector directory is the current working directory. You can read and modify component.json files, source code (*.js), and other connector files.

When modifying components, follow the Appmixer component.json schema:
- name: fully qualified like "appmixer.${connector.name}.module.ComponentName"
- label, description, auth, inPorts, outPorts, properties, trigger, webhook, tick, icon
- Inspector input types: text, textarea, number, select, multiselect, date-time, toggle, expression, key-value, filepicker

Prefer making targeted edits to existing files rather than rewriting entire files.`;

		if (gitInfo) {
			ctx += '\n\nGit & GitHub:';
			if (gitInfo.branch) ctx += `\n- Current branch: ${gitInfo.branch}`;
			if (gitInfo.remoteUrl) ctx += `\n- Remote: ${gitInfo.remoteUrl}`;
			if (gitInfo.ghRepo?.nameWithOwner) ctx += `\n- GitHub repo: ${gitInfo.ghRepo.nameWithOwner}`;
			if (gitInfo.ghRepo?.defaultBranchRef?.name) ctx += `\n- Default branch: ${gitInfo.ghRepo.defaultBranchRef.name}`;
			if (gitInfo.ghAvailable) {
				ctx += `\n\nYou have the GitHub CLI (gh) available. Use it for GitHub operations:
- gh pr create, gh pr list, gh pr view, gh pr merge
- gh issue create, gh issue list, gh issue view
- gh repo view, gh release create
- gh api for direct GitHub API calls
When creating PRs or issues, relate them to the ${connector.name} connector work.`;
			}
		}

		return ctx;
	});

	let stats = $derived.by(() => {
		let totalComponents = 0;
		let totalModules = connector.modules.length;
		let triggers = 0;
		let authComponents = 0;

		for (const module of connector.modules) {
			for (const comp of module.components) {
				totalComponents++;
				if (comp.componentJson.trigger) triggers++;
				if (comp.componentJson.auth) authComponents++;
			}
		}

		return { totalComponents, totalModules, triggers, authComponents };
	});

	let testPlanStats = $derived.by(() => {
		if (!testPlanData) return null;
		return {
			passed: testPlanData.filter(t => t.status === 'passed').length,
			failed: testPlanData.filter(t => t.status === 'failed').length,
			total: testPlanData.length
		};
	});

	let allComponents = $derived.by(() => {
		const list = [];
		for (const module of connector.modules) {
			for (const comp of module.components) {
				list.push({ ...comp, moduleName: module.name });
			}
		}
		return list;
	});

	function getComponentType(comp) {
		if (comp.componentJson.trigger && comp.componentJson.webhook) return 'Webhook';
		if (comp.componentJson.trigger && comp.componentJson.tick) return 'Polling';
		if (comp.componentJson.trigger) return 'Trigger';
		return 'Action';
	}

	function getTypeBadgeVariant(type) {
		if (type === 'Webhook') return 'secondary';
		if (type === 'Polling') return 'secondary';
		if (type === 'Trigger') return 'default';
		return 'outline';
	}

	async function handleComponentGenerated(componentJson) {
		if (!componentJson?.name) return;

		// Parse name like "appmixer.googledrive.core.GetFolder"
		const parts = componentJson.name.split('.');
		if (parts.length < 4) return;

		const componentPath = parts.slice(1).join('/'); // e.g. "googledrive/core/GetFolder"

		try {
			const response = await fetch(`/api/component?path=${encodeURIComponent(componentPath)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ componentJson })
			});

			if (!response.ok) {
				const data = await response.json();
				console.error('Failed to apply component:', data.error);
				return;
			}

			// Refresh the tree to pick up the new/updated component
			onRefreshTree?.();
		} catch (err) {
			console.error('Failed to apply component:', err);
		}
	}
</script>

<div class="dashboard">
	<!-- Header -->
	<div class="dashboard-header">
		<div class="dashboard-title-section">
			{#if connector.icon}
				<img src={connector.icon} alt="" class="dashboard-icon" />
			{:else}
				<div class="dashboard-icon-placeholder">
					<Package class="dashboard-icon-fallback" />
				</div>
			{/if}
			<div class="dashboard-title-text">
				<h2 class="dashboard-title">{connector.label || connector.name}</h2>
				<p class="dashboard-subtitle">{connector.name}</p>
			</div>
		</div>
		{#if isConnected}
			<div class="dashboard-header-actions">
				<Button
					variant={showClaudeChat ? 'secondary' : 'outline'}
					size="sm"
					onclick={() => showClaudeChat = !showClaudeChat}
				>
					<MessageSquare class="h-4 w-4 mr-2" />
					Claude Code
				</Button>
			</div>
		{/if}
	</div>

	<div class="dashboard-content-wrapper">
		{#if showE2EFlows}
			<E2EFlowsPanel connectorName={connector.name} onBack={() => showE2EFlows = false} {onOpenSettings} />
		{:else if showTestPlan && testPlanData && testPlanConnector}
			<!-- Test Plan View -->
			<div class="test-plan-view">
				<div class="test-plan-toolbar">
					<Button variant="ghost" size="sm" onclick={() => showTestPlan = false}>
						<X class="h-4 w-4 mr-1" />
						Back to Dashboard
					</Button>
				</div>
				<div class="test-plan-main">
					<TestPlanViewer
						testPlan={testPlanData}
						connectorName={testPlanConnector}
						{connectorsDir}
						onTestPlanUpdated={onTestPlanUpdated}
						onReloadTestPlan={onReloadTestPlan}
					/>
				</div>
			</div>
		{:else}
			<div class="dashboard-body">
				<!-- Stat Cards -->
				<div class="stats-grid">
					<Card.Root class="stat-card">
						<Card.Content class="stat-card-content">
							<span class="stat-label">Components</span>
							<span class="stat-value">{stats.totalComponents}</span>
						</Card.Content>
					</Card.Root>

					<Card.Root class="stat-card">
						<Card.Content class="stat-card-content">
							<span class="stat-label">Modules</span>
							<span class="stat-value">{stats.totalModules}</span>
						</Card.Content>
					</Card.Root>

					<Card.Root class="stat-card">
						<Card.Content class="stat-card-content">
							<span class="stat-label">Triggers</span>
							<span class="stat-value">{stats.triggers}</span>
						</Card.Content>
					</Card.Root>

					<Card.Root class="stat-card">
						<Card.Content class="stat-card-content">
							<span class="stat-label">Auth Required</span>
							<span class="stat-value">{stats.authComponents}</span>
						</Card.Content>
					</Card.Root>

					<Card.Root class="stat-card test-plan-card">
						<Card.Content class="stat-card-content">
							<span class="stat-label">
								<Workflow class="stat-icon" />
								E2E Flows
							</span>
							<span class="test-plan-empty">View E2E test flows for this connector</span>
							<Button variant="outline" size="sm" onclick={() => showE2EFlows = true} class="test-plan-btn">
								View E2E Flows
							</Button>
						</Card.Content>
					</Card.Root>

					{#if testPlanStats}
						<Card.Root class="stat-card test-plan-card">
							<Card.Content class="stat-card-content">
								<span class="stat-label">
									<FlaskConical class="stat-icon" />
									Test Plan
								</span>
								<div class="test-plan-stats">
									<span class="test-passed">{testPlanStats.passed} passed</span>
									<span class="test-separator">/</span>
									<span class="test-failed">{testPlanStats.failed} failed</span>
									<span class="test-separator">/</span>
									<span class="test-total">{testPlanStats.total} total</span>
								</div>
								<Button variant="outline" size="sm" onclick={() => showTestPlan = true} class="test-plan-btn">
									View Test Plan
								</Button>
							</Card.Content>
						</Card.Root>
					{:else if isConnected}
						<Card.Root class="stat-card test-plan-card">
							<Card.Content class="stat-card-content">
								<span class="stat-label">
									<FlaskConical class="stat-icon" />
									Test Plan
								</span>
								<span class="test-plan-empty">No test plan yet</span>
								<Button
									variant="outline"
									size="sm"
									onclick={onGenerateTestPlan}
									disabled={planningRunning || testPlanLoading}
									class="test-plan-btn"
								>
									{#if planningRunning}
										<Loader2 class="h-3.5 w-3.5 spinning mr-1" />
										Generating...
									{:else if testPlanLoading}
										<Loader2 class="h-3.5 w-3.5 spinning mr-1" />
										Loading...
									{:else}
										<Sparkles class="h-3.5 w-3.5 mr-1" />
										Generate Test Plan
									{/if}
								</Button>
							</Card.Content>
						</Card.Root>
					{/if}
				</div>

				{#if planningRunning || planningOutput}
					<div class="planning-output-panel">
						<div class="planning-output-header">
							<div class="planning-output-title">
								<Sparkles class="h-3.5 w-3.5" />
								<span>Planning Agent</span>
								{#if planningRunning}
									<span class="planning-badge running">
										<Loader2 class="h-3 w-3 spinning" />
										running
									</span>
								{:else}
									<span class="planning-badge done">done</span>
								{/if}
							</div>
							{#if !planningRunning}
								<button
									class="planning-close-btn"
									onclick={onClearPlanning}
									title="Close"
								>
									<X class="h-3.5 w-3.5" />
								</button>
							{/if}
						</div>
						<pre class="planning-output-pre">{planningOutput}</pre>
						{#if planningError}
							<div class="planning-error">{planningError}</div>
						{/if}
					</div>
				{/if}

				<!-- Components Table -->
				<div class="components-section">
					<h3 class="section-title">Components</h3>
					<div class="components-table">
						<div class="table-header">
							<span class="col-name">Name</span>
							<span class="col-type">Type</span>
							<span class="col-module">Module</span>
						</div>
						{#each allComponents as comp}
							{@const compType = getComponentType(comp)}
							<button
								class="table-row"
								onclick={() => onComponentSelect?.(comp)}
							>
								<span class="col-name">
									{#if comp.componentJson.icon}
										<img src={comp.componentJson.icon} alt="" class="table-comp-icon" />
									{:else if connector.icon}
										<img src={connector.icon} alt="" class="table-comp-icon" />
									{:else}
										<Box class="table-comp-icon-fallback" />
									{/if}
									{comp.label || comp.name}
								</span>
								<span class="col-type">
									<Badge variant={getTypeBadgeVariant(compType)}>{compType}</Badge>
								</span>
								<span class="col-module">{comp.moduleName}</span>
							</button>
						{/each}
					</div>
				</div>
			</div>
		{/if}

		{#if showClaudeChat}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="resize-handle" onmousedown={onResizeStart}></div>
			<div class="claude-chat-panel" style="width: {chatPanelWidth}px">
				<AiChatPanel
					context={claudeContext}
					cwd={connectorsDir ? connectorsDir + '/' + connector.name : ''}
					storageKey={connector.name}
					onDone={onRefreshTree}
					onComponentGenerated={handleComponentGenerated}
					allowedTools={['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch']}
				/>
			</div>
		{/if}
	</div>
</div>

<style>
	.dashboard {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.dashboard-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card);
	}

	.dashboard-title-section {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.dashboard-icon {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		border-radius: 4px;
	}

	.dashboard-icon-placeholder {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-muted);
		border-radius: 4px;
	}

	:global(.dashboard-icon-fallback) {
		width: 24px;
		height: 24px;
		color: var(--color-muted-foreground);
	}

	.dashboard-title-text {
		display: flex;
		flex-direction: column;
	}

	.dashboard-title {
		font-size: 18px;
		font-weight: 600;
		line-height: 1.2;
	}

	.dashboard-subtitle {
		font-size: 12px;
		color: var(--color-muted-foreground);
		font-family: monospace;
	}

	.dashboard-header-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.dashboard-content-wrapper {
		flex: 1;
		display: flex;
		overflow: hidden;
		min-height: 0;
	}

	.dashboard-body {
		flex: 1;
		overflow: auto;
		padding: 20px;
	}

	/* Resize handle */
	.resize-handle {
		width: 4px;
		cursor: col-resize;
		background: transparent;
		flex-shrink: 0;
		position: relative;
		z-index: 10;
		transition: background 0.15s;
	}

	.resize-handle::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: -3px;
		right: -3px;
	}

	.resize-handle:hover,
	.resize-handle:active {
		background: var(--color-primary);
	}

	/* Claude Code Chat Panel */
	.claude-chat-panel {
		flex-shrink: 0;
		border-left: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--color-card);
	}

	/* Stat Cards Grid */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 12px;
		margin-bottom: 24px;
	}

	:global(.stat-card) {
		padding: 0 !important;
		gap: 0 !important;
	}

	:global(.stat-card-content) {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 16px !important;
	}

	.stat-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--color-muted-foreground);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	:global(.stat-icon) {
		width: 14px;
		height: 14px;
	}

	.stat-value {
		font-size: 28px;
		font-weight: 700;
		line-height: 1;
	}

	/* Test Plan Card */
	:global(.test-plan-card) {
		grid-column: span 2;
	}

	.test-plan-stats {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
		font-weight: 500;
		margin-top: 4px;
	}

	.test-passed {
		color: #22c55e;
	}

	.test-failed {
		color: #ef4444;
	}

	.test-total {
		color: var(--color-muted-foreground);
	}

	.test-separator {
		color: var(--color-muted-foreground);
	}

	.test-plan-empty {
		font-size: 13px;
		color: var(--color-muted-foreground);
	}

	:global(.test-plan-btn) {
		margin-top: 8px;
		align-self: flex-start;
	}

	:global(.spinning) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	/* Test Plan View */
	.test-plan-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
		min-width: 0;
	}

	.test-plan-toolbar {
		padding: 8px 16px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card);
	}

	.test-plan-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	/* Planning Output Panel */
	.planning-output-panel {
		max-height: 300px;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: #0d1117;
		border: 1px solid #30363d;
		margin-bottom: 16px;
	}

	.planning-output-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 10px;
		background: #161b22;
		border-bottom: 1px solid #30363d;
	}

	.planning-output-title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 600;
		color: #c9d1d9;
	}

	.planning-output-title :global(svg) {
		color: #8b5cf6;
	}

	.planning-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 9px;
		font-weight: 500;
		padding: 1px 6px;
		border-radius: 4px;
		margin-left: 4px;
	}

	.planning-badge.running {
		background: #21262d;
		border: 1px solid #30363d;
		color: #f59e0b;
	}

	.planning-badge.done {
		background: #21262d;
		border: 1px solid #30363d;
		color: #8b949e;
	}

	.planning-close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: var(--radius-sm);
		color: #8b949e;
	}

	.planning-close-btn:hover {
		background: #21262d;
		color: #c9d1d9;
	}

	.planning-output-pre {
		font-family: "SF Mono", "Fira Code", monospace;
		font-size: 10px;
		line-height: 1.5;
		padding: 8px 10px;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
		color: #c9d1d9;
	}

	.planning-error {
		padding: 6px 10px;
		font-size: 11px;
		color: #f87171;
		background: #1a0000;
		border-top: 1px solid #30363d;
	}

	/* Components Table */
	.components-section {
		display: flex;
		flex-direction: column;
	}

	.section-title {
		font-size: 14px;
		font-weight: 600;
		margin-bottom: 8px;
	}

	.components-table {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.table-header {
		display: grid;
		grid-template-columns: 1fr 100px 120px;
		gap: 8px;
		padding: 8px 12px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted-foreground);
		background: var(--color-muted);
		border-bottom: 1px solid var(--color-border);
	}

	.table-row {
		display: grid;
		grid-template-columns: 1fr 100px 120px;
		gap: 8px;
		padding: 8px 12px;
		font-size: 13px;
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
		width: 100%;
		border-bottom: 1px solid var(--color-border);
		transition: background 0.1s;
	}

	.table-row:last-child {
		border-bottom: none;
	}

	.table-row:hover {
		background: var(--color-muted);
	}

	.col-name {
		display: flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.col-type {
		display: flex;
		align-items: center;
	}

	.col-module {
		display: flex;
		align-items: center;
		color: var(--color-muted-foreground);
		font-family: monospace;
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.table-comp-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		border-radius: 2px;
	}

	:global(.table-comp-icon-fallback) {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		color: var(--color-muted-foreground);
	}
</style>
