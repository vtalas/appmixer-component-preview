<script>
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Search, Package, X, Save, AlertCircle, FolderSync, RotateCw, Loader2, MessageSquare, ShieldAlert, ShieldCheck, Copy, Check, Settings, Columns2, ChevronRight } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import ComponentPreview from '$lib/components/ComponentPreview.svelte';
	import AiChatPanel from '$lib/components/AiChatPanel.svelte';
	import ConnectorDashboard from '$lib/components/ConnectorDashboard.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';

	import { browser } from '$app/environment';
	import { onMount, untrack } from 'svelte';
	import { fileSync } from '$lib/stores/fileSync.svelte';

	let connectorSearch = $state('');
	let selectedComponent = $state(null);
	let selectedDashboardConnector = $state(null);
	let initialE2ETab = $state(null);
	let showSettings = $state(false);
	let showAiPanel = $state(false);
	let secondComponent = $state(null);
	let showComponentPicker = $state(false);
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

	// Auto-restore last folder on mount
	onMount(() => {
		fileSync.restoreLastFolder();
	});

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

	// Helper to find a component by connector name + component name (without module)
	function findComponentByRoute(connectorName, componentName) {
		const connector = currentTree.connectors.find(c => c.name === connectorName);
		if (!connector) return null;
		for (const module of connector.modules) {
			const component = module.components.find(c => c.name === componentName);
			if (component) return component;
		}
		return null;
	}

	// Get connector for the selected component (reactive)
	let selectedConnector = $derived.by(() => {
		if (!selectedComponent) return null;
		const connectorName = selectedComponent.path.split('/')[0];
		return currentTree.connectors.find(c => c.name === connectorName) || null;
	});

	// Parse /connector/<connectorName>[/e2e/local|remote][/<componentName>] from pathname
	function parseRoute(pathname) {
		const e2eMatch = pathname.match(/^\/connector\/([^/]+)\/e2e\/(local|remote)\/?$/);
		if (e2eMatch) {
			return { connector: decodeURIComponent(e2eMatch[1]), dashboard: true, e2eTab: e2eMatch[2] === 'remote' ? 'appmixer' : 'local' };
		}
		const componentMatch = pathname.match(/^\/connector\/([^/]+)\/([^/]+)\/?$/);
		if (componentMatch) {
			return { connector: decodeURIComponent(componentMatch[1]), component: decodeURIComponent(componentMatch[2]) };
		}
		const dashboardMatch = pathname.match(/^\/connector\/([^/]+)\/?$/);
		if (dashboardMatch) {
			return { connector: decodeURIComponent(dashboardMatch[1]), dashboard: true };
		}
		return null;
	}

	// Read initial state from URL on mount
	function initFromUrl() {
		if (!browser) return;
		const route = parseRoute(window.location.pathname);
		if (route) {
			if (route.dashboard) {
				const connector = currentTree.connectors.find(c => c.name === route.connector);
				if (connector) {
					selectedDashboardConnector = connector;
					selectedComponent = null;
					initialE2ETab = route.e2eTab || null;
				}
			} else {
				const component = findComponentByRoute(route.connector, route.component);
				if (component) {
					selectedComponent = component;
					selectedDashboardConnector = null;
					initialE2ETab = null;
				}
			}
		}
	}

	// Update URL when selection changes
	function updateUrl(component, dashboardConnector = null) {
		if (!browser) return;
		if (component) {
			const [connectorName] = component.path.split('/');
			const newPath = `/connector/${encodeURIComponent(connectorName)}/${encodeURIComponent(component.name)}`;
			if (window.location.pathname !== newPath) {
				window.history.pushState(null, '', newPath);
			}
		} else if (dashboardConnector) {
			const newPath = `/connector/${encodeURIComponent(dashboardConnector.name)}`;
			if (window.location.pathname !== newPath) {
				window.history.pushState(null, '', newPath);
			}
		} else {
			if (window.location.pathname !== '/') {
				window.history.pushState(null, '', '/');
			}
		}
	}

	// Initialize from URL on mount
	onMount(() => {
		initFromUrl();

		// Listen for browser back/forward navigation
		const handlePopState = () => {
			const route = parseRoute(window.location.pathname);
			if (route) {
				if (route.dashboard) {
					const connector = currentTree.connectors.find(c => c.name === route.connector);
					if (connector) {
						selectedDashboardConnector = connector;
						selectedComponent = null;
						initialE2ETab = route.e2eTab || null;
						return;
					}
				} else {
					const component = findComponentByRoute(route.connector, route.component);
					if (component) {
						selectedComponent = component;
						selectedDashboardConnector = null;
						initialE2ETab = null;
						return;
					}
				}
			}
			selectedComponent = null;
			selectedDashboardConnector = null;
			initialE2ETab = null;
		};

		window.addEventListener('popstate', handlePopState);
		return () => window.removeEventListener('popstate', handlePopState);
	});

	// Re-check URL when tree loads (tree may not be ready on initial mount)
	$effect(() => {
		const connectors = currentTree.connectors;
		if (connectors.length > 0 && !selectedComponent && !selectedDashboardConnector) {
			untrack(() => initFromUrl());
		}
	});

	// Filtered connectors for the grid view
	let filteredConnectors = $derived.by(() => {
		if (!connectorSearch.trim()) return currentTree.connectors;
		const query = connectorSearch.toLowerCase();
		return currentTree.connectors.filter(c => {
			const searchText = [c.name, c.label || ''].join(' ').toLowerCase();
			return searchText.includes(query);
		});
	});

	async function selectComponent(component) {
		// If connected, load fresh data from disk
		if (fileSync.isConnected) {
			await fileSync.loadComponentFromDirectory(component.path);
		}
		selectedComponent = component;
		selectedDashboardConnector = null;
		updateUrl(component);
	}

	function closeEditor() {
		const connector = selectedConnector;
		selectedComponent = null;
		secondComponent = null;
		showComponentPicker = false;
		if (connector) {
			const connectorObj = currentTree.connectors.find(c => c.name === connector.name);
			if (connectorObj) {
				selectedDashboardConnector = connectorObj;
				updateUrl(null, connectorObj);
				return;
			}
		}
		selectedDashboardConnector = null;
		updateUrl(null);
	}

	function selectConnectorDashboard(connector) {
		selectedDashboardConnector = connector;
		selectedComponent = null;
		secondComponent = null;
		showComponentPicker = false;
		updateUrl(null, connector);
	}

	// Side-by-side functions
	function openSideBySide(component) {
		secondComponent = component;
		showComponentPicker = false;
	}

	function closeSideBySide() {
		secondComponent = null;
	}

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
			const response = await fetch('/api/planning', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ connector: activeConnectorName })
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to start planning');
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error('No response body');

			const decoder = new TextDecoder();
			let buffer = '';
			let output = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					try {
						const event = JSON.parse(line.slice(6));
						if (event.type === 'stdout') {
							output += event.text;
							planningOutput = output;
						} else if (event.type === 'stderr') {
							output += '[stderr] ' + event.text;
							planningOutput = output;
						} else if (event.type === 'done') {
							planningOutput += `\n[PLANNING] Process exited with code ${event.code}\n`;
							if (event.code === 0) {
								await handleReloadTestPlan();
							} else {
								planningError = `Planning agent exited with code ${event.code}`;
							}
						} else if (event.type === 'error') {
							planningError = event.message;
						}
					} catch { /* skip */ }
				}
			}
		} catch (err) {
			planningOutput += `\nFailed to run planning agent: ${err}\n`;
			planningError = String(err);
		} finally {
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
			await fetch('/api/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'kill-port' })
			});
		} catch { /* ignore */ }
	}

	async function cancelAuthLogin() {
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
		if (!connectorName || !fileSync.isConnected) return;
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

			// Validate auth
			const validateResponse = await fetch('/api/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'validate', authPath: info.fullPath })
			});
			const validateResult = await validateResponse.json();

			if (selectedConnector?.name !== connectorName) return;

			if (validateResult.code === 0) {
				authStatus = 'valid';
				return;
			}

			// Try refresh
			const refreshResponse = await fetch('/api/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'refresh', authPath: info.fullPath })
			});
			const refreshResult = await refreshResponse.json();

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

			const cmdStr = buildAuthCommand();
			const response = await fetch('/api/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'login', command: cmdStr })
			});

			const reader = response.body?.getReader();
			if (!reader) throw new Error('No response body');

			const decoder = new TextDecoder();
			let buffer = '';
			let output = '';
			let exitCode = 1;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					try {
						const event = JSON.parse(line.slice(6));
						if (event.type === 'stdout' || event.type === 'stderr') {
							output += event.text;
							authLoginResult = output;
						} else if (event.type === 'done') {
							exitCode = event.code;
						} else if (event.type === 'error') {
							output += `\nError: ${event.message}`;
							authLoginResult = output;
						}
					} catch { /* skip */ }
				}
			}

			authLoginRunning = false;

			if (exitCode === 0) {
				authLoginResult = output + '\nLogin successful!';
				authCheckingConnector = null;
				await checkAuthStatus();
				showAuthForm = false;
			} else {
				authLoginResult = output + `\nLogin failed (exit code ${exitCode})`;
			}
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
	let activeConnectorName = $derived(selectedConnector?.name ?? selectedDashboardConnector?.name ?? null);
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

	// Handle full JSON replacement from Component JSON tab
	function handleJsonChange(newJson) {
		if (!selectedComponent || !newJson || typeof newJson !== 'object') return;

		// Replace all top-level keys
		const current = selectedComponent.componentJson;
		// Remove keys not in newJson
		for (const key of Object.keys(current)) {
			if (!(key in newJson)) {
				delete current[key];
			}
		}
		// Set all keys from newJson
		for (const [key, value] of Object.entries(newJson)) {
			current[key] = value;
		}

		// Mark as dirty
		fileSync.markComponentDirty(selectedComponent.path);

		// Force reactivity
		selectedComponent = selectedComponent;
	}

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
				<Button
					variant={showSettings ? 'secondary' : 'outline'}
					size="sm"
					onclick={() => { showSettings = !showSettings; if (showSettings) { selectedComponent = null; selectedDashboardConnector = null; updateUrl(null); } }}
					title="Settings"
				>
					<Settings class="h-4 w-4" />
				</Button>
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

	<!-- Main Content -->
	<div class="main-content">
		<!-- Breadcrumb Navigation -->
		{#if !showSettings && (selectedDashboardConnector || selectedComponent)}
			<nav class="breadcrumb-bar">
				<button class="breadcrumb-item" onclick={() => { selectedComponent = null; secondComponent = null; showComponentPicker = false; selectedDashboardConnector = null; updateUrl(null); }}>
					Connectors
				</button>
				{#if selectedComponent && selectedConnector}
					<ChevronRight class="breadcrumb-sep" />
					<button class="breadcrumb-item" onclick={closeEditor}>
						{#if selectedConnector.icon}
							<img src={selectedConnector.icon} alt="" class="breadcrumb-icon" />
						{/if}
						{selectedConnector.label || selectedConnector.name}
					</button>
				{:else if selectedDashboardConnector}
					<ChevronRight class="breadcrumb-sep" />
					<span class="breadcrumb-item current">
						{#if selectedDashboardConnector.icon}
							<img src={selectedDashboardConnector.icon} alt="" class="breadcrumb-icon" />
						{/if}
						{selectedDashboardConnector.label || selectedDashboardConnector.name}
					</span>
				{/if}
				{#if selectedComponent && selectedConnector}
					<div class="breadcrumb-actions">
						{#if selectedComponent.componentJson.auth}
							{#if authStatus === 'checking'}
								<Badge variant="secondary" class="auth-checking-badge">
									<Loader2 class="h-3 w-3 spinning" /> Checking...
								</Badge>
							{:else if authStatus === 'valid'}
								<Badge variant="outline" class="auth-valid-badge">
									<ShieldCheck class="h-3 w-3" /> Authenticated
								</Badge>
							{:else if authStatus === 'failed'}
								<button class="auth-failed-btn" onclick={() => showAuthForm = !showAuthForm}>
									<ShieldAlert class="h-3.5 w-3.5" /> Auth Failed
								</button>
							{/if}
						{/if}
						{#if fileSync.isConnected}
							<Button variant="ghost" size="sm" onclick={reloadCurrentComponent} title="Reload from disk">
								<RotateCw class="h-4 w-4" />
							</Button>
						{/if}
						{#if fileSync.isConnected && fileSync.isComponentModified(selectedComponent.path)}
							<Button variant="outline" size="sm" onclick={saveCurrentComponent} disabled={fileSync.state.isSaving}>
								<Save class="h-4 w-4 mr-2" /> Save
							</Button>
						{/if}
						<Button
							variant={secondComponent ? 'secondary' : 'ghost'}
							size="sm"
							onclick={() => {
								if (secondComponent) {
									closeSideBySide();
								} else if (selectedConnector) {
									let first = null;
									for (const mod of selectedConnector.modules) {
										for (const c of mod.components) {
											if (c.path !== selectedComponent.path) { first = c; break; }
										}
										if (first) break;
									}
									if (first) openSideBySide(first);
								}
							}}
							title="Side by Side"
						>
							<Columns2 class="h-4 w-4" />
						</Button>
						<Button
							variant={showAiPanel ? 'secondary' : 'ghost'}
							size="sm"
							onclick={() => showAiPanel = !showAiPanel}
							title="Toggle AI Assistant"
						>
							<MessageSquare class="h-4 w-4" />
						</Button>
					</div>
				{/if}
			</nav>
		{/if}

		{#if showSettings}
			<SettingsPanel onBack={() => showSettings = false} />
		{:else if selectedDashboardConnector}
			<ConnectorDashboard
				connector={selectedDashboardConnector}
				{testPlanData}
				testPlanLoading={testPlanLoading}
				testPlanConnector={testPlanConnector}
				connectorsDir={fileSync.directoryPath || ''}
				isConnected={fileSync.isConnected}
				onComponentSelect={selectComponent}
				onTestPlanUpdated={handleTestPlanUpdated}
				onReloadTestPlan={handleReloadTestPlan}
				onGenerateTestPlan={generateTestPlan}
				planningRunning={planningRunning}
				planningOutput={planningOutput}
				planningError={planningError}
				onClearPlanning={() => { planningOutput = ''; planningError = null; }}
				onRefreshTree={() => fileSync.scanConnectorsDirectory()}
				onOpenSettings={() => { showSettings = true; selectedComponent = null; selectedDashboardConnector = null; updateUrl(null); }}				{initialE2ETab}
				onE2ETabChange={(tab) => {
					initialE2ETab = tab;
					if (tab && selectedDashboardConnector) {
						const tabPath = tab === 'appmixer' ? 'remote' : 'local';
						const newPath = `/connector/${encodeURIComponent(selectedDashboardConnector.name)}/e2e/${tabPath}`;
						if (window.location.pathname !== newPath) window.history.pushState(null, '', newPath);
					} else if (!tab && selectedDashboardConnector) {
						updateUrl(null, selectedDashboardConnector);
					}
				}}
			/>
		{:else if selectedComponent}
			{@const comp = selectedComponent.componentJson}
			<div class="editor-panel">
				<!-- Component Properties + Side-by-Side + AI Panel -->
				<div class="editor-body-wrapper">
					<div class="editor-pane">
						<div class="pane-header">
							<div class="pane-header-left">
								{#if selectedConnector?.icon}
									<img src={selectedConnector.icon} alt="" class="pane-header-icon" />
								{/if}
								<select
									class="pane-component-select"
									value={selectedComponent.path}
									onchange={(e) => { const c = findComponentByPath(e.target.value); if (c) selectComponent(c); }}
								>
									{#each selectedConnector?.modules || [] as module}
										<optgroup label={module.name}>
											{#each module.components as c}
												<option value={c.path}>{c.label || c.name}</option>
											{/each}
										</optgroup>
									{/each}
								</select>
								{#if comp.description}
									<span class="pane-description">{comp.description}</span>
								{/if}
							</div>
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
											<Button size="sm" variant="destructive" onclick={cancelAuthLogin}><X class="h-3.5 w-3.5 mr-1" /> Cancel</Button>
											<span class="auth-running-label"><Loader2 class="h-3.5 w-3.5 spinning" /> Running...</span>
										{:else}
											<Button size="sm" onclick={executeAuthLogin} disabled={!authFormData.clientId || !authFormData.clientSecret}>Login</Button>
										{/if}
										<button class="auth-copy-btn" onclick={copyAuthCommand} title="Copy command">
											{#if authCopied}<Check class="h-3.5 w-3.5" />{:else}<Copy class="h-3.5 w-3.5" />{/if}
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
											<Button size="sm" variant="destructive" onclick={cancelAuthLogin}><X class="h-3.5 w-3.5 mr-1" /> Cancel</Button>
											<span class="auth-running-label"><Loader2 class="h-3.5 w-3.5 spinning" /> Running...</span>
										{:else}
											<Button size="sm" onclick={executeAuthLogin} disabled={!authFormData.username || !authFormData.password}>Login</Button>
										{/if}
										<button class="auth-copy-btn" onclick={copyAuthCommand} title="Copy command">
											{#if authCopied}<Check class="h-3.5 w-3.5" />{:else}<Copy class="h-3.5 w-3.5" />{/if}
										</button>
									</div>
								{:else if authInfo.authType === 'apiKey'}
									<div class="auth-form-actions">
										{#if authLoginRunning}
											<Button size="sm" variant="destructive" onclick={cancelAuthLogin}><X class="h-3.5 w-3.5 mr-1" /> Cancel</Button>
											<span class="auth-running-label"><Loader2 class="h-3.5 w-3.5 spinning" /> Running...</span>
										{:else}
											<Button size="sm" onclick={executeAuthLogin}>Login</Button>
										{/if}
										<button class="auth-copy-btn" onclick={copyAuthCommand} title="Copy command">
											{#if authCopied}<Check class="h-3.5 w-3.5" />{:else}<Copy class="h-3.5 w-3.5" />{/if}
										</button>
									</div>
								{:else}
									<div class="auth-form-note"><p>Run this command in your terminal:</p></div>
									<div class="auth-form-actions">
										{#if authLoginRunning}
											<Button size="sm" variant="destructive" onclick={cancelAuthLogin}><X class="h-3.5 w-3.5 mr-1" /> Cancel</Button>
											<span class="auth-running-label"><Loader2 class="h-3.5 w-3.5 spinning" /> Running...</span>
										{:else}
											<Button size="sm" onclick={executeAuthLogin}>Login</Button>
										{/if}
										<button class="auth-copy-btn" onclick={copyAuthCommand} title="Copy command">
											{#if authCopied}<Check class="h-3.5 w-3.5" /> Copied{:else}<Copy class="h-3.5 w-3.5" /> Copy Command{/if}
										</button>
									</div>
								{/if}
								<code class="auth-command-preview">{buildAuthCommand()}</code>
								{#if authLoginResult}
									<pre class="auth-result">{authLoginResult}</pre>
								{/if}
							</div>
						{/if}
						<div class="properties-scroll">
							<ComponentPreview
								componentJson={comp}
								componentPath={selectedComponent.path}
								connectorsDir={fileSync.directoryPath || ''}
								{testPlanData}
								onTestPlanUpdated={handleTestPlanUpdated}
								onInspectorInputChange={handleInspectorInputChange}
								onRequiredChange={handleRequiredChange}
								onTypeChange={handleTypeChange}
								onOptionsChange={handleOptionsChange}
								onFieldsChange={handleFieldsChange}
								onSourceChange={handleSourceChange}
								onJsonChange={handleJsonChange}
							/>
						</div>
					</div>
					{#if secondComponent}
						<div class="editor-pane secondary-pane">
							<div class="pane-header">
								<div class="pane-header-left">
									{#if selectedConnector?.icon}
										<img src={selectedConnector.icon} alt="" class="pane-header-icon" />
									{/if}
									<select
										class="pane-component-select"
										value={secondComponent.path}
										onchange={(e) => { const c = findComponentByPath(e.target.value); if (c) openSideBySide(c); }}
									>
										{#each selectedConnector?.modules || [] as module}
											<optgroup label={module.name}>
												{#each module.components as c}
													<option value={c.path}>{c.label || c.name}</option>
												{/each}
											</optgroup>
										{/each}
									</select>
									{#if secondComponent.componentJson.description}
										<span class="pane-description">{secondComponent.componentJson.description}</span>
									{/if}
								</div>
								<button class="secondary-pane-close" onclick={closeSideBySide}>
									<X class="h-3.5 w-3.5" />
								</button>
							</div>
							<div class="properties-scroll">
								<ComponentPreview
									componentJson={secondComponent.componentJson}
									componentPath={secondComponent.path}
									connectorsDir={fileSync.directoryPath || ''}
								/>
							</div>
						</div>
					{/if}
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
			<!-- Connectors Grid View -->
			<div class="connectors-view">
				{#if fileSync.state.isLoading}
					<div class="connectors-loading">
						<Loader2 class="loading-spinner" />
						<span>Loading connectors...</span>
					</div>
				{:else if !fileSync.isConnected}
					<div class="empty-state">
						<FolderSync class="empty-icon" />
						<p class="empty-title">No folder connected</p>
						<p class="empty-subtitle">Click "Open Connectors" to select the appmixer connectors folder</p>
					</div>
				{:else}
					<div class="connectors-header">
						<h1 class="connectors-title">Connectors</h1>
						<div class="connectors-search">
							<Search class="search-icon" />
							<Input
								placeholder="Search connectors..."
								class="search-input"
								bind:value={connectorSearch}
							/>
						</div>
					</div>
					<div class="connectors-grid">
						{#each filteredConnectors as connector}
							{@const componentCount = connector.modules.reduce((acc, m) => acc + m.components.length, 0)}
							<button class="connector-card" onclick={() => selectConnectorDashboard(connector)}>
								{#if connector.icon}
									<img src={connector.icon} alt="" class="connector-card-icon" />
								{:else}
									<div class="connector-card-icon-placeholder">
										<Package class="connector-card-icon-fallback" />
									</div>
								{/if}
								<span class="connector-card-name">{connector.label || connector.name}</span>
								<Badge variant="secondary">{componentCount} components</Badge>
							</button>
						{/each}
						{#if filteredConnectors.length === 0}
							<div class="connectors-empty">No connectors found</div>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.app-layout {
		display: flex;
		flex-direction: column;
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
		flex-shrink: 0;
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

	/* Main Content */
	.main-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* Connectors Grid View */
	.connectors-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: auto;
	}

	.connectors-loading {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: var(--color-muted-foreground);
		gap: 12px;
	}

	.connectors-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20px 24px 0;
		gap: 16px;
	}

	.connectors-title {
		font-size: 20px;
		font-weight: 600;
		flex-shrink: 0;
	}

	.connectors-search {
		position: relative;
		max-width: 320px;
		width: 100%;
	}

	:global(.search-icon) {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		color: var(--color-muted-foreground);
		z-index: 1;
	}

	:global(.search-input) {
		padding-left: 34px;
		height: 36px;
		font-size: 13px;
	}

	.connectors-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 12px;
		padding: 20px 24px;
	}

	.connector-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 20px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-card);
		cursor: pointer;
		transition: all 0.15s ease;
		text-align: center;
	}

	.connector-card:hover {
		border-color: var(--color-ring);
		background: var(--color-muted);
	}

	.connector-card-icon {
		width: 40px;
		height: 40px;
		border-radius: 6px;
	}

	.connector-card-icon-placeholder {
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-muted);
		border-radius: 6px;
	}

	:global(.connector-card-icon-fallback) {
		width: 24px;
		height: 24px;
		color: var(--color-muted-foreground);
	}

	.connector-card-name {
		font-size: 13px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}

	.connectors-empty {
		grid-column: 1 / -1;
		text-align: center;
		padding: 40px;
		color: var(--color-muted-foreground);
		font-size: 14px;
	}

	/* Breadcrumb Navigation */
	.breadcrumb-bar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px 20px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card);
		flex-shrink: 0;
		min-height: 40px;
	}

	.breadcrumb-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-left: auto;
	}

	.breadcrumb-item {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-muted-foreground);
		border: none;
		background: none;
		cursor: pointer;
		padding: 4px 8px;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	.breadcrumb-item:hover {
		color: var(--color-foreground);
		background: var(--color-muted);
	}

	.breadcrumb-item.current {
		color: var(--color-foreground);
		cursor: default;
	}

	.breadcrumb-item.current:hover {
		background: none;
	}

	:global(.breadcrumb-sep) {
		width: 14px;
		height: 14px;
		color: var(--color-muted-foreground);
		opacity: 0.5;
		flex-shrink: 0;
	}

	.breadcrumb-icon {
		width: 18px;
		height: 18px;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.breadcrumb-select-wrapper {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.breadcrumb-select {
		padding: 4px 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-foreground);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		cursor: pointer;
		appearance: auto;
	}

	.breadcrumb-select:hover {
		background: var(--color-muted);
		border-color: var(--color-border);
	}

	.breadcrumb-select:focus {
		outline: none;
		border-color: var(--color-ring);
		background: var(--color-background);
	}

	.modified-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: hsl(var(--color-primary));
		flex-shrink: 0;
	}

	/* Editor */
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
		gap: 12px;
		padding: 8px 20px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card);
	}

	.editor-header-left {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.editor-description-inline {
		font-size: 12px;
		color: var(--color-muted-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.editor-badges-inline {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.editor-badges-inline:empty {
		display: none;
	}

	.editor-header-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	/* Component Picker for Side-by-Side */
	.component-picker {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 20px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-muted);
	}

	.picker-label {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-muted-foreground);
		flex-shrink: 0;
	}

	.editor-badges {
		display: flex;
		gap: 6px;
		padding: 8px 20px;
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

	.editor-pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-height: 0;
	}

	.secondary-pane {
		border-left: 1px solid var(--color-border);
	}

	.secondary-pane-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 20px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card);
	}

	.secondary-pane-header-left {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.secondary-pane-icon {
		width: 20px;
		height: 20px;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.secondary-pane-title-group {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		overflow: hidden;
	}

	.secondary-pane-title {
		font-size: 13px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.secondary-pane-description {
		font-size: 12px;
		color: var(--color-muted-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.secondary-pane-badges {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.secondary-pane-close {
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
		flex-shrink: 0;
	}

	.secondary-pane-close:hover {
		background: var(--color-accent);
		color: var(--color-foreground);
	}

	/* Pane headers (shared between left and right) */
	.pane-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card);
		flex-shrink: 0;
	}

	.pane-header-left {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.pane-header-icon {
		width: 20px;
		height: 20px;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.pane-component-select {
		padding: 4px 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-foreground);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		cursor: pointer;
		appearance: auto;
		flex-shrink: 0;
		max-width: 220px;
	}

	.pane-component-select:hover {
		background: var(--color-muted);
		border-color: var(--color-border);
	}

	.pane-component-select:focus {
		outline: none;
		border-color: var(--color-ring);
		background: var(--color-background);
	}

	.pane-header-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.pane-description {
		font-size: 12px;
		color: var(--color-muted-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ai-panel {
		width: 420px;
		border-left: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--color-card);
		flex-shrink: 0;
	}

	.properties-scroll {
		flex: 1;
		overflow: auto;
		padding: 20px;
		min-height: 0;
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
