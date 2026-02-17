import { json, error } from '@sveltejs/kit';
import { getAppmixerInfo } from '$lib/server/appmixer.js';
import { getGitHubRepoInfo } from '$lib/server/github.js';
import { setAppmixerOverrides, setGitHubOverrides, getAppmixerOverrides, getGitHubOverrides } from '$lib/server/state.js';

export async function GET() {
    return json({
        appmixer: getAppmixerInfo(),
        github: getGitHubRepoInfo()
    });
}

export async function POST({ request }) {
    try {
        const { type, config } = await request.json();

        if (type === 'appmixer') {
            if (config.clear) {
                setAppmixerOverrides(null);
            } else {
                const current = getAppmixerOverrides() || {};
                setAppmixerOverrides({
                    baseUrl: config.baseUrl || current.baseUrl || '',
                    username: config.username || current.username || '',
                    password: config.password || current.password || ''
                });
            }
            return json({ success: true, info: getAppmixerInfo() });
        }

        if (type === 'github') {
            if (config.clear) {
                setGitHubOverrides(null);
            } else {
                const current = getGitHubOverrides() || {};
                setGitHubOverrides({
                    owner: config.owner || current.owner || '',
                    repo: config.repo || current.repo || '',
                    branch: config.branch || current.branch || '',
                    token: config.token || current.token || ''
                });
            }
            return json({ success: true, info: getGitHubRepoInfo() });
        }

        return error(400, 'type must be "appmixer" or "github"');
    } catch (e) {
        console.error('Failed to update settings:', e);
        return error(500, e.message || 'Failed to update settings');
    }
}
