import { json, error } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';
import fs from 'fs';
import path from 'path';

export async function POST({ request }) {
    try {
        const { localPath } = await request.json();
        if (!localPath) return error(400, 'localPath is required');

        const connectorsDir = getConnectorsDir();
        if (!connectorsDir) return error(400, 'Connectors directory not configured');

        const fullPath = path.join(connectorsDir, localPath);

        // Safety: ensure the resolved path is within connectorsDir
        const resolved = path.resolve(fullPath);
        const resolvedBase = path.resolve(connectorsDir);
        if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
            return error(403, 'Path outside connectors directory');
        }

        if (!fs.existsSync(resolved)) {
            return error(404, `File not found: ${localPath}`);
        }

        fs.unlinkSync(resolved);
        return json({ success: true });
    } catch (e) {
        if (e?.status) throw e;
        console.error('Failed to delete local flow:', e);
        return error(500, e.message || 'Failed to delete local flow');
    }
}
