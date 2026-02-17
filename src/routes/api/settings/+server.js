import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getAppmixerInfo } from '$lib/server/appmixer.js';
import { getGitHubRepoInfo } from '$lib/server/github.js';
import {
    getAppmixerInstances, addAppmixerInstance, updateAppmixerInstance, deleteAppmixerInstance,
    getActiveAppmixerId, setActiveAppmixerId,
    getGitHubInstances, addGitHubInstance, updateGitHubInstance, deleteGitHubInstance,
    getActiveGithubId, setActiveGithubId
} from '$lib/server/state.js';

function sanitizeAppmixerInstance(inst) {
    return {
        id: inst.id,
        name: inst.name,
        baseUrl: inst.baseUrl,
        username: inst.username,
        hasPassword: !!inst.password
    };
}

function sanitizeGitHubInstance(inst) {
    return {
        id: inst.id,
        name: inst.name,
        owner: inst.owner,
        repo: inst.repo,
        branch: inst.branch,
        hasToken: !!inst.token
    };
}

export async function GET() {
    const appmixerInfo = getAppmixerInfo();
    const githubInfo = getGitHubRepoInfo();

    return json({
        appmixer: {
            instances: getAppmixerInstances().map(sanitizeAppmixerInstance),
            activeId: getActiveAppmixerId() || 'env-default',
            envConfigured: !!(env.APPMIXER_BASE_URL && env.APPMIXER_USERNAME && env.APPMIXER_PASSWORD),
            envInfo: {
                baseUrl: env.APPMIXER_BASE_URL || '',
                username: env.APPMIXER_USERNAME || ''
            }
        },
        github: {
            instances: getGitHubInstances().map(sanitizeGitHubInstance),
            activeId: getActiveGithubId() || 'env-default',
            envConfigured: !!env.GITHUB_TOKEN,
            envInfo: {
                owner: env.GITHUB_REPO_OWNER || 'clientIO',
                repo: env.GITHUB_REPO_NAME || 'appmixer-connectors',
                branch: env.GITHUB_REPO_BRANCH || 'dev'
            }
        },
        // Legacy info (used by E2EFlowsPanel)
        appmixerLegacy: appmixerInfo,
        githubLegacy: githubInfo
    });
}

export async function POST({ request }) {
    try {
        const { action, type, instance, id } = await request.json();

        if (!['add', 'update', 'delete', 'setActive'].includes(action)) {
            return error(400, 'action must be one of: add, update, delete, setActive');
        }
        if (!['appmixer', 'github'].includes(type)) {
            return error(400, 'type must be "appmixer" or "github"');
        }

        if (type === 'appmixer') {
            switch (action) {
                case 'add': {
                    const created = addAppmixerInstance(instance);
                    return json({ success: true, instance: sanitizeAppmixerInstance(created), instances: getAppmixerInstances().map(sanitizeAppmixerInstance) });
                }
                case 'update': {
                    const targetId = instance?.id || id;
                    if (!targetId) return error(400, 'instance.id or id is required');
                    const updated = updateAppmixerInstance(targetId, instance);
                    if (!updated) return error(404, 'Instance not found');
                    return json({ success: true, instance: sanitizeAppmixerInstance(updated), instances: getAppmixerInstances().map(sanitizeAppmixerInstance) });
                }
                case 'delete': {
                    const targetId = instance?.id || id;
                    if (!targetId) return error(400, 'instance.id or id is required');
                    deleteAppmixerInstance(targetId);
                    return json({ success: true, activeId: getActiveAppmixerId() || 'env-default', instances: getAppmixerInstances().map(sanitizeAppmixerInstance) });
                }
                case 'setActive': {
                    const targetId = instance?.id || id;
                    setActiveAppmixerId(targetId);
                    return json({ success: true, activeId: getActiveAppmixerId() || 'env-default' });
                }
            }
        }

        if (type === 'github') {
            switch (action) {
                case 'add': {
                    const created = addGitHubInstance(instance);
                    return json({ success: true, instance: sanitizeGitHubInstance(created), instances: getGitHubInstances().map(sanitizeGitHubInstance) });
                }
                case 'update': {
                    const targetId = instance?.id || id;
                    if (!targetId) return error(400, 'instance.id or id is required');
                    const updated = updateGitHubInstance(targetId, instance);
                    if (!updated) return error(404, 'Instance not found');
                    return json({ success: true, instance: sanitizeGitHubInstance(updated), instances: getGitHubInstances().map(sanitizeGitHubInstance) });
                }
                case 'delete': {
                    const targetId = instance?.id || id;
                    if (!targetId) return error(400, 'instance.id or id is required');
                    deleteGitHubInstance(targetId);
                    return json({ success: true, activeId: getActiveGithubId() || 'env-default', instances: getGitHubInstances().map(sanitizeGitHubInstance) });
                }
                case 'setActive': {
                    const targetId = instance?.id || id;
                    setActiveGithubId(targetId);
                    return json({ success: true, activeId: getActiveGithubId() || 'env-default' });
                }
            }
        }
    } catch (e) {
        console.error('Settings API error:', e);
        return error(500, e.message || 'Internal error');
    }
}
