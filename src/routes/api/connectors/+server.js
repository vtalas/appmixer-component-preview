import fs from 'fs';
import path from 'path';
import { json } from '@sveltejs/kit';
import { getConnectorsDir, setConnectorsDir } from '$lib/server/state.js';

const SKIP_DIRS = new Set([
    'node_modules', '.git', '.github', 'artifacts', 'test', 'tests',
    '__tests__', 'dist', 'build', '.svelte-kit', '.vscode'
]);

function shouldScanDir(name) {
    if (!name || name.startsWith('.')) return false;
    return !SKIP_DIRS.has(name);
}

function scanConnectors(basePath) {
    const connectors = [];

    let topEntries;
    try {
        topEntries = fs.readdirSync(basePath, { withFileTypes: true });
    } catch {
        return connectors;
    }

    for (const connectorEntry of topEntries) {
        if (!connectorEntry.isDirectory() || !shouldScanDir(connectorEntry.name)) continue;

        const connectorPath = path.join(basePath, connectorEntry.name);
        const modules = [];
        let connectorLabel;
        let connectorIcon;

        // Try to read service.json
        const servicePath = path.join(connectorPath, 'service.json');
        try {
            if (fs.existsSync(servicePath)) {
                const serviceJson = JSON.parse(fs.readFileSync(servicePath, 'utf-8'));
                connectorLabel = serviceJson.label;
                connectorIcon = serviceJson.icon;
            }
        } catch { /* optional */ }

        let moduleEntries;
        try {
            moduleEntries = fs.readdirSync(connectorPath, { withFileTypes: true });
        } catch { continue; }

        for (const moduleEntry of moduleEntries) {
            if (!moduleEntry.isDirectory() || !shouldScanDir(moduleEntry.name)) continue;

            const modulePath = path.join(connectorPath, moduleEntry.name);
            const components = [];

            let componentEntries;
            try {
                componentEntries = fs.readdirSync(modulePath, { withFileTypes: true });
            } catch { continue; }

            for (const compEntry of componentEntries) {
                if (!compEntry.isDirectory() || !shouldScanDir(compEntry.name)) continue;

                const compJsonPath = path.join(modulePath, compEntry.name, 'component.json');
                try {
                    if (fs.existsSync(compJsonPath)) {
                        const content = fs.readFileSync(compJsonPath, 'utf-8');
                        const componentJson = JSON.parse(content);
                        components.push({
                            name: compEntry.name,
                            label: componentJson.label || compEntry.name,
                            path: `${connectorEntry.name}/${moduleEntry.name}/${compEntry.name}`,
                            componentJson
                        });
                    }
                } catch { /* skip bad files */ }
            }

            if (components.length > 0) {
                components.sort((a, b) => a.name.localeCompare(b.name));
                modules.push({ name: moduleEntry.name, components });
            }
        }

        if (modules.length > 0) {
            modules.sort((a, b) => a.name.localeCompare(b.name));
            connectors.push({
                name: connectorEntry.name,
                label: connectorLabel,
                icon: connectorIcon,
                modules
            });
        }
    }

    connectors.sort((a, b) => a.name.localeCompare(b.name));
    return connectors;
}

/** GET /api/connectors — return the current tree + directory info */
export const GET = async () => {
    const dir = getConnectorsDir();
    if (!dir) {
        return json({ connectors: [], directoryPath: null, directoryName: null });
    }
    const connectors = scanConnectors(dir);
    const directoryName = path.basename(dir);
    return json({ connectors, directoryPath: dir, directoryName });
};

/** POST /api/connectors — set connectors directory and scan */
export const POST = async ({ request }) => {
    const { directoryPath } = await request.json();
    if (!directoryPath || typeof directoryPath !== 'string') {
        return json({ error: 'directoryPath is required' }, { status: 400 });
    }

    if (!fs.existsSync(directoryPath)) {
        return json({ error: 'Directory does not exist' }, { status: 404 });
    }

    setConnectorsDir(directoryPath);
    const connectors = scanConnectors(directoryPath);
    const directoryName = path.basename(directoryPath);
    return json({ connectors, directoryPath, directoryName });
};
