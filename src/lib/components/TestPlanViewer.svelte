<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		CheckCircle2,
		XCircle,
		Clock,
		ChevronRight,
		ChevronDown,
		Play,
		Loader2,
		Filter,
		Terminal,
		AlertTriangle,
		SkipForward,
		Bot,
		Square,
		Sparkles,
		ExternalLink
	} from 'lucide-svelte';

	// Tauri shell plugin — imported dynamically.
	// These MUST be $state so Svelte re-renders when they become available.
	let Command = $state<typeof import('@tauri-apps/plugin-shell').Command | null>(null);
	let isTauri = $state(false);
	let resolvedAppmixerPath = $state<string | null>(null);

	if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
		isTauri = true;
		import('@tauri-apps/plugin-shell').then(async (mod) => {
			Command = mod.Command;
			try {
				const which = mod.Command.create('sh', ['-l', '-c', 'which appmixer'], { env: {} });
				const result = await which.execute();
				if (result.code === 0 && result.stdout.trim()) {
					resolvedAppmixerPath = result.stdout.trim();
				}
			} catch {
				// ignore
			}
		});
	}

	interface TestCommand {
		exitCode: number;
		cmd: string;
		command?: string;
		stdout: string;
		stderr: string;
		duration?: number;
	}

	interface TestPlanItem {
		name: string;
		completed: boolean;
		status?: string | null;
		result: {
			commands?: TestCommand[];
		};
		ignored?: boolean;
		reason?: string | null;
		description?: string | null;
	}

	interface Props {
		testPlan: TestPlanItem[];
		connectorName: string;
		connectorsDir: string;
		onTestPlanUpdated?: (testPlan: TestPlanItem[]) => void;
		onReloadTestPlan?: () => void;
	}

	let { testPlan, connectorName, connectorsDir, onTestPlanUpdated, onReloadTestPlan }: Props = $props();

	type FilterMode = 'all' | 'passed' | 'failed' | 'pending' | 'ignored';
	let filterMode = $state<FilterMode>('all');
	let expandedTests = $state<Set<string>>(new Set());
	let expandedCommands = $state<Set<string>>(new Set());
	let runningTests = $state<Set<string>>(new Set());
	let runningAll = $state(false);

	// Summary stats
	let stats = $derived.by(() => {
		let passed = 0, failed = 0, pending = 0, ignored = 0;
		for (const item of testPlan) {
			if (item.ignored) { ignored++; continue; }
			if (!item.completed) { pending++; continue; }
			if (item.status === 'passed') passed++;
			else if (item.status === 'failed') failed++;
			else pending++;
		}
		return { passed, failed, pending, ignored, total: testPlan.length };
	});

	// Filtered items
	let filteredItems = $derived.by(() => {
		return testPlan.filter(item => {
			switch (filterMode) {
				case 'passed': return item.completed && item.status === 'passed';
				case 'failed': return item.completed && item.status === 'failed';
				case 'pending': return !item.completed && !item.ignored;
				case 'ignored': return item.ignored === true;
				default: return true;
			}
		});
	});

	function getStatusColor(item: TestPlanItem): string {
		if (item.ignored) return 'muted';
		if (!item.completed) return 'pending';
		if (item.status === 'passed') return 'passed';
		if (item.status === 'failed') return 'failed';
		return 'pending';
	}

	function toggleTest(name: string) {
		const newSet = new Set(expandedTests);
		if (newSet.has(name)) newSet.delete(name);
		else newSet.add(name);
		expandedTests = newSet;
	}

	function toggleCommand(key: string) {
		const newSet = new Set(expandedCommands);
		if (newSet.has(key)) newSet.delete(key);
		else newSet.add(key);
		expandedCommands = newSet;
	}

	function formatDuration(ms: number | undefined): string {
		if (!ms) return '';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	function getDisplayCommand(cmd: TestCommand): string {
		// Use the relative command if available, otherwise the full cmd
		return cmd.command || cmd.cmd;
	}

	// Strip ANSI color codes for clean display
	function stripAnsi(str: string): string {
		return str.replace(/\x1b\[[0-9;]*m/g, '');
	}

	// Extract meaningful output from stdout (skip boilerplate), with max length cap
	function extractOutput(stdout: string, maxLen = 5000): string {
		const clean = stripAnsi(stdout);
		let output: string;
		// Find the actual component output
		const outputMatch = clean.match(/Component has send a message to output port: \w+\n([\s\S]*?)(?:\n\nComponent's receive method|\n\nStopping component|$)/);
		if (outputMatch) {
			output = outputMatch[1].trim();
		} else {
			// If not found, look for error-like content
			const lines = clean.split('\n').filter(l => l.trim());
			const meaningfulStart = lines.findIndex(l =>
				l.includes('Component has send') ||
				l.includes('Error') ||
				l.includes('error') ||
				l.includes('Component\'s receive')
			);
			output = meaningfulStart >= 0
				? lines.slice(meaningfulStart).join('\n')
				: clean;
		}
		if (output.length > maxLen) {
			return output.slice(0, maxLen) + `\n\n… (${output.length - maxLen} more characters)`;
		}
		return output;
	}

	/**
	 * Resolve the full component path from a test plan item.
	 * Strategy: 1) Extract from previous command, 2) Try common modules, 3) Use `find`
	 */
	function resolveComponentPath(item: TestPlanItem): string {
		// Try to extract from a previous command
		if (item.result?.commands?.length) {
			for (const cmd of item.result.commands) {
				const match = (cmd.cmd || '').match(/test component\s+(\S+)/);
				if (match) return match[1];
			}
		}
		// Fallback: <connectorsDir>/src/appmixer/<connector>/core/<Component>
		return `${connectorsDir}/src/appmixer/${connectorName}/core/${item.name}`;
	}

	async function runSingleTest(item: TestPlanItem) {
		if (!isTauri || !Command || !resolvedAppmixerPath) return;

		runningTests = new Set([...runningTests, item.name]);
		const startTime = Date.now();

		try {
			const componentPath = resolveComponentPath(item);

			// Also try to extract inputs from the last command if present
			let inputsArg = '';
			if (item.result?.commands?.length) {
				const lastCmd = item.result.commands[item.result.commands.length - 1];
				const inputMatch = (lastCmd.cmd || '').match(/-i\s+(\{[^}]*\}(?:\})*)/);
				if (inputMatch) {
					inputsArg = ` -i '$APPMIXER_TEST_INPUTS'`;
				}
			}

			const env: Record<string, string> = {};
			if (inputsArg) {
				const lastCmd = item.result!.commands![item.result!.commands!.length - 1];
				const inputMatch = (lastCmd.cmd || '').match(/-i\s+(\{.*\})/);
				if (inputMatch) env.APPMIXER_TEST_INPUTS = inputMatch[1];
			}

			const cmd = Command.create('sh', [
				'-c',
				`"${resolvedAppmixerPath}" test component "${componentPath}"${inputsArg} < /dev/null 2>&1`
			], { env });

			const result = await cmd.execute();
			const duration = Date.now() - startTime;
			const relPath = componentPath.replace(/^.*?(src\/appmixer\/)/, '$1');
			const newCommand: TestCommand = {
				exitCode: result.code ?? 1,
				cmd: `appmixer test component ${componentPath}${inputsArg ? ` -i ${env.APPMIXER_TEST_INPUTS || ''}` : ''}`,
				command: `appmixer test component ${relPath}`,
				stdout: result.stdout || '',
				stderr: result.stderr || '',
				duration
			};

			// Update the test plan item
			const updatedPlan = testPlan.map(t => {
				if (t.name !== item.name) return t;
				const commands = [...(t.result?.commands || []), newCommand];
				return {
					...t,
					completed: true,
					status: result.code === 0 ? 'passed' : 'failed',
					result: { commands },
					reason: result.code !== 0 ? `Exit code ${result.code}` : null,
					description: result.code !== 0 ? stripAnsi(result.stdout || result.stderr || '').slice(0, 500) : null
				};
			});

			onTestPlanUpdated?.(updatedPlan);

			// Auto-expand to show result
			expandedTests = new Set([...expandedTests, item.name]);
		} catch (err) {
			console.error(`Failed to run test for ${item.name}:`, err);
		} finally {
			const newSet = new Set(runningTests);
			newSet.delete(item.name);
			runningTests = newSet;
		}
	}

	async function runAllTests() {
		if (!isTauri || !Command || !resolvedAppmixerPath) return;
		runningAll = true;

		const pendingItems = testPlan.filter(item => !item.ignored);
		for (const item of pendingItems) {
			if (!runningAll) break; // allow stopping
			await runSingleTest(item);
		}

		runningAll = false;
	}

	// ── AI Test Agent ─────────────────────────────────────────────────
	let aiTestRunning = $state<string | null>(null); // component name currently being AI-tested
	let aiTestOutput = $state('');
	let aiTestChildPid = $state<number | null>(null);
	let aiTestShowOutput = $state(false);
	let resolvedNodePath = $state<string | null>(null);
	let resolvedCliDir = $state<string | null>(null);

	// Resolve node and appmixer-cli paths on mount
	if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
		import('@tauri-apps/plugin-shell').then(async (mod) => {
			// Find node
			try {
				const which = mod.Command.create('sh', ['-l', '-c', 'which node'], { env: {} });
				const result = await which.execute();
				if (result.code === 0 && result.stdout.trim()) {
					resolvedNodePath = result.stdout.trim();
				}
			} catch { /* ignore */ }

			// Find appmixer CLI directory (npm root -g + /appmixer)
			try {
				const npmRoot = mod.Command.create('sh', ['-l', '-c', 'npm root -g'], { env: {} });
				const result = await npmRoot.execute();
				if (result.code === 0 && result.stdout.trim()) {
					resolvedCliDir = `${result.stdout.trim()}/appmixer`;
				}
			} catch { /* ignore */ }
		});
	}

	/**
	 * Derive the connectors root directory from connectorsDir.
	 * connectorsDir points to <root>/src/appmixer/ — the agent expects <root>.
	 */
	function getConnectorsRootDir(): string {
		// If connectorsDir ends with src/appmixer or src/appmixer/, strip it
		let dir = connectorsDir.replace(/\/+$/, '');
		if (dir.endsWith('/src/appmixer')) {
			dir = dir.slice(0, -'/src/appmixer'.length);
		}
		return dir;
	}

	async function runAiTest(componentName: string) {
		if (!isTauri || !Command || !resolvedNodePath) return;

		aiTestRunning = componentName;
		aiTestOutput = '';
		aiTestShowOutput = true;

		const connectorsRootDir = getConnectorsRootDir();
		const scriptPath = await getScriptPath();

		if (!scriptPath) {
			aiTestOutput = 'ERROR: Could not find run-ai-test.mjs script\n';
			aiTestRunning = null;
			return;
		}

		const args = [
			'-l', '-c',
			[
				`"${resolvedNodePath}"`,
				`"${scriptPath}"`,
				`--connectorsDir "${connectorsRootDir}"`,
				`--connector "${connectorName}"`,
				`--component "${componentName}"`,
				resolvedCliDir ? `--cliDir "${resolvedCliDir}"` : '',
				'< /dev/null 2>&1'
			].filter(Boolean).join(' ')
		];

		try {
			const cmd = Command.create('sh', args, { env: {} });
			let output = '';

			cmd.stdout.on('data', (line: string) => {
				const trimmed = line.replace(/\n+$/, '');
				if (trimmed) {
					output += trimmed + '\n';
					aiTestOutput = output;
				}
			});

			cmd.stderr.on('data', (line: string) => {
				const trimmed = line.replace(/\n+$/, '');
				if (trimmed) {
					output += '[stderr] ' + trimmed + '\n';
					aiTestOutput = output;
				}
			});

			const child = await cmd.spawn();
			aiTestChildPid = child.pid;

			// Wait for the process to finish
			cmd.on('close', (data: { code: number | null }) => {
				const exitCode = data.code ?? 1;
				const exitLine = `\n[AI-TEST] Process exited with code ${exitCode}\n`;
				aiTestOutput += exitLine;
				aiTestRunning = null;
				aiTestChildPid = null;

				// Reload test plan after AI test completes
				if (exitCode === 0) {
					setTimeout(() => {
						onReloadTestPlan?.();
					}, 500);
				}
			});

			cmd.on('error', (err: string) => {
				aiTestOutput += `\n[AI-TEST] Error: ${err}\n`;
				aiTestRunning = null;
				aiTestChildPid = null;
			});
		} catch (err) {
			aiTestOutput += `\nFailed to spawn AI test: ${err}\n`;
			aiTestRunning = null;
			aiTestChildPid = null;
		}
	}

	async function stopAiTest() {
		if (aiTestChildPid && Command) {
			try {
				const killCmd = Command.create('sh', ['-c', `kill -9 -${aiTestChildPid} 2>/dev/null; kill -9 ${aiTestChildPid} 2>/dev/null`], { env: {} });
				await killCmd.execute();
			} catch {
				// best effort
			}
			aiTestRunning = null;
			aiTestChildPid = null;
			aiTestOutput += '\n[AI-TEST] Stopped by user\n';
		}
	}

	async function getScriptPath(): Promise<string | null> {
		if (!Command) return null;
		// Try to find the script relative to the app
		// In dev, it's at the project root scripts/run-ai-test.mjs
		// In production, it would be bundled differently
		const candidates = [
			// Dev path (relative to where the Tauri app runs from)
			'scripts/run-ai-test.mjs',
			'../scripts/run-ai-test.mjs'
		];

		// Use __dirname-like resolution via Tauri
		try {
			const findCmd = Command.create('sh', ['-l', '-c',
				`for p in scripts/run-ai-test.mjs ../scripts/run-ai-test.mjs; do [ -f "$p" ] && echo "$(cd "$(dirname "$p")" && pwd)/$(basename "$p")" && exit 0; done; echo ""`
			], { env: {} });
			const result = await findCmd.execute();
			const found = result.stdout.trim();
			if (found) return found;
		} catch { /* ignore */ }

		// Fallback: use a fixed path based on app location
		try {
			const resourceCmd = Command.create('sh', ['-l', '-c', 'echo $PWD'], { env: {} });
			const result = await resourceCmd.execute();
			const pwd = result.stdout.trim();
			if (pwd) {
				return `${pwd}/scripts/run-ai-test.mjs`;
			}
		} catch { /* ignore */ }

		return null;
	}

	// Auto-scroll directive: scrolls element to bottom whenever the bound value changes
	function autoScroll(node: HTMLElement, _value: string) {
		node.scrollTop = node.scrollHeight;
		return {
			update() {
				node.scrollTop = node.scrollHeight;
			}
		};
	}

	// ── Resizable AI output panel ────────────────────────────────────
	const AI_PANEL_STORAGE_KEY = 'ai-test-panel-height';
	const AI_PANEL_MIN = 150;
	const AI_PANEL_DEFAULT = 500;

	let aiPanelHeight = $state(AI_PANEL_DEFAULT);
	let isResizing = $state(false);
	let aiPopupWindow = $state<Window | null>(null);

	// Restore saved height
	if (typeof window !== 'undefined') {
		try {
			const saved = localStorage.getItem(AI_PANEL_STORAGE_KEY);
			if (saved) aiPanelHeight = Math.max(AI_PANEL_MIN, parseInt(saved, 10));
		} catch { /* ignore */ }
	}

	function onResizeStart(e: MouseEvent) {
		e.preventDefault();
		isResizing = true;
		const startY = e.clientY;
		const startHeight = aiPanelHeight;

		function onMove(ev: MouseEvent) {
			const delta = startY - ev.clientY;
			aiPanelHeight = Math.max(AI_PANEL_MIN, startHeight + delta);
		}

		function onUp() {
			isResizing = false;
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			try { localStorage.setItem(AI_PANEL_STORAGE_KEY, String(aiPanelHeight)); } catch { /* */ }
		}

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	// ── Popup window ─────────────────────────────────────────────────
	function openPopup() {
		if (aiPopupWindow && !aiPopupWindow.closed) {
			aiPopupWindow.focus();
			updatePopupContent();
			return;
		}

		const w = 900;
		const h = 700;
		const left = (screen.width - w) / 2;
		const top = (screen.height - h) / 2;
		const popup = window.open('', 'ai-test-output', `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
		if (!popup) return;

		aiPopupWindow = popup;
		popup.document.write(getPopupHtml());
		popup.document.close();
		updatePopupContent();

		// Keep syncing output
		const interval = setInterval(() => {
			if (popup.closed) {
				aiPopupWindow = null;
				clearInterval(interval);
				return;
			}
			updatePopupContent();
		}, 300);

		popup.addEventListener('beforeunload', () => {
			aiPopupWindow = null;
			clearInterval(interval);
		});
	}

	function getPopupHtml(): string {
		// Note: we split closing tags to avoid Svelte parser issues
		const closeStyle = '<' + '/style>';
		const closeScript = '<' + '/script>';
		return '<!DOCTYPE html>'
			+ '<html><head><title>AI Test Agent</title>'
			+ '<style>'
			+ '* { margin: 0; padding: 0; box-sizing: border-box; }'
			+ 'body { background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; flex-direction: column; height: 100vh; }'
			+ '.header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: #161b22; border-bottom: 1px solid #30363d; flex-shrink: 0; }'
			+ '.header-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }'
			+ '.header-title .dot { width: 8px; height: 8px; border-radius: 50%; }'
			+ '.dot.running { background: #f59e0b; animation: pulse 1.5s ease-in-out infinite; }'
			+ '.dot.done { background: #22c55e; }'
			+ '.badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: #21262d; border: 1px solid #30363d; }'
			+ 'pre { flex: 1; overflow-y: auto; padding: 12px 16px; font-family: "SF Mono", "Fira Code", monospace; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }'
			+ '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }'
			+ closeStyle + '</head>'
			+ '<body>'
			+ '<div class="header"><div class="header-title">'
			+ '<span class="dot" id="status-dot"></span>'
			+ '<span>AI Test Agent</span>'
			+ '<span class="badge" id="status-badge"></span>'
			+ '</div></div>'
			+ '<pre id="output"></pre>'
			+ closeScript
			+ '</body></html>';
	}

	function updatePopupContent() {
		if (!aiPopupWindow || aiPopupWindow.closed) return;
		const doc = aiPopupWindow.document;
		const outputEl = doc.getElementById('output');
		const dotEl = doc.getElementById('status-dot');
		const badgeEl = doc.getElementById('status-badge');

		if (outputEl) {
			const wasAtBottom = outputEl.scrollHeight - outputEl.scrollTop - outputEl.clientHeight < 40;
			outputEl.textContent = stripAnsi(aiTestOutput);
			if (wasAtBottom) outputEl.scrollTop = outputEl.scrollHeight;
		}
		if (dotEl) {
			dotEl.className = aiTestRunning ? 'dot running' : 'dot done';
		}
		if (badgeEl) {
			badgeEl.textContent = aiTestRunning || 'done';
		}
	}

	let authStatus = $state<'idle' | 'checking' | 'valid' | 'invalid'>('idle');

	async function refreshAuth() {
		if (!isTauri || !Command || !resolvedAppmixerPath) return;

		authStatus = 'checking';
		try {
			const authPath = `${connectorsDir}/${connectorName}/auth.js`;
			const cmd = Command.create('sh', [
				'-c',
				`"${resolvedAppmixerPath}" test auth refresh "${authPath}" < /dev/null 2>&1`
			], { env: {} });

			const result = await cmd.execute();
			authStatus = result.code === 0 ? 'valid' : 'invalid';

			if (result.code !== 0) {
				console.warn(`Auth refresh failed for ${connectorName}:`, result.stdout, result.stderr);
			}

			// Reset status after a few seconds
			setTimeout(() => { authStatus = 'idle'; }, 4000);
		} catch (err) {
			authStatus = 'invalid';
			console.error('Auth refresh failed:', err);
			setTimeout(() => { authStatus = 'idle'; }, 4000);
		}
	}
</script>

<div class="test-plan-viewer">
	<!-- Header -->
	<div class="tp-header">
		<div class="tp-header-left">
			<Terminal class="h-4 w-4" />
			<span class="tp-title">Test Plan</span>
			<Badge variant="outline" class="tp-connector-badge">{connectorName}</Badge>
		</div>
		<div class="tp-header-right">
			{#if isTauri}
				<Button
					variant={authStatus === 'valid' ? 'outline' : authStatus === 'invalid' ? 'destructive' : 'outline'}
					size="sm"
					onclick={refreshAuth}
					disabled={authStatus === 'checking' || !resolvedAppmixerPath}
					title="Refresh authentication"
				>
					{#if authStatus === 'checking'}
						<Loader2 class="h-3.5 w-3.5 mr-1 spinning" />
						Refreshing...
					{:else if authStatus === 'valid'}
						<CheckCircle2 class="h-3.5 w-3.5 mr-1" />
						Auth OK
					{:else if authStatus === 'invalid'}
						<XCircle class="h-3.5 w-3.5 mr-1" />
						Auth Failed
					{:else}
						<AlertTriangle class="h-3.5 w-3.5 mr-1" />
						Refresh Auth
					{/if}
				</Button>
				<Button
					variant="default"
					size="sm"
					onclick={runAllTests}
					disabled={runningAll || !resolvedAppmixerPath}
				>
					{#if runningAll}
						<Loader2 class="h-3.5 w-3.5 mr-1 spinning" />
						Running...
					{:else}
						<Play class="h-3.5 w-3.5 mr-1" />
						Run All
					{/if}
				</Button>
				{#if aiTestShowOutput}
					<Button
						variant="ghost"
						size="sm"
						onclick={() => aiTestShowOutput = false}
						title="Hide AI output"
					>
						<ChevronDown class="h-3.5 w-3.5" />
					</Button>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Summary bar -->
	<div class="tp-summary">
		<button
			class="tp-stat {filterMode === 'all' ? 'active' : ''}"
			onclick={() => filterMode = 'all'}
		>
			<span class="tp-stat-count">{stats.total}</span>
			<span class="tp-stat-label">Total</span>
		</button>
		<button
			class="tp-stat passed {filterMode === 'passed' ? 'active' : ''}"
			onclick={() => filterMode = 'passed'}
		>
			<CheckCircle2 class="h-3.5 w-3.5" />
			<span class="tp-stat-count">{stats.passed}</span>
			<span class="tp-stat-label">Passed</span>
		</button>
		<button
			class="tp-stat failed {filterMode === 'failed' ? 'active' : ''}"
			onclick={() => filterMode = 'failed'}
		>
			<XCircle class="h-3.5 w-3.5" />
			<span class="tp-stat-count">{stats.failed}</span>
			<span class="tp-stat-label">Failed</span>
		</button>
		<button
			class="tp-stat pending {filterMode === 'pending' ? 'active' : ''}"
			onclick={() => filterMode = 'pending'}
		>
			<Clock class="h-3.5 w-3.5" />
			<span class="tp-stat-count">{stats.pending}</span>
			<span class="tp-stat-label">Pending</span>
		</button>
		{#if stats.ignored > 0}
			<button
				class="tp-stat ignored {filterMode === 'ignored' ? 'active' : ''}"
				onclick={() => filterMode = 'ignored'}
			>
				<SkipForward class="h-3.5 w-3.5" />
				<span class="tp-stat-count">{stats.ignored}</span>
				<span class="tp-stat-label">Ignored</span>
			</button>
		{/if}
	</div>

	<!-- Progress bar -->
	<div class="tp-progress-bar">
		{#if stats.total > 0}
			<div class="tp-progress-passed" style="width: {(stats.passed / stats.total) * 100}%"></div>
			<div class="tp-progress-failed" style="width: {(stats.failed / stats.total) * 100}%"></div>
		{/if}
	</div>

	<!-- AI Test Output Panel -->
	{#if aiTestShowOutput && (aiTestOutput || aiTestRunning)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="tp-ai-resize-handle" onmousedown={onResizeStart}></div>
		<div class="tp-ai-output-panel" style="height: {aiPanelHeight}px">
			<div class="tp-ai-output-header">
				<div class="tp-ai-output-title">
					<Sparkles class="h-3.5 w-3.5" />
					<span>AI Test Agent</span>
					{#if aiTestRunning}
						<Badge variant="secondary" class="tp-ai-badge">
							<Loader2 class="h-3 w-3 spinning" />
							{aiTestRunning}
						</Badge>
					{:else}
						<Badge variant="outline" class="tp-ai-badge">done</Badge>
					{/if}
				</div>
				<div class="tp-ai-output-actions">
					{#if aiTestRunning}
						<Button variant="destructive" size="sm" onclick={stopAiTest} title="Stop AI test">
							<Square class="h-3 w-3 mr-1" />
							Stop
						</Button>
					{/if}
					<Button variant="ghost" size="sm" onclick={openPopup} title="Open in popup window" class="tp-popup-btn">
						<ExternalLink class="h-3.5 w-3.5" />
					</Button>
					<Button variant="ghost" size="sm" onclick={() => { aiTestShowOutput = false; aiTestOutput = ''; }} title="Close">
						<XCircle class="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
			<pre class="tp-ai-output-pre" use:autoScroll={aiTestOutput}>{stripAnsi(aiTestOutput)}</pre>
		</div>
	{/if}

	<!-- Test list -->
	<div class="tp-list">
		{#if filteredItems.length === 0}
			<div class="tp-empty">
				<Filter class="h-5 w-5" />
				<span>No tests match the current filter</span>
			</div>
		{:else}
			{#each filteredItems as item (item.name)}
				{@const statusColor = getStatusColor(item)}
				{@const isExpanded = expandedTests.has(item.name)}
				{@const isRunning = runningTests.has(item.name)}
				<div class="tp-item {statusColor}">
					<!-- Test header -->
					<button class="tp-item-header" onclick={() => toggleTest(item.name)}>
						<div class="tp-item-left">
							{#if isExpanded}
								<ChevronDown class="h-3.5 w-3.5 tp-chevron" />
							{:else}
								<ChevronRight class="h-3.5 w-3.5 tp-chevron" />
							{/if}
							{#if isRunning}
								<Loader2 class="h-4 w-4 spinning tp-status-icon running" />
							{:else if item.status === 'passed'}
								<CheckCircle2 class="h-4 w-4 tp-status-icon passed" />
							{:else if item.status === 'failed'}
								<XCircle class="h-4 w-4 tp-status-icon failed" />
							{:else if item.ignored}
								<SkipForward class="h-4 w-4 tp-status-icon muted" />
							{:else}
								<Clock class="h-4 w-4 tp-status-icon pending" />
							{/if}
							<span class="tp-item-name">{item.name}</span>
						</div>
						<div class="tp-item-right">
							{#if item.completed && item.result?.commands?.length}
								<span class="tp-cmd-count">{item.result.commands.length} run{item.result.commands.length !== 1 ? 's' : ''}</span>
							{/if}
							{#if item.completed && item.status}
								<Badge variant={item.status === 'passed' ? 'default' : 'destructive'} class="tp-status-badge">
									{item.status}
								</Badge>
							{:else if item.ignored}
								<Badge variant="secondary" class="tp-status-badge">ignored</Badge>
							{:else}
								<Badge variant="outline" class="tp-status-badge">pending</Badge>
							{/if}
							{#if isTauri && !item.ignored}
								<Button
									variant="ghost"
									size="sm"
									class="tp-run-btn"
									onclick={(e: MouseEvent) => { e.stopPropagation(); runSingleTest(item); }}
									disabled={isRunning || !resolvedAppmixerPath}
									title="Run test"
								>
									{#if isRunning}
										<Loader2 class="h-3.5 w-3.5 spinning" />
									{:else}
										<Play class="h-3.5 w-3.5" />
									{/if}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									class="tp-run-btn tp-ai-btn"
									onclick={(e: MouseEvent) => { e.stopPropagation(); runAiTest(item.name); }}
									disabled={aiTestRunning !== null || !resolvedNodePath}
									title="Run AI-powered test (LangGraph agent)"
								>
									{#if aiTestRunning === item.name}
										<Loader2 class="h-3.5 w-3.5 spinning" />
									{:else}
										<Bot class="h-3.5 w-3.5" />
									{/if}
								</Button>
							{/if}
						</div>
					</button>

					<!-- Expanded detail -->
					{#if isExpanded}
						<div class="tp-item-detail">
							<!-- Failure reason -->
							{#if item.reason}
								<div class="tp-reason">
									<AlertTriangle class="h-3.5 w-3.5" />
									<span>{item.reason}</span>
								</div>
							{/if}

							<!-- Failure description -->
							{#if item.description}
								<div class="tp-description">{item.description}</div>
							{/if}

							<!-- Commands -->
							{#if item.result?.commands && item.result.commands.length > 0}
								<div class="tp-commands">
									{#each item.result.commands as cmd, ci}
										{@const cmdKey = `${item.name}-${ci}`}
										{@const isCmdExpanded = expandedCommands.has(cmdKey)}
										<div class="tp-cmd {cmd.exitCode === 0 ? 'success' : 'error'}">
											<button class="tp-cmd-header" onclick={() => toggleCommand(cmdKey)}>
												<div class="tp-cmd-left">
													{#if isCmdExpanded}
														<ChevronDown class="h-3 w-3" />
													{:else}
														<ChevronRight class="h-3 w-3" />
													{/if}
													<span class="tp-cmd-exit {cmd.exitCode === 0 ? 'success' : 'error'}">
														{cmd.exitCode === 0 ? '✓' : '✗'}
													</span>
													<code class="tp-cmd-text">{getDisplayCommand(cmd)}</code>
												</div>
												<div class="tp-cmd-right">
													{#if cmd.duration}
														<span class="tp-cmd-duration">{formatDuration(cmd.duration)}</span>
													{/if}
													<span class="tp-cmd-exit-code">exit {cmd.exitCode}</span>
												</div>
											</button>

											{#if isCmdExpanded}
												<div class="tp-cmd-output">
													{#if cmd.stdout}
														<div class="tp-output-section">
															<div class="tp-output-label">stdout</div>
															<pre class="tp-output-pre">{extractOutput(cmd.stdout)}</pre>
														</div>
													{/if}
													{#if cmd.stderr}
														<div class="tp-output-section">
															<div class="tp-output-label stderr">stderr</div>
															<pre class="tp-output-pre stderr">{stripAnsi(cmd.stderr)}</pre>
														</div>
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{:else if !item.completed}
								<div class="tp-no-runs">No test runs yet</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.test-plan-viewer {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--color-card);
		overflow: hidden;
	}

	/* Header */
	.tp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 16px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-muted);
		flex-shrink: 0;
	}

	.tp-header-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.tp-title {
		font-size: 13px;
		font-weight: 600;
	}

	:global(.tp-connector-badge) {
		font-size: 10px;
		font-family: monospace;
	}

	.tp-header-right {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	/* Summary */
	.tp-summary {
		display: flex;
		gap: 2px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.tp-stat {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		border-radius: var(--radius-md);
		font-size: 12px;
		cursor: pointer;
		border: 1px solid transparent;
		background: transparent;
		color: var(--color-muted-foreground);
		transition: all 0.15s ease;
	}

	.tp-stat:hover {
		background: var(--color-muted);
	}

	.tp-stat.active {
		background: var(--color-accent);
		border-color: var(--color-border);
		color: var(--color-foreground);
	}

	.tp-stat-count {
		font-weight: 600;
	}

	.tp-stat-label {
		font-size: 11px;
	}

	.tp-stat.passed :global(svg) { color: #22c55e; }
	.tp-stat.failed :global(svg) { color: #ef4444; }
	.tp-stat.pending :global(svg) { color: #f59e0b; }
	.tp-stat.ignored :global(svg) { color: var(--color-muted-foreground); }

	/* Progress bar */
	.tp-progress-bar {
		height: 3px;
		display: flex;
		background: var(--color-muted);
		flex-shrink: 0;
	}

	.tp-progress-passed {
		background: #22c55e;
		transition: width 0.3s ease;
	}

	.tp-progress-failed {
		background: #ef4444;
		transition: width 0.3s ease;
	}

	/* Test list */
	.tp-list {
		flex: 1;
		overflow-y: auto;
		padding: 4px 0;
	}

	.tp-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 40px 20px;
		color: var(--color-muted-foreground);
		font-size: 13px;
	}

	/* Test item */
	.tp-item {
		border-bottom: 1px solid var(--color-border);
	}

	.tp-item:last-child {
		border-bottom: none;
	}

	.tp-item-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 8px 12px;
		border: none;
		background: transparent;
		cursor: pointer;
		font-size: 13px;
		color: var(--color-foreground);
		text-align: left;
		gap: 8px;
	}

	.tp-item-header:hover {
		background: var(--color-muted);
	}

	.tp-item-left {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 1;
	}

	:global(.tp-chevron) {
		flex-shrink: 0;
		color: var(--color-muted-foreground);
	}

	:global(.tp-status-icon.passed) { color: #22c55e; }
	:global(.tp-status-icon.failed) { color: #ef4444; }
	:global(.tp-status-icon.pending) { color: #f59e0b; }
	:global(.tp-status-icon.muted) { color: var(--color-muted-foreground); }
	:global(.tp-status-icon.running) { color: #3b82f6; }

	.tp-item-name {
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tp-item-right {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.tp-cmd-count {
		font-size: 11px;
		color: var(--color-muted-foreground);
	}

	:global(.tp-status-badge) {
		font-size: 10px;
		height: 18px;
		padding: 0 6px;
	}

	:global(.tp-run-btn) {
		padding: 2px 6px !important;
		height: 24px !important;
	}

	/* Expanded detail */
	.tp-item-detail {
		padding: 0 12px 12px 36px;
	}

	.tp-reason {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 8px 10px;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: var(--radius-md);
		font-size: 12px;
		color: #b91c1c;
		margin-bottom: 8px;
	}

	.tp-reason :global(svg) { flex-shrink: 0; margin-top: 1px; }

	.tp-description {
		font-size: 11px;
		color: var(--color-muted-foreground);
		line-height: 1.5;
		padding: 8px 10px;
		background: var(--color-muted);
		border-radius: var(--radius-md);
		margin-bottom: 8px;
		max-height: 120px;
		overflow-y: auto;
	}

	/* Commands list */
	.tp-commands {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.tp-cmd {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--color-background);
	}

	.tp-cmd.success {
		border-left: 3px solid #22c55e;
	}

	.tp-cmd.error {
		border-left: 3px solid #ef4444;
	}

	.tp-cmd-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 6px 8px;
		border: none;
		background: transparent;
		cursor: pointer;
		font-size: 11px;
		color: var(--color-foreground);
		text-align: left;
		gap: 6px;
	}

	.tp-cmd-header:hover {
		background: var(--color-muted);
	}

	.tp-cmd-left {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		flex: 1;
	}

	.tp-cmd-exit {
		font-weight: 700;
		font-size: 12px;
		flex-shrink: 0;
	}

	.tp-cmd-exit.success { color: #22c55e; }
	.tp-cmd-exit.error { color: #ef4444; }

	.tp-cmd-text {
		font-family: monospace;
		font-size: 10px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--color-muted-foreground);
	}

	.tp-cmd-right {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.tp-cmd-duration {
		font-size: 10px;
		color: var(--color-muted-foreground);
		font-family: monospace;
	}

	.tp-cmd-exit-code {
		font-size: 10px;
		font-family: monospace;
		color: var(--color-muted-foreground);
	}

	/* Command output */
	.tp-cmd-output {
		border-top: 1px solid var(--color-border);
	}

	.tp-output-section {
		padding: 0;
	}

	.tp-output-label {
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 4px 8px 2px;
		color: var(--color-muted-foreground);
	}

	.tp-output-label.stderr {
		color: #ef4444;
	}

	.tp-output-pre {
		font-family: monospace;
		font-size: 10px;
		line-height: 1.4;
		padding: 4px 8px 8px;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 300px;
		overflow-y: auto;
		background: #0d1117;
		color: #c9d1d9;
	}

	.tp-output-pre.stderr {
		color: #f87171;
		background: #1a0000;
	}

	.tp-no-runs {
		font-size: 12px;
		color: var(--color-muted-foreground);
		font-style: italic;
		padding: 8px 0;
	}

	/* AI Test Button */
	:global(.tp-ai-btn svg) {
		color: #8b5cf6;
	}

	:global(.tp-ai-btn:hover svg) {
		color: #7c3aed;
	}

	/* AI Resize Handle */
	.tp-ai-resize-handle {
		height: 5px;
		cursor: ns-resize;
		background: #161b22;
		border-bottom: 1px solid #30363d;
		flex-shrink: 0;
		position: relative;
	}

	.tp-ai-resize-handle::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: 32px;
		height: 3px;
		border-radius: 2px;
		background: #484f58;
	}

	.tp-ai-resize-handle:hover,
	.tp-ai-resize-handle:active {
		background: #1f2937;
	}

	.tp-ai-resize-handle:hover::after,
	.tp-ai-resize-handle:active::after {
		background: #8b949e;
	}

	/* AI Output Panel */
	.tp-ai-output-panel {
		flex-shrink: 0;
		min-height: 150px;
		background: #0d1117;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.tp-ai-output-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 10px;
		background: #161b22;
		border-bottom: 1px solid #30363d;
		flex-shrink: 0;
	}

	.tp-ai-output-title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 600;
		color: #c9d1d9;
	}

	.tp-ai-output-title :global(svg) {
		color: #8b5cf6;
	}

	:global(.tp-ai-badge) {
		font-size: 9px;
		height: 18px;
		gap: 4px;
	}

	.tp-ai-output-actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	:global(.tp-popup-btn) {
		color: #8b949e !important;
	}

	:global(.tp-popup-btn:hover) {
		color: #c9d1d9 !important;
	}

	.tp-ai-output-pre {
		font-family: monospace;
		font-size: 10px;
		line-height: 1.5;
		padding: 8px 10px;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-y: auto;
		color: #c9d1d9;
		flex: 1;
	}

	:global(.spinning) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
</style>
