/**
 * Server-side state: holds the currently opened connectors directory path
 * and multi-instance Appmixer / GitHub configurations.
 * This is shared across all API routes via module-level state.
 */

let connectorsDir = null;

export function getConnectorsDir() {
    return connectorsDir;
}

export function setConnectorsDir(dir) {
    connectorsDir = dir;
}

// ── Appmixer instances ──────────────────────────────────────────────
/** @type {Map<string, {id:string, name:string, baseUrl:string, username:string, password:string}>} */
let appmixerInstances = new Map();
let activeAppmixerId = null; // null = use env vars

export function getAppmixerInstances() {
    return [...appmixerInstances.values()];
}

export function getAppmixerInstance(id) {
    return appmixerInstances.get(id) || null;
}

export function addAppmixerInstance(instance) {
    const id = instance.id || crypto.randomUUID();
    const entry = { id, name: instance.name || '', baseUrl: instance.baseUrl || '', username: instance.username || '', password: instance.password || '' };
    appmixerInstances.set(id, entry);
    return entry;
}

export function updateAppmixerInstance(id, data) {
    const existing = appmixerInstances.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...data, id }; // id cannot change
    appmixerInstances.set(id, updated);
    return updated;
}

export function deleteAppmixerInstance(id) {
    const deleted = appmixerInstances.delete(id);
    if (activeAppmixerId === id) activeAppmixerId = null;
    return deleted;
}

export function getActiveAppmixerId() {
    return activeAppmixerId;
}

export function setActiveAppmixerId(id) {
    if (id === null || id === 'env-default') {
        activeAppmixerId = null;
    } else if (appmixerInstances.has(id)) {
        activeAppmixerId = id;
    }
}

// ── GitHub instances ────────────────────────────────────────────────
/** @type {Map<string, {id:string, name:string, owner:string, repo:string, branch:string, token:string}>} */
let githubInstances = new Map();
let activeGithubId = null; // null = use env vars

export function getGitHubInstances() {
    return [...githubInstances.values()];
}

export function getGitHubInstance(id) {
    return githubInstances.get(id) || null;
}

export function addGitHubInstance(instance) {
    const id = instance.id || crypto.randomUUID();
    const entry = { id, name: instance.name || '', owner: instance.owner || '', repo: instance.repo || '', branch: instance.branch || '', token: instance.token || '' };
    githubInstances.set(id, entry);
    return entry;
}

export function updateGitHubInstance(id, data) {
    const existing = githubInstances.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...data, id };
    githubInstances.set(id, updated);
    return updated;
}

export function deleteGitHubInstance(id) {
    const deleted = githubInstances.delete(id);
    if (activeGithubId === id) activeGithubId = null;
    return deleted;
}

export function getActiveGithubId() {
    return activeGithubId;
}

export function setActiveGithubId(id) {
    if (id === null || id === 'env-default') {
        activeGithubId = null;
    } else if (githubInstances.has(id)) {
        activeGithubId = id;
    }
}

// ── Backward-compatible getters (used by appmixer.js / github.js) ──

/**
 * Returns the active Appmixer instance config, or null if using env vars.
 */
export function getAppmixerOverrides() {
    if (!activeAppmixerId) return null;
    const inst = appmixerInstances.get(activeAppmixerId);
    if (!inst) return null;
    return { baseUrl: inst.baseUrl, username: inst.username, password: inst.password };
}

export function setAppmixerOverrides(config) {
    // Legacy compat: if called with a config object, upsert as a "legacy" instance
    if (!config) {
        activeAppmixerId = null;
        return;
    }
    const id = 'legacy';
    appmixerInstances.set(id, { id, name: 'Legacy', baseUrl: config.baseUrl || '', username: config.username || '', password: config.password || '' });
    activeAppmixerId = id;
}

/**
 * Returns the active GitHub instance config, or null if using env vars.
 */
export function getGitHubOverrides() {
    if (!activeGithubId) return null;
    const inst = githubInstances.get(activeGithubId);
    if (!inst) return null;
    return { owner: inst.owner, repo: inst.repo, branch: inst.branch, token: inst.token };
}

export function setGitHubOverrides(config) {
    if (!config) {
        activeGithubId = null;
        return;
    }
    const id = 'legacy';
    githubInstances.set(id, { id, name: 'Legacy', owner: config.owner || '', repo: config.repo || '', branch: config.branch || '', token: config.token || '' });
    activeGithubId = id;
}
