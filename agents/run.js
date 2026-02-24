#!/usr/bin/env node

/**
 * CLI runner for the self-improving test flow agent.
 *
 * Usage:
 *   node run.js <path-to-flow.json> [options]
 *
 * Options:
 *   --max-iterations N    Max generate→review iterations per meta round (default: 5)
 *   --max-meta-rounds N   Max meta-improvement rounds (default: 3)
 *   --generator-model M   Model for generator (default: sonnet)
 *   --reviewer-model M    Model for reviewer (default: sonnet)
 *   --meta-model M        Model for meta-improver (default: sonnet)
 *   --schema PATH         Path to flow-schema.json
 *   --context PATH        Path to connector context file (e.g., copilot-instructions.md section)
 *   --output PATH         Path to write the improved flow (default: overwrites input)
 */

import fs from 'fs';
import path from 'path';
import { run } from './selfImprovingTestFlowAgent.js';

const args = process.argv.slice(2);
const flowPath = args.find(a => !a.startsWith('--'));

if (!flowPath) {
    console.error('Usage: node run.js <path-to-flow.json> [options]');
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
    maxMetaRounds: parseInt(getArg('max-meta-rounds', '3')),
    generatorModel: getArg('generator-model', 'sonnet'),
    reviewerModel: getArg('reviewer-model', 'sonnet'),
    metaModel: getArg('meta-model', 'sonnet'),
    flowSchemaPath: getArg('schema', null),
    connectorContext: getArg('context', null) ? fs.readFileSync(getArg('context', ''), 'utf-8') : ''
});

const outputPath = getArg('output', flowPath);
if (result.success) {
    fs.writeFileSync(outputPath, JSON.stringify(result.flowJson, null, 4));
    console.log(`\n✅ Saved improved flow to ${outputPath}`);
    console.log(`   Iterations: ${result.iterations}, Meta rounds: ${result.metaRounds}`);
} else {
    fs.writeFileSync(outputPath + '.failed.json', JSON.stringify(result.flowJson, null, 4));
    console.log(`\n❌ Best effort saved to ${outputPath}.failed.json`);
    console.log(`   Iterations: ${result.iterations}, Meta rounds: ${result.metaRounds}`);
}
