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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPTS_DIR = path.join(__dirname, 'prompts');
const LOGS_DIR = path.join(__dirname, 'logs');

// --- Helpers ---

const readPrompt = (name) => fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf-8');
const writePrompt = (name, content) => fs.writeFileSync(path.join(PROMPTS_DIR, `${name}.md`), content);
const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };

/**
 * Call Claude via SDK's query(). Works with subscription, no API key needed.
 */
const runLLM = async ({ systemPrompt, userPrompt, model = 'sonnet', silent = false }) => {
    const result = query({
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

    let finalText = '';
    for await (const message of result) {
        if (message.type === 'assistant') {
            const textContent = message.message?.content?.find(b => b.type === 'text');
            if (textContent?.text) {
                finalText = textContent.text;
                if (!silent) {
                    console.log(`  [${model}] ${finalText.substring(0, 200)}${finalText.length > 200 ? '...' : ''}`);
                }
            }
        }
        if (message.type === 'result') {
            // Use result text if available
            if (message.result) finalText = message.result;
            if (!silent) {
                console.log(`  Cost: $${message.total_cost_usd?.toFixed(4) || '?'}, Duration: ${message.duration_ms}ms`);
            }
        }
    }

    return finalText;
};

// --- Main orchestrator ---

/**
 * @param {Object} options
 * @param {Object} options.flowJson - Initial flow JSON to improve
 * @param {number} [options.maxIterations=5] - Max generate→review iterations before meta-improvement
 * @param {number} [options.maxMetaRounds=3] - Max meta-improvement rounds
 * @param {string} [options.generatorModel='sonnet'] - Model for generator
 * @param {string} [options.reviewerModel='sonnet'] - Model for reviewer
 * @param {string} [options.metaModel='sonnet'] - Model for meta-improver
 * @param {string} [options.connectorContext=''] - Additional context about the connector
 * @returns {Promise<{flowJson: Object, iterations: number, metaRounds: number, history: Array, success: boolean}>}
 */
export const run = async ({
    flowJson,
    maxIterations = 5,
    maxMetaRounds = 3,
    generatorModel = 'sonnet',
    reviewerModel = 'haiku',
    metaModel = 'sonnet',
    connectorContext = '',
    connectorsDir = ''
}) => {
    ensureDir(LOGS_DIR);

    const history = [];
    let currentFlow = flowJson;
    let totalIterations = 0;

    for (let metaRound = 0; metaRound < maxMetaRounds; metaRound++) {
        console.log(`\n=== Meta Round ${metaRound + 1}/${maxMetaRounds} ===\n`);

        const roundErrors = [];

        for (let iteration = 0; iteration < maxIterations; iteration++) {
            totalIterations++;
            console.log(`--- Iteration ${iteration + 1}/${maxIterations} (total: ${totalIterations}) ---`);

            // Step 1: Deterministic validation
            const detErrors = deterministicValidation(currentFlow);

            // Step 1b: Input coverage validation (if connectorsDir provided)
            const coverageErrors = connectorsDir ? inputCoverageValidation(currentFlow, connectorsDir) : [];
            const allDetErrors = [...detErrors, ...coverageErrors];

            if (allDetErrors.length > 0) {
                const critical = allDetErrors.filter(e => e.severity === 'critical');
                const warnings = allDetErrors.filter(e => e.severity === 'warning');
                if (critical.length) console.log(`  ❌ Validation: ${critical.length} critical errors`);
                critical.forEach(e => console.log(`    [${e.rule}] ${e.component || 'flow'}: ${e.message}`));
                if (warnings.length) console.log(`  ⚠️  Validation: ${warnings.length} warnings`);
                warnings.forEach(e => console.log(`    [${e.rule}] ${e.component || 'flow'}: ${e.message}`));
                if (critical.length === 0) console.log('  ✅ Validation: no critical errors');
            } else {
                console.log('  ✅ Validation: PASSED');
            }

            // Step 2: LLM Review
            const reviewerPrompt = readPrompt('reviewer-system');
            const reviewInput = `Review this E2E test flow JSON:\n\n${JSON.stringify(currentFlow, null, 2)}` +
                (connectorContext ? `\n\nComponent schemas:\n${connectorContext}` : '') +
                (allDetErrors.length > 0 ? `\n\nDeterministic validation found:\n${JSON.stringify(allDetErrors, null, 2)}` : '');

            console.log('  🔍 LLM review...');
            const reviewRaw = await runLLM({
                systemPrompt: reviewerPrompt,
                userPrompt: reviewInput,
                model: reviewerModel,
                silent: true
            });

            const reviewResult = extractJSON(reviewRaw);
            const llmErrors = reviewResult?.errors || [];

            // Merge (dedup)
            const allErrors = [...allDetErrors];
            for (const err of llmErrors) {
                const isDup = allErrors.some(e => e.rule === err.rule && e.component === err.component);
                if (!isDup) allErrors.push(err);
            }

            const criticalErrors = allErrors.filter(e => e.severity === 'critical');

            history.push({
                iteration: totalIterations,
                metaRound: metaRound + 1,
                deterministicErrors: allDetErrors,
                llmErrors,
                totalErrors: allErrors.length,
                criticalErrors: criticalErrors.length
            });
            roundErrors.push(...allErrors);

            // All clear?
            if (criticalErrors.length === 0) {
                console.log(`\n✅ Flow passed after ${totalIterations} iterations!`);
                saveLog({ history, result: currentFlow });
                return { flowJson: currentFlow, iterations: totalIterations, metaRounds: metaRound, history, success: true };
            }

            console.log(`  ❌ ${criticalErrors.length} critical errors → generator fix...`);
            criticalErrors.forEach(e => console.log(`    [${e.rule}] ${e.component || 'flow'}: ${e.message}`));

            // Step 3: Generator fix
            const generatorPrompt = readPrompt('generator-system');
            const fixInput = `Fix this E2E test flow. Errors found:\n\n${JSON.stringify(allErrors, null, 2)}\n\nCurrent flow:\n${JSON.stringify(currentFlow, null, 2)}` +
                (connectorContext ? `\n\nComponent schemas:\n${connectorContext}` : '') +
                '\n\nFix ALL errors. Return ONLY the complete corrected flow JSON.';

            console.log('  🔧 Generator fixing...');
            const fixRaw = await runLLM({
                systemPrompt: generatorPrompt,
                userPrompt: fixInput,
                model: generatorModel,
                silent: true
            });

            const fixedFlow = extractJSON(fixRaw);
            if (fixedFlow && fixedFlow.flow) {
                currentFlow = fixedFlow;
                console.log('  ✅ Generator produced fixed flow');
            } else {
                console.log('  ⚠️  Generator failed to produce valid JSON, retrying...');
            }
        }

        // Step 4: Meta-improvement
        if (metaRound < maxMetaRounds - 1) {
            console.log(`\n🧠 Meta-improvement round ${metaRound + 1}...`);

            const metaPrompt = readPrompt('meta-improver-system');
            const currentGeneratorPrompt = readPrompt('generator-system');
            const currentReviewerPrompt = readPrompt('reviewer-system');

            // Summarize error patterns
            const errorSummary = {};
            for (const err of roundErrors) {
                const key = `${err.rule}:${err.severity}`;
                if (!errorSummary[key]) errorSummary[key] = { ...err, count: 0 };
                errorSummary[key].count++;
            }

            const metaInput = `## Current Generator Prompt\n${currentGeneratorPrompt}\n\n## Current Reviewer Prompt\n${currentReviewerPrompt}\n\n## Error Summary (${roundErrors.length} total across ${maxIterations} iterations)\n${
                Object.values(errorSummary).sort((a, b) => b.count - a.count)
                    .map(e => `- **${e.rule}** (${e.severity}, ${e.count}x): ${e.message}`).join('\n')
            }\n\nImprove both prompts to prevent these recurring errors.`;

            const metaRaw = await runLLM({
                systemPrompt: metaPrompt,
                userPrompt: metaInput,
                model: metaModel,
                silent: true
            });

            const metaResult = extractJSON(metaRaw);
            if (metaResult) {
                if (metaResult.generator_prompt) {
                    writePrompt('generator-system', metaResult.generator_prompt);
                    console.log('  ✏️  Updated generator prompt');
                }
                if (metaResult.reviewer_prompt) {
                    writePrompt('reviewer-system', metaResult.reviewer_prompt);
                    console.log('  ✏️  Updated reviewer prompt');
                }
                if (metaResult.changes) {
                    metaResult.changes.forEach(c => console.log(`  • ${c}`));
                }
            } else {
                console.log('  ⚠️  Meta-improver failed to produce valid output');
            }
        }
    }

    console.log(`\n❌ Failed after ${totalIterations} iterations and ${maxMetaRounds} meta rounds.`);
    saveLog({ history, lastFlow: currentFlow, success: false });

    return { flowJson: currentFlow, iterations: totalIterations, metaRounds: maxMetaRounds, history, success: false };
};

const saveLog = (data) => {
    ensureDir(LOGS_DIR);
    const logPath = path.join(LOGS_DIR, `run-${Date.now()}.json`);
    fs.writeFileSync(logPath, JSON.stringify(data, null, 2));
    console.log(`  📝 Log saved: ${logPath}`);
};

export default { run };
