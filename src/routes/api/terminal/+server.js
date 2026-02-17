import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { json } from '@sveltejs/kit';

const LOG_DIR = path.join(os.tmpdir(), 'appmixer-claude-sessions');

/** POST /api/terminal — launch claude in Terminal.app */
export const POST = async ({ request }) => {
    const { prompt, sessionId, cwd, context } = await request.json();

    const sid = sessionId || randomUUID();
    const logFile = path.join(LOG_DIR, `${sid}.log`);

    // Ensure log dir exists and create empty log file
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(logFile, '');

    // Build the claude command
    // Use --output-format stream-json so we can parse output in the web app.
    // Pipe through tee to capture to log file while also showing in terminal.
    // Use a python/node one-liner to pretty-print the JSON stream for the terminal.
    const fullPrompt = context && !sessionId
        ? `${context}\n\n---\n\nUser request: ${prompt}`
        : prompt;

    // Escape single quotes for shell
    const esc = (s) => s.replace(/'/g, "'\\''");

    // Build the shell script that will run in Terminal.app
    const script = `#!/bin/bash
cd '${esc(cwd || process.cwd())}'
export TERM=xterm-256color
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Claude Code — Terminal Session                             ║"
echo "║  Session: ${sid.slice(0, 8)}...                                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Run claude interactively with the prompt.
# Using -p for the initial prompt; claude will run its full flow
# including any tool approvals shown right here in the terminal.
claude -p '${esc(fullPrompt)}' \\
    --session-id '${sid}' \\
    --output-format stream-json \\
    --verbose \\
    2>'${esc(logFile)}.stderr' | tee '${esc(logFile)}'

EXIT_CODE=$?
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $EXIT_CODE -eq 0 ]; then
    echo "✓ Session complete."
else
    echo "✗ Session ended with exit code $EXIT_CODE"
fi
echo ""
echo "You can continue this session with: claude --resume --session-id '${sid}'"
echo "Or close this terminal window."
echo ""
# Signal completion
echo '{"type":"terminal_done","exitCode":'$EXIT_CODE'}' >> '${esc(logFile)}'
`;

    const scriptFile = path.join(LOG_DIR, `${sid}.sh`);
    fs.writeFileSync(scriptFile, script, { mode: 0o755 });

    // Open Terminal.app and run the script
    try {
        const appleScript = `tell application "Terminal"
    activate
    do script "${esc(scriptFile)}"
end tell`;
        execSync(`osascript -e '${esc(appleScript)}'`, { timeout: 5000 });
    } catch (err) {
        return json({
            error: `Failed to open Terminal: ${err.message}`
        }, { status: 500 });
    }

    return json({ sessionId: sid, logFile });
};

/** GET /api/terminal?sessionId=... — stream the log file as SSE */
export const GET = async ({ url, request }) => {
    const sid = url.searchParams.get('sessionId');
    if (!sid) {
        return json({ error: 'sessionId is required' }, { status: 400 });
    }

    const logFile = path.join(LOG_DIR, `${sid}.log`);
    if (!fs.existsSync(logFile)) {
        return json({ error: 'Log file not found' }, { status: 404 });
    }

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            let offset = 0;
            let closed = false;
            let done = false;

            function safeEnqueue(data) {
                if (!closed) {
                    try {
                        controller.enqueue(encoder.encode(data));
                    } catch { /* */ }
                }
            }

            function safeClose() {
                if (!closed) {
                    closed = true;
                    clearInterval(interval);
                    try { controller.close(); } catch { /* */ }
                }
            }

            // Poll the log file for new content
            const interval = setInterval(() => {
                if (closed || done) {
                    safeClose();
                    return;
                }

                try {
                    const stat = fs.statSync(logFile);
                    if (stat.size > offset) {
                        const fd = fs.openSync(logFile, 'r');
                        const buf = Buffer.alloc(stat.size - offset);
                        fs.readSync(fd, buf, 0, buf.length, offset);
                        fs.closeSync(fd);
                        offset = stat.size;

                        const text = buf.toString('utf-8');
                        const lines = text.split('\n').filter(l => l.trim());

                        for (const line of lines) {
                            try {
                                const event = JSON.parse(line);
                                safeEnqueue(`data: ${line}\n\n`);

                                if (event.type === 'terminal_done' || event.type === 'done') {
                                    done = true;
                                }
                            } catch {
                                // Not JSON, skip
                            }
                        }
                    }
                } catch {
                    // File might not exist yet or be in the middle of a write
                }
            }, 200);

            request.signal.addEventListener('abort', () => {
                safeClose();
            });
        },
        cancel() {
            // Cleanup handled by interval clearing
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            'Content-Encoding': 'identity'
        }
    });
};
