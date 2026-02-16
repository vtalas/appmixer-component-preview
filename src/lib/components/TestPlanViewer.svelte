<script>
    import {Badge} from '$lib/components/ui/badge';
    import {Button} from '$lib/components/ui/button';
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
        ExternalLink,
        Trash2,
        RotateCw,
        Pencil,
        Copy,
        Check
    } from 'lucide-svelte';
    import { createCommandRunner, stripAnsi } from '$lib/utils/commandRunner.svelte.js';

    // Server-ready state
    let serverReady = $state(true);

    let { testPlan, connectorName, connectorsDir, onTestPlanUpdated, onReloadTestPlan } = $props();

    let filterMode = $state('all');
    let expandedTests = $state(new Set());
    let expandedCommands = $state(new Set());
    let runningTests = $state(new Set());
    let runningAll = $state(false);

    // Shared command runner (streaming + popup output)
    const runner = createCommandRunner({
        isRunning: () => !!(aiTestRunning || runningTests.size > 0),
        statusLabel: () => aiTestRunning || 'running'
    });

    // Summary stats
    let stats = $derived.by(() => {
        let passed = 0, failed = 0, pending = 0, ignored = 0;
        for (const item of testPlan) {
            if (item.ignored) {
                ignored++;
                continue;
            }
            if (!item.completed) {
                pending++;
                continue;
            }
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
                case 'passed':
                    return item.completed && item.status === 'passed';
                case 'failed':
                    return item.completed && item.status === 'failed';
                case 'pending':
                    return !item.completed && !item.ignored;
                case 'ignored':
                    return item.ignored === true;
                default:
                    return true;
            }
        });
    });

    function getStatusColor(item) {
        if (item.ignored) return 'muted';
        if (!item.completed) return 'pending';
        if (item.status === 'passed') return 'passed';
        if (item.status === 'failed') return 'failed';
        return 'pending';
    }

    function toggleTest(name) {
        const newSet = new Set(expandedTests);
        if (newSet.has(name)) newSet.delete(name);
        else newSet.add(name);
        expandedTests = newSet;
    }

    function toggleCommand(key) {
        const newSet = new Set(expandedCommands);
        if (newSet.has(key)) newSet.delete(key);
        else newSet.add(key);
        expandedCommands = newSet;
    }

    function formatDuration(ms) {
        if (!ms) return '';
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    }

    function getDisplayCommand(cmd) {
        // Use the relative command if available, otherwise the full cmd
        return cmd.command || cmd.cmd;
    }


    // Extract meaningful output from stdout (skip boilerplate), with max length cap
    function extractOutput(stdout, maxLen = 5000) {
        const clean = stripAnsi(stdout);
        let output;
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
    function resolveComponentPath(item) {
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

    /**
     * Run test for a single item: re-runs the last existing command if available,
     * otherwise falls back to creating a new command from scratch.
     */
    function handleRunTest(item) {
        if (item.result?.commands?.length) {
            // Re-run the last existing command
            const lastCmdIndex = item.result.commands.length - 1;
            rerunCommand(item, lastCmdIndex);
        } else {
            runSingleTest(item);
        }
    }

    async function runSingleTest(item) {
        runningTests = new Set([...runningTests, item.name]);
        const startTime = Date.now();

        try {
            const componentPath = resolveComponentPath(item);

            let inputsArg = '';
            let inputsJson = '';
            if (item.result?.commands?.length) {
                const lastCmd = item.result.commands[item.result.commands.length - 1];
                const inputMatch = (lastCmd.cmd || '').match(/-i\s+(\{.*\})/);
                if (inputMatch) {
                    inputsJson = inputMatch[1];
                    inputsArg = ` -i '${inputsJson}'`;
                }
            }

            const shellCmd = `appmixer test component "${componentPath}"${inputsArg} < /dev/null 2>&1`;
            const { stdout, stderr, exitCode } = await runner.run(shellCmd);

            const duration = Date.now() - startTime;
            const relPath = componentPath.replace(/^.*?(src\/appmixer\/)/, '$1');
            const newCommand = {
                exitCode,
                cmd: `appmixer test component ${componentPath}${inputsJson ? ` -i ${inputsJson}` : ''}`,
                command: `appmixer test component ${relPath}`,
                stdout, stderr, duration
            };

            const updatedPlan = testPlan.map(t => {
                if (t.name !== item.name) return t;
                const commands = [...(t.result?.commands || []), newCommand];
                return {
                    ...t,
                    completed: true,
                    status: exitCode === 0 ? 'passed' : 'failed',
                    result: { commands },
                    reason: exitCode !== 0 ? `Exit code ${exitCode}` : null,
                    description: exitCode !== 0 ? stripAnsi(stdout || stderr || '').slice(0, 500) : null
                };
            });
            onTestPlanUpdated?.(updatedPlan);
        } catch (err) {
            if (!(err instanceof Error && err.name === 'AbortError')) {
                console.error(`Failed to run test for ${item.name}:`, err);
                runner.appendOutput(`\nFailed: ${err}\n`);
            }
        } finally {
            const newSet = new Set(runningTests);
            newSet.delete(item.name);
            runningTests = newSet;
        }
    }

    async function runAllAiTests() {
        runningAll = true;

        const items = testPlan.filter(item => !item.ignored);
        for (const item of items) {
            if (!runningAll) break;
            await runAiTest(item.name);
            // Wait for the AI test to finish before starting the next
            await new Promise(resolve => {
                const check = setInterval(() => {
                    if (!aiTestRunning) {
                        clearInterval(check);
                        resolve();
                    }
                }, 500);
            });
        }

        runningAll = false;
        runner.appendOutput(`\n${'━'.repeat(60)}\n[Run All] Finished.\n${'━'.repeat(60)}\n`);

        // Reload test plan once after all tests are done
        setTimeout(() => {
            onReloadTestPlan?.();
        }, 500);
    }

    /**
     * Re-run a single command from a test item's history.
     * Creates a new row immediately (with "running" state), streams output into it,
     * then updates exit code when done.
     */
    let runningCommand = $state(null);

    // ── Edit Command ─────────────────────────────────────────────────
    let editingCmd = $state(null); // { itemName, cmdIndex, inputJson, error }
    let copiedCmd = $state(null); // cmdKey of recently copied command

    async function copyCommand(cmd, cmdKey) {
        const text = cmd.cmd || cmd.command || '';
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            copiedCmd = cmdKey;
            setTimeout(() => {
                if (copiedCmd === cmdKey) copiedCmd = null;
            }, 1500);
        } catch { /* ignore */
        }
    }

    /** Find the balanced JSON object after `-i` in a command string. */
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
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\' && inString) {
                escape = true;
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                continue;
            }
            if (inString) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) return { start, end: i + 1, flagStart: flagMatch.index };
            }
        }
        return null;
    }

    function parseInputJson(cmdStr) {
        const range = extractInputJsonRange(cmdStr);
        if (!range) return null;
        const raw = cmdStr.slice(range.start, range.end);
        try {
            return JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
            return raw;
        }
    }

    function getBaseCommand(cmdStr) {
        const range = extractInputJsonRange(cmdStr);
        if (!range) return cmdStr;
        // Remove from the -i flag through the end of the JSON (plus optional trailing quote)
        let end = range.end;
        if (cmdStr[end] === "'") end++;
        return (cmdStr.slice(0, range.flagStart) + cmdStr.slice(end)).replace(/\s+/g, ' ').trim();
    }

    function openEditCommand(item, cmdIndex) {
        const cmd = item.result?.commands?.[cmdIndex];
        if (!cmd) return;
        const fullCmd = cmd.cmd || cmd.command || '';
        const inputJson = parseInputJson(fullCmd);
        editingCmd = { itemName: item.name, cmdIndex, inputJson: inputJson || '{}' };
    }

    function saveEditedCommand() {
        if (!editingCmd) return;
        const { itemName, cmdIndex, inputJson } = editingCmd;

        // Validate JSON
        let compacted;
        try {
            compacted = JSON.stringify(JSON.parse(inputJson));
        } catch {
            editingCmd = { ...editingCmd, error: 'Invalid JSON. Please fix the syntax and try again.' };
            return;
        }

        const updatedPlan = testPlan.map(t => {
            if (t.name !== itemName) return t;
            const commands = [...(t.result?.commands || [])];
            const cmd = commands[cmdIndex];
            if (!cmd) return t;

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
            return { ...t, result: { commands } };
        });

        onTestPlanUpdated?.(updatedPlan);
        editingCmd = null;
    }

    async function rerunCommand(item, cmdIndex) {
        const srcCmd = item.result?.commands?.[cmdIndex];
        if (!srcCmd) return;

        const fullCmd = srcCmd.cmd || srcCmd.command || '';
        if (!fullCmd) return;

        runningTests = new Set([...runningTests, item.name]);
        const startTime = Date.now();

        // Create a new "running" command entry and append it to the plan immediately
        const newCommand = {
            exitCode: null,
            cmd: srcCmd.cmd,
            command: srcCmd.command,
            stdout: '',
            stderr: '',
            duration: null
        };

        const updatedPlanInit = testPlan.map(t => {
            if (t.name !== item.name) return t;
            return { ...t, result: { commands: [...(t.result?.commands || []), newCommand] } };
        });
        onTestPlanUpdated?.(updatedPlanInit);

        const newCmdIndex = (item.result?.commands?.length || 0);
        const cmdKey = `${item.name}-${newCmdIndex}`;
        runningCommand = cmdKey;

        let accStdout = '';
        let accStderr = '';
        try {
            let shellCmd = fullCmd;
            shellCmd = shellCmd.replace(/-i\s+(\{.*\})/, (_, json) => `-i '${json}'`);

            const { stdout, stderr, exitCode } = await runner.run(`${shellCmd} < /dev/null 2>&1`, {
                onData: (text, type) => {
                    if (type === 'stderr') { accStderr += text; } else { accStdout += text; }
                    updateRerunningCommand(item.name, newCmdIndex, { stdout: accStdout, stderr: accStderr });
                }
            });

            const duration = Date.now() - startTime;

            const finalPlan = testPlan.map(t => {
                if (t.name !== item.name) return t;
                const commands = [...(t.result?.commands || [])];
                commands[newCmdIndex] = {
                    ...commands[newCmdIndex],
                    exitCode, stdout, stderr, duration
                };
                return {
                    ...t,
                    completed: true,
                    status: exitCode === 0 ? 'passed' : 'failed',
                    result: { commands },
                    reason: exitCode !== 0 ? `Exit code ${exitCode}` : null,
                    description: exitCode !== 0 ? stripAnsi(stdout || stderr || '').slice(0, 500) : null
                };
            });
            onTestPlanUpdated?.(finalPlan);
        } catch (err) {
            if (!(err instanceof Error && err.name === 'AbortError')) {
                updateRerunningCommand(item.name, newCmdIndex, {
                    exitCode: 1,
                    stderr: `Error: ${err}`,
                    duration: Date.now() - startTime
                });
                console.error(`Failed to rerun command:`, err);
            }
        } finally {
            runningCommand = null;
            const newSet = new Set(runningTests);
            newSet.delete(item.name);
            runningTests = newSet;
        }
    }

    /** Helper: live-update a command entry while it's running */
    function updateRerunningCommand(testName, cmdIdx, updates) {
        const updatedPlan = testPlan.map(t => {
            if (t.name !== testName) return t;
            const commands = [...(t.result?.commands || [])];
            if (commands[cmdIdx]) {
                commands[cmdIdx] = { ...commands[cmdIdx], ...updates };
            }
            return { ...t, result: { commands } };
        });
        onTestPlanUpdated?.(updatedPlan);
    }

    /**
     * Delete a single command from a test item's history.
     */
    function deleteCommand(item, cmdIndex) {
        const updatedPlan = testPlan.map(t => {
            if (t.name !== item.name) return t;
            const commands = [...(t.result?.commands || [])];
            commands.splice(cmdIndex, 1);

            // Recalculate status based on remaining commands
            if (commands.length === 0) {
                return { ...t, completed: false, status: null, result: { commands }, reason: null, description: null };
            }
            const lastCmd = commands[commands.length - 1];
            const lastPassed = lastCmd.exitCode === 0;
            return {
                ...t,
                completed: true,
                status: lastPassed ? 'passed' : 'failed',
                result: { commands },
                reason: lastPassed ? null : `Exit code ${lastCmd.exitCode}`,
                description: lastPassed ? null : stripAnsi(lastCmd.stdout || lastCmd.stderr || '').slice(0, 500)
            };
        });
        onTestPlanUpdated?.(updatedPlan);
    }

    // ── AI Test Agent ─────────────────────────────────────────────────
    let aiTestRunning = $state(null);

    function getConnectorsRootDir() {
        let dir = connectorsDir.replace(/\/+$/, '');
        if (dir.endsWith('/src/appmixer')) {
            dir = dir.slice(0, -'/src/appmixer'.length);
        }
        return dir;
    }

    async function runAiTest(componentName) {
        aiTestRunning = componentName;
        if (runningAll) {
            runner.appendOutput(`\n${'─'.repeat(60)}\n[Run All] Testing: ${componentName}\n${'─'.repeat(60)}\n`);
        }
        const connectorsRootDir = getConnectorsRootDir();
        const shellCmd = `node scripts/run-ai-test.mjs --connectorsDir "${connectorsRootDir}" --connector "${connectorName}" --component "${componentName}" < /dev/null 2>&1`;

        try {
            const { exitCode } = await runner.run(shellCmd, {
                useAppCwd: true,
                appendOutput: runningAll,
                label: 'AI-TEST'
            });
            if (exitCode === 0 && !runningAll) {
                setTimeout(() => { onReloadTestPlan?.(); }, 500);
            }
        } catch (err) {
            if (!(err instanceof Error && err.name === 'AbortError')) {
                runner.appendOutput(`\nFailed to run AI test: ${err}\n`);
            }
        } finally {
            aiTestRunning = null;
        }
    }

    function stopAiTest() {
        runningAll = false;
        runner.stop();
        aiTestRunning = null;
        runner.appendOutput('\n[AI-TEST] Stopped by user\n');
    }

    // Auth status: 'checking' | 'valid' | 'invalid' | 'refreshing' | 'needs-auth'
    let authStatus = $state('checking');

    /**
     * Validate the auth token by calling `appmixer test auth validate`.
     * If validation fails, automatically attempt a refresh.
     */
    async function validateAuth() {
        authStatus = 'checking';
        try {
            const authPath = `${connectorsDir}/${connectorName}/auth.js`;
            const response = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'validate', authPath })
            });
            const result = await response.json();
            if (result.code === 0) {
                authStatus = 'valid';
            } else {
                console.warn(`Auth validation failed for ${connectorName}, attempting refresh…`);
                await refreshAuth();
            }
        } catch (err) {
            console.error('Auth validation failed:', err);
            authStatus = 'invalid';
        }
    }

    async function refreshAuth() {
        authStatus = 'refreshing';
        try {
            const authPath = `${connectorsDir}/${connectorName}/auth.js`;
            const response = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'refresh', authPath })
            });
            const result = await response.json();
            if (result.code === 0) {
                authStatus = 'valid';
            } else {
                authStatus = 'invalid';
                console.warn(`Auth refresh failed for ${connectorName}`);
            }
        } catch (err) {
            authStatus = 'invalid';
            console.error('Auth refresh failed:', err);
        }
    }

    // Auto-validate auth when the component mounts
    $effect(() => {
        if (connectorName && connectorsDir) {
            validateAuth();
        }
    });
</script>

<div class="test-plan-viewer">
    <!-- Header -->
    <div class="tp-header">
        <div class="tp-header-left">
            <Terminal class="h-4 w-4"/>
            <span class="tp-title">Test Plan</span>
            <Badge variant="outline" class="tp-connector-badge">{connectorName}</Badge>
        </div>
        <div class="tp-header-right">
            {#if true}
                <Button
                        variant={authStatus === 'valid' ? 'outline' : authStatus === 'invalid' || authStatus === 'needs-auth' ? 'destructive' : 'outline'}
                        size="sm"
                        onclick={validateAuth}
                        disabled={authStatus === 'checking' || authStatus === 'refreshing'}
                        title={authStatus === 'invalid' || authStatus === 'needs-auth' ? 'Click to retry auth validation & refresh' : 'Validate authentication'}
                >
                    {#if authStatus === 'checking'}
                        <Loader2 class="h-3.5 w-3.5 mr-1 spinning"/>
                        Validating...
                    {:else if authStatus === 'refreshing'}
                        <Loader2 class="h-3.5 w-3.5 mr-1 spinning"/>
                        Refreshing...
                    {:else if authStatus === 'valid'}
                        <CheckCircle2 class="h-3.5 w-3.5 mr-1"/>
                        Auth OK
                    {:else if authStatus === 'invalid' || authStatus === 'needs-auth'}
                        <XCircle class="h-3.5 w-3.5 mr-1"/>
                        Auth Failed
                    {:else}
                        <AlertTriangle class="h-3.5 w-3.5 mr-1"/>
                        Refresh Auth
                    {/if}
                </Button>
                <Button
                        variant="default"
                        size="sm"
                        onclick={runAllAiTests}
                        disabled={runningAll || aiTestRunning !== null || authStatus === 'invalid' || authStatus === 'needs-auth'}
                        title={authStatus === 'invalid' || authStatus === 'needs-auth' ? 'Auth required — validate auth first' : 'Run all AI tests'}
                >
                    {#if runningAll}
                        <Loader2 class="h-3.5 w-3.5 mr-1 spinning"/>
                        Running All...
                    {:else}
                        <Bot class="h-3.5 w-3.5 mr-1"/>
                        Run All
                    {/if}
                </Button>
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
            <CheckCircle2 class="h-3.5 w-3.5"/>
            <span class="tp-stat-count">{stats.passed}</span>
            <span class="tp-stat-label">Passed</span>
        </button>
        <button
                class="tp-stat failed {filterMode === 'failed' ? 'active' : ''}"
                onclick={() => filterMode = 'failed'}
        >
            <XCircle class="h-3.5 w-3.5"/>
            <span class="tp-stat-count">{stats.failed}</span>
            <span class="tp-stat-label">Failed</span>
        </button>
        <button
                class="tp-stat pending {filterMode === 'pending' ? 'active' : ''}"
                onclick={() => filterMode = 'pending'}
        >
            <Clock class="h-3.5 w-3.5"/>
            <span class="tp-stat-count">{stats.pending}</span>
            <span class="tp-stat-label">Pending</span>
        </button>
        {#if stats.ignored > 0}
            <button
                    class="tp-stat ignored {filterMode === 'ignored' ? 'active' : ''}"
                    onclick={() => filterMode = 'ignored'}
            >
                <SkipForward class="h-3.5 w-3.5"/>
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

    <!-- Test list -->
    <div class="tp-list">
        {#if filteredItems.length === 0}
            <div class="tp-empty">
                <Filter class="h-5 w-5"/>
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
                                <ChevronDown class="h-3.5 w-3.5 tp-chevron"/>
                            {:else}
                                <ChevronRight class="h-3.5 w-3.5 tp-chevron"/>
                            {/if}
                            {#if isRunning || aiTestRunning === item.name}
                                <Loader2 class="h-4 w-4 spinning tp-status-icon running"/>
                            {:else if item.status === 'passed'}
                                <CheckCircle2 class="h-4 w-4 tp-status-icon passed"/>
                            {:else if item.status === 'failed'}
                                <XCircle class="h-4 w-4 tp-status-icon failed"/>
                            {:else if item.ignored}
                                <SkipForward class="h-4 w-4 tp-status-icon muted"/>
                            {:else}
                                <Clock class="h-4 w-4 tp-status-icon pending"/>
                            {/if}
                            <span class="tp-item-name">{item.name}</span>
                        </div>
                        <div class="tp-item-right">
                            {#if item.completed && item.result?.commands?.length}
                                <span class="tp-cmd-count">{item.result.commands.length}
                                    run{item.result.commands.length !== 1 ? 's' : ''}</span>
                            {/if}
                            {#if item.completed && item.status}
                                <Badge variant={item.status === 'passed' ? 'default' : 'destructive'}
                                       class="tp-status-badge">
                                    {item.status}
                                </Badge>
                            {:else if item.ignored}
                                <Badge variant="secondary" class="tp-status-badge">ignored</Badge>
                            {:else}
                                <Badge variant="outline" class="tp-status-badge">pending</Badge>
                            {/if}
                            {#if !item.ignored}
                                {#if aiTestRunning === item.name}
                                    <Badge variant="secondary" class="tp-ai-running-badge">
                                        <Loader2 class="h-3 w-3 spinning"/>
                                        AI running
                                    </Badge>
                                    <Button
                                            variant="ghost"
                                            size="sm"
                                            class="tp-run-btn"
                                            onclick={(e) => { e.stopPropagation(); runner.openPopup(); }}
                                            title="View AI test output"
                                    >
                                        <ExternalLink class="h-3.5 w-3.5"/>
                                    </Button>
                                    <Button
                                            variant="ghost"
                                            size="sm"
                                            class="tp-run-btn tp-stop-btn"
                                            onclick={(e) => { e.stopPropagation(); stopAiTest(); }}
                                            title="Stop AI test"
                                    >
                                        <Square class="h-3.5 w-3.5"/>
                                    </Button>
                                {:else if isRunning}
                                    <Badge variant="secondary" class="tp-ai-running-badge">
                                        <Loader2 class="h-3 w-3 spinning"/>
                                        Running
                                    </Badge>
                                    <Button
                                            variant="ghost"
                                            size="sm"
                                            class="tp-run-btn"
                                            onclick={(e) => { e.stopPropagation(); runner.openPopup(); }}
                                            title="View test output"
                                    >
                                        <ExternalLink class="h-3.5 w-3.5"/>
                                    </Button>
                                    <Button
                                            variant="ghost"
                                            size="sm"
                                            class="tp-run-btn tp-stop-btn"
                                            onclick={(e) => { e.stopPropagation(); runner.stop(); }}
                                            title="Stop test"
                                    >
                                        <Square class="h-3.5 w-3.5"/>
                                    </Button>
                                {:else}
                                    <Button
                                            variant="ghost"
                                            size="sm"
                                            class="tp-run-btn"
                                            onclick={(e) => { e.stopPropagation(); handleRunTest(item); }}
                                            disabled={runningTests.size > 0 || aiTestRunning !== null || authStatus === 'invalid' || authStatus === 'needs-auth'}
                                            title={authStatus === 'invalid' || authStatus === 'needs-auth' ? 'Auth required — validate auth first' : 'Run test'}
                                    >
                                        <Play class="h-3.5 w-3.5"/>
                                    </Button>
                                    <Button
                                            variant="ghost"
                                            size="sm"
                                            class="tp-run-btn tp-ai-btn"
                                            onclick={(e) => { e.stopPropagation(); runAiTest(item.name); }}
                                            disabled={runningTests.size > 0 || aiTestRunning !== null || authStatus === 'invalid' || authStatus === 'needs-auth'}
                                            title={authStatus === 'invalid' || authStatus === 'needs-auth' ? 'Auth required — validate auth first' : 'Run AI-powered test'}
                                    >
                                        <Bot class="h-3.5 w-3.5"/>
                                    </Button>
                                {/if}
                            {/if}
                        </div>
                    </button>

                    <!-- Expanded detail -->
                    {#if isExpanded}
                        <div class="tp-item-detail">
                            <!-- Failure reason -->
                            {#if item.reason}
                                <div class="tp-reason">
                                    <AlertTriangle class="h-3.5 w-3.5"/>
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
                                        {@const isRunningCmd = cmd.exitCode === null}
                                        <div class="tp-cmd {isRunningCmd ? 'running' : cmd.exitCode === 0 ? 'success' : 'error'}"
                                             data-cmd-key={cmdKey}>
                                            <button class="tp-cmd-header" onclick={() => toggleCommand(cmdKey)}>
                                                <div class="tp-cmd-left">
                                                    {#if isCmdExpanded}
                                                        <ChevronDown class="h-3 w-3"/>
                                                    {:else}
                                                        <ChevronRight class="h-3 w-3"/>
                                                    {/if}
                                                    {#if isRunningCmd}
                                                        <Loader2 class="h-3 w-3 spinning tp-cmd-running-icon"/>
                                                    {:else}
														<span class="tp-cmd-exit {cmd.exitCode === 0 ? 'success' : 'error'}">
															{cmd.exitCode === 0 ? '✓' : '✗'}
														</span>
                                                    {/if}
                                                    <code class="tp-cmd-text">{getDisplayCommand(cmd)}</code>
                                                </div>
                                                <div class="tp-cmd-right">
                                                    {#if isRunningCmd}
                                                        <Badge variant="secondary" class="tp-status-badge">running…
                                                        </Badge>
                                                    {:else}
                                                        {#if cmd.duration}
                                                            <span class="tp-cmd-duration">{formatDuration(cmd.duration)}</span>
                                                        {/if}
                                                        <span class="tp-cmd-exit-code">exit {cmd.exitCode}</span>
                                                    {/if}
                                                    {#if true}
                                                        <button
                                                                class="tp-cmd-action"
                                                                onclick={(e) => { e.stopPropagation(); copyCommand(cmd, cmdKey); }}
                                                                title="Copy command"
                                                        >
                                                            {#if copiedCmd === cmdKey}
                                                                <Check class="h-3 w-3"/>
                                                            {:else}
                                                                <Copy class="h-3 w-3"/>
                                                            {/if}
                                                        </button>
                                                        <button
                                                                class="tp-cmd-action"
                                                                onclick={(e) => { e.stopPropagation(); rerunCommand(item, ci); }}
                                                                disabled={runningCommand !== null || isRunningCmd || authStatus === 'invalid' || authStatus === 'needs-auth'}
                                                                title={authStatus === 'invalid' || authStatus === 'needs-auth' ? 'Auth required — validate auth first' : 'Re-run this command'}
                                                        >
                                                            {#if runningCommand === cmdKey}
                                                                <Loader2 class="h-3 w-3 spinning"/>
                                                            {:else}
                                                                <RotateCw class="h-3 w-3"/>
                                                            {/if}
                                                        </button>
                                                        <button
                                                                class="tp-cmd-action"
                                                                onclick={(e) => { e.stopPropagation(); openEditCommand(item, ci); }}
                                                                disabled={isRunningCmd}
                                                                title="Edit -i input JSON"
                                                        >
                                                            <Pencil class="h-3 w-3"/>
                                                        </button>
                                                        <button
                                                                class="tp-cmd-action tp-cmd-delete"
                                                                onclick={(e) => { e.stopPropagation(); deleteCommand(item, ci); }}
                                                                disabled={isRunningCmd}
                                                                title="Remove this command"
                                                        >
                                                            <Trash2 class="h-3 w-3"/>
                                                        </button>
                                                    {/if}
                                                </div>
                                            </button>

                                            {#if isCmdExpanded || isRunningCmd}
                                                <div class="tp-cmd-output">
                                                    {#if cmd.stdout}
                                                        <div class="tp-output-section">
                                                            <div class="tp-output-label">stdout</div>
                                                            <pre class="tp-output-pre"
                                                                 >{stripAnsi(cmd.stdout)}</pre>
                                                        </div>
                                                    {/if}
                                                    {#if cmd.stderr}
                                                        <div class="tp-output-section">
                                                            <div class="tp-output-label stderr">stderr</div>
                                                            <pre class="tp-output-pre stderr"
                                                                 >{stripAnsi(cmd.stderr)}</pre>
                                                        </div>
                                                    {/if}
                                                    {#if isRunningCmd && !cmd.stdout && !cmd.stderr}
                                                        <div class="tp-cmd-waiting">
                                                            <Loader2 class="h-3.5 w-3.5 spinning"/>
                                                            <span>Waiting for output…</span>
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

<!-- Edit Command Modal -->
{#if editingCmd}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tp-modal-overlay" onclick={() => editingCmd = null}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="tp-modal" onclick={(e) => e.stopPropagation()}>
            <div class="tp-modal-header">
                <span class="tp-modal-title">Edit Command Input</span>
                <button class="tp-modal-close" onclick={() => editingCmd = null}>&times;</button>
            </div>
            <div class="tp-modal-body">
                <label class="tp-modal-label">Base command</label>
                <code class="tp-modal-base-cmd">{getBaseCommand(
                    testPlan.find(t => t.name === editingCmd.itemName)?.result?.commands?.[editingCmd.cmdIndex]?.command ||
                    testPlan.find(t => t.name === editingCmd.itemName)?.result?.commands?.[editingCmd.cmdIndex]?.cmd || ''
                )}</code>
                {#if editingCmd.error}
                    <div class="tp-modal-error">{editingCmd.error}</div>
                {/if}
                <label class="tp-modal-label">-i JSON input</label>
                <textarea
                        class="tp-modal-textarea"
                        rows="16"
                        bind:value={editingCmd.inputJson}
                        spellcheck="false"
                ></textarea>
            </div>
            <div class="tp-modal-footer">
                <button class="tp-modal-btn tp-modal-btn-cancel" onclick={() => editingCmd = null}>Cancel</button>
                <button class="tp-modal-btn tp-modal-btn-save" onclick={saveEditedCommand}>Save</button>
            </div>
        </div>
    </div>
{/if}

<style>
    .test-plan-viewer {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--color-card);
        overflow: hidden;
        min-height: 0;
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

    .tp-stat.passed :global(svg) {
        color: #22c55e;
    }

    .tp-stat.failed :global(svg) {
        color: #ef4444;
    }

    .tp-stat.pending :global(svg) {
        color: #f59e0b;
    }

    .tp-stat.ignored :global(svg) {
        color: var(--color-muted-foreground);
    }

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

    :global(.tp-status-icon.passed) {
        color: #22c55e;
    }

    :global(.tp-status-icon.failed) {
        color: #ef4444;
    }

    :global(.tp-status-icon.pending) {
        color: #f59e0b;
    }

    :global(.tp-status-icon.muted) {
        color: var(--color-muted-foreground);
    }

    :global(.tp-status-icon.running) {
        color: #3b82f6;
    }

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

    .tp-reason :global(svg) {
        flex-shrink: 0;
        margin-top: 1px;
    }

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

    .tp-cmd.running {
        border-left: 3px solid #3b82f6;
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

    .tp-cmd-exit.success {
        color: #22c55e;
    }

    .tp-cmd-exit.error {
        color: #ef4444;
    }

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
        overflow-y: auto;
        max-height: 300px;
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

    /* Command action buttons (rerun / delete) */
    .tp-cmd-action {
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

    .tp-cmd-header:hover .tp-cmd-action {
        opacity: 1;
    }

    .tp-cmd-action:hover {
        background: var(--color-muted);
        color: var(--color-foreground);
    }

    .tp-cmd-action.tp-cmd-delete:hover {
        color: #ef4444;
        background: #fef2f2;
    }

    .tp-cmd-action :global(.tp-copied) {
        color: #22c55e;
    }

    .tp-cmd-action:disabled {
        opacity: 0.5;
        cursor: default;
    }

    /* AI Test Button */
    :global(.tp-ai-btn svg) {
        color: #8b5cf6;
    }

    :global(.tp-ai-btn:hover svg) {
        color: #7c3aed;
    }

    /* AI running badge in row */
    :global(.tp-ai-running-badge) {
        font-size: 10px;
        height: 18px;
        padding: 0 6px;
        gap: 4px;
        color: #8b5cf6;
    }

    /* Stop button */
    :global(.tp-stop-btn svg) {
        color: #ef4444;
    }

    :global(.tp-stop-btn:hover svg) {
        color: #dc2626;
    }

    :global(.tp-cmd-running-icon) {
        color: #3b82f6;
    }

    .tp-cmd-waiting {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 12px 8px;
        color: var(--color-muted-foreground);
        font-size: 11px;
    }

    .tp-cmd-waiting :global(svg) {
        color: #3b82f6;
    }

    :global(.spinning) {
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

    /* Edit Command Modal */
    .tp-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }

    .tp-modal {
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

    .tp-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--color-border);
    }

    .tp-modal-title {
        font-size: 14px;
        font-weight: 600;
    }

    .tp-modal-close {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: var(--color-muted-foreground);
        padding: 0 4px;
        line-height: 1;
    }

    .tp-modal-close:hover {
        color: var(--color-foreground);
    }

    .tp-modal-body {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
    }

    .tp-modal-error {
        font-size: 12px;
        color: #ef4444;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: var(--radius-sm, 4px);
        padding: 6px 10px;
        margin-bottom: 8px;
    }

    .tp-modal-label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted-foreground);
        margin-bottom: 4px;
    }

    .tp-modal-base-cmd {
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

    .tp-modal-textarea {
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

    .tp-modal-textarea:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }

    .tp-modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid var(--color-border);
    }

    .tp-modal-btn {
        padding: 6px 16px;
        border-radius: var(--radius-sm, 4px);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid var(--color-border);
    }

    .tp-modal-btn-cancel {
        background: transparent;
        color: var(--color-foreground);
    }

    .tp-modal-btn-cancel:hover {
        background: var(--color-muted);
    }

    .tp-modal-btn-save {
        background: #3b82f6;
        color: white;
        border-color: #3b82f6;
    }

    .tp-modal-btn-save:hover {
        background: #2563eb;
        border-color: #2563eb;
    }
</style>
