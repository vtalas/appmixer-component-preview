import { json, error } from '@sveltejs/kit';
import { fetchFlowById, cleanFlowForComparison } from '$lib/server/appmixer.js';
import { buildFlowNameToGitHubMap } from '$lib/server/github.js';

export async function POST({ request }) {
    try {
        const { flowId, flowName } = await request.json();
        if (!flowId || !flowName) return error(400, 'flowId and flowName are required');

        const [fullFlow, githubFlowMap] = await Promise.all([
            fetchFlowById(flowId),
            buildFlowNameToGitHubMap()
        ]);

        const ghInfo = githubFlowMap.get(flowName);
        if (!ghInfo) return error(404, 'Flow not found in GitHub repository');

        return json({
            server: JSON.stringify(cleanFlowForComparison(fullFlow), null, 2),
            github: JSON.stringify(ghInfo.content, null, 2),
            githubPath: ghInfo.path
        });
    } catch (e) {
        if (e?.status) throw e;
        console.error('Failed to compute diff:', e);
        return error(500, e.message || 'Failed to compute diff');
    }
}
