#!/usr/bin/env node

/**
 * CLI runner for the server flow agent.
 *
 * Usage:
 *   node agents/runServer.js <path-to-flow.json> [options]
 *
 * Options:
 *   --max-iterations N    Max fix iterations per meta round (default: 5)
 *   --max-meta-rounds N   Max meta-improvement rounds (default: 2)
 *   --generator-model M   Model for generator (default: sonnet)
 *   --meta-model M        Model for meta-improver (default: sonnet)
 *   --no-start            Skip trying to start the flow (validate only)
 *   --no-cleanup          Don't delete the flow from server when done
 *   --output PATH         Path to write the fixed flow (default: overwrites input)
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import { run } from './serverFlowAgent.js';

const args = process.argv.slice(2);
const flowPath = args.find(a => !a.startsWith('--'));

if (!flowPath) {
    console.error('Usage: node agents/runServer.js <path-to-flow.json> [options]');
    process.exit(1);
}

const getArg = (name, defaultVal) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
};

const flowJson = JSON.parse(fs.readFileSync(flowPath, 'utf-8'));

const result = await run({
    flowJson,
    maxIterations: parseInt(getArg('max-iterations', '5')),
    maxMetaRounds: parseInt(getArg('max-meta-rounds', '2')),
    generatorModel: getArg('generator-model', 'sonnet'),
    metaModel: getArg('meta-model', 'sonnet'),
    tryStart: !args.includes('--no-start'),
    cleanup: !args.includes('--no-cleanup')
});

const outputPath = getArg('output', flowPath);
if (result.success) {
    fs.writeFileSync(outputPath, JSON.stringify(result.flowJson, null, 4));
    console.log(`\n✅ Saved server-validated flow to ${outputPath}`);
    console.log(`   Iterations: ${result.iterations}, Meta rounds: ${result.metaRounds}`);
    console.log(`   Flow ID: ${result.flowId}`);
} else {
    fs.writeFileSync(outputPath + '.server-failed.json', JSON.stringify(result.flowJson, null, 4));
    console.log(`\n❌ Best effort saved to ${outputPath}.server-failed.json`);
    console.log(`   Iterations: ${result.iterations}, Meta rounds: ${result.metaRounds}`);
}
