import fs from 'fs';
import path from 'path';
import { json } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';

/** GET /api/component?path=connector/module/component — read component.json */
export const GET = async ({ url }) => {
    const componentPath = url.searchParams.get('path');
    if (!componentPath) {
        return json({ error: 'path parameter is required' }, { status: 400 });
    }

    const dir = getConnectorsDir();
    if (!dir) {
        return json({ error: 'No connectors directory is open' }, { status: 400 });
    }

    const filePath = path.join(dir, componentPath, 'component.json');
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const componentJson = JSON.parse(content);
        return json({ componentJson });
    } catch (err) {
        return json({ error: `Failed to read component: ${err.message}` }, { status: 500 });
    }
};

/** PUT /api/component?path=connector/module/component — write component.json */
export const PUT = async ({ request, url }) => {
    const componentPath = url.searchParams.get('path');
    if (!componentPath) {
        return json({ error: 'path parameter is required' }, { status: 400 });
    }

    const dir = getConnectorsDir();
    if (!dir) {
        return json({ error: 'No connectors directory is open' }, { status: 400 });
    }

    const { componentJson } = await request.json();
    if (!componentJson) {
        return json({ error: 'componentJson is required' }, { status: 400 });
    }

    const componentDir = path.join(dir, componentPath);
    const filePath = path.join(componentDir, 'component.json');
    try {
        fs.mkdirSync(componentDir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(componentJson, null, 4), 'utf-8');
        return json({ success: true });
    } catch (err) {
        return json({ error: `Failed to write component: ${err.message}` }, { status: 500 });
    }
};
