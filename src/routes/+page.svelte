<script>
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Badge } from '$lib/components/ui/badge';
	import { ChevronRight, Search, Package, Folder, Box, X, Save, AlertCircle, FolderSync, Circle, RotateCw, Loader2, MessageSquare, FlaskConical, Sparkles, ShieldAlert, ShieldCheck, Copy, Check } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import ComponentPreview from '$lib/components/ComponentPreview.svelte';
	import AiChatPanel from '$lib/components/AiChatPanel.svelte';
	import TestPlanViewer from '$lib/components/TestPlanViewer.svelte';

	import { browser } from '$app/environment';
	import { onMount, untrack } from 'svelte';
	import { fileSync } from '$lib/stores/fileSync.svelte';

	let searchQuery = $state('');
	let selectedComponent = $state(null);
	let expandedConnectors = $state(new Set());
	let expandedModules = $state(new Set());
	let showAiPanel = $state(false);
	let activeTab = $state('properties');
	let testPlanData = $state(null);
	let testPlanLoading = $state(false);
	let testPlanConnector = $state(null);
	let planningRunning = $state(false);
	let planningOutput = $state('');
	let planningError = $state(null);

	// Auth state
	let authStatus = $state(null); // null | 'checking' | 'valid' | 'failed'
	let authInfo = $state(null); // { found, authType, fullPath }
	let showAuthForm = $state(false);
	let authFormData = $state({ clientId: '', clientSecret: '', scope: '', username: '', password: '', apiKey: '' });
	let authLoginRunning = $state(false);
	let authLoginResult = $state(null);
	let authCopied = $state(false);
	let authCheckingConnector = null; // non-reactive guard
	let authChildProcess = null; // Tauri Child process ref for cancellation

	// Use the file sync store's tree instead of static data
	let currentTree = $derived(fileSync.tree);

	// Helper to find a component by its path
	function findComponentByPath(path) {
		for (const connector of currentTree.connectors) {
			for (const module of connector.modules) {
				for (const component of module.components) {
					if (component.path === path) {
						return component;
					}
				}
			}
		}
		return null;
	}

	// Get connector for the selected component (reactive)
	let selectedConnector = $derived.by(() => {
		if (!selectedComponent) return null;
		const connectorName = selectedComponent.path.split('/')[0];
		return currentTree.connectors.find(c => c.name === connectorName) || null;
	});

	// Helper to expand the tree to show a component
	function expandTreeForComponent(component) {
		const [connectorName, moduleName] = component.path.split('/');
		expandedConnectors = new Set([...expandedConnectors, connectorName]);
		expandedModules = new Set([...expandedModules, `${connectorName}/${moduleName}`]);
	}

	// Read initial state from URL hash on mount
	function initFromUrl() {
		if (!browser) return;
		const hash = window.location.hash.slice(1); // Remove the '#'
		if (hash) {
			const path = decodeURIComponent(hash);
			const component = findComponentByPath(path);
			if (component) {
				selectedComponent = component;
				expandTreeForComponent(component);
			}
		}
	}

	// Update URL when selection changes
	function updateUrl(component) {
		if (!browser) return;
		if (component) {
			const newHash = `#${encodeURIComponent(component.path)}`;
			if (window.location.hash !== newHash) {
				window.history.pushState(null, '', newHash);
			}
		} else {
			if (window.location.hash) {
				window.history.pushState(null, '', window.location.pathname);
			}
		}
	}

	// Initialize from URL on mount
	onMount(() => {
		initFromUrl();

		// Listen for browser back/forward navigation
		const handlePopState = () => {
			const hash = window.location.hash.slice(1);
			if (hash) {
				const path = decodeURIComponent(hash);
				const component = findComponentByPath(path);
				if (component) {
					selectedComponent = component;
					expandTreeForComponent(component);
				}
			} else {
				selectedComponent = null;
			}
		};

		window.addEventListener('popstate', handlePopState);
		return () => window.removeEventListener('popstate', handlePopState);
	});

	let filteredTree = $derived.by(() => {
		if (!searchQuery.trim()) {
			return currentTree;
		}

		const query = searchQuery.toLowerCase();
		const filtered = { connectors: [] };

		for (const connector of currentTree.connectors) {
			const filteredModules = [];

			for (const module of connector.modules) {
				const filteredComponents = module.components.filter((comp) => {
					const searchText = [
						comp.name,
						comp.label || '',
						comp.componentJson.description || '',
						connector.name,
						module.name
					]
						.join(' ')
						.toLowerCase();
					return searchText.includes(query);
				});

				if (filteredComponents.length > 0) {
					filteredModules.push({
						...module,
						components: filteredComponents
					});
				}
			}

			if (filteredModules.length > 0) {
				filtered.connectors.push({
					...connector,
					modules: filteredModules
				});
			}
		}

		return filtered;
	});

	function toggleConnector(name) {
		const newSet = new Set(expandedConnectors);
		if (newSet.has(name)) {
			newSet.delete(name);
		} else {
			newSet.add(name);
		}
		expandedConnectors = newSet;
	}

	function toggleModule(key) {
		const newSet = new Set(expandedModules);
		if (newSet.has(key)) {
			newSet.delete(key);
		} else {
			newSet.add(key);
		}
		expandedModules = newSet;
	}

	async function selectComponent(component) {
		// If connected, load fresh data from disk
		if (fileSync.isConnected) {
			await fileSync.loadComponentFromDirectory(component.path);
		}
		selectedComponent = component;
		updateUrl(component);
	}

	function closeEditor() {
		selectedComponent = null;
		updateUrl(null);
	}

	// Expand all when searching
	$effect(() => {
		if (searchQuery.trim()) {
			const connectorNames = new Set(filteredTree.connectors.map((c) => c.name));
			expandedConnectors = connectorNames;

			const moduleKeys = new Set();
			for (const connector of filteredTree.connectors) {
				for (const module of connector.modules) {
					moduleKeys.add(`${connector.name}/${module.name}`);
				}
			}
			expandedModules = moduleKeys;
		}
	});

	// Keyboard shortcuts
	function handleKeydown(event) {
		const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
		const modifier = isMac ? event.metaKey : event.ctrlKey;

		if (modifier && event.key === 's') {
			event.preventDefault();
			if (fileSync.isConnected) {
				fileSync.saveAllModifiedComponents();
			}
		}

		if (modifier && event.key === 'o') {
			event.preventDefault();
			fileSync.openConnectorsFolder();
		}
	}

	// Save current component
	async function saveCurrentComponent() {
		if (selectedComponent && fileSync.isConnected) {
			await fileSync.saveComponentToDirectory(selectedComponent);
		}
	}

	// Reload current component from disk
	async function reloadCurrentComponent() {
		if (selectedComponent && fileSync.isConnected) {
			await fileSync.loadComponentFromDirectory(selectedComponent.path);
			// Force reactivity by reassigning
			selectedComponent = selectedComponent;
		}
	}

	$effect(() => {
		if (!browser) return;
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});

	// Handle inspector input changes (label, tooltip edits)
	function handleInspectorInputChange(portName, inputKey, field, value) {
		if (!selectedComponent) return;

		const componentJson = selectedComponent.componentJson;

		// Find the inspector to update
		let inspector;
		if (portName === 'properties') {
			inspector = componentJson.properties?.inspector;
		} else {
			const port = componentJson.inPorts?.find(p => p.name === portName);
			inspector = port?.inspector;
		}

		if (inspector?.inputs && inspector.inputs[inputKey]) {
			// Handle special fields that need transformation
			let processedValue = value;

			if (field === 'levels') {
				// Convert comma-separated string to array
				processedValue = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
			}

			// Update the field
			inspector.inputs[inputKey][field] = processedValue;

			// Mark component as dirty
			fileSync.markComponentDirty(selectedComponent.path);

			// Force reactivity
			selectedComponent = selectedComponent;
		}
	}

	// Handle required checkbox changes
	function handleRequiredChange(portName, inputKey, required) {
		if (!selectedComponent) return;

		const componentJson = selectedComponent.componentJson;

		// Find the schema to update
		let schema;
		if (portName === 'properties') {
			schema = componentJson.properties?.schema;
		} else {
			const port = componentJson.inPorts?.find(p => p.name === portName);
			schema = port?.schema;
		}

		if (schema) {
			// Initialize required array if it doesn't exist
			if (!schema.required) {
				schema.required = [];
			}

			const requiredArray = schema.required;
			const index = requiredArray.indexOf(inputKey);

			if (required && index === -1) {
				// Add to required array
				requiredArray.push(inputKey);
			} else if (!required && index !== -1) {
				// Remove from required array
				requiredArray.splice(index, 1);
			}

			// Mark component as dirty
			fileSync.markComponentDirty(selectedComponent.path);

			// Force reactivity
			selectedComponent = selectedComponent;
		}
	}

	// Handle input type changes
	function handleTypeChange(portName, inputKey, newType) {
		if (!selectedComponent) return;

		const componentJson = selectedComponent.componentJson;

		// Find the inspector to update
		let inspector;
		if (portName === 'properties') {
			inspector = componentJson.properties?.inspector;
		} else {
			const port = componentJson.inPorts?.find(p => p.name === portName);
			inspector = port?.inspector;
		}

		if (inspector?.inputs && inspector.inputs[inputKey]) {
			// Update the type
			inspector.inputs[inputKey].type = newType;

			// Mark component as dirty
			fileSync.markComponentDirty(selectedComponent.path);

			// Force reactivity
			selectedComponent = selectedComponent;
		}
	}

	// Handle options changes for select/multiselect
	function handleOptionsChange(portName, inputKey, options) {
		if (!selectedComponent) return;

		const componentJson = selectedComponent.componentJson;

		// Find the inspector to update
		let inspector;
		if (portName === 'properties') {
			inspector = componentJson.properties?.inspector;
		} else {
			const port = componentJson.inPorts?.find(p => p.name === portName);
			inspector = port?.inspector;
		}

		if (inspector?.inputs && inspector.inputs[inputKey]) {
			// Update the options
			inspector.inputs[inputKey].options = options;

			// Mark component as dirty
			fileSync.markComponentDirty(selectedComponent.path);

			// Force reactivity
			selectedComponent = selectedComponent;
		}
	}

	// Handle fields changes for expression type
	function handleFieldsChange(portName, inputKey, fields) {
		if (!selectedComponent) return;

		const componentJson = selectedComponent.componentJson;

		// Find the inspector to update
		let inspector;
		if (portName === 'properties') {
			inspector = componentJson.properties?.inspector;
		} else {
			const port = componentJson.inPorts?.find(p => p.name === portName);
			inspector = port?.inspector;
		}

		if (inspector?.inputs && inspector.inputs[inputKey]) {
			// Update the fields
			inspector.inputs[inputKey].fields = fields;

			// Mark component as dirty
			fileSync.markComponentDirty(selectedComponent.path);

			// Force reactivity
			selectedComponent = selectedComponent;
		}
	}

	// Build context string for AI chat panel
	let aiContext = $derived.by(() => {
		if (!selectedComponent) return '';
		const comp = selectedComponent.componentJson;
		return `Currently editing component: ${comp.name || selectedComponent.name}\nPath: ${selectedComponent.path}\nLabel: ${comp.label || ''}\nDescription: ${comp.description || ''}\nCurrent JSON:\n${JSON.stringify(comp, null, 2)}`;
	});

	// Handle AI-generated component JSON
	function handleComponentGenerated(componentJson) {
		if (!selectedComponent || !componentJson || typeof componentJson !== 'object') return;

		// Merge the generated JSON into the selected component
		const current = selectedComponent.componentJson;
		const generated = componentJson;

		// Update all top-level keys from the generated JSON
		for (const [key, value] of Object.entries(generated)) {
			current[key] = value;
		}

		// Mark as dirty
		fileSync.markComponentDirty(selectedComponent.path);

		// Force reactivity
		selectedComponent = selectedComponent;
	}

	// Test plan tab stats
	let testPlanStats = $derived.by(() => {
		if (!testPlanData) return { passed: 0, failed: 0, total: 0 };
		return {
			passed: testPlanData.filter((t) => t.status === 'passed').length,
			failed: testPlanData.filter((t) => t.status === 'failed').length,
			total: testPlanData.length
		};
	});

	// ── Test Plan ────────────────────────────────────────────────────────
	async function loadTestPlanForConnector(connectorName) {
		if (testPlanConnector === connectorName && testPlanData !== null) return;
		if (testPlanLoading) return;
		testPlanLoading = true;
		testPlanConnector = connectorName;
		try {
			const data = await fileSync.loadTestPlan(connectorName);
			testPlanData = data && Array.isArray(data) ? data : null;
		} catch {
			testPlanData = null;
		} finally {
			testPlanLoading = false;
		}
	}

	function handleTestPlanUpdated(updatedPlan) {
		testPlanData = updatedPlan;
		// Also persist to disk
		if (testPlanConnector) {
			fileSync.saveTestPlan(testPlanConnector, updatedPlan);
		}
	}

	async function handleReloadTestPlan() {
		if (testPlanConnector) {
			// Force reload by resetting the guard
			const connectorName = testPlanConnector;
			testPlanConnector = null;
			testPlanData = null;
			await loadTestPlanForConnector(connectorName);
		}
	}

	async function generateTestPlan() {
		if (planningRunning || !activeConnectorName || !fileSync.isConnected) return;

		planningRunning = true;
		planningOutput = '';
		planningError = null;

		try {
			const { Command } = await import('@tauri-apps/plugin-shell');

			// Resolve node path
			const whichNode = Command.create('sh', ['-l', '-c', 'which node'], { env: {} });
			const nodeResult = await whichNode.execute();
			const nodePath = nodeResult.stdout.trim();
			if (!nodePath) throw new Error('Could not find node');

			// Resolve CLI dir
			const npmRoot = Command.create('sh', ['-l', '-c', 'npm root -g'], { env: {} });
			const npmResult = await npmRoot.execute();
			const cliDir = npmResult.stdout.trim() ? `${npmResult.stdout.trim()}/appmixer` : null;

			// Find run-planning.mjs script
			const findCmd = Command.create('sh', ['-l', '-c',
				`for p in scripts/run-planning.mjs ../scripts/run-planning.mjs; do [ -f "$p" ] && echo "$(cd "$(dirname "$p")" && pwd)/$(basename "$p")" && exit 0; done; echo ""`
			], { env: {} });
			const findResult = await findCmd.execute();
			let scriptPath = findResult.stdout.trim();
			if (!scriptPath) {
				const pwdCmd = Command.create('sh', ['-l', '-c', 'echo $PWD'], { env: {} });
				const pwdResult = await pwdCmd.execute();
				scriptPath = `${pwdResult.stdout.trim()}/scripts/run-planning.mjs`;
			}

			// Compute connectorsRootDir by stripping /src/appmixer
			let connectorsRootDir = (fileSync.directoryPath || '').replace(/\/+$/, '');
			if (connectorsRootDir.endsWith('/src/appmixer')) {
				connectorsRootDir = connectorsRootDir.slice(0, -'/src/appmixer'.length);
			}

			const args = [
				'-l', '-c',
				[
					`"${nodePath}"`,
					`"${scriptPath}"`,
					`--connectorsDir "${connectorsRootDir}"`,
					`--connector "${activeConnectorName}"`,
					cliDir ? `--cliDir "${cliDir}"` : '',
					'< /dev/null 2>&1'
				].filter(Boolean).join(' ')
			];

			const cmd = Command.create('sh', args, { env: {} });
			let output = '';

			cmd.stdout.on('data', (line) => {
				const trimmed = line.replace(/\n+$/, '');
				if (trimmed) {
					output += trimmed + '\n';
					planningOutput = output;
				}
			});

			cmd.stderr.on('data', (line) => {
				const trimmed = line.replace(/\n+$/, '');
				if (trimmed) {
					output += '[stderr] ' + trimmed + '\n';
					planningOutput = output;
				}
			});

			await cmd.spawn();

			cmd.on('close', async (data) => {
				const exitCode = data.code ?? 1;
				planningOutput += `\n[PLANNING] Process exited with code ${exitCode}\n`;
				planningRunning = false;

				if (exitCode === 0) {
					await handleReloadTestPlan();
					activeTab = 'testplan';
				} else {
					planningError = `Planning agent exited with code ${exitCode}`;
				}
			});

			cmd.on('error', (err) => {
				planningOutput += `\n[PLANNING] Error: ${err}\n`;
				planningError = String(err);
				planningRunning = false;
			});
		} catch (err) {
			planningOutput += `\nFailed to spawn planning agent: ${err}\n`;
			planningError = String(err);
			planningRunning = false;
		}
	}

	// ── Auth ─────────────────────────────────────────────────────────────
	function resetAuthState() {
		cancelAuthLogin();
		authCheckingConnector = null;
		authStatus = null;
		authInfo = null;
		showAuthForm = false;
		authFormData = { clientId: '', clientSecret: '', scope: '', username: '', password: '', apiKey: '' };
		authLoginRunning = false;
		authLoginResult = null;
		authCopied = false;
	}

	async function killPort2300() {
		try {
			const { Command } = await import('@tauri-apps/plugin-shell');
			await Command.create('sh', ['-c', 'lsof -ti :2300 | xargs kill -9 2>/dev/null || true'], { env: {} }).execute();
		} catch { /* ignore */ }
	}

	async function cancelAuthLogin() {
		if (authChildProcess) {
			try { authChildProcess.kill(); } catch { /* ignore */ }
			authChildProcess = null;
		}
		await killPort2300();
		if (authLoginRunning) {
			authLoginRunning = false;
			authLoginResult = (authLoginResult || '') + '\nCancelled.';
		}
	}

	async function closeAuthForm() {
		await cancelAuthLogin();
		showAuthForm = false;
	}

	async function checkAuthStatus() {
		const connectorName = selectedConnector?.name;
		if (!connectorName || !fileSync.isConnected || !fileSync.isTauri) return;
		if (authCheckingConnector === connectorName) return;
		authCheckingConnector = connectorName;

		authStatus = 'checking';
		authInfo = null;

		try {
			const info = await fileSync.getAuthInfo(connectorName);
			if (selectedConnector?.name !== connectorName) return;

			if (!info.found) {
				authStatus = null;
				return;
			}
			authInfo = info;

			const { Command } = await import('@tauri-apps/plugin-shell');
			if (selectedConnector?.name !== connectorName) return;

			const cmd = Command.create('sh', ['-l', '-c',
				`appmixer test auth validate "${info.fullPath}"`
			], { env: {} });
			const result = await cmd.execute();

			if (selectedConnector?.name !== connectorName) return;

			if (result.code === 0) {
				authStatus = 'valid';
				return;
			}

			// Try refresh
			const refreshCmd = Command.create('sh', ['-l', '-c',
				`appmixer test auth refresh "${info.fullPath}"`
			], { env: {} });
			const refreshResult = await refreshCmd.execute();

			if (selectedConnector?.name !== connectorName) return;
			authStatus = refreshResult.code === 0 ? 'valid' : 'failed';
		} catch (err) {
			console.error('Auth check failed:', err);
			if (selectedConnector?.name !== connectorName) return;
			authStatus = 'failed';
		}
	}

	function buildAuthCommand() {
		if (!authInfo) return '';
		const base = `appmixer test auth login "${authInfo.fullPath}"`;
		switch (authInfo.authType) {
			case 'oauth2': {
				const parts = [base];
				if (authFormData.clientId) parts.push(`--clientId "${authFormData.clientId}"`);
				if (authFormData.clientSecret) parts.push(`--clientSecret "${authFormData.clientSecret}"`);
				if (authFormData.scope) parts.push(`--scope "${authFormData.scope}"`);
				return parts.join(' ');
			}
			case 'apiKey':
				return base;
			case 'pwd': {
				const parts = [base];
				if (authFormData.username) parts.push(`--username "${authFormData.username}"`);
				if (authFormData.password) parts.push(`--password "${authFormData.password}"`);
				return parts.join(' ');
			}
			default:
				return base;
		}
	}

	async function executeAuthLogin() {
		if (authLoginRunning || !authInfo) return;

		authLoginRunning = true;
		authLoginResult = '';

		try {
			// Kill any leftover process on port 2300 from a previous run
			await killPort2300();

			const { Command } = await import('@tauri-apps/plugin-shell');
			const cmdStr = buildAuthCommand();
			const cmd = Command.create('sh', ['-l', '-c', cmdStr], { env: {} });

			let output = '';

			cmd.stdout.on('data', (line) => {
				output += line;
				authLoginResult = output;
			});

			cmd.stderr.on('data', (line) => {
				output += line;
				authLoginResult = output;
			});

			authChildProcess = await cmd.spawn();

			cmd.on('close', async (data) => {
				authChildProcess = null;
				authLoginRunning = false;
				if (data.code === 0) {
					authLoginResult = output + '\nLogin successful!';
					// Re-check auth status
					authCheckingConnector = null;
					await checkAuthStatus();
					showAuthForm = false;
				} else {
					authLoginResult = output + `\nLogin failed (exit code ${data.code})`;
				}
			});

			cmd.on('error', (err) => {
				authChildProcess = null;
				authLoginRunning = false;
				authLoginResult = output + `\nError: ${err}`;
			});
		} catch (err) {
			authLoginRunning = false;
			authLoginResult = `Failed to execute login command: ${err}`;
		}
	}

	async function copyAuthCommand() {
		const cmd = buildAuthCommand();
		try {
			await navigator.clipboard.writeText(cmd);
			authCopied = true;
			setTimeout(() => { authCopied = false; }, 2000);
		} catch { /* ignore */ }
	}

	// Reset auth state when connector changes
	$effect(() => {
		const name = activeConnectorName;
		untrack(() => {
			if (authCheckingConnector && authCheckingConnector !== name) {
				resetAuthState();
			}
		});
	});

	// Auto-check auth when a component with auth is selected
	let hasAuth = $derived(selectedComponent?.componentJson?.auth != null);
	$effect(() => {
		const name = activeConnectorName;
		const connected = isConnected;
		const needsAuth = hasAuth;
		if (name && connected && needsAuth) {
			untrack(() => checkAuthStatus());
		}
	});

	// Auto-load test plan when connector changes.
	// Use $derived for the connector name so the effect only re-runs when
	// the connector actually changes — not on every selectedComponent mutation.
	let activeConnectorName = $derived(selectedConnector?.name ?? null);
	let isConnected = $derived(fileSync.isConnected);
	$effect(() => {
		const name = activeConnectorName;
		const connected = isConnected;
		if (name && connected) {
			// Fire-and-forget; loadTestPlanForConnector has its own guards
			untrack(() => loadTestPlanForConnector(name));
		} else {
			untrack(() => {
				testPlanData = null;
				testPlanConnector = null;
			});
		}
	});

	// Handle source changes for dynamic options
	function handleSourceChange(portName, inputKey, source) {
		if (!selectedComponent) return;

		const componentJson = selectedComponent.componentJson;

		// Find the inspector to update
		let inspector;
		if (portName === 'properties') {
			inspector = componentJson.properties?.inspector;
		} else {
			const port = componentJson.inPorts?.find(p => p.name === portName);
			inspector = port?.inspector;
		}

		if (inspector?.inputs && inspector.inputs[inputKey]) {
			const input = inspector.inputs[inputKey];
			if (source) {
				// Add or update source
				input.source = source;
				// Remove static options when switching to dynamic
				delete input.options;
			} else {
				// Remove source (switch to static options)
				delete input.source;
				// Initialize empty options array
				input.options = [];
			}

			// Mark component as dirty
			fileSync.markComponentDirty(selectedComponent.path);

			// Force reactivity
			selectedComponent = selectedComponent;
		}
	}
</script>

<svelte:head>
	<title>Appmixer Component Preview</title>
</svelte:head>

<div class="app-layout">
	<!-- File Sync Toolbar -->
	{#if browser && fileSync.isSupported}
		<div class="file-toolbar">
			<div class="file-toolbar-left">
				<Button variant="outline" size="sm" onclick={() => fileSync.openConnectorsFolder()}>
					<FolderSync class="h-4 w-4 mr-2" />
					{fileSync.isConnected ? 'Change Folder' : 'Open Connectors'}
				</Button>
				{#if fileSync.isConnected}
					<Button
						variant="outline"
						size="sm"
						onclick={() => fileSync.saveAllModifiedComponents()}
						disabled={!fileSync.state.hasUnsavedChanges || fileSync.state.isSaving}
					>
						<Save class="h-4 w-4 mr-2" />
						Save All ({fileSync.state.modifiedComponents.size})
					</Button>
				{/if}
			</div>
			<div class="file-toolbar-right">
				{#if fileSync.state.directoryName}
					<span class="file-name">
						<FolderSync class="h-3 w-3 inline mr-1" />
						{fileSync.state.directoryName}/
					</span>
					{#if fileSync.state.hasUnsavedChanges}
						<Badge variant="secondary" class="unsaved-badge">
							{fileSync.state.modifiedComponents.size} modified
						</Badge>
					{/if}
				{:else}
					<span class="file-name muted">Not connected</span>
				{/if}
				{#if fileSync.state.lastSavedAt}
					<span class="last-saved">Saved {fileSync.state.lastSavedAt.toLocaleTimeString()}</span>
				{/if}
				{#if fileSync.state.error}
					<span class="file-error">
						<AlertCircle class="h-4 w-4" />
						{fileSync.state.error}
					</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Sidebar -->
	<div class="sidebar">
		<div class="sidebar-header">
			<h1 class="sidebar-title">Components</h1>
			<div class="search-box">
				<Search class="search-icon" />
				<Input
					placeholder="Search..."
					class="search-input"
					bind:value={searchQuery}
				/>
			</div>
		</div>

		<ScrollArea class="sidebar-content">
			{#if fileSync.state.isLoading}
				<div class="sidebar-loading">
					<Loader2 class="loading-spinner" />
					<span>Loading connectors...</span>
				</div>
			{:else if !fileSync.isConnected}
				<div class="sidebar-empty">
					<FolderSync class="empty-folder-icon" />
					<p>No folder connected</p>
					<p class="sidebar-empty-hint">Click "Open Connectors" to select the appmixer connectors folder</p>
				</div>
			{:else}
			<div class="tree-container">
				{#each filteredTree.connectors as connector}
					<Collapsible.Root
						open={expandedConnectors.has(connector.name)}
						onOpenChange={() => toggleConnector(connector.name)}
					>
						<Collapsible.Trigger class="tree-item connector-item">
							<ChevronRight
								class="tree-chevron {expandedConnectors.has(connector.name) ? 'expanded' : ''}"
							/>
							{#if connector.icon}
								<img
									src={connector.icon}
									alt=""
									class="connector-icon"
								/>
							{:else}
								<Package class="tree-icon" />
							{/if}
							<span class="tree-label">{connector.label || connector.name}</span>
							<Badge variant="secondary" class="tree-badge">
								{connector.modules.reduce((acc, m) => acc + m.components.length, 0)}
							</Badge>
						</Collapsible.Trigger>
						<Collapsible.Content>
							<div class="tree-children">
								{#each connector.modules as module}
									{@const moduleKey = `${connector.name}/${module.name}`}
									<Collapsible.Root
										open={expandedModules.has(moduleKey)}
										onOpenChange={() => toggleModule(moduleKey)}
									>
										<Collapsible.Trigger class="tree-item module-item">
											<ChevronRight
												class="tree-chevron {expandedModules.has(moduleKey) ? 'expanded' : ''}"
											/>
											<Folder class="tree-icon" />
											<span class="tree-label">{module.name}</span>
											<Badge variant="outline" class="tree-badge">
												{module.components.length}
											</Badge>
										</Collapsible.Trigger>
										<Collapsible.Content>
											<div class="tree-children">
												{#each module.components as component}
													<button
														class="tree-item component-item {selectedComponent?.path === component.path ? 'selected' : ''} {fileSync.isComponentModified(component.path) ? 'modified' : ''}"
														onclick={() => selectComponent(component)}
													>
														{#if fileSync.isComponentModified(component.path)}
															<Circle class="modified-indicator" />
														{/if}
														{#if component.componentJson.icon}
															<img
																src={component.componentJson.icon}
																alt=""
																class="component-icon"
															/>
														{:else if connector.icon}
															<img
																src={connector.icon}
																alt=""
																class="component-icon"
															/>
														{:else}
															<Box class="tree-icon" />
														{/if}
														<span class="tree-label">{component.label || component.name}</span>
														{#if component.componentJson.trigger}
															<Badge variant="secondary" class="tree-badge small">T</Badge>
														{/if}
													</button>
												{/each}
											</div>
										</Collapsible.Content>
									</Collapsible.Root>
								{/each}
							</div>
						</Collapsible.Content>
					</Collapsible.Root>
				{/each}
			</div>
			{/if}
		</ScrollArea>
	</div>

	<!-- Main Content -->
	<div class="main-content">
		{#if selectedComponent}
			{@const comp = selectedComponent.componentJson}
			<div class="editor-panel">
				<!-- Editor Header -->
				<div class="editor-header">
					<div class="editor-title-section">
						{#if comp.icon}
							<img
								src={comp.icon}
								alt=""
								class="editor-icon"
							/>
						{:else if selectedConnector?.icon}
							<img
								src={selectedConnector.icon}
								alt=""
								class="editor-icon"
							/>
						{:else}
							<div class="editor-icon-placeholder">
								<Package class="editor-icon-fallback" />
							</div>
						{/if}
						<div class="editor-title-text">
							<h2 class="editor-title">
								{comp.label || selectedComponent.name}
								{#if fileSync.isComponentModified(selectedComponent.path)}
									<span class="modified-dot"></span>
								{/if}
							</h2>
							<p class="editor-subtitle">{comp.name}</p>
						</div>
					</div>
					<div class="editor-header-actions">
						{#if fileSync.isConnected}
							<Button
								variant="ghost"
								size="sm"
								onclick={reloadCurrentComponent}
								title="Reload from disk"
							>
								<RotateCw class="h-4 w-4" />
							</Button>
						{/if}
						{#if fileSync.isConnected && fileSync.isComponentModified(selectedComponent.path)}
							<Button
								variant="outline"
								size="sm"
								onclick={saveCurrentComponent}
								disabled={fileSync.state.isSaving}
							>
								<Save class="h-4 w-4 mr-2" />
								Save Component
							</Button>
						{/if}
						<Button
							variant={showAiPanel ? 'secondary' : 'ghost'}
							size="sm"
							onclick={() => showAiPanel = !showAiPanel}
							title="Toggle AI Assistant"
						>
							<MessageSquare class="h-4 w-4" />
						</Button>
						<Button variant="ghost" size="sm" onclick={closeEditor} class="close-button">
							<X class="h-4 w-4" />
						</Button>
					</div>
				</div>

				<!-- Component Info -->
				{#if comp.description}
					<div class="editor-description">
						{comp.description}
					</div>
				{/if}

				<div class="editor-badges">
					{#if comp.trigger}
						<Badge>Trigger</Badge>
					{/if}
					{#if comp.webhook}
						<Badge variant="secondary">Webhook</Badge>
					{/if}
					{#if comp.tick}
						<Badge variant="secondary">Polling</Badge>
					{/if}
					{#if comp.auth}
						<Badge variant="outline">{comp.auth.service}</Badge>
						{#if authStatus === 'checking'}
							<Badge variant="secondary" class="auth-checking-badge">
								<Loader2 class="h-3 w-3 spinning" />
								Checking...
							</Badge>
						{:else if authStatus === 'valid'}
							<Badge variant="outline" class="auth-valid-badge">
								<ShieldCheck class="h-3 w-3" />
								Authenticated
							</Badge>
						{:else if authStatus === 'failed'}
							<button class="auth-failed-btn" onclick={() => showAuthForm = !showAuthForm}>
								<ShieldAlert class="h-3.5 w-3.5" />
								Auth Failed
							</button>
						{/if}
					{/if}
				</div>

				<!-- Auth Login Form -->
				{#if showAuthForm && authInfo}
					<div class="auth-form-panel">
						<div class="auth-form-header">
							<span class="auth-form-title">Authenticate {selectedConnector?.label || selectedConnector?.name}</span>
							<Badge variant="outline">{authInfo.authType || 'unknown'}</Badge>
							<button class="auth-form-close" onclick={closeAuthForm}>
								<X class="h-3.5 w-3.5" />
							</button>
						</div>

						{#if authInfo.authType === 'oauth2'}
							<div class="auth-form-fields">
								<div class="auth-field">
									<label class="auth-label">Client ID</label>
									<Input bind:value={authFormData.clientId} placeholder="Enter client ID" />
								</div>
								<div class="auth-field">
									<label class="auth-label">Client Secret</label>
									<Input bind:value={authFormData.clientSecret} placeholder="Enter client secret" type="password" />
								</div>
								<div class="auth-field">
									<label class="auth-label">Scopes <span class="auth-optional">(optional, comma-separated)</span></label>
									<Input bind:value={authFormData.scope} placeholder="e.g. contacts.read,contacts.write" />
								</div>
							</div>
							<div class="auth-form-actions">
								{#if authLoginRunning}
									<Button size="sm" variant="destructive" onclick={cancelAuthLogin}>
										<X class="h-3.5 w-3.5 mr-1" /> Cancel
									</Button>
									<span class="auth-running-label">
										<Loader2 class="h-3.5 w-3.5 spinning" /> Running...
									</span>
								{:else}
									<Button
										size="sm"
										onclick={executeAuthLogin}
										disabled={!authFormData.clientId || !authFormData.clientSecret}
									>
										Login
									</Button>
								{/if}
								<button class="auth-copy-btn" onclick={copyAuthCommand} title="Copy command">
									{#if authCopied}
										<Check class="h-3.5 w-3.5" />
									{:else}
										<Copy class="h-3.5 w-3.5" />
									{/if}
								</button>
							</div>
						{:else if authInfo.authType === 'pwd'}
							<div class="auth-form-fields">
								<div class="auth-field">
									<label class="auth-label">Username</label>
									<Input bind:value={authFormData.username} placeholder="Enter username" />
								</div>
								<div class="auth-field">
									<label class="auth-label">Password</label>
									<Input bind:value={authFormData.password} placeholder="Enter password" type="password" />
								</div>
							</div>
							<div class="auth-form-actions">
								{#if authLoginRunning}
									<Button size="sm" variant="destructive" onclick={cancelAuthLogin}>
										<X class="h-3.5 w-3.5 mr-1" /> Cancel
									</Button>
									<span class="auth-running-label">
										<Loader2 class="h-3.5 w-3.5 spinning" /> Running...
									</span>
								{:else}
									<Button
										size="sm"
										onclick={executeAuthLogin}
										disabled={!authFormData.username || !authFormData.password}
									>
										Login
									</Button>
								{/if}
								<button class="auth-copy-btn" onclick={copyAuthCommand} title="Copy command">
									{#if authCopied}
										<Check class="h-3.5 w-3.5" />
									{:else}
										<Copy class="h-3.5 w-3.5" />
									{/if}
								</button>
							</div>
						{:else if authInfo.authType === 'apiKey'}
							<div class="auth-form-actions">
								{#if authLoginRunning}
									<Button size="sm" variant="destructive" onclick={cancelAuthLogin}>
										<X class="h-3.5 w-3.5 mr-1" /> Cancel
									</Button>
									<span class="auth-running-label">
										<Loader2 class="h-3.5 w-3.5 spinning" /> Running...
									</span>
								{:else}
									<Button size="sm" onclick={executeAuthLogin}>
										Login
									</Button>
								{/if}
								<button class="auth-copy-btn" onclick={copyAuthCommand} title="Copy command">
									{#if authCopied}
										<Check class="h-3.5 w-3.5" />
									{:else}
										<Copy class="h-3.5 w-3.5" />
									{/if}
								</button>
							</div>
						{:else}
							<div class="auth-form-note">
								<p>Run this command in your terminal:</p>
							</div>
							<div class="auth-form-actions">
								{#if authLoginRunning}
									<Button size="sm" variant="destructive" onclick={cancelAuthLogin}>
										<X class="h-3.5 w-3.5 mr-1" /> Cancel
									</Button>
									<span class="auth-running-label">
										<Loader2 class="h-3.5 w-3.5 spinning" /> Running...
									</span>
								{:else}
									<Button size="sm" onclick={executeAuthLogin}>
										Login
									</Button>
								{/if}
								<button class="auth-copy-btn" onclick={copyAuthCommand} title="Copy command">
									{#if authCopied}
										<Check class="h-3.5 w-3.5" /> Copied
									{:else}
										<Copy class="h-3.5 w-3.5" /> Copy Command
									{/if}
								</button>
							</div>
						{/if}

						<code class="auth-command-preview">{buildAuthCommand()}</code>

						{#if authLoginResult}
							<pre class="auth-result">{authLoginResult}</pre>
						{/if}
					</div>
				{/if}

				<!-- Tabs: Properties / Test Plan -->
				{#if testPlanData || (!testPlanData && fileSync.isConnected && activeConnectorName)}
					<div class="editor-tabs">
						<button
							class="editor-tab {activeTab === 'properties' ? 'active' : ''}"
							onclick={() => activeTab = 'properties'}
						>
							<Package class="h-3.5 w-3.5" />
							Properties
						</button>
						{#if testPlanData}
							<button
								class="editor-tab {activeTab === 'testplan' ? 'active' : ''}"
								onclick={() => activeTab = 'testplan'}
							>
								<FlaskConical class="h-3.5 w-3.5" />
								Test Plan
								{#if testPlanStats.passed > 0 || testPlanStats.failed > 0}
									<span class="tab-stats">
										{#if testPlanStats.passed > 0}<span class="tab-passed">{testPlanStats.passed}</span>{/if}
										{#if testPlanStats.failed > 0}<span class="tab-failed">{testPlanStats.failed}</span>{/if}
										/ {testPlanStats.total}
									</span>
								{/if}
							</button>
						{:else if !testPlanData && fileSync.isConnected && activeConnectorName}
							<button
								class="editor-tab generate-tab"
								onclick={generateTestPlan}
								disabled={planningRunning || testPlanLoading}
							>
								{#if planningRunning}
									<Loader2 class="h-3.5 w-3.5 spinning" />
									Generating...
								{:else if testPlanLoading}
									<Loader2 class="h-3.5 w-3.5 spinning" />
									Loading...
								{:else}
									<Sparkles class="h-3.5 w-3.5" />
									Generate Test Plan
								{/if}
							</button>
						{/if}
					</div>
				{/if}

				<!-- Tab Content + AI Side Panel -->
				<div class="editor-body-wrapper">
					<div class="editor-body">
						{#if activeTab === 'properties' || !testPlanData}
							<ComponentPreview
								componentJson={comp}
								onInspectorInputChange={handleInspectorInputChange}
								onRequiredChange={handleRequiredChange}
								onTypeChange={handleTypeChange}
								onOptionsChange={handleOptionsChange}
								onFieldsChange={handleFieldsChange}
								onSourceChange={handleSourceChange}
							/>
						{:else if activeTab === 'testplan' && testPlanData && testPlanConnector}
							<div class="test-plan-main">
								<TestPlanViewer
									testPlan={testPlanData}
									connectorName={testPlanConnector}
									connectorsDir={fileSync.directoryPath || ''}
									onTestPlanUpdated={handleTestPlanUpdated}
									onReloadTestPlan={handleReloadTestPlan}
								/>
							</div>
						{/if}

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
											onclick={() => { planningOutput = ''; planningError = null; }}
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
					</div>
					{#if showAiPanel}
						<div class="ai-panel">
							<AiChatPanel
								onComponentGenerated={handleComponentGenerated}
								context={aiContext}
							/>
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<div class="empty-state">
				<Package class="empty-icon" />
				<p class="empty-title">Select a component</p>
				<p class="empty-subtitle">Browse connectors in the sidebar and click on a component to preview its inputs</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.app-layout {
		display: flex;
		flex-wrap: wrap;
		height: 100vh;
		background: var(--color-background);
	}

	/* File Toolbar */
	.file-toolbar {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 16px;
		background: var(--color-card);
		border-bottom: 1px solid var(--color-border);
		gap: 16px;
	}

	.file-toolbar-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.file-toolbar-right {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 13px;
	}

	.file-name {
		font-weight: 500;
		font-family: monospace;
	}

	.file-name.muted {
		color: var(--color-muted-foreground);
		font-weight: 400;
	}

	:global(.unsaved-badge) {
		font-size: 10px;
	}

	.last-saved {
		color: var(--color-muted-foreground);
		font-size: 12px;
	}

	.file-error {
		display: flex;
		align-items: center;
		gap: 4px;
		color: hsl(var(--color-destructive));
		font-size: 12px;
	}

	/* Sidebar */
	.sidebar {
		width: 320px;
		height: calc(100vh - 49px); /* Account for toolbar height */
		border-right: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		background: var(--color-card);
	}

	.sidebar-header {
		padding: 16px;
		border-bottom: 1px solid var(--color-border);
	}

	.sidebar-title {
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 12px;
	}

	.search-box {
		position: relative;
	}

	:global(.search-icon) {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		color: var(--color-muted-foreground);
	}

	:global(.search-input) {
		padding-left: 34px;
		height: 36px;
		font-size: 13px;
	}

	:global(.sidebar-content) {
		flex: 1;
	}

	.tree-container {
		padding: 8px;
	}

	:global(.tree-item) {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 8px;
		border-radius: var(--radius-md);
		font-size: 13px;
		text-align: left;
		cursor: pointer;
		border: none;
		background: transparent;
	}

	:global(.tree-item:hover) {
		background: var(--color-muted);
	}

	:global(.tree-item.selected) {
		background: var(--color-accent);
	}

	:global(.tree-chevron) {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		transition: transform 0.15s ease;
	}

	:global(.tree-chevron.expanded) {
		transform: rotate(90deg);
	}

	:global(.tree-icon) {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		color: var(--color-muted-foreground);
	}

	.component-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.connector-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		border-radius: 2px;
	}

	.tree-label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.tree-badge) {
		font-size: 10px;
		padding: 0 6px;
		height: 18px;
	}

	:global(.tree-badge.small) {
		padding: 0 4px;
		height: 16px;
	}

	:global(.modified-indicator) {
		width: 8px;
		height: 8px;
		fill: hsl(var(--color-primary));
		flex-shrink: 0;
	}

	:global(.tree-item.modified) {
		font-weight: 500;
	}

	.tree-children {
		margin-left: 20px;
	}

	/* Main Content */
	.main-content {
		flex: 1;
		height: calc(100vh - 49px); /* Account for toolbar height */
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.editor-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.editor-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card);
	}

	.editor-title-section {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.editor-icon {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		border-radius: 4px;
	}

	.editor-icon-placeholder {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-muted);
		border-radius: 4px;
	}

	:global(.editor-icon-fallback) {
		width: 24px;
		height: 24px;
		color: var(--color-muted-foreground);
	}

	.editor-title-text {
		display: flex;
		flex-direction: column;
	}

	.editor-title {
		font-size: 18px;
		font-weight: 600;
		line-height: 1.2;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.modified-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: hsl(var(--color-primary));
	}

	.editor-header-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.editor-subtitle {
		font-size: 12px;
		color: var(--color-muted-foreground);
		font-family: monospace;
	}

	:global(.close-button) {
		color: var(--color-muted-foreground);
	}

	.editor-description {
		padding: 12px 20px;
		font-size: 13px;
		color: var(--color-muted-foreground);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-muted);
	}

	.editor-badges {
		display: flex;
		gap: 6px;
		padding: 12px 20px;
		border-bottom: 1px solid var(--color-border);
	}

	.editor-badges:empty {
		display: none;
	}

	.editor-body-wrapper {
		flex: 1;
		display: flex;
		overflow: hidden;
		min-height: 0;
	}

	.editor-body {
		flex: 1;
		overflow: auto;
		padding: 20px;
		min-height: 0;
	}

	/* Editor Tabs */
	.editor-tabs {
		display: flex;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card);
		flex-shrink: 0;
	}

	.editor-tab {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 20px;
		font-size: 13px;
		font-weight: 500;
		border: none;
		background: transparent;
		cursor: pointer;
		color: var(--color-muted-foreground);
		border-bottom: 2px solid transparent;
		transition: all 0.15s ease;
	}

	.editor-tab:hover {
		color: var(--color-foreground);
		background: var(--color-muted);
	}

	.editor-tab.active {
		color: var(--color-foreground);
		border-bottom-color: var(--color-primary);
	}

	.tab-stats {
		font-size: 11px;
		font-weight: 400;
		color: var(--color-muted-foreground);
		margin-left: 2px;
	}

	.tab-passed {
		color: #22c55e;
		font-weight: 600;
	}

	.tab-failed {
		color: #ef4444;
		font-weight: 600;
	}

	.test-plan-main {
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.ai-panel {
		width: 420px;
		border-left: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--color-card);
	}

	/* Empty State */
	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: var(--color-muted-foreground);
		padding: 40px;
	}

	:global(.empty-icon) {
		width: 64px;
		height: 64px;
		opacity: 0.3;
		margin-bottom: 16px;
	}

	.empty-title {
		font-size: 18px;
		font-weight: 500;
		margin-bottom: 8px;
	}

	.empty-subtitle {
		font-size: 14px;
		text-align: center;
		max-width: 300px;
	}

	/* Sidebar Loading State */
	.sidebar-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 40px 20px;
		color: var(--color-muted-foreground);
		gap: 12px;
	}

	:global(.loading-spinner) {
		width: 24px;
		height: 24px;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	/* Sidebar Empty State */
	.sidebar-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 40px 20px;
		color: var(--color-muted-foreground);
		text-align: center;
	}

	:global(.empty-folder-icon) {
		width: 48px;
		height: 48px;
		opacity: 0.4;
		margin-bottom: 12px;
	}

	.sidebar-empty p {
		margin: 0;
		font-size: 14px;
	}

	.sidebar-empty-hint {
		font-size: 12px !important;
		margin-top: 8px !important;
		opacity: 0.7;
		max-width: 200px;
	}

	/* Generate Test Plan tab */
	.editor-tab.generate-tab {
		color: #8b5cf6;
		border-bottom-color: transparent;
	}

	.editor-tab.generate-tab:hover {
		color: #7c3aed;
		background: rgba(139, 92, 246, 0.08);
	}

	.editor-tab.generate-tab:disabled {
		opacity: 0.6;
		cursor: default;
	}

	:global(.editor-tab.generate-tab .spinning) {
		animation: spin 1s linear infinite;
	}

	/* Planning Output Panel */
	.planning-output-panel {
		margin-top: 16px;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: #0d1117;
		border: 1px solid #30363d;
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
		max-height: 400px;
		color: #c9d1d9;
	}

	.planning-error {
		padding: 6px 10px;
		font-size: 11px;
		color: #f87171;
		background: #1a0000;
		border-top: 1px solid #30363d;
	}

	/* Auth Status */
	:global(.auth-checking-badge) {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	:global(.auth-checking-badge .spinning) {
		animation: spin 1s linear infinite;
	}

	:global(.auth-valid-badge) {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: #22c55e !important;
		border-color: #22c55e !important;
	}

	.auth-failed-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 10px;
		font-size: 12px;
		font-weight: 600;
		border: 1px solid #ef4444;
		border-radius: 9999px;
		background: #ef4444;
		color: white;
		cursor: pointer;
		transition: all 0.15s ease;
		height: 22px;
	}

	.auth-failed-btn:hover {
		background: #dc2626;
		border-color: #dc2626;
	}

	/* Auth Form Panel */
	.auth-form-panel {
		padding: 16px 20px;
		border-bottom: 1px solid var(--color-border);
		background: #fef2f2;
	}

	.auth-form-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}

	.auth-form-title {
		font-size: 13px;
		font-weight: 600;
		flex: 1;
	}

	.auth-form-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: var(--radius-sm);
		color: var(--color-muted-foreground);
	}

	.auth-form-close:hover {
		background: var(--color-muted);
	}

	.auth-form-fields {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 12px;
	}

	.auth-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.auth-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--color-foreground);
	}

	.auth-optional {
		font-weight: 400;
		color: var(--color-muted-foreground);
	}

	.auth-form-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}

	.auth-running-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--color-muted-foreground);
	}

	:global(.auth-running-label .spinning) {
		animation: spin 1s linear infinite;
	}

	.auth-copy-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		font-size: 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
		cursor: pointer;
		color: var(--color-muted-foreground);
		transition: all 0.15s ease;
	}

	.auth-copy-btn:hover {
		background: var(--color-muted);
		color: var(--color-foreground);
	}

	.auth-form-note {
		margin-bottom: 8px;
	}

	.auth-form-note p {
		font-size: 12px;
		color: var(--color-muted-foreground);
		margin: 0;
	}

	.auth-command-preview {
		display: block;
		font-family: "SF Mono", "Fira Code", monospace;
		font-size: 11px;
		padding: 8px 10px;
		background: #1e1e1e;
		color: #d4d4d4;
		border-radius: var(--radius-sm);
		word-break: break-all;
		white-space: pre-wrap;
		margin-bottom: 8px;
	}

	.auth-result {
		font-family: "SF Mono", "Fira Code", monospace;
		font-size: 11px;
		line-height: 1.5;
		padding: 8px 10px;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-y: auto;
		max-height: 200px;
		background: #0d1117;
		color: #c9d1d9;
		border-radius: var(--radius-sm);
		border: 1px solid #30363d;
	}
</style>
