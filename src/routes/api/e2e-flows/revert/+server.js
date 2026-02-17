import { json, error } from '@sveltejs/kit';
import { updateFlow } from '$lib/server/appmixer.js';
import { buildFlowNameToGitHubMap } from '$lib/server/github.js';

export async function POST({ request }) {
    try {
        const { flowId, flowName } = await request.json();
        if (!flowId || !flowName) return error(400, 'flowId and flowName are required');

        const githubFlowMap = await buildFlowNameToGitHubMap();
        const ghInfo = githubFlowMap.get(flowName);
        if (!ghInfo?.content) return error(404, 'Flow not found in GitHub repository');

        await updateFlow(flowId, ghInfo.content);
        return json({ success: true });
    } catch (e) {
        if (e?.status) throw e;
        console.error('Failed to revert flow:', e);
        return error(500, e.message || 'Failed to revert flow');
    }
}
