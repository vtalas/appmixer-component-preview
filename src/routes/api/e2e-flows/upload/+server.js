import { json, error } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';
import { updateFlow, createFlow, fetchE2EFlows } from '$lib/server/appmixer.js';
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

        // Always read the current version from disk
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const content = JSON.parse(raw);

        // Ensure E2E test flow tag is present so the flow appears in the E2E flows list
        if (!content.customFields) {
            content.customFields = {};
        }
        if (!content.customFields.category) {
            content.customFields.category = 'E2E_test_flow';
        }

        // Auto-detect: if flowId not provided, check if this flow already exists on Appmixer by name
        let resolvedFlowId = flowId;
        if (!resolvedFlowId && content.name) {
            try {
                const existingFlows = await fetchE2EFlows();
                const match = existingFlows.find(f => f.name === content.name);
                if (match) {
                    resolvedFlowId = match.flowId;
                }
            } catch (e) {
                console.error('Failed to check existing flows, will create new:', e.message);
            }
        }

        if (resolvedFlowId) {
            await updateFlow(resolvedFlowId, content);
            return json({ success: true, flowId: resolvedFlowId, action: 'updated' });
        } else {
            const result = await createFlow(content);
            return json({ success: true, flowId: result.flowId, action: 'created' });
        }
    } catch (e) {
        console.error('Failed to upload flow:', e);
        return error(500, e.message || 'Failed to upload flow');
    }
}
