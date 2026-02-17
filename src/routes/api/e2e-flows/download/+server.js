import { json, error } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';
import { fetchFlowById, cleanFlowForComparison } from '$lib/server/appmixer.js';
import fs from 'fs';
import path from 'path';

export async function POST({ request }) {
    try {
        const { flowId, flowName, connector } = await request.json();
        if (!flowId || !flowName || !connector) {
            return error(400, 'flowId, flowName, and connector are required');
        }

        const connectorsDir = getConnectorsDir();
        if (!connectorsDir) return error(400, 'Connectors directory not configured');

        const fullFlow = await fetchFlowById(flowId);
        const cleaned = cleanFlowForComparison(fullFlow);
        const content = JSON.stringify(cleaned, null, 4);

        const safeName = flowName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const fileName = `test-flow-${safeName}.json`;
        const e2eDir = path.join(connectorsDir, connector, 'artifacts', 'e2e-flows');

        fs.mkdirSync(e2eDir, { recursive: true });
        fs.writeFileSync(path.join(e2eDir, fileName), content, 'utf-8');

        return json({
            success: true,
            localPath: path.join(connector, 'artifacts', 'e2e-flows', fileName),
            fileName
        });
    } catch (e) {
        console.error('Failed to download flow:', e);
        return error(500, e.message || 'Failed to download flow');
    }
}
