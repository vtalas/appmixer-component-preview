/**
 * Command runner utility — streams shell commands via /api/shell SSE,
 * manages a popup output window with ANSI color support.
 *
 * Usage:
 *   import { createCommandRunner } from '$lib/utils/commandRunner.svelte.js';
 *   const runner = createCommandRunner();
 *   const { stdout, stderr, exitCode } = await runner.run('ls -la');
 *   runner.stop();
 */

// ── ANSI utilities ──────────────────────────────────────────────────

export function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

const ANSI_FG = {
    30: '#4d4d4d', 31: '#ff5555', 32: '#50fa7b', 33: '#f1fa8c',
    34: '#6272a4', 35: '#ff79c6', 36: '#8be9fd', 37: '#c9d1d9',
    90: '#6272a4', 91: '#ff6e6e', 92: '#69ff94', 93: '#ffffa5',
    94: '#d6acff', 95: '#ff92df', 96: '#a4ffff', 97: '#ffffff'
};

const ANSI_BG = {
    40: '#4d4d4d', 41: '#ff5555', 42: '#50fa7b', 43: '#f1fa8c',
    44: '#6272a4', 45: '#ff79c6', 46: '#8be9fd', 47: '#c9d1d9',
    100: '#6272a4', 101: '#ff6e6e', 102: '#69ff94', 103: '#ffffa5',
    104: '#d6acff', 105: '#ff92df', 106: '#a4ffff', 107: '#ffffff'
};

export function ansiToHtml(str) {
    let escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let result = '';
    let openSpan = false;

    const parts = escaped.split(/(\x1b\[[0-9;]*m)/);
    for (const part of parts) {
        const m = part.match(/^\x1b\[([0-9;]*)m$/);
        if (!m) {
            result += part;
            continue;
        }
        const codes = m[1].split(';').map(Number);
        if (codes.includes(0) || (codes.length === 1 && codes[0] === 0)) {
            if (openSpan) { result += '</span>'; openSpan = false; }
            continue;
        }
        let fg = null, bg = null, bold = false;
        for (const c of codes) {
            if (c === 1) bold = true;
            else if (ANSI_FG[c]) fg = ANSI_FG[c];
            else if (ANSI_BG[c]) bg = ANSI_BG[c];
        }
        if (fg || bg || bold) {
            if (openSpan) result += '</span>';
            let style = '';
            if (fg) style += `color:${fg};`;
            if (bg) style += `background:${bg};`;
            if (bold) style += 'font-weight:bold;';
            result += `<span style="${style}">`;
            openSpan = true;
        }
    }
    if (openSpan) result += '</span>';
    return result;
}

// ── Popup HTML ──────────────────────────────────────────────────────

function getPopupHtml() {
    const closeStyle = '<' + '/style>';
    const closeScript = '<' + '/script>';
    return '<!DOCTYPE html>'
        + '<html><head><title>Test Output</title>'
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
        + '<span>Test Output</span>'
        + '<span class="badge" id="status-badge"></span>'
        + '</div></div>'
        + '<pre id="output"></pre>'
        + closeScript
        + '</body></html>';
}

// ── Runner factory ──────────────────────────────────────────────────

/**
 * Create a command runner instance with reactive state.
 * @param {Object} opts
 * @param {() => boolean} opts.isRunning  - callback returning true when any task is running (for popup badge)
 * @param {() => string|null} opts.statusLabel - callback returning a label for the popup badge (e.g. component name)
 */
export function createCommandRunner({ isRunning, statusLabel } = {}) {
    let output = $state('');
    let popupWindow = $state(null);
    let activeAbortController = null;

    function openPopup() {
        if (popupWindow && !popupWindow.closed) {
            popupWindow.focus();
            syncPopup();
            return;
        }

        const w = 900;
        const h = 700;
        const left = (screen.width - w) / 2;
        const top = (screen.height - h) / 2;
        const popup = window.open('', 'test-output', `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
        if (!popup) return;

        popupWindow = popup;
        popup.document.write(getPopupHtml());
        popup.document.close();
        syncPopup();

        const interval = setInterval(() => {
            if (popup.closed) {
                popupWindow = null;
                clearInterval(interval);
                return;
            }
            syncPopup();
        }, 300);

        popup.addEventListener('beforeunload', () => {
            popupWindow = null;
            clearInterval(interval);
        });
    }

    function syncPopup() {
        if (!popupWindow || popupWindow.closed) return;
        const doc = popupWindow.document;
        const outputEl = doc.getElementById('output');
        const dotEl = doc.getElementById('status-dot');
        const badgeEl = doc.getElementById('status-badge');

        if (outputEl) {
            const wasAtBottom = outputEl.scrollHeight - outputEl.scrollTop - outputEl.clientHeight < 40;
            outputEl.innerHTML = ansiToHtml(output);
            if (wasAtBottom) outputEl.scrollTop = outputEl.scrollHeight;
        }
        const running = isRunning?.() ?? false;
        if (dotEl) {
            dotEl.className = running ? 'dot running' : 'dot done';
        }
        if (badgeEl) {
            badgeEl.textContent = running ? (statusLabel?.() || 'running') : 'done';
        }
    }

    /**
     * Stream a shell command, piping output to the popup window.
     * Returns { stdout, stderr, exitCode }.
     *
     * @param {string} shellCmd - shell command to execute
     * @param {Object} [opts]
     * @param {boolean} [opts.useAppCwd] - run from app project root
     * @param {function} [opts.onData] - callback (text, 'stdout'|'stderr') on each chunk
     * @param {boolean} [opts.appendOutput] - append to existing output instead of clearing
     * @param {string} [opts.label] - prefix for status messages (e.g. "AI-TEST")
     */
    async function run(shellCmd, opts = {}) {
        const { useAppCwd = false, onData, appendOutput = false, label } = opts;

        if (!appendOutput) output = '';

        const controller = new AbortController();
        activeAbortController = controller;

        openPopup();

        let collectedStdout = '';
        let collectedStderr = '';
        let exitCode = 1;

        try {
            const response = await fetch('/api/shell', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    command: shellCmd,
                    stream: true,
                    env: { FORCE_COLOR: '1' },
                    ...(useAppCwd ? { useAppCwd: true } : {})
                }),
                signal: controller.signal
            });

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let buffer = '';

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
                            collectedStdout += event.text;
                            output += event.text;
                            onData?.(event.text, 'stdout');
                        } else if (event.type === 'stderr') {
                            collectedStderr += event.text;
                            output += event.text;
                            onData?.(event.text, 'stderr');
                        } else if (event.type === 'done') {
                            exitCode = event.code ?? 1;
                        } else if (event.type === 'error') {
                            const msg = `\n${label ? `[${label}] ` : ''}Error: ${event.message}\n`;
                            output += msg;
                        }
                    } catch { /* skip */ }
                }
            }

            const tag = label ? `[${label}] ` : '';
            output += `\n${tag}Process exited with code ${exitCode}\n`;
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                const tag = label ? `[${label}] ` : '';
                output += `\n${tag}Stopped by user\n`;
            } else {
                throw err;
            }
        } finally {
            if (activeAbortController === controller) {
                activeAbortController = null;
            }
        }

        return { stdout: collectedStdout, stderr: collectedStderr, exitCode };
    }

    function stop() {
        if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
        }
    }

    function appendOutput(text) {
        output += text;
    }

    return {
        /** Stream a shell command. Returns { stdout, stderr, exitCode }. */
        run,
        /** Abort the currently running command. */
        stop,
        /** Open/focus the popup window. */
        openPopup,
        /** Append text to the output (e.g. status messages). */
        appendOutput,
        /** Reactive: current accumulated output text (with ANSI codes). */
        get output() { return output; },
        set output(v) { output = v; },
    };
}
