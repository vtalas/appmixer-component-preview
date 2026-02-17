import { json, error } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';
import { cleanFlowForComparison } from '$lib/server/appmixer.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function getHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}

export async function GET({ url }) {
    try {
        const connector = url.searchParams.get('connector');
        if (!connector) return error(400, 'connector parameter is required');

        const connectorsDir = getConnectorsDir();
        if (!connectorsDir) return json({ localFlows: [], error: 'Connectors directory not configured' });

        const e2eDir = path.join(connectorsDir, connector, 'artifacts', 'e2e-flows');
        if (!fs.existsSync(e2eDir)) return json({ localFlows: [] });

        const files = fs.readdirSync(e2eDir).filter(f => f.startsWith('test-flow-') && f.endsWith('.json'));
        const localFlows = [];

        for (const fileName of files) {
            const filePath = path.join(e2eDir, fileName);
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const parsed = JSON.parse(raw);
                const cleaned = cleanFlowForComparison(parsed);
                const localHash = getHash(JSON.stringify(cleaned, null, 4));
                localFlows.push({
                    name: parsed.name || fileName,
                    connector,
                    localPath: path.join(connector, 'artifacts', 'e2e-flows', fileName),
                    fileName,
                    localHash
                });
            } catch (e) {
                console.error(`Failed to parse local flow ${filePath}:`, e.message);
            }
        }

        return json({ localFlows });
    } catch (e) {
        console.error('Failed to scan local flows:', e);
        return error(500, e.message || 'Failed to scan local flows');
    }
}
