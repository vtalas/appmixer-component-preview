<script>
    import {tick} from 'svelte';
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
        Sparkles,
        ExternalLink,
        Trash2,
        RotateCw,
        Pencil,
        Copy,
        Check
    } from 'lucide-svelte';

    // Tauri shell plugin — imported dynamically.
    // These MUST be $state so Svelte re-renders when they become available.
    let Command = $state(null);
    let isTauri = $state(false);
    let resolvedAppmixerPath = $state(null);

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

    let { testPlan, connectorName, connectorsDir, onTestPlanUpdated, onReloadTestPlan } = $props();

    let filterMode = $state('all');
    let expandedTests = $state(new Set());
    let expandedCommands = $state(new Set());
    let runningTests = $state(new Set());
    let runningAll = $state(false);

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

    // Strip ANSI color codes for clean display
    function stripAnsi(str) {
        return str.replace(/\x1b\[[0-9;]*m/g, '');
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
        if (!isTauri || !Command || !resolvedAppmixerPath) return;

        runningTests = new Set([...runningTests, item.name]);
        const startTime = Date.now();

        try {
            const componentPath = resolveComponentPath(item);

            // Also try to extract inputs from the last command if present
            let inputsArg = '';
            if (item.result?.commands?.length) {
                const lastCmd = item.result.commands[item.result.commands.length - 1];
                const inputMatch = (lastCmd.cmd || '').match(/-i\s+(\{.*\})/);
                if (inputMatch) {
                    inputsArg = ` -i '$APPMIXER_TEST_INPUTS'`;
                }
            }

            const env = {};
            if (inputsArg) {
                const lastCmd = item.result.commands[item.result.commands.length - 1];
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
            const newCommand = {
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

    async function runAllAiTests() {
        if (!isTauri || !Command || !resolvedNodePath) return;
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
        aiTestOutput += `\n${'━'.repeat(60)}\n[Run All] Finished.\n${'━'.repeat(60)}\n`;

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
        if (!isTauri || !Command || !resolvedAppmixerPath) return;
        const srcCmd = item.result?.commands?.[cmdIndex];
        if (!srcCmd) return;

        const fullCmd = srcCmd.cmd || srcCmd.command || '';
        if (!fullCmd) return;

        const startTime = Date.now();

        // Create a new "running" command entry and append it to the plan immediately
        const newCommand = {
            exitCode: null,       // null = still running
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

        // The new command is the last one — track its index
        const newCmdIndex = (item.result?.commands?.length || 0);
        const cmdKey = `${item.name}-${newCmdIndex}`;
        runningCommand = cmdKey;

        // Auto-expand the test and the new command row
        expandedTests = new Set([...expandedTests, item.name]);
        expandedCommands = new Set([...expandedCommands, cmdKey]);

        // Scroll the new command row into view after DOM updates
        tick().then(() => {
            const el = document.querySelector(`[data-cmd-key="${cmdKey}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });

        try {
            // Quote JSON arguments for -i so the shell doesn't mangle braces
            let shellCmd = fullCmd.replace(/^appmixer\s/, `"${resolvedAppmixerPath}" `);
            shellCmd = shellCmd.replace(/-i\s+(\{.*\})/, (_, json) => `-i '${json}'`);
            const execCmd = Command.create('sh', ['-l', '-c', `${shellCmd} < /dev/null 2>&1`], { env: {} });

            let collectedStdout = '';
            let collectedStderr = '';

            execCmd.stdout.on('data', (line) => {
                collectedStdout += line;
                // Live-update the command row in the plan
                updateRerunningCommand(item.name, newCmdIndex, { stdout: collectedStdout });
            });

            execCmd.stderr.on('data', (line) => {
                collectedStderr += line;
                updateRerunningCommand(item.name, newCmdIndex, { stderr: collectedStderr });
            });

            await execCmd.spawn();

            // Wait for completion
            const result = await new Promise((resolve) => {
                execCmd.on('close', (data) => {
                    resolve({ code: data.code ?? 1 });
                });
            });

            const duration = Date.now() - startTime;
            const exitCode = result.code;

            // Final update with exit code & duration
            const finalPlan = testPlan.map(t => {
                if (t.name !== item.name) return t;
                const commands = [...(t.result?.commands || [])];
                commands[newCmdIndex] = {
                    ...commands[newCmdIndex],
                    exitCode,
                    stdout: collectedStdout,
                    stderr: collectedStderr,
                    duration
                };
                return {
                    ...t,
                    completed: true,
                    status: exitCode === 0 ? 'passed' : 'failed',
                    result: { commands },
                    reason: exitCode !== 0 ? `Exit code ${exitCode}` : null,
                    description: exitCode !== 0 ? stripAnsi(collectedStdout || collectedStderr || '').slice(0, 500) : null
                };
            });
            onTestPlanUpdated?.(finalPlan);
        } catch (err) {
            // Mark the command as failed
            updateRerunningCommand(item.name, newCmdIndex, {
                exitCode: 1,
                stderr: `Error: ${err}`,
                duration: Date.now() - startTime
            });
            console.error(`Failed to rerun command:`, err);
        } finally {
            runningCommand = null;
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
    let aiTestRunning = $state(null); // component name currently being AI-tested
    let aiTestOutput = $state('');
    let aiTestChildPid = $state(null);
    let aiTestShowOutput = $state(false);
    let resolvedNodePath = $state(null);
    let resolvedCliDir = $state(null);

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
            } catch { /* ignore */
            }

            // Find appmixer CLI directory (npm root -g + /appmixer)
            try {
                const npmRoot = mod.Command.create('sh', ['-l', '-c', 'npm root -g'], { env: {} });
                const result = await npmRoot.execute();
                if (result.code === 0 && result.stdout.trim()) {
                    resolvedCliDir = `${result.stdout.trim()}/appmixer`;
                }
            } catch { /* ignore */
            }
        });
    }

    /**
     * Derive the connectors root directory from connectorsDir.
     * connectorsDir points to <root>/src/appmixer/ — the agent expects <root>.
     */
    function getConnectorsRootDir() {
        // If connectorsDir ends with src/appmixer or src/appmixer/, strip it
        let dir = connectorsDir.replace(/\/+$/, '');
        if (dir.endsWith('/src/appmixer')) {
            dir = dir.slice(0, -'/src/appmixer'.length);
        }
        return dir;
    }

    async function runAiTest(componentName) {
        if (!isTauri || !Command || !resolvedNodePath) return;

        aiTestRunning = componentName;
        if (!runningAll) {
            aiTestOutput = '';
        } else {
            aiTestOutput += `\n${'─'.repeat(60)}\n[Run All] Testing: ${componentName}\n${'─'.repeat(60)}\n`;
        }
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
            let output = runningAll ? aiTestOutput : '';

            cmd.stdout.on('data', (line) => {
                const trimmed = line.replace(/\n+$/, '');
                if (trimmed) {
                    output += trimmed + '\n';
                    aiTestOutput = output;
                }
            });

            cmd.stderr.on('data', (line) => {
                const trimmed = line.replace(/\n+$/, '');
                if (trimmed) {
                    output += '[stderr] ' + trimmed + '\n';
                    aiTestOutput = output;
                }
            });

            const child = await cmd.spawn();
            aiTestChildPid = child.pid;

            // Wait for the process to finish
            cmd.on('close', (data) => {
                const exitCode = data.code ?? 1;
                const exitLine = `\n[AI-TEST] Process exited with code ${exitCode}\n`;
                aiTestOutput += exitLine;
                aiTestRunning = null;
                aiTestChildPid = null;

                // Reload test plan after AI test completes (skip during Run All — reload once at end)
                if (exitCode === 0 && !runningAll) {
                    setTimeout(() => {
                        onReloadTestPlan?.();
                    }, 500);
                }
            });

            cmd.on('error', (err) => {
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

    async function getScriptPath() {
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
        } catch { /* ignore */
        }

        // Fallback: use a fixed path based on app location
        try {
            const resourceCmd = Command.create('sh', ['-l', '-c', 'echo $PWD'], { env: {} });
            const result = await resourceCmd.execute();
            const pwd = result.stdout.trim();
            if (pwd) {
                return `${pwd}/scripts/run-ai-test.mjs`;
            }
        } catch { /* ignore */
        }

        return null;
    }

    // Auto-scroll directive: scrolls element to bottom whenever the bound value changes
    function autoScroll(node, _value) {
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
    let aiPopupWindow = $state(null);

    // Restore saved height
    if (typeof window !== 'undefined') {
        try {
            const saved = localStorage.getItem(AI_PANEL_STORAGE_KEY);
            if (saved) aiPanelHeight = Math.max(AI_PANEL_MIN, parseInt(saved, 10));
        } catch { /* ignore */
        }
    }

    function onResizeStart(e) {
        e.preventDefault();
        isResizing = true;
        const startY = e.clientY;
        const startHeight = aiPanelHeight;

        function onMove(ev) {
            const delta = startY - ev.clientY;
            aiPanelHeight = Math.max(AI_PANEL_MIN, startHeight + delta);
        }

        function onUp() {
            isResizing = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            try {
                localStorage.setItem(AI_PANEL_STORAGE_KEY, String(aiPanelHeight));
            } catch { /* */
            }
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

    function getPopupHtml() {
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

    // Auth status: 'checking' | 'valid' | 'invalid' | 'refreshing' | 'needs-auth'
    let authStatus = $state('checking');

    /**
     * Validate the auth token by calling `appmixer test auth validate`.
     * If validation fails, automatically attempt a refresh.
     */
    async function validateAuth() {
        if (!isTauri || !Command || !resolvedAppmixerPath) {
            authStatus = 'needs-auth';
            return;
        }

        authStatus = 'checking';
        try {
            const authPath = `${connectorsDir}/${connectorName}/auth.js`;
            const cmd = Command.create('sh', [
                '-l', '-c',
                `"${resolvedAppmixerPath}" test auth validate "${authPath}" < /dev/null 2>&1`
            ], { env: {} });

            const result = await cmd.execute();
            if (result.code === 0) {
                authStatus = 'valid';
            } else {
                console.warn(`Auth validation failed for ${connectorName}, attempting refresh…`, result.stdout);
                // Validation failed — try refresh automatically
                await refreshAuth();
            }
        } catch (err) {
            console.error('Auth validation failed:', err);
            authStatus = 'invalid';
        }
    }

    async function refreshAuth() {
        if (!isTauri || !Command || !resolvedAppmixerPath) return;

        authStatus = 'refreshing';
        try {
            const authPath = `${connectorsDir}/${connectorName}/auth.js`;
            const cmd = Command.create('sh', [
                '-l', '-c',
                `"${resolvedAppmixerPath}" test auth refresh "${authPath}" < /dev/null 2>&1`
            ], { env: {} });

            const result = await cmd.execute();
            if (result.code === 0) {
                authStatus = 'valid';
            } else {
                authStatus = 'invalid';
                console.warn(`Auth refresh failed for ${connectorName}:`, result.stdout, result.stderr);
            }
        } catch (err) {
            authStatus = 'invalid';
            console.error('Auth refresh failed:', err);
        }
    }

    // Auto-validate auth when the component mounts and shell is available
    $effect(() => {
        if (isTauri && Command && resolvedAppmixerPath && connectorName && connectorsDir) {
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
            {#if isTauri}
                <Button
                        variant={authStatus === 'valid' ? 'outline' : authStatus === 'invalid' || authStatus === 'needs-auth' ? 'destructive' : 'outline'}
                        size="sm"
                        onclick={validateAuth}
                        disabled={authStatus === 'checking' || authStatus === 'refreshing' || !resolvedAppmixerPath}
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
                        disabled={runningAll || aiTestRunning !== null || !resolvedNodePath || authStatus === 'invalid' || authStatus === 'needs-auth'}
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
                {#if aiTestShowOutput}
                    <Button
                            variant="ghost"
                            size="sm"
                            onclick={() => aiTestShowOutput = false}
                            title="Hide AI output"
                    >
                        <ChevronDown class="h-3.5 w-3.5"/>
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

    <!-- AI Test Output Panel -->
    {#if aiTestShowOutput && (aiTestOutput || aiTestRunning)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="tp-ai-resize-handle" onmousedown={onResizeStart}></div>
        <div class="tp-ai-output-panel" style="height: {aiPanelHeight}px">
            <div class="tp-ai-output-header">
                <div class="tp-ai-output-title">
                    <Sparkles class="h-3.5 w-3.5"/>
                    <span>AI Test Agent</span>
                    {#if aiTestRunning}
                        <Badge variant="secondary" class="tp-ai-badge">
                            <Loader2 class="h-3 w-3 spinning"/>
                            {aiTestRunning}
                        </Badge>
                    {:else}
                        <Badge variant="outline" class="tp-ai-badge">done</Badge>
                    {/if}
                </div>
                <div class="tp-ai-output-actions">
                    {#if aiTestRunning}
                        <Button variant="destructive" size="sm" onclick={stopAiTest} title="Stop AI test">
                            <Square class="h-3 w-3 mr-1"/>
                            Stop
                        </Button>
                    {/if}
                    <Button variant="ghost" size="sm" onclick={openPopup} title="Open in popup window"
                            class="tp-popup-btn">
                        <ExternalLink class="h-3.5 w-3.5"/>
                    </Button>
                    <Button variant="ghost" size="sm" onclick={() => { aiTestShowOutput = false; aiTestOutput = ''; }}
                            title="Close">
                        <XCircle class="h-3.5 w-3.5"/>
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
                            {#if isRunning}
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
                            {#if isTauri && !item.ignored}
                                <Button
                                        variant="ghost"
                                        size="sm"
                                        class="tp-run-btn"
                                        onclick={(e) => { e.stopPropagation(); handleRunTest(item); }}
                                        disabled={isRunning || !resolvedAppmixerPath || authStatus === 'invalid' || authStatus === 'needs-auth'}
                                        title={authStatus === 'invalid' || authStatus === 'needs-auth' ? 'Auth required — validate auth first' : 'Run test'}
                                >
                                    {#if isRunning}
                                        <Loader2 class="h-3.5 w-3.5 spinning"/>
                                    {:else}
                                        <Play class="h-3.5 w-3.5"/>
                                    {/if}
                                </Button>
                                <Button
                                        variant="ghost"
                                        size="sm"
                                        class="tp-run-btn tp-ai-btn"
                                        onclick={(e) => { e.stopPropagation(); runAiTest(item.name); }}
                                        disabled={aiTestRunning !== null || !resolvedNodePath || authStatus === 'invalid' || authStatus === 'needs-auth'}
                                        title={authStatus === 'invalid' || authStatus === 'needs-auth' ? 'Auth required — validate auth first' : 'Run AI-powered test (LangGraph agent)'}
                                >
                                    {#if aiTestRunning === item.name}
                                        <Loader2 class="h-3.5 w-3.5 spinning"/>
                                    {:else}
                                        <Bot class="h-3.5 w-3.5"/>
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
                                                    {#if isTauri}
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
                                                                 use:autoScroll={cmd.stdout}>{stripAnsi(cmd.stdout)}</pre>
                                                        </div>
                                                    {/if}
                                                    {#if cmd.stderr}
                                                        <div class="tp-output-section">
                                                            <div class="tp-output-label stderr">stderr</div>
                                                            <pre class="tp-output-pre stderr"
                                                                 use:autoScroll={cmd.stderr}>{stripAnsi(cmd.stderr)}</pre>
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
