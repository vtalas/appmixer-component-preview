#!/usr/bin/env node
/**
 * Runner script for the LangGraph planning agent.
 * Spawned by the Tauri app to generate a test plan for a connector.
 *
 * Usage:
 *   node run-planning.mjs --connectorsDir <path> --connector <name> [--cliDir <path>]
 *
 * Environment variables are loaded from <connectorsDir>/.env (same as appmixer CLI).
 * The .env file should contain ANTHROPIC_API_KEY.
 */

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const { values } = parseArgs({
    options: {
        connectorsDir: { type: 'string' },
        connector: { type: 'string' },
        cliDir: { type: 'string' }
    }
});

const { connectorsDir, connector } = values;
const cliDir = values.cliDir || process.env.APPMIXER_CLI_DIR || '/usr/local/lib/node_modules/appmixer';

if (!connectorsDir || !connector) {
    console.error('Usage: node run-planning.mjs --connectorsDir <path> --connector <name>');
    process.exit(1);
}

// ── Load .env from the connectors directory ──────────────────────────
try {
    const dotenvPath = path.join(cliDir, 'node_modules/dotenv/lib/main.js');
    const dotenv = await import(pathToFileURL(dotenvPath).href);
    const envFile = path.join(connectorsDir, '.env');
    const result = dotenv.config({ path: envFile });
    if (result.error) {
        console.warn(`[PLANNING] Warning: Could not load ${envFile}: ${result.error.message}`);
        console.warn(`[PLANNING] Create a .env file in your connectors directory with ANTHROPIC_API_KEY=sk-...`);
    } else {
        console.log(`[PLANNING] Loaded environment from ${envFile}`);
    }
} catch (err) {
    try {
        const dotenv = await import('dotenv');
        const envFile = path.join(connectorsDir, '.env');
        dotenv.config({ path: envFile });
        console.log(`[PLANNING] Loaded environment from ${envFile}`);
    } catch {
        console.warn(`[PLANNING] Warning: dotenv not available. Make sure ANTHROPIC_API_KEY is set in ${connectorsDir}/.env`);
    }
}

if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[PLANNING] ERROR: ANTHROPIC_API_KEY is not set.');
    console.error(`[PLANNING] Add it to ${connectorsDir}/.env:`);
    console.error('[PLANNING]   ANTHROPIC_API_KEY=sk-ant-...');
    process.exit(1);
}

// Monkey-patch inquirer to auto-continue
try {
    const inquirerPath = path.join(cliDir, 'node_modules/inquirer/lib/inquirer.js');
    const inquirerModule = await import(pathToFileURL(inquirerPath).href);
    const orig = inquirerModule.default?.prompt || inquirerModule.prompt;
    const patchTarget = inquirerModule.default || inquirerModule;
    patchTarget.prompt = async (questions) => {
        const answers = {};
        for (const q of (Array.isArray(questions) ? questions : [questions])) {
            console.log(`[PLANNING] Auto-continuing: ${q.message || q.name}`);
            answers[q.name] = q.choices?.[0]?.value || 'continue';
        }
        return answers;
    };
} catch (err) {
    console.warn(`[PLANNING] Warning: Could not patch inquirer: ${err.message}`);
}

console.log(`[PLANNING] Starting planning agent for connector: ${connector}`);
console.log(`[PLANNING] Connectors dir: ${connectorsDir}`);
console.log(`[PLANNING] CLI dir: ${cliDir}`);

// Set cwd to connectors dir
process.chdir(connectorsDir);

try {
    const agentPath = path.join(cliDir, 'src/ai/src/agents/planningSubgraph.js');
    const planning = await import(pathToFileURL(agentPath).href);

    console.log(`[PLANNING] Running planning agent...`);
    const graph = planning.planningSubgraph({ connectorsDir, connector });
    await graph.invoke({}, { recursionLimit: 200 });

    console.log(`[PLANNING] Planning completed successfully`);
    process.exit(0);
} catch (err) {
    console.error(`[PLANNING] Error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
}
