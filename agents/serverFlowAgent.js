/**
 * Server Flow Agent
 *
 * Takes a locally-validated flow, uploads it to the Appmixer server,
 * runs server-side validation, attempts to start it, and iteratively
 * fixes any errors returned by the server.
 *
 * Same self-improving pattern as selfImprovingTestFlowAgent.js but
 * focused on the server round-trip: upload → validate → start → fix loop.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '../appmixerApi/client.js';
import { createFlow, upsertFlow, listFlows, validateFlow, startFlow, stopFlow, deleteFlow, getFlowStatus } from '../appmixerApi/flows.js';
import { extractJSON } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, 'prompts');
const LOGS_DIR = path.join(__dirname, 'logs');

// ---------------------------------------------------------------------------
// Prompt I/O
// ---------------------------------------------------------------------------

const readPrompt = (name) => fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf-8');
const writePrompt = (name, content) => fs.writeFileSync(path.join(PROMPTS_DIR, `${name}.md`), content);

// ---------------------------------------------------------------------------
// LLM wrapper (uses @anthropic-ai/claude-agent-sdk)
// ---------------------------------------------------------------------------

let queryFn;
const getQuery = async () => {
    if (!queryFn) {
        const sdk = await import('@anthropic-ai/claude-agent-sdk');
        queryFn = sdk.query;
    }
    return queryFn;
};

const runLLM = async ({ systemPrompt, userPrompt, model = 'sonnet', silent = false }) => {
    const query = await getQuery();
    const stream = query({
        prompt: userPrompt,
        options: {
            model,
            tools: [],
            systemPrompt,
            maxTurns: 1,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true
        }
    });

    let text = '';
    for await (const msg of stream) {
        if (msg.type === 'assistant') {
            text = msg.message?.content?.find(b => b.type === 'text')?.text || text;
        }
        if (msg.type === 'result') {
            if (msg.result) text = msg.result;
            if (!silent) {
                console.log(`  💰 $${msg.total_cost_usd?.toFixed(4) || '?'} | ${msg.duration_ms}ms`);
            }
        }
    }
    return text;
};

// ---------------------------------------------------------------------------
// Server operations
// ---------------------------------------------------------------------------

/**
 * Find existing flow by name, stop if running, then update. Create if not found.
 * Mirrors the logic from appmixer-components/scripts/upload-E2E-flows.js
 */
const uploadToServer = async (client, flowJson, existingFlowId = null) => {
    // If we already know the flowId from a previous iteration, just update
    if (existingFlowId) {
        console.log(`  📤 Updating flow ${existingFlowId}...`);
        await upsertFlow(client, existingFlowId, flowJson, { validate: false, forceUpdate: true });
        return existingFlowId;
    }

    // Search for existing flow by name
    const flowName = flowJson.name;
    if (flowName) {
        console.log(`  🔍 Looking for existing flow "${flowName}"...`);
        const remoteFlows = await listFlows(client, {
            filter: 'customFields.category:E2E_test_flow',
            projection: 'flowId,name,stage',
            limit: 1000
        });
        const existing = remoteFlows.find(f => f.name === flowName);

        if (existing) {
            const flowId = existing.flowId;
            console.log(`  📤 Found existing flow ${flowId}, updating...`);

            // Stop if running
            if (existing.stage === 'running') {
                console.log(`  ⏹️  Stopping running flow...`);
                try { await stopFlow(client, flowId); } catch { /* ok */ }
            }

            await upsertFlow(client, flowId, flowJson, { validate: false, forceUpdate: true });
            return flowId;
        }
    }

    // Not found — create new
    console.log('  📤 Creating new flow on server...');
    // Tag it as E2E so we can find it next time
    flowJson.customFields = { category: 'E2E_test_flow', ...(flowJson.customFields || {}) };
    flowJson.description = flowJson.description || 'E2E test flow';
    const result = await createFlow(client, flowJson);
    const flowId = result.flowId || result._id || result.id;
    console.log(`  ✅ Created flow: ${flowId}`);
    return flowId;
};

const serverValidate = async (client, flowId) => {
    console.log(`  🔍 Server-side validation...`);
    try {
        const result = await validateFlow(client, flowId);
        console.log(flowId)
        console.log(result)
        return result;
    } catch (err) {
        const data = err.response?.data;
        if (data) {
            console.log(`  ❌ Validation error: ${JSON.stringify(data).slice(0, 500)}`);
            return { ok: false, error: data };
        }
        throw err;
    }
};

const tryStartFlow = async (client, flowId) => {
    console.log(`  🚀 Attempting to start flow...`);
    try {
        console.log("AAAA")
        const xstatus = await getFlowStatus(client, flowId);
        console.log(xstatus)
        const data = await startFlow(client, flowId);

        console.log(data)
        // Give it a moment, then check status
        await new Promise(r => setTimeout(r, 3000));
        const status = await getFlowStatus(client, flowId);
        console.log(`  📊 Flow status: ${JSON.stringify(status).slice(0, 300)}`);
        return { started: true, status };
    } catch (err) {
        const data = err.response?.data;
        console.log(`  ❌ Start failed: ${JSON.stringify(data || err.message).slice(0, 500)}`);
        return { started: false, error: data || { message: err.message } };
    }
};

const cleanupFlow = async (client, flowId) => {
    try {
        // Try to stop first
        try { await stopFlow(client, flowId); } catch { /* might not be running */ }
        await deleteFlow(client, flowId);
        console.log(`  🗑️  Cleaned up flow ${flowId}`);
    } catch (err) {
        console.log(`  ⚠️  Cleanup failed: ${err.message}`);
    }
};

// ---------------------------------------------------------------------------
// Parse server errors into a format the generator understands
// ---------------------------------------------------------------------------

const parseServerErrors = (validateResult, startResult) => {
    const errors = [];

    // Parse validation errors
    if (validateResult && !validateResult.ok) {
        const data = validateResult.error || validateResult;

        if (Array.isArray(data)) {
            for (const item of data) {
                errors.push({
                    severity: 'critical',
                    rule: `server-validation-${item.keyword || item.code || 'unknown'}`,
                    component: item.componentId || item.dataPath || '',
                    message: item.message || JSON.stringify(item)
                });
            }
        } else if (data.errors) {
            for (const item of (Array.isArray(data.errors) ? data.errors : [data.errors])) {
                errors.push({
                    severity: 'critical',
                    rule: `server-validation`,
                    component: item.componentId || '',
                    message: typeof item === 'string' ? item : (item.message || JSON.stringify(item))
                });
            }
        } else if (data.message) {
            errors.push({
                severity: 'critical',
                rule: 'server-validation',
                component: '',
                message: data.message
            });
        }
    }

    // Parse start errors
    if (startResult && !startResult.started) {
        const data = startResult.error || {};
        errors.push({
            severity: 'critical',
            rule: 'server-start',
            component: data.componentId || '',
            message: data.message || JSON.stringify(data)
        });
    }

    return errors;
};

// ---------------------------------------------------------------------------
// Generator fix step (reuses generator-system prompt)
// ---------------------------------------------------------------------------

const fix = async (flow, errors, model) => {
    const prompt = readPrompt('generator-system');
    const input = [
        'Fix this E2E test flow. The server returned these errors when trying to validate/start it:',
        JSON.stringify(errors, null, 2),
        'Current flow:',
        JSON.stringify(flow, null, 2),
        'Fix ALL errors. Return ONLY the complete corrected flow JSON.'
    ].join('\n\n');

    console.log('  🔧 Generator fixing...');
    const raw = await runLLM({ systemPrompt: prompt, userPrompt: input, model, silent: true });
    const fixed = extractJSON(raw);

    if (fixed?.flow) {
        console.log('  ✅ Generator produced fixed flow');
        return fixed;
    }
    console.log('  ⚠️  Generator failed to produce valid JSON');
    return null;
};

// ---------------------------------------------------------------------------
// Meta-improvement step
// ---------------------------------------------------------------------------

const metaImprove = async (roundErrors, maxIterations, model) => {
    console.log('\n🧠 Meta-improvement (server errors)...');

    const generatorPrompt = readPrompt('generator-system');
    const metaPrompt = readPrompt('meta-improver-system');

    const summary = {};
    for (const err of roundErrors) {
        const key = `${err.rule}:${err.severity}`;
        if (!summary[key]) summary[key] = { ...err, count: 0 };
        summary[key].count++;
    }

    const input = [
        `## Current Generator Prompt\n${generatorPrompt}`,
        `## Server Error Summary (${roundErrors.length} total across ${maxIterations} iterations)`,
        'These errors come from the Appmixer server validation and start endpoints.',
        Object.values(summary)
            .sort((a, b) => b.count - a.count)
            .map(e => `- **${e.rule}** (${e.severity}, ${e.count}x): ${e.message}`)
            .join('\n'),
        'Improve the generator prompt to prevent these server-side errors.'
    ].join('\n\n');

    const raw = await runLLM({ systemPrompt: metaPrompt, userPrompt: input, model, silent: true });
    const result = extractJSON(raw);

    if (!result) {
        console.log('  ⚠️  Meta-improver failed to produce valid output');
        return;
    }

    if (result.generator_prompt) {
        writePrompt('generator-system', result.generator_prompt);
        console.log('  ✏️  Updated generator prompt');
    }
    if (result.changes) {
        result.changes.forEach(c => console.log(`  • ${c}`));
    }
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };

const saveLog = (data) => {
    ensureDir(LOGS_DIR);
    const logPath = path.join(LOGS_DIR, `server-run-${Date.now()}.json`);
    fs.writeFileSync(logPath, JSON.stringify(data, null, 2));
    console.log(`  📝 Log saved: ${logPath}`);
};

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * @param {Object} options
 * @param {Object} options.flowJson - Flow JSON to upload and test
 * @param {number} [options.maxIterations=5] - Max fix iterations per meta round
 * @param {number} [options.maxMetaRounds=2] - Max meta-improvement rounds
 * @param {string} [options.generatorModel='sonnet'] - Model for fix generation
 * @param {string} [options.metaModel='sonnet'] - Model for meta-improvement
 * @param {boolean} [options.cleanup=true] - Delete flow from server after done
 * @param {boolean} [options.tryStart=true] - Also try to start the flow (not just validate)
 */
export const run = async ({
    flowJson,
    maxIterations = 5,
    maxMetaRounds = 2,
    generatorModel = 'sonnet',
    metaModel = 'sonnet',
    cleanup = true,
    tryStart = true
}) => {
    ensureDir(LOGS_DIR);

    const client = await createClient();
    const history = [];
    let currentFlow = flowJson;
    let flowId = null;
    let totalIterations = 0;

    const componentCount = Object.keys(flowJson.flow || {}).length;
    console.log(`\n🖥️  Server Flow Agent`);
    console.log(`📋 Flow: "${flowJson.name || 'unnamed'}" (${componentCount} components)`);
    console.log(`   Models: generator=${generatorModel}, meta=${metaModel}`);
    console.log(`   Limits: ${maxIterations} iterations × ${maxMetaRounds} meta rounds`);
    console.log(`   Server: ${client.baseUrl}`);
    console.log(`   Try start: ${tryStart}, Cleanup: ${cleanup}`);

    try {
        for (let metaRound = 0; metaRound < maxMetaRounds; metaRound++) {
            console.log(`\n${'═'.repeat(60)}`);
            console.log(`  Meta Round ${metaRound + 1}/${maxMetaRounds}`);
            console.log(`${'═'.repeat(60)}`);
            const roundErrors = [];

            for (let iter = 0; iter < maxIterations; iter++) {
                totalIterations++;
                console.log(`\n── Iteration ${iter + 1}/${maxIterations} (total: ${totalIterations}) ──`);

                // 1. Upload / update on server
                try {
                    flowId = await uploadToServer(client, currentFlow, flowId);
                } catch (err) {
                    const data = err.response?.data;
                    console.log(`  ❌ Upload failed: ${JSON.stringify(data || err.message).slice(0, 500)}`);

                    // Upload error itself might be a validation error
                    const uploadErrors = [{
                        severity: 'critical',
                        rule: 'server-upload',
                        component: '',
                        message: data?.message || err.message
                    }];
                    roundErrors.push(...uploadErrors);
                    history.push({ iteration: totalIterations, metaRound: metaRound + 1, phase: 'upload', errors: uploadErrors.length });

                    const fixed = await fix(currentFlow, uploadErrors, generatorModel);
                    if (fixed) currentFlow = fixed;
                    continue;
                }

                // 2. Server-side validation
                const validateResult = await serverValidate(client, flowId);

                // 3. Try to start (if validation looks ok and tryStart enabled)
                let startResult = null;
                const valErrors = parseServerErrors(validateResult, null);

                if (valErrors.length === 0 && tryStart) {
                    startResult = await tryStartFlow(client, flowId);
                }

                // 4. Collect all server errors
                const allErrors = parseServerErrors(validateResult, startResult);
                roundErrors.push(...allErrors);

                history.push({
                    iteration: totalIterations,
                    metaRound: metaRound + 1,
                    validationErrors: valErrors.length,
                    startErrors: startResult && !startResult.started ? 1 : 0,
                    totalErrors: allErrors.length
                });

                // 5. Success?
                if (allErrors.length === 0 && (!tryStart || startResult?.started)) {
                    console.log(`\n✅ Flow uploaded, validated, and ${tryStart ? 'started' : 'validated'} successfully after ${totalIterations} iteration(s)!`);

                    // Stop the flow if we started it (it's a test)
                    if (startResult?.started) {
                        try { await stopFlow(client, flowId); } catch { /* ok */ }
                    }

                    saveLog({ history, result: currentFlow, flowId, success: true });
                    return {
                        flowJson: currentFlow,
                        flowId,
                        iterations: totalIterations,
                        metaRounds: metaRound,
                        history,
                        success: true
                    };
                }

                // 6. Log errors and fix
                console.log(`\n  📊 ${allErrors.length} server error(s):`);
                allErrors.forEach(e => console.log(`    ❌ [${e.rule}] ${e.component}: ${e.message}`));

                const fixed = await fix(currentFlow, allErrors, generatorModel);
                if (fixed) {
                    currentFlow = fixed;
                }
            }

            // Meta-improve (unless last round)
            if (metaRound < maxMetaRounds - 1 && roundErrors.length > 0) {
                await metaImprove(roundErrors, maxIterations, metaModel);
            }
        }

        console.log(`\n❌ Failed after ${totalIterations} iterations and ${maxMetaRounds} meta rounds.`);
        saveLog({ history, lastFlow: currentFlow, flowId, success: false });
        return { flowJson: currentFlow, flowId, iterations: totalIterations, metaRounds: maxMetaRounds, history, success: false };

    } finally {
        if (cleanup && flowId) {
            await cleanupFlow(client, flowId);
        }
    }
};

export default { run };
