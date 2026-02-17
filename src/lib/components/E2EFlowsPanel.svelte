<script>
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { X, ExternalLink, Github, Trash2, FileDiff, FileText, Play, Square, Settings, Loader2, Download, Upload, HardDrive } from 'lucide-svelte';
	import { onMount } from 'svelte';

	let { connectorName = '', onBack, onOpenSettings } = $props();

	// --- Data state ---
	let flows = $state([]);
	let localFlows = $state([]);
	let designerBaseUrl = $state('');
	let loading = $state(true);
	let localFlowsLoading = $state(false);
	let error = $state('');

	// Settings info
	let appmixerInfo = $state(null);
	let githubInfo = $state(null);

	// Sync statuses
	let syncStatuses = $state({});
	let syncStatusLoading = $state(false);

	// Download / Upload tracking
	let isDownloading = $state(new Set());
	let isUploading = $state(new Set());

	// Merged flows: three-way merge by flow name
	let mergedFlows = $derived(() => {
		const byName = new Map();

		// 1. Add all instance flows
		for (const f of flows) {
			byName.set(f.name, {
				...f,
				onInstance: true,
				onLocal: false,
				localPath: null,
				localHash: null,
				localFileName: null,
				...(syncStatuses[f.flowId] || {})
			});
		}

		// 2. Merge local flows
		for (const lf of localFlows) {
			const existing = byName.get(lf.name);
			if (existing) {
				existing.onLocal = true;
				existing.localPath = lf.localPath;
				existing.localHash = lf.localHash;
				existing.localFileName = lf.fileName;
			} else {
				byName.set(lf.name, {
					name: lf.name,
					flowId: null,
					connector: lf.connector,
					running: false,
					url: null,
					onInstance: false,
					onLocal: true,
					localPath: lf.localPath,
					localHash: lf.localHash,
					localFileName: lf.fileName,
					syncStatus: null,
					githubUrl: null,
					githubPath: null,
					localSyncStatus: null
				});
			}
		}

		return [...byName.values()];
	});

	// Stats
	let stats = $derived({
		total: mergedFlows().length,
		running: mergedFlows().filter(f => f.running).length,
		stopped: mergedFlows().filter(f => f.onInstance && !f.running).length,
		match: mergedFlows().filter(f => f.syncStatus === 'match').length,
		modified: mergedFlows().filter(f => f.syncStatus === 'modified').length,
		serverOnly: mergedFlows().filter(f => f.syncStatus === 'server_only').length,
		error: mergedFlows().filter(f => f.syncStatus === 'error').length,
		localOnly: mergedFlows().filter(f => f.onLocal && !f.onInstance).length
	});

	// Filters
	let searchQuery = $state('');
	let runningFilter = $state('');
	let syncFilter = $state('');
	let localSyncFilter = $state('');

	let filteredFlows = $derived(
		mergedFlows().filter(flow => {
			const matchSearch = !searchQuery || flow.name?.toLowerCase().includes(searchQuery.toLowerCase());
			const matchRunning = !runningFilter ||
				(runningFilter === 'running' && flow.running) ||
				(runningFilter === 'stopped' && flow.onInstance && !flow.running) ||
				(runningFilter === 'local_only' && !flow.onInstance);
			const matchSync = !syncFilter || flow.syncStatus === syncFilter;
			const matchLocalSync = !localSyncFilter ||
				(localSyncFilter === 'local_only' && flow.onLocal && !flow.onInstance) ||
				(localSyncFilter !== 'local_only' && flow.localSyncStatus === localSyncFilter);
			return matchSearch && matchRunning && matchSync && matchLocalSync;
		})
	);

	// Selection
	let selectedFlowIds = $state(new Set());
	function isSelectable(flow) {
		return flow.onInstance && (flow.syncStatus === 'modified' || flow.syncStatus === 'server_only');
	}
	let selectableFlows = $derived(filteredFlows.filter(isSelectable));
	let allSelectableSelected = $derived(
		selectableFlows.length > 0 && selectableFlows.every(f => selectedFlowIds.has(f.flowId))
	);
	let selectedFlows = $derived(mergedFlows().filter(f => f.flowId && selectedFlowIds.has(f.flowId)));

	function toggleFlowSelection(flowId) {
		const s = new Set(selectedFlowIds);
		s.has(flowId) ? s.delete(flowId) : s.add(flowId);
		selectedFlowIds = s;
	}
	function toggleSelectAll() {
		const s = new Set(selectedFlowIds);
		if (allSelectableSelected) {
			selectableFlows.forEach(f => s.delete(f.flowId));
		} else {
			selectableFlows.forEach(f => s.add(f.flowId));
		}
		selectedFlowIds = s;
	}
	function clearSelection() { selectedFlowIds = new Set(); }

	// Toggle (start/stop)
	let togglingFlowIds = $state(new Set());

	async function toggleFlow(flow) {
		const action = flow.running ? 'stop' : 'start';
		togglingFlowIds = new Set([...togglingFlowIds, flow.flowId]);
		try {
			const res = await fetch('/api/e2e-flows/toggle', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ flowId: flow.flowId, action })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `Failed to ${action}`);
			await loadFlows();
		} catch (e) {
			alert(`Failed to ${action} flow: ${e.message}`);
		} finally {
			const s = new Set(togglingFlowIds);
			s.delete(flow.flowId);
			togglingFlowIds = s;
		}
	}

	// Download: Instance → Local
	async function downloadFlow(flow) {
		if (!flow.flowId) return;
		isDownloading = new Set([...isDownloading, flow.name]);
		try {
			const res = await fetch('/api/e2e-flows/download', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ flowId: flow.flowId, flowName: flow.name, connector: flow.connector || connectorName })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Failed to download');
			await Promise.all([loadLocalFlows(), loadSyncStatuses()]);
		} catch (e) {
			alert(`Failed to download flow: ${e.message}`);
		} finally {
			const s = new Set(isDownloading);
			s.delete(flow.name);
			isDownloading = s;
		}
	}

	// Upload: Local → Instance
	async function uploadFlow(flow) {
		if (!flow.localPath) return;
		isUploading = new Set([...isUploading, flow.name]);
		try {
			const res = await fetch('/api/e2e-flows/upload', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ localPath: flow.localPath, flowId: flow.flowId || undefined })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Failed to upload');
			await Promise.all([loadFlows(), loadSyncStatuses()]);
		} catch (e) {
			alert(`Failed to upload flow: ${e.message}`);
		} finally {
			const s = new Set(isUploading);
			s.delete(flow.name);
			isUploading = s;
		}
	}

	// Delete dialog
	let showDeleteDialog = $state(false);
	let flowToDelete = $state(null);
	let isDeleting = $state(false);
	let deleteError = $state('');

	function confirmDelete(flow) {
		flowToDelete = flow;
		deleteError = '';
		showDeleteDialog = true;
	}

	async function performDelete() {
		if (!flowToDelete) return;
		isDeleting = true;
		deleteError = '';
		try {
			const res = await fetch('/api/e2e-flows/delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ flowIds: [flowToDelete.flowId] })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Failed to delete');
			const result = await res.json();
			if (result.errors?.length > 0) throw new Error(result.errors[0].error);
			const s = new Set(selectedFlowIds);
			s.delete(flowToDelete.flowId);
			selectedFlowIds = s;
			showDeleteDialog = false;
			flowToDelete = null;
			await loadFlows();
		} catch (e) {
			deleteError = e.message;
		} finally {
			isDeleting = false;
		}
	}

	// Diff dialog
	let showDiffDialog = $state(false);
	let diffFlow = $state(null);
	let isDiffLoading = $state(false);
	let diffError = $state('');
	let diffData = $state(null);
	let isReverting = $state(false);
	let revertError = $state('');
	let revertSuccess = $state(false);

	async function openDiff(flow) {
		diffFlow = flow;
		diffError = '';
		diffData = null;
		revertError = '';
		revertSuccess = false;
		showDiffDialog = true;
		isDiffLoading = true;
		try {
			const res = await fetch('/api/e2e-flows/diff', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ flowId: flow.flowId, flowName: flow.name })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Failed to load diff');
			diffData = await res.json();
		} catch (e) {
			diffError = e.message;
		} finally {
			isDiffLoading = false;
		}
	}

	async function revertFlow() {
		if (!diffFlow) return;
		isReverting = true;
		revertError = '';
		try {
			const res = await fetch('/api/e2e-flows/revert', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ flowId: diffFlow.flowId, flowName: diffFlow.name })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Failed to revert');
			revertSuccess = true;
		} catch (e) {
			revertError = e.message;
		} finally {
			isReverting = false;
		}
	}

	async function closeDiffDialog() {
		const hadRevert = revertSuccess;
		showDiffDialog = false;
		revertSuccess = false;
		revertError = '';
		if (hadRevert) {
			await loadFlows();
			await loadSyncStatuses();
		}
	}

	// Results dialog
	let showResultsDialog = $state(false);
	let resultsFlow = $state(null);
	let isResultsLoading = $state(false);
	let resultsError = $state('');
	let resultsData = $state(null);

	async function openResults(flow) {
		resultsFlow = flow;
		resultsError = '';
		resultsData = null;
		showResultsDialog = true;
		isResultsLoading = true;
		try {
			const res = await fetch('/api/e2e-flows/results', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ flowId: flow.flowId, flowName: flow.name })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Failed to load results');
			resultsData = await res.json();
		} catch (e) {
			resultsError = e.message;
		} finally {
			isResultsLoading = false;
		}
	}

	function getComponentLink(componentId) {
		if (!resultsFlow?.url || !componentId) return resultsFlow?.url || '#';
		return `${resultsFlow.url}?componentId=${encodeURIComponent(componentId)}`;
	}

	// Sync dialog
	let showSyncDialog = $state(false);
	let syncPrTitle = $state('');
	let syncPrDescription = $state('');
	let syncTargetBranch = $state('');
	let isSyncing = $state(false);
	let syncError = $state('');
	let syncResult = $state(null);

	function openSyncDialog() {
		const count = selectedFlowIds.size;
		syncPrTitle = `Sync ${count} E2E flow${count > 1 ? 's' : ''} from Appmixer`;
		syncPrDescription = '';
		syncTargetBranch = githubInfo?.branch || 'dev';
		syncError = '';
		syncResult = null;
		showSyncDialog = true;
	}

	async function performSync() {
		if (!syncPrTitle.trim()) { syncError = 'PR title is required'; return; }
		isSyncing = true;
		syncError = '';
		try {
			const flowsToSync = selectedFlows.map(f => ({
				flowId: f.flowId, name: f.name, connector: f.connector, githubPath: f.githubPath || null
			}));
			const res = await fetch('/api/e2e-flows/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ flows: flowsToSync, prTitle: syncPrTitle.trim(), prDescription: syncPrDescription.trim(), targetBranch: syncTargetBranch.trim() })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Failed to sync');
			syncResult = await res.json();
			clearSelection();
		} catch (e) {
			syncError = e.message;
		} finally {
			isSyncing = false;
		}
	}

	async function closeSyncDialog() {
		const hadSuccess = syncResult?.success;
		showSyncDialog = false;
		syncResult = null;
		if (hadSuccess) {
			await loadFlows();
			await loadSyncStatuses();
		}
	}


	// --- Diff computation ---
	function computeDiff(oldText, newText) {
		const oldLines = oldText.split('\n');
		const newLines = newText.split('\n');
		const lcs = buildLCS(oldLines, newLines);
		const result = [];
		let oi = 0, ni = 0, li = 0;
		while (oi < oldLines.length || ni < newLines.length) {
			if (li < lcs.length && oi < oldLines.length && ni < newLines.length && oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
				result.push({ type: 'context', line: oldLines[oi] }); oi++; ni++; li++;
			} else if (li < lcs.length && ni < newLines.length && newLines[ni] === lcs[li]) {
				result.push({ type: 'removed', line: oldLines[oi] }); oi++;
			} else if (li < lcs.length && oi < oldLines.length && oldLines[oi] === lcs[li]) {
				result.push({ type: 'added', line: newLines[ni] }); ni++;
			} else if (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
				result.push({ type: 'removed', line: oldLines[oi] }); oi++;
			} else if (ni < newLines.length && (li >= lcs.length || newLines[ni] !== lcs[li])) {
				result.push({ type: 'added', line: newLines[ni] }); ni++;
			}
		}
		return result;
	}

	function buildLCS(a, b) {
		const m = a.length, n = b.length;
		if (m * n > 2_000_000) return [];
		const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
		for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
		const result = [];
		let i = m, j = n;
		while (i > 0 && j > 0) {
			if (a[i-1] === b[j-1]) { result.unshift(a[i-1]); i--; j--; }
			else if (dp[i-1][j] > dp[i][j-1]) i--;
			else j--;
		}
		return result;
	}

	function generateFlowPath(connector, flowName) {
		const safeName = flowName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		return `src/appmixer/${connector || 'unknown'}/test-flow-${safeName}.json`;
	}

	// Sync status config
	const syncStatusConfig = {
		match: { label: 'In Sync', cls: 'sync-badge-match' },
		modified: { label: 'Modified', cls: 'sync-badge-modified' },
		server_only: { label: 'Server Only', cls: 'sync-badge-server-only' },
		error: { label: 'Error', cls: 'sync-badge-error' }
	};

	const localSyncStatusConfig = {
		match: { label: 'Match', cls: 'sync-badge-match' },
		modified: { label: 'Modified', cls: 'sync-badge-modified' },
		error: { label: 'Error', cls: 'sync-badge-error' }
	};

	// --- Data loading ---
	async function loadSettings() {
		try {
			const res = await fetch('/api/e2e-flows/settings');
			if (res.ok) {
				const data = await res.json();
				appmixerInfo = data.appmixer;
				githubInfo = data.github;
			}
		} catch { /* ignore */ }
	}

	async function loadFlows() {
		loading = true;
		error = '';
		try {
			const res = await fetch(`/api/e2e-flows?connector=${encodeURIComponent(connectorName)}`);
			const data = await res.json();
			if (data.error) { error = data.error; flows = []; }
			else { flows = data.flows || []; designerBaseUrl = data.designerBaseUrl || ''; }
		} catch (e) {
			error = e.message;
			flows = [];
		} finally {
			loading = false;
		}
	}

	async function loadLocalFlows() {
		if (!connectorName) return;
		localFlowsLoading = true;
		try {
			const res = await fetch(`/api/e2e-flows/local?connector=${encodeURIComponent(connectorName)}`);
			if (res.ok) {
				const data = await res.json();
				localFlows = data.localFlows || [];
			}
		} catch (e) {
			console.error('Failed to load local flows:', e);
		} finally {
			localFlowsLoading = false;
		}
	}

	async function loadSyncStatuses() {
		if (!flows.length) return;
		syncStatusLoading = true;
		try {
			const res = await fetch('/api/e2e-flows/sync-status', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ flows: flows.map(f => ({ flowId: f.flowId, name: f.name })) })
			});
			if (res.ok) {
				const data = await res.json();
				syncStatuses = data.statuses;
			}
		} catch (e) {
			console.error('Failed to load sync statuses:', e);
		} finally {
			syncStatusLoading = false;
		}
	}

	onMount(async () => {
		await loadSettings();
		await Promise.all([loadFlows(), loadLocalFlows()]);
		loadSyncStatuses();
	});

	// Escape key handler
	function handleKeydown(e) {
		if (e.key === 'Escape') {
			if (showDiffDialog) showDiffDialog = false;
			else if (showResultsDialog) showResultsDialog = false;
			else if (showDeleteDialog) showDeleteDialog = false;
			else if (showSyncDialog) showSyncDialog = false;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="e2e-panel">
	<!-- Header / Toolbar -->
	<div class="e2e-toolbar">
		<div class="e2e-toolbar-left">
			<Button variant="ghost" size="sm" onclick={onBack}>
				<X class="h-4 w-4 mr-1" />
				Back to Dashboard
			</Button>
			<span class="e2e-toolbar-title">E2E Flows</span>
			{#if connectorName}
				<Badge variant="outline">{connectorName}</Badge>
			{/if}
		</div>
		<div class="e2e-toolbar-right">
			{#if appmixerInfo}
				<span class="e2e-active-info" title="Active Appmixer instance">
					<Settings class="h-3 w-3" />
					{appmixerInfo.baseUrl || 'env'}
				</span>
			{/if}
			{#if githubInfo}
				<span class="e2e-active-info" title="Active GitHub instance">
					<Github class="h-3 w-3" />
					{githubInfo.owner}/{githubInfo.repo}
				</span>
			{/if}
			<button class="e2e-settings-btn" onclick={onOpenSettings} title="Open Settings">
				<Settings class="h-3.5 w-3.5" />
				<span>Settings</span>
			</button>
		</div>
	</div>

	{#if loading}
		<div class="e2e-loading">
			<Loader2 class="h-5 w-5 spinning" />
			<span>Loading E2E flows...</span>
		</div>
	{:else if error}
		<div class="e2e-error">{error}</div>
	{:else}
		<!-- Stats bar -->
		<div class="e2e-stats-bar">
			<button class="e2e-stat" class:active={!syncFilter && !runningFilter && !localSyncFilter} onclick={() => { syncFilter = ''; runningFilter = ''; localSyncFilter = ''; }}>
				<span class="e2e-stat-value">{stats.total}</span>
				<span class="e2e-stat-label">Total</span>
			</button>
			<button class="e2e-stat stat-running" class:active={runningFilter === 'running'} onclick={() => runningFilter = runningFilter === 'running' ? '' : 'running'}>
				<span class="e2e-stat-value">{stats.running}</span>
				<span class="e2e-stat-label">Running</span>
			</button>
			<button class="e2e-stat stat-stopped" class:active={runningFilter === 'stopped'} onclick={() => runningFilter = runningFilter === 'stopped' ? '' : 'stopped'}>
				<span class="e2e-stat-value">{stats.stopped}</span>
				<span class="e2e-stat-label">Stopped</span>
			</button>
			<span class="e2e-stat-divider"></span>
			<button class="e2e-stat stat-match" class:active={syncFilter === 'match'} onclick={() => syncFilter = syncFilter === 'match' ? '' : 'match'}>
				<span class="e2e-stat-value">{syncStatusLoading ? '...' : stats.match}</span>
				<span class="e2e-stat-label">In Sync</span>
			</button>
			<button class="e2e-stat stat-modified" class:active={syncFilter === 'modified'} onclick={() => syncFilter = syncFilter === 'modified' ? '' : 'modified'}>
				<span class="e2e-stat-value">{syncStatusLoading ? '...' : stats.modified}</span>
				<span class="e2e-stat-label">Modified</span>
			</button>
			<button class="e2e-stat stat-server-only" class:active={syncFilter === 'server_only'} onclick={() => syncFilter = syncFilter === 'server_only' ? '' : 'server_only'}>
				<span class="e2e-stat-value">{syncStatusLoading ? '...' : stats.serverOnly}</span>
				<span class="e2e-stat-label">Server Only</span>
			</button>
			<span class="e2e-stat-divider"></span>
			<button class="e2e-stat stat-local-only" class:active={localSyncFilter === 'local_only'} onclick={() => localSyncFilter = localSyncFilter === 'local_only' ? '' : 'local_only'}>
				<span class="e2e-stat-value">{stats.localOnly}</span>
				<span class="e2e-stat-label">Local Only</span>
			</button>
		</div>

		<!-- Filter bar -->
		<div class="e2e-filter-bar">
			<input type="text" placeholder="Search flows..." bind:value={searchQuery} class="e2e-search" />
			<select bind:value={runningFilter} class="e2e-select">
				<option value="">All Statuses</option>
				<option value="running">Running</option>
				<option value="stopped">Stopped</option>
				<option value="local_only">Local Only</option>
			</select>
			<select bind:value={syncFilter} class="e2e-select">
				<option value="">All GitHub Sync</option>
				<option value="match">In Sync</option>
				<option value="modified">Modified</option>
				<option value="server_only">Server Only</option>
				<option value="error">Error</option>
			</select>
			<select bind:value={localSyncFilter} class="e2e-select">
				<option value="">All Local Sync</option>
				<option value="match">Match</option>
				<option value="modified">Modified</option>
				<option value="local_only">Local Only</option>
			</select>
			{#if searchQuery || runningFilter || syncFilter || localSyncFilter}
				<button class="e2e-clear-btn" onclick={() => { searchQuery = ''; runningFilter = ''; syncFilter = ''; localSyncFilter = ''; }}>Clear</button>
			{/if}
			<span class="e2e-count">{filteredFlows.length} of {mergedFlows().length} flows</span>
		</div>

		<!-- Flow table -->
		<div class="e2e-table-wrap">
			{#if filteredFlows.length === 0}
				<div class="e2e-empty">No E2E flows found</div>
			{:else}
				<table class="e2e-table">
					<thead>
						<tr>
							<th class="col-check">
								{#if selectableFlows.length > 0}
									<input type="checkbox" checked={allSelectableSelected} onchange={toggleSelectAll} />
								{/if}
							</th>
							<th class="col-name">Flow Name</th>
							<th class="col-sources">Sources</th>
							<th class="col-status">Status</th>
							<th class="col-sync">GitHub Sync</th>
							<th class="col-local-sync">Local Sync</th>
							<th class="col-actions">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredFlows as flow (flow.name)}
							{@const selectable = isSelectable(flow)}
							<tr class:selected={flow.flowId && selectedFlowIds.has(flow.flowId)}>
								<td class="col-check">
									{#if selectable}
										<input type="checkbox" checked={selectedFlowIds.has(flow.flowId)} onchange={() => toggleFlowSelection(flow.flowId)} />
									{/if}
								</td>
								<td class="col-name">
									<span class="flow-name">{flow.name}</span>
								</td>
								<td class="col-sources">
									<div class="source-icons">
										{#if flow.onInstance}
											<span class="source-icon source-instance" title="On Instance">
												<ExternalLink size={12} />
											</span>
										{/if}
										{#if flow.onLocal}
											<span class="source-icon source-local" title="Local file">
												<HardDrive size={12} />
											</span>
										{/if}
										{#if flow.githubUrl}
											<span class="source-icon source-github" title="On GitHub">
												<Github size={12} />
											</span>
										{/if}
									</div>
								</td>
								<td class="col-status">
									{#if flow.onInstance}
										{#if flow.running}
											<span class="status-badge status-running">Running</span>
										{:else}
											<span class="status-badge status-stopped">Stopped</span>
										{/if}
									{:else}
										<span class="text-muted">---</span>
									{/if}
								</td>
								<td class="col-sync">
									{#if !flow.onInstance}
										<span class="text-muted">---</span>
									{:else if flow.syncStatus === null}
										<span class="sync-badge-loading"></span>
									{:else}
										{@const sc = syncStatusConfig[flow.syncStatus] || syncStatusConfig.error}
										<span class="sync-badge {sc.cls}">{sc.label}</span>
									{/if}
								</td>
								<td class="col-local-sync">
									{#if !flow.onLocal && !flow.onInstance}
										<span class="text-muted">---</span>
									{:else if flow.onLocal && !flow.onInstance}
										<span class="sync-badge sync-badge-local-only">Local Only</span>
									{:else if !flow.onLocal}
										<span class="text-muted">---</span>
									{:else if flow.localSyncStatus === null}
										<span class="sync-badge-loading"></span>
									{:else}
										{@const lsc = localSyncStatusConfig[flow.localSyncStatus] || localSyncStatusConfig.error}
										<span class="sync-badge {lsc.cls}">{lsc.label}</span>
									{/if}
								</td>
								<td class="col-actions">
									<div class="action-btns">
										{#if flow.onInstance}
											<a href={flow.url} target="_blank" rel="noopener noreferrer" class="action-btn action-designer" title="Open in Designer">
												<ExternalLink size={14} />
											</a>
										{/if}
										{#if flow.githubUrl}
											<a href={flow.githubUrl} target="_blank" rel="noopener noreferrer" class="action-btn action-github" title="View on GitHub">
												<Github size={14} />
											</a>
										{/if}
										{#if flow.onInstance && flow.syncStatus === 'modified'}
											<button class="action-btn action-diff" onclick={() => openDiff(flow)} title="View changes">
												<FileDiff size={14} />
											</button>
										{/if}
										{#if flow.onInstance}
											<button class="action-btn action-results" onclick={() => openResults(flow)} title="E2E results">
												<FileText size={14} />
											</button>
											<button
												class="action-btn {flow.running ? 'action-stop' : 'action-start'}"
												onclick={() => toggleFlow(flow)}
												disabled={togglingFlowIds.has(flow.flowId)}
												title={flow.running ? 'Stop' : 'Start'}
											>
												{#if togglingFlowIds.has(flow.flowId)}
													<Loader2 size={14} class="spinning" />
												{:else if flow.running}
													<Square size={14} />
												{:else}
													<Play size={14} />
												{/if}
											</button>
										{/if}
										{#if flow.onInstance}
											<button
												class="action-btn action-download"
												onclick={() => downloadFlow(flow)}
												disabled={isDownloading.has(flow.name)}
												title="Download to local"
											>
												{#if isDownloading.has(flow.name)}
													<Loader2 size={14} class="spinning" />
												{:else}
													<Download size={14} />
												{/if}
											</button>
										{/if}
										{#if flow.onLocal}
											<button
												class="action-btn action-upload"
												onclick={() => uploadFlow(flow)}
												disabled={isUploading.has(flow.name)}
												title={flow.onInstance ? 'Upload to instance (update)' : 'Upload to instance (create)'}
											>
												{#if isUploading.has(flow.name)}
													<Loader2 size={14} class="spinning" />
												{:else}
													<Upload size={14} />
												{/if}
											</button>
										{/if}
										{#if flow.onInstance}
											<button class="action-btn action-delete" onclick={() => confirmDelete(flow)} title="Delete">
												<Trash2 size={14} />
											</button>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<!-- Floating action bar -->
		{#if selectedFlowIds.size > 0}
			<div class="e2e-floating-bar">
				<span class="e2e-floating-count">{selectedFlowIds.size} flow{selectedFlowIds.size > 1 ? 's' : ''} selected</span>
				<span class="e2e-floating-divider"></span>
				<Button variant="outline" size="sm" onclick={clearSelection}>Clear</Button>
				<Button size="sm" onclick={openSyncDialog}>Sync to GitHub</Button>
			</div>
		{/if}
	{/if}
</div>

<!-- ======== MODAL DIALOGS ======== -->

<!-- Delete Confirmation -->
{#if showDeleteDialog}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => showDeleteDialog = false} onkeydown={() => {}}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-content modal-sm" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
			<div class="modal-header">
				<h3>Remove Flow</h3>
				<button class="modal-close" onclick={() => showDeleteDialog = false}><X size={16} /></button>
			</div>
			<div class="modal-body">
				{#if flowToDelete}
					<div class="modal-info-box">
						<p class="modal-info-name">{flowToDelete.name}</p>
					</div>
					<p class="modal-warning">This action cannot be undone. The flow will be permanently deleted from the Appmixer instance.</p>
				{/if}
				{#if deleteError}
					<div class="modal-error">{deleteError}</div>
				{/if}
			</div>
			<div class="modal-footer">
				<Button variant="outline" size="sm" onclick={() => showDeleteDialog = false} disabled={isDeleting}>Cancel</Button>
				<Button variant="destructive" size="sm" onclick={performDelete} disabled={isDeleting}>
					{#if isDeleting}<Loader2 class="h-3.5 w-3.5 spinning mr-1" />Removing...{:else}Remove Flow{/if}
				</Button>
			</div>
		</div>
	</div>
{/if}

<!-- Diff Dialog -->
{#if showDiffDialog}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={closeDiffDialog} onkeydown={() => {}}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-content modal-xl" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
			<div class="modal-header">
				<div>
					<h3>Flow Changes</h3>
					{#if diffFlow}
						<p class="modal-subtitle">{diffFlow.name} — instance vs GitHub</p>
					{/if}
				</div>
				<button class="modal-close" onclick={closeDiffDialog}><X size={16} /></button>
			</div>
			<div class="modal-body modal-body-scroll">
				{#if isDiffLoading}
					<div class="modal-loading"><Loader2 class="h-5 w-5 spinning" /> Loading diff...</div>
				{:else if diffError}
					<div class="modal-error">{diffError}</div>
				{:else if diffData}
					{#if revertSuccess}
						<div class="modal-success">Flow reverted to GitHub version successfully.</div>
					{:else}
						{@const lines = computeDiff(diffData.github, diffData.server)}
						{@const added = lines.filter(l => l.type === 'added').length}
						{@const removed = lines.filter(l => l.type === 'removed').length}
						<div class="diff-summary">
							<span class="diff-added">+{added} added</span>
							<span class="diff-removed">-{removed} removed</span>
							<span class="diff-context">{lines.filter(l => l.type === 'context').length} unchanged</span>
						</div>
						<div class="diff-view">
							<table class="diff-table">
								{#each lines as line}
									<tr class="diff-line diff-{line.type}">
										<td class="diff-marker">{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ''}</td>
										<td class="diff-text">{line.line}</td>
									</tr>
								{/each}
							</table>
						</div>
						{#if revertError}
							<div class="modal-error">{revertError}</div>
						{/if}
					{/if}
				{/if}
			</div>
			<div class="modal-footer">
				{#if diffData && !revertSuccess}
					<Button variant="destructive" size="sm" onclick={revertFlow} disabled={isReverting}>
						{#if isReverting}<Loader2 class="h-3.5 w-3.5 spinning mr-1" />Reverting...{:else}Revert to GitHub{/if}
					</Button>
				{/if}
				<Button variant="outline" size="sm" onclick={closeDiffDialog}>Close</Button>
			</div>
		</div>
	</div>
{/if}

<!-- Results Dialog -->
{#if showResultsDialog}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => showResultsDialog = false} onkeydown={() => {}}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-content modal-xl" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
			<div class="modal-header">
				<div>
					<h3>E2E Test Results</h3>
					{#if resultsFlow}
						<p class="modal-subtitle">{resultsFlow.name}</p>
					{/if}
				</div>
				<button class="modal-close" onclick={() => showResultsDialog = false}><X size={16} /></button>
			</div>
			<div class="modal-body modal-body-scroll">
				{#if isResultsLoading}
					<div class="modal-loading"><Loader2 class="h-5 w-5 spinning" /> Loading results...</div>
				{:else if resultsError}
					<div class="modal-error">{resultsError}</div>
				{:else if resultsData}
					<!-- Summary -->
					<div class="results-summary">
						<table class="results-summary-table">
							<tbody>
								<tr><td class="results-label">Status</td><td>{resultsData.status}</td></tr>
								<tr><td class="results-label">Failed</td><td>{resultsData.failedAsserts}</td></tr>
								<tr><td class="results-label">Total</td><td>{resultsData.totalAsserts}</td></tr>
							</tbody>
						</table>
					</div>
					<!-- Component details -->
					<table class="results-table">
						<thead>
							<tr>
								<th>Component</th>
								<th class="w-16">Status</th>
								<th class="w-16">Asserts</th>
								<th>Errors</th>
								<th>ComponentId</th>
							</tr>
						</thead>
						<tbody>
							{#if resultsData.details?.length > 0}
								{#each resultsData.details as detail}
									<tr>
										<td>{detail.componentName}</td>
										<td class="text-center">{detail.status === 'failed' ? '❌' : '✅'}</td>
										<td class="text-center">{detail.asserts}</td>
										<td>
											{#if detail.errors?.length > 0}
												{#each detail.errors as err}
													<div class="results-err">{err}</div>
												{/each}
											{:else}
												<span class="text-muted">—</span>
											{/if}
										</td>
										<td>
											{#if detail.componentId}
												<a href={getComponentLink(detail.componentId)} target="_blank" rel="noopener noreferrer" class="results-link">{detail.componentId}</a>
											{:else}
												<span class="text-muted">—</span>
											{/if}
										</td>
									</tr>
								{/each}
							{:else}
								<tr><td colspan="5" class="text-center text-muted">No component-level details found</td></tr>
							{/if}
						</tbody>
					</table>
				{/if}
			</div>
			<div class="modal-footer">
				<Button variant="outline" size="sm" onclick={() => showResultsDialog = false}>Close</Button>
			</div>
		</div>
	</div>
{/if}

<!-- Sync to GitHub Dialog -->
{#if showSyncDialog}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => { if (!isSyncing) closeSyncDialog(); }} onkeydown={() => {}}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-content modal-lg" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
			<div class="modal-header">
				<h3>Sync to GitHub</h3>
				<button class="modal-close" onclick={closeSyncDialog}><X size={16} /></button>
			</div>
			<div class="modal-body">
				{#if syncResult?.success}
					<div class="modal-success-block">
						<p class="modal-success-title">Pull Request Created</p>
						<p>{syncResult.synced?.length || 0} flow(s) synced</p>
						<a href={syncResult.prUrl} target="_blank" rel="noopener noreferrer" class="modal-pr-link">
							View PR #{syncResult.prNumber}
							<ExternalLink size={14} />
						</a>
						{#if syncResult.errors?.length > 0}
							<div class="modal-warning-box">
								<p>Some flows failed:</p>
								{#each syncResult.errors as err}
									<p>- {err.name}: {err.error}</p>
								{/each}
							</div>
						{/if}
					</div>
				{:else}
					<div class="modal-form">
						<label>
							<span>PR Title</span>
							<input type="text" bind:value={syncPrTitle} disabled={isSyncing} class="e2e-input" />
						</label>
						<label>
							<span>Description <small>(optional)</small></span>
							<textarea bind:value={syncPrDescription} disabled={isSyncing} rows="3" class="e2e-input"></textarea>
						</label>
						<label>
							<span>Target Branch</span>
							<input type="text" bind:value={syncTargetBranch} disabled={isSyncing} class="e2e-input" />
						</label>
						<div>
							<span class="modal-form-label">Flows to sync ({selectedFlows.length})</span>
							<div class="sync-flow-list">
								{#each selectedFlows as flow}
									<div class="sync-flow-item">
										<span>{flow.name}</span>
										<span class="sync-flow-path">{flow.githubPath || generateFlowPath(flow.connector, flow.name)}</span>
									</div>
								{/each}
							</div>
						</div>
						{#if syncError}
							<div class="modal-error">{syncError}</div>
						{/if}
					</div>
				{/if}
			</div>
			<div class="modal-footer">
				{#if syncResult?.success}
					<Button size="sm" onclick={closeSyncDialog}>Close</Button>
				{:else}
					<Button variant="outline" size="sm" onclick={closeSyncDialog} disabled={isSyncing}>Cancel</Button>
					<Button size="sm" onclick={performSync} disabled={isSyncing}>
						{#if isSyncing}<Loader2 class="h-3.5 w-3.5 spinning mr-1" />Creating PR...{:else}Create Pull Request{/if}
					</Button>
				{/if}
			</div>
		</div>
	</div>
{/if}


<style>
	/* ===== Panel Layout ===== */
	.e2e-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	.e2e-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 16px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card);
		gap: 8px;
		flex-wrap: wrap;
	}

	.e2e-toolbar-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.e2e-toolbar-title {
		font-size: 14px;
		font-weight: 600;
	}

	.e2e-toolbar-right {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.e2e-settings-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: transparent;
		font-size: 11px;
		color: var(--color-muted-foreground);
		cursor: pointer;
		transition: background 0.15s;
	}
	.e2e-settings-btn:hover {
		background: var(--color-muted);
		color: var(--color-foreground);
	}

	.e2e-active-info {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		color: var(--color-muted-foreground);
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.e2e-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 40px;
		color: var(--color-muted-foreground);
		font-size: 13px;
	}

	.e2e-error {
		margin: 16px;
		padding: 12px;
		border-radius: var(--radius-md);
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #dc2626;
		font-size: 13px;
	}

	/* ===== Stats Bar ===== */
	.e2e-stats-bar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--color-border);
		overflow-x: auto;
	}

	.e2e-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		padding: 6px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: transparent;
		cursor: pointer;
		transition: all 0.15s;
		min-width: 60px;
	}
	.e2e-stat:hover { background: var(--color-muted); }
	.e2e-stat.active { ring: 2px; box-shadow: 0 0 0 2px var(--color-primary); }

	.e2e-stat-value { font-size: 18px; font-weight: 700; line-height: 1; }
	.e2e-stat-label { font-size: 10px; color: var(--color-muted-foreground); }

	.stat-running .e2e-stat-value { color: #059669; }
	.stat-stopped .e2e-stat-value { color: #6b7280; }
	.stat-match .e2e-stat-value { color: #16a34a; }
	.stat-modified .e2e-stat-value { color: #ca8a04; }
	.stat-server-only .e2e-stat-value { color: #2563eb; }
	.stat-local-only .e2e-stat-value { color: #7c3aed; }

	.e2e-stat-divider {
		width: 1px;
		height: 28px;
		background: var(--color-border);
		margin: 0 4px;
		flex-shrink: 0;
	}

	/* ===== Filter Bar ===== */
	.e2e-filter-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--color-border);
		flex-wrap: wrap;
	}

	.e2e-search {
		flex: 1;
		min-width: 140px;
		max-width: 260px;
		padding: 5px 10px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
		font-size: 12px;
		color: var(--color-foreground);
	}
	.e2e-search:focus { outline: none; box-shadow: 0 0 0 2px var(--color-ring); }

	.e2e-select {
		padding: 5px 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
		font-size: 12px;
		color: var(--color-foreground);
	}

	.e2e-clear-btn {
		padding: 4px 8px;
		border: none;
		background: transparent;
		font-size: 12px;
		color: var(--color-muted-foreground);
		cursor: pointer;
	}
	.e2e-clear-btn:hover { color: var(--color-foreground); }

	.e2e-count {
		font-size: 11px;
		color: var(--color-muted-foreground);
		margin-left: auto;
	}

	/* ===== Table ===== */
	.e2e-table-wrap {
		flex: 1;
		overflow: auto;
		min-height: 0;
	}

	.e2e-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 40px;
		color: var(--color-muted-foreground);
		font-size: 13px;
	}

	.e2e-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.e2e-table thead {
		position: sticky;
		top: 0;
		z-index: 1;
	}
	.e2e-table th {
		padding: 6px 12px;
		text-align: left;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted-foreground);
		background: var(--color-muted);
		border-bottom: 1px solid var(--color-border);
	}
	.e2e-table td {
		padding: 6px 12px;
		border-bottom: 1px solid var(--color-border);
		vertical-align: middle;
	}
	.e2e-table tr:hover td { background: var(--color-muted); }
	.e2e-table tr.selected td { background: rgba(59, 130, 246, 0.06); }

	.col-check { width: 36px; }
	.col-sources { width: 70px; }
	.col-status { width: 80px; }
	.col-sync { width: 90px; }
	.col-local-sync { width: 90px; }
	.col-actions { width: 200px; }

	.flow-name {
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: block;
		max-width: 280px;
	}

	/* Source icons */
	.source-icons {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.source-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: var(--radius-sm);
		border: 1px solid;
	}
	.source-instance { color: #2563eb; border-color: #bfdbfe; background: #eff6ff; }
	.source-local { color: #7c3aed; border-color: #c4b5fd; background: #f5f3ff; }
	.source-github { color: #6b7280; border-color: #e5e7eb; background: #f9fafb; }

	/* Badges */
	.status-badge {
		display: inline-flex;
		align-items: center;
		padding: 1px 8px;
		border-radius: 9999px;
		font-size: 10px;
		font-weight: 500;
		border: 1px solid;
	}
	.status-running { background: #ecfdf5; color: #059669; border-color: #a7f3d0; }
	.status-stopped { background: #f9fafb; color: #6b7280; border-color: #e5e7eb; }

	.sync-badge {
		display: inline-flex;
		align-items: center;
		padding: 1px 8px;
		border-radius: 9999px;
		font-size: 10px;
		font-weight: 500;
		border: 1px solid;
	}
	.sync-badge-match { background: #dcfce7; color: #16a34a; border-color: #bbf7d0; }
	.sync-badge-modified { background: #fef9c3; color: #a16207; border-color: #fde68a; }
	.sync-badge-server-only { background: #dbeafe; color: #2563eb; border-color: #bfdbfe; }
	.sync-badge-local-only { background: #ede9fe; color: #7c3aed; border-color: #c4b5fd; }
	.sync-badge-error { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
	.sync-badge-loading {
		display: inline-block;
		width: 60px;
		height: 18px;
		border-radius: 9999px;
		background: linear-gradient(90deg, var(--color-muted) 25%, transparent 50%, var(--color-muted) 75%);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
	}
	@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

	/* Action buttons */
	.action-btns {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		cursor: pointer;
		transition: background 0.15s;
		color: inherit;
		text-decoration: none;
	}
	.action-btn:disabled { opacity: 0.4; pointer-events: none; }
	.action-designer { color: #2563eb; }
	.action-designer:hover { background: #eff6ff; }
	.action-github { color: #6b7280; }
	.action-github:hover { background: #f3f4f6; }
	.action-diff { color: #ca8a04; }
	.action-diff:hover { background: #fefce8; }
	.action-results { color: #6b7280; }
	.action-results:hover { background: #f3f4f6; }
	.action-start { color: #059669; }
	.action-start:hover { background: #ecfdf5; }
	.action-stop { color: #d97706; }
	.action-stop:hover { background: #fffbeb; }
	.action-download { color: #2563eb; }
	.action-download:hover { background: #eff6ff; }
	.action-upload { color: #7c3aed; }
	.action-upload:hover { background: #f5f3ff; }
	.action-delete { color: #dc2626; }
	.action-delete:hover { background: #fef2f2; }

	/* Floating bar */
	.e2e-floating-bar {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 16px;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 12px rgba(0,0,0,0.15);
		z-index: 10;
	}
	.e2e-floating-count { font-size: 12px; font-weight: 500; }
	.e2e-floating-divider { width: 1px; height: 20px; background: var(--color-border); }

	/* ===== Modal ===== */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 24px;
	}
	.modal-content {
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		max-height: 85vh;
		width: 100%;
	}
	.modal-sm { max-width: 440px; }
	.modal-md { max-width: 540px; }
	.modal-lg { max-width: 680px; }
	.modal-xl { max-width: 900px; }

	.modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 16px 20px 12px;
		border-bottom: 1px solid var(--color-border);
	}
	.modal-header h3 { font-size: 15px; font-weight: 600; margin: 0; }
	.modal-subtitle { font-size: 12px; color: var(--color-muted-foreground); margin-top: 2px; }
	.modal-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: var(--radius-sm);
		color: var(--color-muted-foreground);
		flex-shrink: 0;
	}
	.modal-close:hover { background: var(--color-muted); color: var(--color-foreground); }

	.modal-body {
		padding: 16px 20px;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
	}
	.modal-body-scroll { overflow-y: auto; }

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 20px;
		border-top: 1px solid var(--color-border);
	}

	.modal-loading {
		display: flex;
		align-items: center;
		gap: 8px;
		justify-content: center;
		padding: 24px;
		color: var(--color-muted-foreground);
		font-size: 13px;
	}

	.modal-error {
		padding: 10px 12px;
		border-radius: var(--radius-sm);
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #dc2626;
		font-size: 12px;
		margin-top: 8px;
	}

	.modal-success {
		padding: 12px;
		border-radius: var(--radius-sm);
		background: #f0fdf4;
		border: 1px solid #bbf7d0;
		color: #16a34a;
		font-size: 13px;
		font-weight: 500;
		text-align: center;
	}

	.modal-success-block {
		text-align: center;
		padding: 16px 0;
	}
	.modal-success-title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
	.modal-pr-link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-top: 8px;
		color: #2563eb;
		font-weight: 500;
		font-size: 13px;
	}

	.modal-info-box {
		padding: 10px 12px;
		border-radius: var(--radius-sm);
		background: var(--color-muted);
	}
	.modal-info-name { font-weight: 500; font-size: 13px; }
	.modal-warning {
		font-size: 12px;
		color: var(--color-muted-foreground);
		margin-top: 10px;
	}
	.modal-warning-box {
		margin-top: 12px;
		padding: 10px;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: var(--radius-sm);
		font-size: 12px;
		color: #92400e;
		text-align: left;
	}

	/* Modal form */
	.modal-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.modal-form label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.modal-form label > span {
		font-size: 12px;
		font-weight: 500;
	}
	.modal-form label > span small {
		font-weight: 400;
		color: var(--color-muted-foreground);
	}
	.modal-form-label {
		font-size: 12px;
		font-weight: 500;
		margin-bottom: 4px;
	}

	.e2e-input {
		padding: 6px 10px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
		font-size: 12px;
		color: var(--color-foreground);
		width: 100%;
		font-family: inherit;
	}
	.e2e-input:focus { outline: none; box-shadow: 0 0 0 2px var(--color-ring); }
	.e2e-input:disabled { opacity: 0.6; }
	textarea.e2e-input { resize: vertical; }


	/* Sync flow list */
	.sync-flow-list {
		max-height: 160px;
		overflow-y: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}
	.sync-flow-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 6px 10px;
		border-bottom: 1px solid var(--color-border);
		font-size: 11px;
		gap: 8px;
	}
	.sync-flow-item:last-child { border-bottom: none; }
	.sync-flow-path {
		color: var(--color-muted-foreground);
		font-family: monospace;
		font-size: 10px;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 50%;
	}

	/* ===== Diff ===== */
	.diff-summary {
		display: flex;
		gap: 12px;
		font-size: 11px;
		margin-bottom: 8px;
	}
	.diff-added { color: #16a34a; font-weight: 600; }
	.diff-removed { color: #dc2626; font-weight: 600; }
	.diff-context { color: var(--color-muted-foreground); }

	.diff-view {
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		max-height: 50vh;
	}

	.diff-table {
		width: 100%;
		border-collapse: collapse;
		font-family: "SF Mono", "Fira Code", monospace;
		font-size: 10px;
		line-height: 1.6;
	}

	.diff-line.diff-added { background: #f0fdf4; }
	.diff-line.diff-removed { background: #fef2f2; }
	.diff-line.diff-context:hover { background: var(--color-muted); }

	.diff-marker {
		width: 20px;
		text-align: center;
		user-select: none;
		color: var(--color-muted-foreground);
		padding: 0 4px;
	}
	.diff-added .diff-marker { color: #16a34a; background: #dcfce7; }
	.diff-removed .diff-marker { color: #dc2626; background: #fecaca; }

	.diff-text {
		padding: 0 8px;
		white-space: pre;
	}
	.diff-added .diff-text { color: #14532d; }
	.diff-removed .diff-text { color: #7f1d1d; }

	/* ===== Results ===== */
	.results-summary {
		margin-bottom: 12px;
	}
	.results-summary-table {
		width: 100%;
		border-collapse: collapse;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		font-size: 12px;
	}
	.results-summary-table td {
		padding: 6px 12px;
		border-bottom: 1px solid var(--color-border);
	}
	.results-label {
		font-weight: 500;
		background: var(--color-muted);
		width: 120px;
	}

	.results-table {
		width: 100%;
		border-collapse: collapse;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		font-size: 11px;
	}
	.results-table th {
		padding: 6px 10px;
		text-align: left;
		font-weight: 600;
		background: var(--color-muted);
		border-bottom: 1px solid var(--color-border);
		font-size: 10px;
	}
	.results-table td {
		padding: 6px 10px;
		border-bottom: 1px solid var(--color-border);
		vertical-align: top;
	}
	.results-err { color: #dc2626; font-size: 11px; }
	.results-link { color: #2563eb; font-size: 10px; word-break: break-all; }

	.text-muted { color: var(--color-muted-foreground); }
	.text-center { text-align: center; }
	.w-16 { width: 64px; }

	:global(.spinning) {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
</style>
