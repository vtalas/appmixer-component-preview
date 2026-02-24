/**
 * Appmixer API client for SvelteKit server-side.
 * Thin wrapper over appmixerApi that resolves config from SvelteKit env + runtime overrides.
 */

import { env } from '$env/dynamic/private';
import { getAppmixerOverrides } from './state.js';
import { createClient as createApiClient, invalidateToken } from '../../../appmixerApi/client.js';
import * as flowsApi from '../../../appmixerApi/flows.js';
import * as storeApi from '../../../appmixerApi/store.js';
import {
    getE2EResultStoreIds,
    cleanFlowForComparison,
    extractConnectorFromFlowName
} from '../../../appmixerApi/helpers.js';

// Re-export helpers
export { getE2EResultStoreIds, cleanFlowForComparison, extractConnectorFromFlowName };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

async function getClient() {
    const config = getAppmixerConfig();
    return createApiClient(config);
}

// ---------------------------------------------------------------------------
// Flow API (delegates to appmixerApi/flows.js)
// ---------------------------------------------------------------------------

export async function fetchE2EFlows() {
    const client = await getClient();
    return flowsApi.listFlows(client, {
        filter: 'customFields.category:E2E_test_flow',
        projection: 'name,flowId,stage',
        limit: 1000
    });
}

export async function fetchFlowById(flowId) {
    const client = await getClient();
    return flowsApi.getFlow(client, flowId, '-thumbnail,-stageChangeInfo,-started,-stopped');
}

export async function startFlow(flowId) {
    const client = await getClient();
    return flowsApi.startFlow(client, flowId);
}

export async function stopFlow(flowId) {
    const client = await getClient();
    try {
        return await flowsApi.stopFlow(client, flowId);
    } catch (err) {
        console.error(`Stop flow ${flowId} failed:`, err.response?.status, err.response?.data);
        throw err;
    }
}

export async function updateFlow(flowId, flowData) {
    const client = await getClient();
    return flowsApi.upsertFlow(client, flowId, flowData);
}

export async function createFlow(flowData) {
    const client = await getClient();
    return flowsApi.createFlow(client, flowData);
}

export async function deleteFlow(flowId) {
    const client = await getClient();
    return flowsApi.deleteFlow(client, flowId);
}

// ---------------------------------------------------------------------------
// Store API
// ---------------------------------------------------------------------------

export async function fetchStoreRecords(storeId, options = {}) {
    if (!storeId) return [];
    const client = await getClient();
    return storeApi.fetchStoreRecords(client, storeId, options);
}
