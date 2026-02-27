import fs from 'fs';
import path from 'path';
import { json } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';

/**
 * Recursively find files matching a pattern, returning relative paths.
 */
function findFiles(dir, filename, baseDir = dir) {
    const results = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return results;
    }
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findFiles(full, filename, baseDir));
        } else if (typeof filename === 'string' ? entry.name === filename : filename.test(entry.name)) {
            results.push(path.relative(baseDir, full));
        }
    }
    return results;
}

/**
 * Recursively count files matching a pattern.
 */
function countFiles(dir, filename) {
    let count = 0;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            count += countFiles(full, filename);
        } else if (typeof filename === 'string' ? entry.name === filename : filename.test(entry.name)) {
            count++;
        }
    }
    return count;
}

/** GET /api/statistics */
export const GET = async () => {
    const dir = getConnectorsDir();
    if (!dir) {
        return json({ error: 'No connectors directory set' }, { status: 400 });
    }

    // Collect bundle.json details
    const bundleFiles = findFiles(dir, 'bundle.json');
    const bundles = [];
    for (const rel of bundleFiles) {
        try {
            const full = path.join(dir, rel);
            const raw = JSON.parse(fs.readFileSync(full, 'utf-8'));
            bundles.push({ name: raw.name || '', version: raw.version || '', path: rel });
        } catch { /* skip */ }
    }
    bundles.sort((a, b) => a.name.localeCompare(b.name));
    const connectors = bundles.length;
    const components = countFiles(dir, 'component.json');
    const e2eFlowFiles = findFiles(dir, /^test-flow.*\.json$/);
    const e2eFlows = e2eFlowFiles.length;

    return json({ connectors, components, e2eFlows, e2eFlowFiles, bundles, directoryPath: dir });
};
