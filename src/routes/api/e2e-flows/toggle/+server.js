import { json, error } from '@sveltejs/kit';
import { startFlow, stopFlow } from '$lib/server/appmixer.js';

export async function POST({ request }) {
    try {
        const { flowId, action } = await request.json();
        if (!flowId) return error(400, 'flowId is required');
        if (action !== 'start' && action !== 'stop') return error(400, 'action must be "start" or "stop"');

        if (action === 'start') {
            await startFlow(flowId);
        } else {
            await stopFlow(flowId);
        }
        return json({ success: true, action });
    } catch (e) {
        console.error('Failed to toggle flow:', e);
        return error(500, e.message || 'Failed to toggle flow');
    }
}
