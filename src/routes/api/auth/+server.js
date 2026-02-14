import fs from 'fs';
import path from 'path';
import { json } from '@sveltejs/kit';
import { spawn } from 'child_process';
import { getConnectorsDir } from '$lib/server/state.js';

/**
 * Recursively find a file by name within a directory.
 */
function findFile(dirPath, fileName, depth = 0, maxDepth = 4) {
    if (depth > maxDepth) return null;
    const SKIP = new Set(['node_modules', '.git', '.github', 'artifacts', 'dist', 'build']);

    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() && entry.name === fileName) {
                return path.join(dirPath, entry.name);
            }
        }
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIP.has(entry.name)) {
                const found = findFile(path.join(dirPath, entry.name), fileName, depth + 1, maxDepth);
                if (found) return found;
            }
        }
    } catch { /* ignore */ }
    return null;
}

/** GET /api/auth?connector=name — get auth info */
export const GET = async ({ url }) => {
    const connector = url.searchParams.get('connector');
    if (!connector) {
        return json({ error: 'connector parameter is required' }, { status: 400 });
    }

    const dir = getConnectorsDir();
    if (!dir) {
        return json({ found: false });
    }

    const connectorPath = path.join(dir, connector);
    const authJsPath = findFile(connectorPath, 'auth.js');

    if (!authJsPath) {
        return json({ found: false, authType: null, fullPath: null });
    }

    try {
        const content = fs.readFileSync(authJsPath, 'utf-8');
        const typeMatch = content.match(/type:\s*['"](\w+)['"]/);
        const authType = typeMatch ? typeMatch[1] : null;
        return json({ found: true, authType, fullPath: authJsPath });
    } catch {
        return json({ found: false, authType: null, fullPath: null });
    }
};

/** POST /api/auth/validate — validate auth */
export const POST = async ({ request }) => {
    const { action, authPath, command } = await request.json();

    if (action === 'validate' && authPath) {
        return runShellCommand(`appmixer test auth validate "${authPath}"`);
    }

    if (action === 'refresh' && authPath) {
        return runShellCommand(`appmixer test auth refresh "${authPath}"`);
    }

    if (action === 'login' && command) {
        return streamShellCommand(command);
    }

    if (action === 'kill-port') {
        return runShellCommand('lsof -ti :2300 | xargs kill -9 2>/dev/null || true');
    }

    return json({ error: 'Invalid action' }, { status: 400 });
};

async function runShellCommand(cmd) {
    return new Promise((resolve) => {
        const child = spawn('sh', ['-l', '-c', cmd], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env }
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('close', (code) => {
            resolve(json({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
        });

        child.on('error', (err) => {
            resolve(json({ code: 1, stdout: '', stderr: err.message }));
        });
    });
}

function streamShellCommand(cmd) {
    const child = spawn('sh', ['-l', '-c', cmd], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
    });

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            let closed = false;

            function safeEnqueue(data) {
                if (!closed) {
                    try { controller.enqueue(encoder.encode(data)); } catch { /* */ }
                }
            }

            child.stdout.on('data', (data) => {
                safeEnqueue(`data: ${JSON.stringify({ type: 'stdout', text: data.toString() })}\n\n`);
            });

            child.stderr.on('data', (data) => {
                safeEnqueue(`data: ${JSON.stringify({ type: 'stderr', text: data.toString() })}\n\n`);
            });

            child.on('close', (code) => {
                safeEnqueue(`data: ${JSON.stringify({ type: 'done', code })}\n\n`);
                if (!closed) { closed = true; try { controller.close(); } catch { /* */ } }
            });

            child.on('error', (err) => {
                safeEnqueue(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
                if (!closed) { closed = true; try { controller.close(); } catch { /* */ } }
            });
        },
        cancel() {
            child.kill('SIGTERM');
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Content-Encoding': 'identity'
        }
    });
}
