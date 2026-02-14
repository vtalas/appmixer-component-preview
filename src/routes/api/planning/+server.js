import { spawn } from 'child_process';
import { json } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * POST /api/planning — run the planning agent (SSE stream)
 * Body: { connector: string }
 */
export const POST = async ({ request }) => {
    const { connector } = await request.json();

    if (!connector) {
        return json({ error: 'connector is required' }, { status: 400 });
    }

    const connectorsDir = getConnectorsDir();
    if (!connectorsDir) {
        return json({ error: 'No connectors directory is open' }, { status: 400 });
    }

    // Compute connectorsRootDir by stripping /src/appmixer
    let connectorsRootDir = connectorsDir.replace(/\/+$/, '');
    if (connectorsRootDir.endsWith('/src/appmixer')) {
        connectorsRootDir = connectorsRootDir.slice(0, -'/src/appmixer'.length);
    }

    // Find the planning script — try multiple locations
    const scriptCandidates = [
        path.resolve(__dirname, '../../../../../../scripts/run-planning.mjs'),
        path.resolve(process.cwd(), 'scripts/run-planning.mjs'),
    ];

    let scriptPath = null;
    for (const candidate of scriptCandidates) {
        try {
            const fs = await import('fs');
            if (fs.existsSync(candidate)) {
                scriptPath = candidate;
                break;
            }
        } catch { /* */ }
    }

    if (!scriptPath) {
        scriptPath = path.resolve(process.cwd(), 'scripts/run-planning.mjs');
    }

    const cmdStr = `node "${scriptPath}" --connectorsDir "${connectorsRootDir}" --connector "${connector}" < /dev/null 2>&1`;

    const child = spawn('sh', ['-l', '-c', cmdStr], {
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

            request.signal.addEventListener('abort', () => {
                child.kill('SIGTERM');
                safeClose();
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
};
