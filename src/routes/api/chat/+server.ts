import { spawn } from 'child_process';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const { prompt, sessionId, cwd } = await request.json();

	if (!prompt || typeof prompt !== 'string') {
		return new Response(JSON.stringify({ error: 'prompt is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const args = [
		'--output-format', 'stream-json',
		'--verbose',
		'-p', prompt
	];

	if (sessionId) {
		args.push('--session-id', sessionId);
	}

	const child = spawn('claude', args, {
		stdio: ['ignore', 'pipe', 'pipe'],
		cwd: cwd || undefined,
		env: {
			...process.env,
			HOME: process.env.HOME || ''
		}
	});

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			let closed = false;

			function safeEnqueue(data: string) {
				if (!closed) {
					try {
						controller.enqueue(encoder.encode(data));
					} catch {
						// Controller already closed
					}
				}
			}

			function safeClose() {
				if (!closed) {
					closed = true;
					try {
						controller.close();
					} catch {
						// Already closed
					}
				}
			}

			child.stdout.on('data', (data: Buffer) => {
				const text = data.toString();
				const lines = text.split('\n').filter((l: string) => l.trim());
				for (const line of lines) {
					try {
						JSON.parse(line);
						safeEnqueue(`data: ${line}\n\n`);
					} catch {
						// Not JSON, skip
					}
				}
			});

			child.stderr.on('data', (data: Buffer) => {
				const text = data.toString().trim();
				if (text) {
					safeEnqueue(`data: ${JSON.stringify({ type: 'stderr', content: text })}\n\n`);
				}
			});

			child.on('close', (code: number | null) => {
				safeEnqueue(`data: ${JSON.stringify({ type: 'done', exitCode: code })}\n\n`);
				safeClose();
			});

			child.on('error', (err: Error) => {
				safeEnqueue(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
				safeClose();
			});

			// Handle client disconnect
			request.signal.addEventListener('abort', () => {
				closed = true;
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
			'X-Accel-Buffering': 'no',
			// Prevent Vite's built-in @polka/compression from buffering the stream.
			// Setting any Content-Encoding causes the compression middleware to skip.
			'Content-Encoding': 'identity'
		}
	});
};
