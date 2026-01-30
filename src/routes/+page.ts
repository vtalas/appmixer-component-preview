import type { PageLoad } from './$types';
import type { ConnectorTree } from '$lib/types/component';
import connectorsData from '$lib/data/connectors.json';

export const prerender = true;

export const load: PageLoad = async () => {
	return { tree: connectorsData as ConnectorTree };
};
