import { json, error } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';
import { cleanFlowForComparison } from '$lib/server/appmixer.js';
import { execSync } from 'child_process';
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

/**
 * Get git status for a file relative to the repo root.
 * Returns: 'modified' | 'added' | 'untracked' | 'clean' | null (not a git repo)
 */
function getGitStatus(filePath, repoRoot) {
    if (!repoRoot) return null;
    try {
        const relToRepo = path.relative(repoRoot, filePath);
        const porcelain = execSync(
            `git status --porcelain -- ${JSON.stringify(relToRepo)}`,
            { cwd: repoRoot, encoding: 'utf-8', timeout: 5000 }
        ).trim();
        if (!porcelain) return 'clean';
        const code = porcelain.substring(0, 2);
        if (code === '??') return 'untracked';
        if (code.includes('A')) return 'added';
        return 'modified';
    } catch {
        return null;
    }
}

/**
 * Find the git repo root for the connectors directory (cached per request).
 */
function findRepoRoot(dir) {
    try {
        return execSync('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {
        return null;
    }
}

export async function GET({ url }) {
    try {
        const connector = url.searchParams.get('connector');
        if (!connector) return error(400, 'connector parameter is required');

        const connectorsDir = getConnectorsDir();
        if (!connectorsDir) return json({ localFlows: [], error: 'Connectors directory not configured' });

        const repoRoot = findRepoRoot(connectorsDir);

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
                    const gitStatus = getGitStatus(filePath, repoRoot);
                    localFlows.push({
                        name,
                        connector,
                        localPath: relativePath,
                        fileName,
                        localHash,
                        gitStatus
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
