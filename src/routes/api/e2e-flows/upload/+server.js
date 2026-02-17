import { json, error } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';
import { updateFlow, createFlow } from '$lib/server/appmixer.js';
import fs from 'fs';
import path from 'path';

export async function POST({ request }) {
    try {
        const { localPath, flowId } = await request.json();
        if (!localPath) return error(400, 'localPath is required');

        const connectorsDir = getConnectorsDir();
        if (!connectorsDir) return error(400, 'Connectors directory not configured');

        const fullPath = path.join(connectorsDir, localPath);
        if (!fs.existsSync(fullPath)) return error(404, `File not found: ${localPath}`);

        const raw = fs.readFileSync(fullPath, 'utf-8');
        const content = JSON.parse(raw);

        if (flowId) {
            await updateFlow(flowId, content);
            return json({ success: true, flowId, action: 'updated' });
        } else {
            const result = await createFlow(content);
            return json({ success: true, flowId: result.flowId, action: 'created' });
        }
    } catch (e) {
        console.error('Failed to upload flow:', e);
        return error(500, e.message || 'Failed to upload flow');
    }
}
