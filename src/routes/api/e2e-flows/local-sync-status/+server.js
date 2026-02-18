import { json, error } from '@sveltejs/kit';
import { fetchE2EFlows, fetchFlowById, cleanFlowForComparison } from '$lib/server/appmixer.js';
import { buildFlowNameToGitHubMap } from '$lib/server/github.js';
import crypto from 'crypto';

function getHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}

export async function POST({ request }) {
    try {
        const { localFlows } = await request.json();
        if (!localFlows || !Array.isArray(localFlows)) return error(400, 'localFlows array is required');

        // Fetch GitHub flow map
        const githubFlowMap = await buildFlowNameToGitHubMap().catch(e => {
            console.error('Failed to fetch GitHub flows:', e);
            return new Map();
        });

        // Fetch all E2E flows from Appmixer, build name → flow map
        const appmixerFlowMap = new Map();
        try {
            const appmixerFlows = await fetchE2EFlows();
            for (const f of appmixerFlows) {
                if (f.name) appmixerFlowMap.set(f.name, f);
            }
        } catch (e) {
            console.error('Failed to fetch Appmixer E2E flows:', e);
        }

        const statuses = {};
        await Promise.all(
            localFlows.map(async (lf) => {
                const result = {
                    githubSyncStatus: null,
                    githubUrl: null,
                    githubPath: null,
                    appmixerSyncStatus: null,
                    appmixerFlowId: null
                };

                // Compare vs GitHub
                const ghInfo = githubFlowMap.get(lf.name);
                if (ghInfo) {
                    result.githubUrl = ghInfo.url || null;
                    result.githubPath = ghInfo.path || null;
                    try {
                        const ghHash = getHash(JSON.stringify(ghInfo.content, null, 4));
                        result.githubSyncStatus = lf.localHash === ghHash ? 'match' : 'modified';
                    } catch {
                        result.githubSyncStatus = 'error';
                    }
                } else {
                    result.githubSyncStatus = 'local_only';
                }

                // Compare vs Appmixer
                const appmixerFlow = appmixerFlowMap.get(lf.name);
                if (appmixerFlow) {
                    result.appmixerFlowId = appmixerFlow.flowId;
                    result.appmixerStage = appmixerFlow.stage || 'stopped';
                    try {
                        const fullFlow = await fetchFlowById(appmixerFlow.flowId);
                        const serverHash = getHash(JSON.stringify(cleanFlowForComparison(fullFlow), null, 4));
                        result.appmixerSyncStatus = lf.localHash === serverHash ? 'match' : 'modified';
                    } catch {
                        result.appmixerSyncStatus = 'error';
                    }
                } else {
                    result.appmixerSyncStatus = 'local_only';
                }

                statuses[lf.name] = result;
            })
        );

        return json({ statuses });
    } catch (e) {
        console.error('Failed to compute local sync statuses:', e);
        return error(500, e.message || 'Failed to compute local sync statuses');
    }
}
