/**
 * Appmixer API client — env vars + module-level runtime overrides (no DB/auth).
 */

import { env } from '$env/dynamic/private';
import { getAppmixerOverrides } from './state.js';

const TOKEN_TTL = 55 * 60 * 1000; // 55 minutes
let cachedToken = null;
let tokenExpiry = 0;
let tokenConfigKey = '';

/**
 * Resolve Appmixer config: runtime overrides take precedence over env vars.
 */
export function getAppmixerConfig() {
    const overrides = getAppmixerOverrides() || {};
    const baseUrl = (overrides.baseUrl || env.APPMIXER_BASE_URL || '').replace(/\/+$/, '');
    return {
        baseUrl,
        username: overrides.username || env.APPMIXER_USERNAME || '',
        password: overrides.password || env.APPMIXER_PASSWORD || ''
    };
}

export function isAppmixerConfigured() {
    const c = getAppmixerConfig();
    return !!(c.baseUrl && c.username && c.password);
}

export function getAppmixerInfo() {
    const c = getAppmixerConfig();
    const overrides = getAppmixerOverrides() || {};
    return {
        baseUrl: c.baseUrl,
        username: c.username,
        hasEnvCredentials: !!(env.APPMIXER_BASE_URL && env.APPMIXER_USERNAME && env.APPMIXER_PASSWORD),
        hasCustomCredentials: !!(overrides.baseUrl && overrides.username && overrides.password)
    };
}

async function getAccessToken() {
    const config = getAppmixerConfig();
    const key = `${config.baseUrl}:${config.username}`;

    if (cachedToken && tokenConfigKey === key && Date.now() < tokenExpiry) {
        return cachedToken;
    }

    if (!config.baseUrl || !config.username || !config.password) {
        throw new Error('Appmixer credentials not configured');
    }

    const response = await fetch(`${config.baseUrl}/user/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: config.username, password: config.password })
    });

    if (!response.ok) {
        throw new Error(`Appmixer auth failed: ${response.status}`);
    }

    const data = await response.json();
    cachedToken = data.token;
    tokenExpiry = Date.now() + TOKEN_TTL;
    tokenConfigKey = key;
    return cachedToken;
}

export async function fetchE2EFlows() {
    const config = getAppmixerConfig();
    const token = await getAccessToken();
    const response = await fetch(
        `${config.baseUrl}/flows?filter=customFields.category:E2E_test_flow&projection=name,flowId&limit=1000`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!response.ok) throw new Error(`Failed to fetch E2E flows: ${response.status}`);
    return response.json();
}

export async function fetchFlowById(flowId) {
    const config = getAppmixerConfig();
    const token = await getAccessToken();
    const response = await fetch(
        `${config.baseUrl}/flows/${flowId}?projection=-thumbnail,-stageChangeInfo,-started,-stopped`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!response.ok) throw new Error(`Failed to fetch flow ${flowId}: ${response.status}`);
    return response.json();
}

export async function startFlow(flowId) {
    const config = getAppmixerConfig();
    const token = await getAccessToken();
    const response = await fetch(`${config.baseUrl}/flows/${flowId}/coordinator`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'start' })
    });
    if (!response.ok) throw new Error(`Failed to start flow ${flowId}: ${response.status}`);
}

export async function stopFlow(flowId) {
    const config = getAppmixerConfig();
    const token = await getAccessToken();
    const response = await fetch(`${config.baseUrl}/flows/${flowId}/coordinator`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'stop' })
    });
    if (!response.ok) throw new Error(`Failed to stop flow ${flowId}: ${response.status}`);
}

export async function updateFlow(flowId, flowData) {
    const config = getAppmixerConfig();
    const token = await getAccessToken();
    const response = await fetch(`${config.baseUrl}/flows/${flowId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(flowData)
    });
    if (!response.ok) throw new Error(`Failed to update flow ${flowId}: ${response.status}`);
}

export async function createFlow(flowData) {
    const config = getAppmixerConfig();
    const token = await getAccessToken();
    const response = await fetch(`${config.baseUrl}/flows`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(flowData)
    });
    if (!response.ok) throw new Error(`Failed to create flow: ${response.status}`);
    return response.json();
}

export async function deleteFlow(flowId) {
    const config = getAppmixerConfig();
    const token = await getAccessToken();
    const response = await fetch(`${config.baseUrl}/flows/${flowId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Failed to delete flow ${flowId}: ${response.status}`);
}

export function getE2EResultStoreIds(flow) {
    if (!flow?.flow) return { failedStoreId: null, successStoreId: null };
    const comp = Object.values(flow.flow)
        .find(item => item.type === 'appmixer.utils.test.ProcessE2EResults');
    const props = comp?.config?.properties;
    return {
        failedStoreId: props?.failedStoreId || null,
        successStoreId: props?.successStoreId || null
    };
}

export async function fetchStoreRecords(storeId, options = {}) {
    if (!storeId) return [];
    const config = getAppmixerConfig();
    const token = await getAccessToken();
    const params = new URLSearchParams({
        storeId,
        offset: String(options.offset ?? 0),
        limit: String(options.limit ?? 200),
        sort: options.sort ?? 'updatedAt:-1'
    });
    const response = await fetch(`${config.baseUrl}/store?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Failed to fetch store records for ${storeId}: ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
}

export function cleanFlowForComparison(flow) {
    const cleaned = { ...flow };
    delete cleaned.flowId;
    delete cleaned.btime;
    delete cleaned.mtime;
    delete cleaned.userId;
    delete cleaned.runtimeErrors;
    delete cleaned.customFields;
    delete cleaned.stage;
    delete cleaned.description;

    if (cleaned.flow) {
        const comp = Object.values(cleaned.flow)
            .find(item => item.type === 'appmixer.utils.test.ProcessE2EResults');
        if (comp?.config?.properties) {
            delete comp.config.properties.failedStoreId;
            delete comp.config.properties.successStoreId;
        }
    }
    return cleaned;
}

/**
 * Extract connector name from E2E flow name.
 * Patterns: "E2E box - ...", "box E2E", "appmixer.box ..."
 */
export function extractConnectorFromFlowName(flowName) {
    if (!flowName) return null;
    const patterns = [
        /e2e[_\s-]+(\w+)/i,
        /(\w+)[_\s-]+e2e/i,
        /appmixer\.(\w+)/i,
    ];
    for (const p of patterns) {
        const m = flowName.match(p);
        if (m?.[1]) return m[1].toLowerCase();
    }
    return null;
}
