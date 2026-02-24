/**
 * Self-Improving Test Flow Agent
 *
 * Orchestrates a generate → review → fix loop for E2E test flows.
 * After N failed iterations, invokes a meta-improver that edits
 * the generator and reviewer system prompts to reduce recurring errors.
 *
 * Uses @anthropic-ai/claude-agent-sdk — works with Claude Max subscription.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractJSON, deterministicValidation, inputCoverageValidation } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, 'prompts');
const LOGS_DIR = path.join(__dirname, 'logs');

// ---------------------------------------------------------------------------
// Prompt I/O
// ---------------------------------------------------------------------------

const readPrompt = (name) => fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf-8');
const writePrompt = (name, content) => fs.writeFileSync(path.join(PROMPTS_DIR, `${name}.md`), content);

// ---------------------------------------------------------------------------
// LLM wrapper
// ---------------------------------------------------------------------------

const runLLM = async ({ systemPrompt, userPrompt, model = 'sonnet', silent = false }) => {
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
// Validation step
// ---------------------------------------------------------------------------

const validate = (flow, connectorsDir) => {
    const structural = deterministicValidation(flow);
    const coverage = connectorsDir ? inputCoverageValidation(flow, connectorsDir) : [];
    return [...structural, ...coverage];
};

const logValidationErrors = (errors) => {
    const critical = errors.filter(e => e.severity === 'critical');
    const warnings = errors.filter(e => e.severity === 'warning');

    if (critical.length) {
        console.log(`  ❌ ${critical.length} critical errors`);
        critical.forEach(e => console.log(`    [${e.rule}] ${e.component || 'flow'}: ${e.message}`));
    }
    if (warnings.length) {
        console.log(`  ⚠️  ${warnings.length} warnings`);
        warnings.forEach(e => console.log(`    [${e.rule}] ${e.component || 'flow'}: ${e.message}`));
    }
    if (!critical.length && !warnings.length) {
        console.log('  ✅ Validation: PASSED');
    } else if (!critical.length) {
        console.log('  ✅ No critical errors');
    }
};

// ---------------------------------------------------------------------------
// LLM Review step
// ---------------------------------------------------------------------------

const review = async (flow, detErrors, model) => {
    const prompt = readPrompt('reviewer-system');
    const input = `Review this E2E test flow JSON:\n\n${JSON.stringify(flow, null, 2)}` +
        (detErrors.length > 0 ? `\n\nDeterministic validation found:\n${JSON.stringify(detErrors, null, 2)}` : '');

    console.log('  🔍 LLM review...');
    const raw = await runLLM({ systemPrompt: prompt, userPrompt: input, model, silent: true });
    return extractJSON(raw)?.errors || [];
};

// ---------------------------------------------------------------------------
// Generator fix step
// ---------------------------------------------------------------------------

const fix = async (flow, errors, model) => {
    const prompt = readPrompt('generator-system');
    const input = [
        'Fix this E2E test flow. Errors found:',
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
// Merge errors (dedup)
// ---------------------------------------------------------------------------

const mergeErrors = (detErrors, llmErrors) => {
    const all = [...detErrors];
    for (const err of llmErrors) {
        if (!all.some(e => e.rule === err.rule && e.component === err.component)) {
            all.push(err);
        }
    }
    return all;
};

// ---------------------------------------------------------------------------
// Meta-improvement step
// ---------------------------------------------------------------------------

const metaImprove = async (roundErrors, maxIterations, model) => {
    console.log('\n🧠 Meta-improvement...');

    const generatorPrompt = readPrompt('generator-system');
    const reviewerPrompt = readPrompt('reviewer-system');
    const metaPrompt = readPrompt('meta-improver-system');

    // Summarize error patterns
    const summary = {};
    for (const err of roundErrors) {
        const key = `${err.rule}:${err.severity}`;
        if (!summary[key]) summary[key] = { ...err, count: 0 };
        summary[key].count++;
    }

    const input = [
        `## Current Generator Prompt\n${generatorPrompt}`,
        `## Current Reviewer Prompt\n${reviewerPrompt}`,
        `## Error Summary (${roundErrors.length} total across ${maxIterations} iterations)`,
        Object.values(summary)
            .sort((a, b) => b.count - a.count)
            .map(e => `- **${e.rule}** (${e.severity}, ${e.count}x): ${e.message}`)
            .join('\n'),
        'Improve both prompts to prevent these recurring errors.'
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
    if (result.reviewer_prompt) {
        writePrompt('reviewer-system', result.reviewer_prompt);
        console.log('  ✏️  Updated reviewer prompt');
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
    const logPath = path.join(LOGS_DIR, `run-${Date.now()}.json`);
    fs.writeFileSync(logPath, JSON.stringify(data, null, 2));
    console.log(`  📝 Log saved: ${logPath}`);
};

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * @param {Object} options
 * @param {Object} options.flowJson - Initial flow JSON to improve
 * @param {number} [options.maxIterations=5]
 * @param {number} [options.maxMetaRounds=3]
 * @param {string} [options.generatorModel='sonnet']
 * @param {string} [options.reviewerModel='haiku']
 * @param {string} [options.metaModel='sonnet']
 * @param {string} [options.connectorsDir='']
 */
export const run = async ({
    flowJson,
    maxIterations = 5,
    maxMetaRounds = 3,
    generatorModel = 'sonnet',
    reviewerModel = 'haiku',
    metaModel = 'sonnet',
    connectorsDir = ''
}) => {
    ensureDir(LOGS_DIR);

    const history = [];
    let currentFlow = flowJson;
    let totalIterations = 0;

    for (let metaRound = 0; metaRound < maxMetaRounds; metaRound++) {
        console.log(`\n=== Meta Round ${metaRound + 1}/${maxMetaRounds} ===\n`);
        const roundErrors = [];

        for (let iter = 0; iter < maxIterations; iter++) {
            totalIterations++;
            console.log(`--- Iteration ${iter + 1}/${maxIterations} (total: ${totalIterations}) ---`);

            // 1. Validate
            const detErrors = validate(currentFlow, connectorsDir);
            logValidationErrors(detErrors);

            // 2. LLM Review
            const llmErrors = await review(currentFlow, detErrors, reviewerModel);

            // 3. Merge & evaluate
            const allErrors = mergeErrors(detErrors, llmErrors);
            const criticalErrors = allErrors.filter(e => e.severity === 'critical');

            history.push({
                iteration: totalIterations,
                metaRound: metaRound + 1,
                detErrors: detErrors.length,
                llmErrors: llmErrors.length,
                totalErrors: allErrors.length,
                criticalErrors: criticalErrors.length
            });
            roundErrors.push(...allErrors);

            // 4. Success?
            if (criticalErrors.length === 0) {
                console.log(`\n✅ Flow passed after ${totalIterations} iterations!`);
                saveLog({ history, result: currentFlow });
                return { flowJson: currentFlow, iterations: totalIterations, metaRounds: metaRound, history, success: true };
            }

            // 5. Fix
            const fixed = await fix(currentFlow, allErrors, generatorModel);
            if (fixed) currentFlow = fixed;
        }

        // 6. Meta-improve (unless last round)
        if (metaRound < maxMetaRounds - 1) {
            await metaImprove(roundErrors, maxIterations, metaModel);
        }
    }

    console.log(`\n❌ Failed after ${totalIterations} iterations and ${maxMetaRounds} meta rounds.`);
    saveLog({ history, lastFlow: currentFlow, success: false });
    return { flowJson: currentFlow, iterations: totalIterations, metaRounds: maxMetaRounds, history, success: false };
};

export default { run };
