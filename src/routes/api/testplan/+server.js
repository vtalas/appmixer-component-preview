import fs from 'fs';
import path from 'path';
import { json } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';

/** GET /api/testplan?connector=name — load test-plan.json */
export const GET = async ({ url }) => {
    const connector = url.searchParams.get('connector');
    if (!connector) {
        return json({ error: 'connector parameter is required' }, { status: 400 });
    }

    const dir = getConnectorsDir();
    if (!dir) {
        return json({ error: 'No connectors directory is open' }, { status: 400 });
    }

    const testPlanPath = path.join(dir, connector, 'artifacts', 'ai-artifacts', 'test-plan.json');
    try {
        if (!fs.existsSync(testPlanPath)) {
            return json({ data: null });
        }
        const content = fs.readFileSync(testPlanPath, 'utf-8');
        return json({ data: JSON.parse(content) });
    } catch {
        return json({ data: null });
    }
};

/** PUT /api/testplan?connector=name — save test-plan.json */
export const PUT = async ({ request, url }) => {
    const connector = url.searchParams.get('connector');
    if (!connector) {
        return json({ error: 'connector parameter is required' }, { status: 400 });
    }

    const dir = getConnectorsDir();
    if (!dir) {
        return json({ error: 'No connectors directory is open' }, { status: 400 });
    }

    const { data } = await request.json();
    const testPlanDir = path.join(dir, connector, 'artifacts', 'ai-artifacts');
    const testPlanPath = path.join(testPlanDir, 'test-plan.json');

    try {
        fs.mkdirSync(testPlanDir, { recursive: true });
        fs.writeFileSync(testPlanPath, JSON.stringify(data, null, 4), 'utf-8');
        return json({ success: true });
    } catch (err) {
        return json({ error: `Failed to save test plan: ${err.message}` }, { status: 500 });
    }
};
