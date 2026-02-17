import { json, error } from '@sveltejs/kit';
import { fetchFlowById, cleanFlowForComparison } from '$lib/server/appmixer.js';
import { buildFlowNameToGitHubMap } from '$lib/server/github.js';
import { getConnectorsDir } from '$lib/server/state.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function getHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}

function compareFlows(serverFlow, githubFlow) {
    if (!githubFlow) return 'server_only';
    const serverHash = getHash(JSON.stringify(cleanFlowForComparison(serverFlow), null, 4));
    const githubHash = getHash(JSON.stringify(githubFlow, null, 4));
    return serverHash === githubHash ? 'match' : 'modified';
}

function buildLocalFlowMap(connectorsDir) {
    const localMap = new Map();
    if (!connectorsDir || !fs.existsSync(connectorsDir)) return localMap;

    let connectorDirs;
    try {
        connectorDirs = fs.readdirSync(connectorsDir, { withFileTypes: true })
            .filter(d => d.isDirectory());
    } catch { return localMap; }

    for (const dir of connectorDirs) {
        const e2eDir = path.join(connectorsDir, dir.name, 'artifacts', 'e2e-flows');
        if (!fs.existsSync(e2eDir)) continue;

        let files;
        try {
            files = fs.readdirSync(e2eDir).filter(f => f.startsWith('test-flow-') && f.endsWith('.json'));
        } catch { continue; }

        for (const fileName of files) {
            try {
                const raw = fs.readFileSync(path.join(e2eDir, fileName), 'utf-8');
                const parsed = JSON.parse(raw);
                if (!parsed.name) continue;
                const cleaned = cleanFlowForComparison(parsed);
                const localHash = getHash(JSON.stringify(cleaned, null, 4));
                localMap.set(parsed.name, {
                    localPath: path.join(dir.name, 'artifacts', 'e2e-flows', fileName),
                    localHash
                });
            } catch { /* skip unparseable files */ }
        }
    }
    return localMap;
}

export async function POST({ request }) {
    try {
        const { flows } = await request.json();
        if (!flows || !Array.isArray(flows)) return error(400, 'flows array is required');

        const githubFlowMap = await buildFlowNameToGitHubMap().catch(e => {
            console.error('Failed to fetch GitHub flows:', e);
            return new Map();
        });

        const connectorsDir = getConnectorsDir();
        const localFlowMap = buildLocalFlowMap(connectorsDir);

        const statuses = {};
        await Promise.all(
            flows.map(async (flow) => {
                const ghInfo = githubFlowMap.get(flow.name);
                const localInfo = localFlowMap.get(flow.name);

                if (!ghInfo) {
                    // No GitHub match — still compute local sync
                    let localSyncStatus = null;
                    let localPath = null;
                    if (localInfo) {
                        localPath = localInfo.localPath;
                        // Need to fetch the full flow to compare with local
                        try {
                            const fullFlow = await fetchFlowById(flow.flowId);
                            const serverHash = getHash(JSON.stringify(cleanFlowForComparison(fullFlow), null, 4));
                            localSyncStatus = serverHash === localInfo.localHash ? 'match' : 'modified';
                        } catch {
                            localSyncStatus = 'error';
                        }
                    }
                    statuses[flow.flowId] = {
                        syncStatus: 'server_only',
                        githubUrl: null,
                        githubPath: null,
                        localSyncStatus,
                        localPath
                    };
                    return;
                }
                try {
                    const fullFlow = await fetchFlowById(flow.flowId);
                    const serverHash = getHash(JSON.stringify(cleanFlowForComparison(fullFlow), null, 4));

                    let localSyncStatus = null;
                    let localPath = null;
                    if (localInfo) {
                        localPath = localInfo.localPath;
                        localSyncStatus = serverHash === localInfo.localHash ? 'match' : 'modified';
                    }

                    statuses[flow.flowId] = {
                        syncStatus: compareFlows(fullFlow, ghInfo.content),
                        githubUrl: ghInfo.url || null,
                        githubPath: ghInfo.path || null,
                        localSyncStatus,
                        localPath
                    };
                } catch (e) {
                    console.error(`Failed to fetch flow ${flow.flowId}:`, e);
                    statuses[flow.flowId] = {
                        syncStatus: 'error',
                        githubUrl: ghInfo.url || null,
                        githubPath: ghInfo.path || null,
                        localSyncStatus: localInfo ? 'error' : null,
                        localPath: localInfo?.localPath || null
                    };
                }
            })
        );

        return json({ statuses });
    } catch (e) {
        console.error('Failed to compute sync statuses:', e);
        return error(500, e.message || 'Failed to compute sync statuses');
    }
}
