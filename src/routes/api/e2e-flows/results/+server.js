import { json, error } from '@sveltejs/kit';
import { fetchFlowById, fetchStoreRecords, getE2EResultStoreIds } from '$lib/server/appmixer.js';

function normalizeResultArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function findRecordByFlowName(records, flowName) {
    if (!Array.isArray(records) || !records.length) return null;
    const exact = records.find(r => r?.key === flowName);
    if (exact) return exact;
    const lower = flowName.toLowerCase().trim();
    const ci = records.find(r => r?.key?.toLowerCase().trim() === lower);
    if (ci) return ci;
    const partial = records.find(r => {
        const k = r?.key?.toLowerCase().trim();
        return k && (k.includes(lower) || lower.includes(k));
    });
    return partial || null;
}

function toResultDetail(item) {
    return {
        componentId: item?.componentId || '',
        componentName: item?.componentName || 'Unknown component',
        success: Array.isArray(item?.success) ? item.success : [],
        errors: Array.isArray(item?.error) ? item.error : [],
        status: (Array.isArray(item?.error) && item.error.length > 0) ? 'failed' : 'passed',
        asserts: Array.isArray(item?.error) ? item.error.length : 0
    };
}

function mergeResultDetails(primary, secondary) {
    const ordered = [];
    const byKey = new Map();

    const upsert = (detail) => {
        const key = detail.componentId || detail.componentName;
        if (!key) return;
        if (!byKey.has(key)) {
            ordered.push(key);
            byKey.set(key, detail);
            return;
        }
        const cur = byKey.get(key);
        byKey.set(key, {
            ...cur, ...detail,
            success: detail.success.length > 0 ? detail.success : cur.success,
            errors: detail.errors.length > 0 ? detail.errors : cur.errors,
            status: detail.errors.length > 0 ? 'failed' : cur.status,
            asserts: detail.errors.length > 0 ? detail.errors.length : cur.asserts
        });
    };

    primary.map(toResultDetail).forEach(upsert);
    secondary.map(toResultDetail).forEach(upsert);
    return ordered.map(key => byKey.get(key));
}

export async function POST({ request }) {
    try {
        const { flowId, flowName } = await request.json();
        if (!flowId || !flowName) throw error(400, 'flowId and flowName are required');

        const fullFlow = await fetchFlowById(flowId);
        const { failedStoreId, successStoreId } = getE2EResultStoreIds(fullFlow);

        if (!failedStoreId && !successStoreId) {
            throw error(404, 'No E2E result stores configured for this flow');
        }

        const [failedRecords, successRecords] = await Promise.all([
            failedStoreId ? fetchStoreRecords(failedStoreId) : [],
            successStoreId ? fetchStoreRecords(successStoreId) : []
        ]);

        const failedRecord = findRecordByFlowName(failedRecords, flowName);
        const successRecord = findRecordByFlowName(successRecords, flowName);

        if (!failedRecord && !successRecord) {
            throw error(404, 'No E2E test results found in configured stores');
        }

        const details = mergeResultDetails(
            normalizeResultArray(failedRecord?.value),
            normalizeResultArray(successRecord?.value)
        );
        const failedAsserts = details.filter(d => d.status === 'failed').length;

        return json({
            name: flowName,
            status: failedAsserts > 0 ? 'failed' : 'passed',
            failedAsserts,
            totalAsserts: details.length,
            details,
            stores: { failedStoreId, successStoreId, failedRecordKey: failedRecord?.key || null, successRecordKey: successRecord?.key || null }
        });
    } catch (e) {
        if (e?.status) throw e;
        console.error('Failed to load E2E results:', e);
        throw error(500, e.message || 'Failed to load E2E results');
    }
}
