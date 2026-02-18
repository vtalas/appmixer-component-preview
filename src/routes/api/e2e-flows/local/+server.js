import { json, error } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';
import { cleanFlowForComparison } from '$lib/server/appmixer.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function getHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Returns the list of directories to scan for test-flow-*.json files,
 * matching the same locations as the CLI's listTestFlows tool.
 */
function getTestFlowLocations(connectorsDir, connector) {
    const connectorDir = path.join(connectorsDir, connector);
    return [
        connectorDir,
        path.join(connectorDir, 'ai-artifacts', 'test-flows'),
        path.join(connectorDir, 'artifacts', 'test-flows'),
        path.join(connectorDir, 'artifacts', 'ai-artifacts', 'test-flows')
    ];
}

export async function GET({ url }) {
    try {
        const connector = url.searchParams.get('connector');
        if (!connector) return error(400, 'connector parameter is required');

        const connectorsDir = getConnectorsDir();
        if (!connectorsDir) return json({ localFlows: [], error: 'Connectors directory not configured' });

        const localFlows = [];
        const seenNames = new Set();
        const locations = getTestFlowLocations(connectorsDir, connector);

        for (const dir of locations) {
            if (!fs.existsSync(dir)) continue;

            let files;
            try {
                files = fs.readdirSync(dir).filter(f => f.startsWith('test-flow') && f.endsWith('.json'));
            } catch { continue; }

            for (const fileName of files) {
                const filePath = path.join(dir, fileName);
                try {
                    const raw = fs.readFileSync(filePath, 'utf-8');
                    const parsed = JSON.parse(raw);
                    // Only include files that have a "flow" property (valid test flows)
                    if (!parsed.flow) continue;
                    const name = parsed.name || fileName;
                    // Deduplicate by name (first found wins)
                    if (seenNames.has(name)) continue;
                    seenNames.add(name);
                    const cleaned = cleanFlowForComparison(parsed);
                    const localHash = getHash(JSON.stringify(cleaned, null, 4));
                    // Store the path relative to connectorsDir
                    const relativePath = path.relative(connectorsDir, filePath);
                    localFlows.push({
                        name,
                        connector,
                        localPath: relativePath,
                        fileName,
                        localHash
                    });
                } catch (e) {
                    console.error(`Failed to parse local flow ${filePath}:`, e.message);
                }
            }
        }

        return json({ localFlows });
    } catch (e) {
        console.error('Failed to scan local flows:', e);
        return error(500, e.message || 'Failed to scan local flows');
    }
}
