import { json, error } from '@sveltejs/kit';
import { deleteFlow } from '$lib/server/appmixer.js';

export async function POST({ request }) {
    try {
        const { flowIds } = await request.json();
        if (!flowIds || !Array.isArray(flowIds) || flowIds.length === 0) {
            return error(400, 'No flow IDs provided');
        }

        const results = [];
        const errors = [];
        for (const flowId of flowIds) {
            try {
                await deleteFlow(flowId);
                results.push({ flowId, success: true });
            } catch (e) {
                console.error(`Failed to delete flow ${flowId}:`, e);
                errors.push({ flowId, error: e.message });
            }
        }

        return json({
            success: errors.length === 0,
            deleted: results,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (e) {
        console.error('Failed to delete flows:', e);
        return error(500, e.message || 'Failed to delete flows');
    }
}
