import { execSync } from 'child_process';
import { json } from '@sveltejs/kit';
import { getConnectorsDir } from '$lib/server/state.js';

function run(cmd, cwd) {
    try {
        return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {
        return null;
    }
}

/** GET /api/git-info — return git & gh info for the connectors directory */
export const GET = async () => {
    const dir = getConnectorsDir();
    if (!dir) {
        return json({ error: 'No connectors directory is open' }, { status: 400 });
    }

    const branch = run('git branch --show-current', dir);
    const remoteUrl = run('git remote get-url origin', dir);
    const repoRoot = run('git rev-parse --show-toplevel', dir);

    // Try to get GitHub repo info via gh
    let ghRepo = null;
    const ghJson = run('gh repo view --json nameWithOwner,url,defaultBranchRef 2>/dev/null', dir);
    if (ghJson) {
        try {
            ghRepo = JSON.parse(ghJson);
        } catch { /* */ }
    }

    // Check if gh is available
    const ghAvailable = run('which gh', dir) !== null;

    return json({
        branch,
        remoteUrl,
        repoRoot,
        ghAvailable,
        ghRepo
    });
};
