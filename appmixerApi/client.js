/**
 * Appmixer API client — base HTTP client with auth and token caching.
 *
 * Usage:
 *   import { createClient } from './client.js';
 *   const api = await createClient();                              // uses process.env
 *   const api = await createClient({ baseUrl, username, password }); // explicit config
 */

import axios from 'axios';

const TOKEN_TTL = 55 * 60 * 1000; // 55 minutes
const tokenCache = new Map(); // key → { token, expiry }

/**
 * Authenticate and return a configured axios instance with cached token.
 */
export const createClient = async ({
    baseUrl = process.env.APPMIXER_BASE_URL,
    username = process.env.APPMIXER_USERNAME,
    password = process.env.APPMIXER_PASSWORD
} = {}) => {
    if (!baseUrl) throw new Error('APPMIXER_BASE_URL is required');
    if (!username || !password) throw new Error('APPMIXER_USERNAME and APPMIXER_PASSWORD are required');

    const normalizedUrl = baseUrl.replace(/\/+$/, '');
    const cacheKey = `${normalizedUrl}:${username}`;

    // Check cache
    const cached = tokenCache.get(cacheKey);
    let token;

    if (cached && Date.now() < cached.expiry) {
        token = cached.token;
    } else {
        const authResponse = await axios.post(`${normalizedUrl}/user/auth`, { username, password });
        token = authResponse.data.token;
        tokenCache.set(cacheKey, { token, expiry: Date.now() + TOKEN_TTL });
    }

    const client = axios.create({
        baseURL: normalizedUrl,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    client.token = token;
    client.baseUrl = normalizedUrl;

    return client;
};

/**
 * Invalidate cached token (e.g. on auth error).
 */
export const invalidateToken = (baseUrl, username) => {
    const key = `${baseUrl?.replace(/\/+$/, '')}:${username}`;
    tokenCache.delete(key);
};
