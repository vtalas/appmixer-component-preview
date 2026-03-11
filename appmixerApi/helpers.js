/**
 * Appmixer utility/helper functions (no API calls).
 */

/**
 * Extract E2E result store IDs from a flow object.
 */
export const getE2EResultStoreIds = (flow) => {
    if (!flow?.flow) return { failedStoreId: null, successStoreId: null };
    const comp = Object.values(flow.flow)
        .find(item => item.type === 'appmixer.utils.test.ProcessE2EResults');
    const props = comp?.config?.properties;
    return {
        failedStoreId: props?.failedStoreId || null,
        successStoreId: props?.successStoreId || null
    };
};

/**
 * Clean flow object for comparison (remove runtime/meta fields).
 * Deep-clones first so the original is never mutated.
 * Keys are sorted so that key ordering differences don't affect the hash.
 */
export const cleanFlowForComparison = (flow) => {
    const cleaned = JSON.parse(JSON.stringify(flow));

    // Remove top-level runtime/server-only fields
    const TOP_LEVEL_IGNORE = [
        'flowId', 'btime', 'mtime', 'userId', 'runtimeErrors',
        'customFields', 'stage', 'description', 'thumbnail',
        'offset', 'zoom', 'sharedWith', 'templateId', 'type'
    ];
    for (const key of TOP_LEVEL_IGNORE) {
        delete cleaned[key];
    }

    if (cleaned.flow) {
        // Clean per-component server-added fields
        for (const comp of Object.values(cleaned.flow)) {
            if (!comp || typeof comp !== 'object') continue;
            // Remove runtime state and server-bumped version from components
            delete comp.state;
            delete comp.version;
            // Clean ProcessE2EResults store IDs (assigned at runtime)
            if (comp.type === 'appmixer.utils.test.ProcessE2EResults' && comp.config?.properties) {
                delete comp.config.properties.failedStoreId;
                delete comp.config.properties.successStoreId;
            }
        }
    }
    return cleaned;
};

/**
 * Stable JSON.stringify with sorted keys (for consistent hashing).
 */
export const stableStringify = (obj) => {
    return JSON.stringify(obj, (_, value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.keys(value).sort().reduce((sorted, key) => {
                sorted[key] = value[key];
                return sorted;
            }, {});
        }
        return value;
    }, 4);
};

/**
 * Extract connector name from E2E flow name.
 * Patterns: "E2E box - ...", "box E2E", "appmixer.box ..."
 */
export const extractConnectorFromFlowName = (flowName) => {
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
};
