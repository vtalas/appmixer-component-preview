import { json } from '@sveltejs/kit';
import { fetchE2EFlows, isAppmixerConfigured, getAppmixerConfig, extractConnectorFromFlowName } from '$lib/server/appmixer.js';

/**
 * GET /api/e2e-flows?connector=<name>
 * List E2E flows, optionally filtered by connector.
 */
export async function GET({ url }) {
    try {
        if (!isAppmixerConfigured()) {
            return json({ flows: [], error: 'Appmixer not configured', designerBaseUrl: null });
        }

        const connectorParam = url.searchParams.get('connector')?.toLowerCase() || '';
        const [appmixerFlows, config] = await Promise.all([
            fetchE2EFlows(),
            Promise.resolve(getAppmixerConfig())
        ]);

        const designerBaseUrl = config.baseUrl
            .replace('api-', '')
            .replace('api.clientio.', 'my.clientio.');

        let flows = appmixerFlows.map(flow => ({
            flowId: flow.flowId,
            name: flow.name,
            connector: extractConnectorFromFlowName(flow.name),
            url: `${designerBaseUrl}/designer/${flow.flowId}`,
            stage: flow.stage || 'stopped',
            running: flow.stage === 'running',
            syncStatus: null,
            githubUrl: null,
            githubPath: null
        }));

        if (connectorParam) {
            flows = flows.filter(f => f.connector === connectorParam);
        }

        flows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        return json({ flows, designerBaseUrl, error: null });
    } catch (e) {
        console.error('Failed to fetch E2E flows:', e);
        return json({ flows: [], error: e.message, designerBaseUrl: null }, { status: 500 });
    }
}
