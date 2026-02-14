import { spawn } from 'child_process';
import { json } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';

/**
 * POST /api/shell — execute a shell command and return result
 * Body: { command: string, stream?: boolean }
 *
 * If stream=true, returns SSE stream.
 * Otherwise returns JSON with { code, stdout, stderr }.
 */
export const POST = async ({ request }) => {
    const { command, stream = false, env: extraEnv = {}, useAppCwd = false } = await request.json();

    if (!command || typeof command !== 'string') {
        return json({ error: 'command is required' }, { status: 400 });
    }

    const cwd = useAppCwd ? process.cwd() : (getConnectorsDir() || undefined);

    if (stream) {
        return streamCommand(command, cwd, extraEnv, request.signal);
    }

    return runCommand(command, cwd, extraEnv);
};

async function runCommand(command, cwd, extraEnv) {
    return new Promise((resolve) => {
        const child = spawn('sh', ['-l', '-c', command], {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd,
            env: { ...process.env, ...extraEnv }
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('close', (code) => {
            resolve(json({ code: code ?? 1, stdout, stderr }));
        });

        child.on('error', (err) => {
            resolve(json({ code: 1, stdout: '', stderr: err.message }));
        });
    });
}

function streamCommand(command, cwd, extraEnv, signal) {
    const child = spawn('sh', ['-l', '-c', command], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd,
        env: { ...process.env, ...extraEnv }
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

            function safeClose() {
                if (!closed) { closed = true; try { controller.close(); } catch { /* */ } }
            }

            child.stdout.on('data', (data) => {
                safeEnqueue(`data: ${JSON.stringify({ type: 'stdout', text: data.toString() })}\n\n`);
            });

            child.stderr.on('data', (data) => {
                safeEnqueue(`data: ${JSON.stringify({ type: 'stderr', text: data.toString() })}\n\n`);
            });

            child.on('close', (code) => {
                safeEnqueue(`data: ${JSON.stringify({ type: 'done', code: code ?? 1 })}\n\n`);
                safeClose();
            });

            child.on('error', (err) => {
                safeEnqueue(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
                safeClose();
            });

            if (signal) {
                signal.addEventListener('abort', () => {
                    child.kill('SIGTERM');
                    safeClose();
                });
            }
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
