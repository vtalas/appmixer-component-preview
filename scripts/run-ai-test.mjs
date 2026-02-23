#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const { values } = parseArgs({
    options: {
        connectorsDir: { type: 'string' },
        connector: { type: 'string' },
        component: { type: 'string' },
        cliDir: { type: 'string' },
        maxToolCalls: { type: 'string', default: '10' }
    }
});

const {
    connectorsDir,
    connector,
    component,
    maxToolCalls
} = values;

const cliDir = values.cliDir || process.env.APPMIXER_CLI_DIR || '/Users/vladimir/Projects/appmixer-cli';

if (!connectorsDir || !connector || !component) {
    console.error('Usage: node run-ai-test.mjs --connectorsDir <path> --connector <name> --component <name>');
    process.exit(1);
}

// ── Load .env from the connectors directory ──────────────────────────
// This mirrors exactly what the appmixer CLI does:
//   dotenv.config({ path: cwd + '/.env' });
// The .env file should contain ANTHROPIC_API_KEY (and optionally other keys).
try {
    const dotenvPath = path.join(cliDir, 'node_modules/dotenv/lib/main.js');
    const dotenv = await import(pathToFileURL(dotenvPath).href);
    const envFile = path.join(connectorsDir, '.env');
    const result = dotenv.config({ path: envFile });
    if (result.error) {
        console.warn(`[AI-TEST] Warning: Could not load ${envFile}: ${result.error.message}`);
        console.warn(`[AI-TEST] Create a .env file in your connectors directory with ANTHROPIC_API_KEY=sk-...`);
    } else {
        console.log(`[AI-TEST] Loaded environment from ${envFile}`);
    }
} catch (err) {
    // dotenv not found in CLI dir, try standalone import
    try {
        const dotenv = await import('dotenv');
        const envFile = path.join(connectorsDir, '.env');
        dotenv.config({ path: envFile });
        console.log(`[AI-TEST] Loaded environment from ${envFile}`);
    } catch {
        console.warn(`[AI-TEST] Warning: dotenv not available. Make sure ANTHROPIC_API_KEY is set in ${connectorsDir}/.env`);
    }
}


// Monkey-patch inquirer to auto-continue (the agent uses it for prompt_continue)
// We do this before importing the agent so the agent picks up the patched module
try {
    const inquirerPath = path.join(cliDir, 'node_modules/inquirer/lib/inquirer.js');
    const inquirerModule = await import(pathToFileURL(inquirerPath).href);
    const orig = inquirerModule.default?.prompt || inquirerModule.prompt;
    const patchTarget = inquirerModule.default || inquirerModule;
    patchTarget.prompt = async (questions) => {
        const answers = {};
        for (const q of (Array.isArray(questions) ? questions : [questions])) {
            console.log(`[AI-TEST] Auto-continuing: ${q.message || q.name}`);
            answers[q.name] = q.choices?.[0]?.value || 'continue';
        }
        return answers;
    };
} catch (err) {
    console.warn(`[AI-TEST] Warning: Could not patch inquirer: ${err.message}`);
}

console.log(`[AI-TEST] Starting AI test for ${connector}/${component}`);
console.log(`[AI-TEST] Connectors dir: ${connectorsDir}`);
console.log(`[AI-TEST] CLI dir: ${cliDir}`);

// Set cwd to connectors dir (some tools expect it)
process.chdir(connectorsDir);

try {
    // Dynamically import from the appmixer-cli
    const agentPath = path.join(cliDir, 'src/ai/src/agents/claude/testAgent.js');
    const toolsPath = path.join(cliDir, 'src/ai/src/agents/tools.js');

    const testing = await import(pathToFileURL(agentPath).href);
    const tools = await import(pathToFileURL(toolsPath).href);

    // Step 1: Validate authentication
    console.log(`[AI-TEST] Validating authentication for ${connector}...`);
    const auth = await tools.validateAuthentication({ connectorsDir }).func({ connector });

    if (!auth.valid) {
        console.error(`[AI-TEST] Authentication failed: ${auth.message}`);
        console.error(`[AI-TEST] Run: ${auth.command}`);
        process.exit(2);
    }
    console.log(`[AI-TEST] Authentication valid`);

    // Step 2: Run the Claude test agent
    console.log(`[AI-TEST] Running Claude test agent...`);
    const analysis = await testing.run({ connectorsDir, connector, component });

    console.log(`[AI-TEST] Test completed: ${analysis.status}`);
    if (analysis.status === 'failed') {
        console.error(`[AI-TEST] Reason: ${analysis.reason}`);
    }
    process.exit(analysis.status === 'passed' ? 0 : 1);
} catch (err) {
    console.error(`[AI-TEST] Error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
}
