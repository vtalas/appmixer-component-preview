/** @type {import('@sveltejs/kit').Reroute} */
export function reroute({ url }) {
	if (url.pathname.startsWith('/connector/')) {
		return '/';
	}
}
