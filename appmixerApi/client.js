/**
 * Appmixer API client — base HTTP client with auth.
 *
 * Usage:
 *   import { createClient } from './client.js';
 *   const api = await createClient();       // uses .env defaults
 *   const api = await createClient({ baseUrl, username, password });
 */

import axios from 'axios';

/**
 * Authenticate and return a configured axios instance with token.
 */
export const createClient = async ({
    baseUrl = process.env.APPMIXER_BASE_URL,
    username = process.env.APPMIXER_USERNAME,
    password = process.env.APPMIXER_PASSWORD
} = {}) => {
    if (!baseUrl) throw new Error('APPMIXER_BASE_URL is required');
    if (!username || !password) throw new Error('APPMIXER_USERNAME and APPMIXER_PASSWORD are required');

    // Authenticate
    const authResponse = await axios.post(`${baseUrl}/user/auth`, { username, password });
    const token = authResponse.data.token;

    // Create configured instance
    const client = axios.create({
        baseURL: baseUrl,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    // Attach token for reference
    client.token = token;
    client.baseUrl = baseUrl;

    return client;
};
