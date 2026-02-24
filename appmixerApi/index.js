/**
 * Appmixer API
 *
 * Usage:
 *   import { createClient } from './appmixerApi/client.js';
 *   import * as flows from './appmixerApi/flows.js';
 *   import * as accounts from './appmixerApi/accounts.js';
 *
 *   const client = await createClient();
 *   const flowList = await flows.listFlows(client, { limit: 10 });
 *   const accountList = await accounts.listAccounts(client);
 */

export { createClient } from './client.js';
export * as flows from './flows.js';
export * as accounts from './accounts.js';
