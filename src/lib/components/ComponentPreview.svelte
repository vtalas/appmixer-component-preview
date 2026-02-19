<script>
	import * as Tabs from '$lib/components/ui/tabs';
	import InputsTab from './InputsTab.svelte';
	import PropertiesTab from './PropertiesTab.svelte';
	import OutputsTab from './OutputsTab.svelte';
	import ComponentJsonTab from './ComponentJsonTab.svelte';
	import { createCommandRunner, stripAnsi } from '$lib/utils/commandRunner.svelte.js';

	let {
		componentJson, onInspectorInputChange, onRequiredChange, onTypeChange,
		onOptionsChange, onFieldsChange, onSourceChange, onJsonChange,
		componentPath = '', connectorsDir = '',
		testPlanData = null, onTestPlanUpdated
	} = $props();

	let hasProperties = $derived(
		componentJson.properties?.inspector || componentJson.properties?.schema
	);
	let hasInPorts = $derived(componentJson.inPorts && componentJson.inPorts.length > 0);
	let hasOutPorts = $derived(componentJson.outPorts && componentJson.outPorts.length > 0);

	// Default tab
	let defaultTab = $derived(hasInPorts ? 'inputs' : hasProperties ? 'properties' : 'outputs');

	// Component name is the last segment of the path (e.g. "CreateFolder")
	let componentName = $derived(componentPath.split('/').pop() || '');

	// Find this component's test results from the test plan
	let componentTestItem = $derived.by(() => {
		if (!testPlanData || !Array.isArray(testPlanData) || !componentName) return null;
		return testPlanData.find(item => item.name === componentName) || null;
	});

	let testResults = $derived(componentTestItem?.result?.commands || []);

	// ── CLI Test Runner ─────────────────────────────────────────────────
	let testRunning = $state(false);
	let propertyValues = $state({});
	let runningCommand = $state(null);

	const runner = createCommandRunner({
		isRunning: () => testRunning,
		statusLabel: () => componentName || 'Test'
	});

	function handlePropertyValueChange(key, value) {
		propertyValues[key] = value;
	}

	// ── Test plan helpers ───────────────────────────────────────────────

	function updateTestPlanItem(updater) {
		const plan = testPlanData && Array.isArray(testPlanData) ? [...testPlanData] : [];
		const idx = plan.findIndex(item => item.name === componentName);
		if (idx >= 0) {
			plan[idx] = updater(plan[idx]);
		}
		onTestPlanUpdated?.(plan);
	}

	function recalcStatus(item, commands) {
		if (commands.length === 0) {
			return { ...item, completed: false, status: null, result: { commands }, reason: null, description: null };
		}
		const lastCmd = commands[commands.length - 1];
		const passed = lastCmd.exitCode === 0;
		return {
			...item,
			completed: true,
			status: passed ? 'passed' : 'failed',
			result: { commands },
			reason: passed ? null : `Exit code ${lastCmd.exitCode}`,
			description: passed ? null : stripAnsi(lastCmd.stdout || lastCmd.stderr || '').slice(0, 500)
		};
	}

	function updateTestPlan(newCommand) {
		const plan = testPlanData && Array.isArray(testPlanData) ? [...testPlanData] : [];

		const idx = plan.findIndex(item => item.name === componentName);
		if (idx >= 0) {
			const existing = plan[idx];
			const commands = [...(existing.result?.commands || []), newCommand];
			plan[idx] = recalcStatus(existing, commands);
		} else {
			plan.push(recalcStatus(
				{ name: componentName },
				[newCommand]
			));
		}

		onTestPlanUpdated?.(plan);
	}

	// ── JSON helpers ────────────────────────────────────────────────────

	function extractInputJsonRange(cmdStr) {
		const flagMatch = cmdStr.match(/-i\s+'?/);
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

	// ── Run test ────────────────────────────────────────────────────────

	async function runTest({ portValues, tickPeriod }) {
		testRunning = true;
		runner.output = '';

		const fullPath = `${connectorsDir}/${componentPath}`;
		const startTime = Date.now();

		// Build -i flag: { "portName": { ...values } }
		const inputObj = {};
		for (const [port, values] of Object.entries(portValues)) {
			const filtered = {};
			for (const [k, v] of Object.entries(values)) {
				if (v !== '' && v !== undefined && v !== null) {
					filtered[k] = v;
				}
			}
			if (Object.keys(filtered).length > 0) {
				inputObj[port] = filtered;
			}
		}

		// Build -p flag from property values collected via PropertiesTab
		const filteredProps = {};
		for (const [k, v] of Object.entries(propertyValues)) {
			if (v !== '' && v !== undefined && v !== null) {
				filteredProps[k] = v;
			}
		}

		let args = '';
		let inputsJson = '';
		let propsJson = '';
		if (Object.keys(inputObj).length > 0) {
			inputsJson = JSON.stringify(inputObj);
			args += ` -i '${inputsJson}'`;
		}
		if (Object.keys(filteredProps).length > 0) {
			propsJson = JSON.stringify(filteredProps);
			args += ` -p '${propsJson}'`;
		}
		if (tickPeriod && tickPeriod.trim()) {
			args += ` -t ${tickPeriod.trim()}`;
		}

		const shellCmd = `appmixer test component "${fullPath}"${args} < /dev/null 2>&1`;
		const relPath = componentPath.replace(/^.*?(src\/appmixer\/)/, 'src/appmixer/');

		try {
			const { stdout, stderr, exitCode } = await runner.run(shellCmd, { label: 'TEST' });
			const duration = Date.now() - startTime;

			// Build command record matching the test-plan.json format
			const newCommand = {
				exitCode,
				cmd: `appmixer test component ${fullPath}${inputsJson ? ` -i ${inputsJson}` : ''}${propsJson ? ` -p ${propsJson}` : ''}`,
				command: `appmixer test component ${relPath}`,
				stdout,
				stderr,
				duration
			};

			updateTestPlan(newCommand);
		} catch (err) {
			if (!(err instanceof Error && err.name === 'AbortError')) {
				runner.appendOutput(`\nFailed: ${err}\n`);
			}
		} finally {
			testRunning = false;
		}
	}

	function stopTest() {
		runner.stop();
		testRunning = false;
	}

	// ── Re-run command ──────────────────────────────────────────────────

	async function rerunCommand(cmdIndex) {
		const srcCmd = testResults[cmdIndex];
		if (!srcCmd) return;

		const fullCmd = srcCmd.cmd || srcCmd.command || '';
		if (!fullCmd) return;

		const startTime = Date.now();

		// Create a new "running" command entry and append it immediately
		const newCommand = {
			exitCode: null,
			cmd: srcCmd.cmd,
			command: srcCmd.command,
			stdout: '',
			stderr: '',
			duration: null
		};

		// Append running entry
		const plan = testPlanData && Array.isArray(testPlanData) ? [...testPlanData] : [];
		const idx = plan.findIndex(item => item.name === componentName);
		let newCmdIndex;
		if (idx >= 0) {
			const existing = plan[idx];
			const commands = [...(existing.result?.commands || []), newCommand];
			newCmdIndex = commands.length - 1;
			plan[idx] = { ...existing, result: { commands } };
		}
		onTestPlanUpdated?.(plan);

		const cmdKey = `cmd-${newCmdIndex}`;
		runningCommand = cmdKey;

		let accStdout = '';
		let accStderr = '';

		try {
			let shellCmd = fullCmd;
			// Wrap -i JSON in quotes for shell
			shellCmd = shellCmd.replace(/-i\s+(\{.*\})/, (_, json) => `-i '${json}'`);

			const { stdout, stderr, exitCode } = await runner.run(`${shellCmd} < /dev/null 2>&1`, {
				label: 'RE-RUN',
				onData: (text, type) => {
					if (type === 'stderr') { accStderr += text; } else { accStdout += text; }
					// Live-update the running command entry
					updateTestPlanItem(item => {
						const commands = [...(item.result?.commands || [])];
						if (commands[newCmdIndex]) {
							commands[newCmdIndex] = { ...commands[newCmdIndex], stdout: accStdout, stderr: accStderr };
						}
						return { ...item, result: { commands } };
					});
				}
			});

			const duration = Date.now() - startTime;

			updateTestPlanItem(item => {
				const commands = [...(item.result?.commands || [])];
				commands[newCmdIndex] = { ...commands[newCmdIndex], exitCode, stdout, stderr, duration };
				return recalcStatus(item, commands);
			});
		} catch (err) {
			if (!(err instanceof Error && err.name === 'AbortError')) {
				updateTestPlanItem(item => {
					const commands = [...(item.result?.commands || [])];
					if (commands[newCmdIndex]) {
						commands[newCmdIndex] = {
							...commands[newCmdIndex],
							exitCode: 1,
							stderr: `Error: ${err}`,
							duration: Date.now() - startTime
						};
					}
					return recalcStatus(item, commands);
				});
			}
		} finally {
			runningCommand = null;
		}
	}

	// ── Delete command ──────────────────────────────────────────────────

	function deleteCommand(cmdIndex) {
		updateTestPlanItem(item => {
			const commands = [...(item.result?.commands || [])];
			commands.splice(cmdIndex, 1);
			return recalcStatus(item, commands);
		});
	}

	// ── Edit command (-i JSON) ──────────────────────────────────────────

	function editCommand(cmdIndex, newInputJson) {
		let compacted;
		try {
			compacted = JSON.stringify(JSON.parse(newInputJson));
		} catch {
			return;
		}

		updateTestPlanItem(item => {
			const commands = [...(item.result?.commands || [])];
			const cmd = commands[cmdIndex];
			if (!cmd) return item;

			const replaceJson = (str) => {
				if (!str) return str;
				const range = extractInputJsonRange(str);
				if (range) {
					let end = range.end;
					if (str[end] === "'") end++;
					return str.slice(0, range.flagStart) + `-i ${compacted}` + str.slice(end);
				}
				return `${str} -i ${compacted}`;
			};

			commands[cmdIndex] = {
				...cmd,
				cmd: replaceJson(cmd.cmd),
				command: replaceJson(cmd.command)
			};
			return { ...item, result: { commands } };
		});
	}

	// ── Show output in popup ────────────────────────────────────────────

	function showInPopup(cmdIndex) {
		const cmd = testResults[cmdIndex];
		if (!cmd) return;
		let text = '';
		if (cmd.cmd || cmd.command) {
			text += `$ ${cmd.cmd || cmd.command}\n\n`;
		}
		if (cmd.stdout) text += cmd.stdout;
		if (cmd.stderr) text += (text ? '\n' : '') + cmd.stderr;
		runner.output = text;
		runner.openPopup();
	}
</script>

<div class="component-editor">
	<Tabs.Root value={defaultTab} class="tabs-root">
		<Tabs.List class="editor-tabs">
			{#if hasInPorts}
				<Tabs.Trigger value="inputs">Inputs</Tabs.Trigger>
			{/if}
			{#if hasProperties}
				<Tabs.Trigger value="properties">Properties</Tabs.Trigger>
			{/if}
			{#if hasOutPorts}
				<Tabs.Trigger value="outputs">Outputs</Tabs.Trigger>
			{/if}
			<Tabs.Trigger value="component-json">Component JSON</Tabs.Trigger>
		</Tabs.List>

		{#if hasInPorts}
			<Tabs.Content value="inputs" class="editor-content">
				<InputsTab
					{componentJson}
					{onInspectorInputChange}
					{onRequiredChange}
					{onTypeChange}
					{onOptionsChange}
					{onFieldsChange}
					{onSourceChange}
					onRunTest={runTest}
					onStopTest={stopTest}
					{testRunning}
					hasTick={!!componentJson.tick}
					{testResults}
					onRerunCommand={rerunCommand}
					onDeleteCommand={deleteCommand}
					onEditCommand={editCommand}
					onShowInPopup={showInPopup}
					{runningCommand}
				/>
			</Tabs.Content>
		{/if}

		{#if hasProperties}
			<Tabs.Content value="properties" class="editor-content">
				<PropertiesTab
					{componentJson}
					{onInspectorInputChange}
					{onRequiredChange}
					{onTypeChange}
					{onOptionsChange}
					{onFieldsChange}
					{onSourceChange}
					onFormValueChange={handlePropertyValueChange}
				/>
			</Tabs.Content>
		{/if}

		{#if hasOutPorts}
			<Tabs.Content value="outputs" class="editor-content">
				<OutputsTab {componentJson} />
			</Tabs.Content>
		{/if}

		<Tabs.Content value="component-json" class="editor-content">
			<ComponentJsonTab {componentJson} {onJsonChange} />
		</Tabs.Content>
	</Tabs.Root>
</div>

<style>
	.component-editor {
		height: 100%;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--color-card);
		min-height: 0;
	}

	:global(.tabs-root) {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	:global(.editor-tabs) {
		border-bottom: 1px solid var(--color-border);
		border-radius: 0;
		padding: 0 8px;
		background: var(--color-muted);
	}

	:global(.editor-content) {
		flex: 1;
		overflow: auto;
		margin: 0 !important;
	}
</style>
