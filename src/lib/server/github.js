/**
 * GitHub API client — env vars + module-level runtime overrides (no DB/auth).
 */

import { env } from '$env/dynamic/private';
import { getGitHubOverrides } from './state.js';

const GITHUB_API_BASE = 'https://api.github.com';
const TREE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let cachedTree = null;
let cachedTreeKey = null;
let treeCacheExpiry = null;

export function getGitHubConfig() {
    const overrides = getGitHubOverrides() || {};
    return {
        owner: overrides.owner || env.GITHUB_REPO_OWNER || 'clientIO',
        repo: overrides.repo || env.GITHUB_REPO_NAME || 'appmixer-connectors',
        branch: overrides.branch || env.GITHUB_REPO_BRANCH || 'dev',
        token: overrides.token || env.GITHUB_TOKEN || ''
    };
}

export function getGitHubRepoInfo() {
    const c = getGitHubConfig();
    const overrides = getGitHubOverrides() || {};
    return {
        owner: c.owner,
        repo: c.repo,
        branch: c.branch,
        url: `https://github.com/${c.owner}/${c.repo}/tree/${c.branch}`,
        hasEnvToken: !!env.GITHUB_TOKEN,
        hasCustomToken: !!overrides.token
    };
}

function getHeaders(token) {
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'appmixer-component-preview'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

async function getRepoTree(config) {
    const key = `${config.owner}/${config.repo}/${config.branch}`;
    if (cachedTree && cachedTreeKey === key && treeCacheExpiry && Date.now() < treeCacheExpiry) {
        return cachedTree;
    }
    const url = `${GITHUB_API_BASE}/repos/${config.owner}/${config.repo}/git/trees/${config.branch}?recursive=1`;
    const response = await fetch(url, { headers: getHeaders(config.token) });
    if (!response.ok) throw new Error(`Failed to fetch GitHub tree: ${response.status}`);
    const data = await response.json();
    cachedTree = data.tree;
    cachedTreeKey = key;
    treeCacheExpiry = Date.now() + TREE_CACHE_TTL;
    return cachedTree;
}

async function findTestFlowFiles() {
    const config = getGitHubConfig();
    const tree = await getRepoTree(config);
    return tree
        .filter(item =>
            item.type === 'blob' &&
            item.path.startsWith('src/appmixer/') &&
            item.path.includes('test-flow') &&
            item.path.endsWith('.json')
        )
        .map(file => ({
            path: file.path,
            sha: file.sha,
            connector: file.path.split('/')[2] || 'unknown',
            url: `https://github.com/${config.owner}/${config.repo}/blob/${config.branch}/${file.path}`
        }));
}

async function fetchFileContent(path) {
    const config = getGitHubConfig();
    const response = await fetch(
        `${GITHUB_API_BASE}/repos/${config.owner}/${config.repo}/contents/${path}?ref=${config.branch}`,
        { headers: getHeaders(config.token) }
    );
    if (!response.ok) throw new Error(`Failed to fetch file ${path}: ${response.status}`);
    const data = await response.json();
    return Buffer.from(data.content, 'base64').toString('utf-8');
}

async function fetchTestFlowJson(path) {
    const content = await fetchFileContent(path);
    return JSON.parse(content);
}

/**
 * Build a map of flow name -> GitHub file info (fetches content of each test-flow file).
 */
export async function buildFlowNameToGitHubMap() {
    const files = await findTestFlowFiles();
    const flowMap = new Map();
    const BATCH_SIZE = 10;

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
            batch.map(async (file) => {
                try {
                    const content = await fetchTestFlowJson(file.path);
                    return { file, content };
                } catch (e) {
                    console.error(`Failed to fetch ${file.path}:`, e.message);
                    return null;
                }
            })
        );
        for (const r of results) {
            if (r?.content?.name) {
                flowMap.set(r.content.name, { ...r.file, content: r.content });
            }
        }
    }
    return flowMap;
}

export function generateFlowPath(connector, flowName) {
    const safeName = flowName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return `src/appmixer/${connector}/test-flow-${safeName}.json`;
}

async function getBranchSha(branch) {
    const config = getGitHubConfig();
    const response = await fetch(
        `${GITHUB_API_BASE}/repos/${config.owner}/${config.repo}/git/ref/heads/${branch}`,
        { headers: getHeaders(config.token) }
    );
    if (!response.ok) throw new Error(`Failed to get branch SHA: ${response.status}`);
    const data = await response.json();
    return data.object.sha;
}

export async function createBranch(branchName, baseBranch) {
    const config = getGitHubConfig();
    const baseSha = await getBranchSha(baseBranch);
    const response = await fetch(
        `${GITHUB_API_BASE}/repos/${config.owner}/${config.repo}/git/refs`,
        {
            method: 'POST',
            headers: { ...getHeaders(config.token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha })
        }
    );
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Failed to create branch: ${err.message || response.status}`);
    }
    const data = await response.json();
    return { ref: data.ref, sha: data.object.sha };
}

async function getFileInfo(path, branch) {
    const config = getGitHubConfig();
    const response = await fetch(
        `${GITHUB_API_BASE}/repos/${config.owner}/${config.repo}/contents/${path}?ref=${branch}`,
        { headers: getHeaders(config.token) }
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Failed to get file info: ${response.status}`);
    const data = await response.json();
    return { sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf-8') };
}

export async function createOrUpdateFile(path, content, message, branch) {
    const config = getGitHubConfig();
    const existing = await getFileInfo(path, branch);
    const body = {
        message,
        content: Buffer.from(content).toString('base64'),
        branch
    };
    if (existing) body.sha = existing.sha;

    const response = await fetch(
        `${GITHUB_API_BASE}/repos/${config.owner}/${config.repo}/contents/${path}`,
        {
            method: 'PUT',
            headers: { ...getHeaders(config.token), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }
    );
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Failed to create/update file: ${err.message || response.status}`);
    }
    return response.json();
}

export async function createPullRequest(title, body, head, base) {
    const config = getGitHubConfig();
    const response = await fetch(
        `${GITHUB_API_BASE}/repos/${config.owner}/${config.repo}/pulls`,
        {
            method: 'POST',
            headers: { ...getHeaders(config.token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, head, base })
        }
    );
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Failed to create PR: ${err.message || response.status}`);
    }
    return response.json();
}

export async function verifyWriteAccess() {
    const config = getGitHubConfig();
    if (!config.token) return { hasWriteAccess: false, error: 'No GitHub token configured' };
    const response = await fetch(
        `${GITHUB_API_BASE}/repos/${config.owner}/${config.repo}`,
        { headers: getHeaders(config.token) }
    );
    if (!response.ok) return { hasWriteAccess: false, error: `Cannot access repository: ${response.status}` };
    const data = await response.json();
    if (!data.permissions?.push) return { hasWriteAccess: false, error: 'Token does not have write access' };
    return { hasWriteAccess: true };
}
