import { json, error } from '@sveltejs/kit';
import { fetchFlowById, cleanFlowForComparison } from '$lib/server/appmixer.js';
import {
    getGitHubConfig,
    createBranch,
    createOrUpdateFile,
    createPullRequest,
    generateFlowPath,
    verifyWriteAccess
} from '$lib/server/github.js';

export async function POST({ request }) {
    try {
        const { flows, prTitle, prDescription, targetBranch } = await request.json();

        if (!flows || !Array.isArray(flows) || flows.length === 0) return error(400, 'No flows provided');
        if (!prTitle?.trim()) return error(400, 'PR title is required');
        if (!targetBranch?.trim()) return error(400, 'Target branch is required');

        const accessCheck = await verifyWriteAccess();
        if (!accessCheck.hasWriteAccess) return error(403, accessCheck.error || 'No write access');

        const branchName = `sync-e2e-flows-${Date.now()}`;
        await createBranch(branchName, targetBranch);

        const results = [];
        const errors = [];

        for (const flowInfo of flows) {
            try {
                const fullFlow = await fetchFlowById(flowInfo.flowId);
                const cleaned = cleanFlowForComparison(fullFlow);
                const filePath = flowInfo.githubPath || generateFlowPath(flowInfo.connector || 'unknown', flowInfo.name);
                const content = JSON.stringify(cleaned, null, 4);
                await createOrUpdateFile(filePath, content, `Sync E2E flow: ${flowInfo.name}`, branchName);
                results.push({ flowId: flowInfo.flowId, name: flowInfo.name, path: filePath, success: true });
            } catch (e) {
                console.error(`Failed to sync flow ${flowInfo.flowId}:`, e);
                errors.push({ flowId: flowInfo.flowId, name: flowInfo.name, error: e.message });
            }
        }

        if (results.length === 0) return error(500, `Failed to sync any flows: ${errors.map(e => e.error).join(', ')}`);

        const config = getGitHubConfig();
        const prBody = [
            prDescription || '',
            '', '## Synced Flows', '',
            ...results.map(r => `- \`${r.path}\` - ${r.name}`),
            '',
            errors.length > 0 ? ['## Errors', '', ...errors.map(e => `- ${e.name}: ${e.error}`), ''].join('\n') : '',
            '---',
            `*Synced from ${config.owner}/${config.repo} via Appmixer Component Preview*`
        ].filter(Boolean).join('\n');

        const pr = await createPullRequest(prTitle.trim(), prBody, branchName, targetBranch);

        return json({
            success: true,
            prUrl: pr.html_url,
            prNumber: pr.number,
            branch: branchName,
            synced: results,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (e) {
        if (e?.status) throw e;
        console.error('Failed to sync flows:', e);
        return error(500, e.message || 'Failed to sync flows');
    }
}
