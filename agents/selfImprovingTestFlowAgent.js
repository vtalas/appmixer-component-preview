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

const extractJSON = (text) => {
    // Try fenced code blocks
    for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
        try { return JSON.parse(match[1].trim()); } catch { /* continue */ }
    }
    // Try raw JSON
    try { return JSON.parse(text.trim()); } catch { /* continue */ }
    // Try finding outermost JSON object
    let depth = 0, start = -1;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') { if (depth === 0) start = i; depth++; }
        else if (text[i] === '}') {
            depth--;
            if (depth === 0 && start !== -1) {
                try { return JSON.parse(text.slice(start, i + 1)); } catch { start = -1; }
            }
        }
    }
    return null;
};

// --- Deterministic validation ---

const deterministicValidation = (flowJson) => {
    const errors = [];

    if (!flowJson.name) {
        errors.push({ severity: 'critical', component: null, rule: 'flow-name', message: 'Flow name is missing' });
    } else if (!flowJson.name.startsWith('E2E ')) {
        errors.push({ severity: 'critical', component: null, rule: 'flow-name', message: `Flow name must start with "E2E ". Got: "${flowJson.name}"` });
    }

    if (!flowJson.flow) {
        errors.push({ severity: 'critical', component: null, rule: 'flow-structure', message: 'Missing "flow" property' });
        return errors;
    }

    const components = flowJson.flow;

    // Required component types
    const types = Object.values(components).map(c => c.type);
    if (!types.includes('appmixer.utils.controls.OnStart')) {
        errors.push({ severity: 'critical', component: null, rule: 'required-component', message: 'Missing OnStart component' });
    }
    if (!types.includes('appmixer.utils.test.AfterAll')) {
        errors.push({ severity: 'critical', component: null, rule: 'required-component', message: 'Missing AfterAll component' });
    }
    if (!types.includes('appmixer.utils.test.ProcessE2EResults')) {
        errors.push({ severity: 'critical', component: null, rule: 'required-component', message: 'Missing ProcessE2EResults component' });
    }

    // AfterAll ↔ Assert connections
    const afterAllEntry = Object.entries(components).find(([, c]) => c.type === 'appmixer.utils.test.AfterAll');
    const assertIds = Object.entries(components)
        .filter(([, c]) => c.type === 'appmixer.utils.test.Assert')
        .map(([id]) => id);

    if (afterAllEntry && assertIds.length > 0) {
        const afterAllSources = Object.keys(afterAllEntry[1].source?.in || {});
        for (const id of assertIds) {
            if (!afterAllSources.includes(id)) {
                errors.push({
                    severity: 'critical', component: id, rule: 'afterall-connection',
                    message: `Assert "${id}" is NOT connected to AfterAll's source.in`
                });
            }
        }
    }

    // Variable mapping & source connection validation
    for (const [compId, comp] of Object.entries(components)) {
        if (!comp.config?.transform?.in) continue;

        for (const [sourceId, sourceConfig] of Object.entries(comp.config.transform.in)) {
            const compSources = Object.keys(comp.source?.in || {});
            if (!compSources.includes(sourceId)) {
                errors.push({
                    severity: 'critical', component: compId, rule: 'source-mismatch',
                    message: `Transform references "${sourceId}" but it's not in source.in [${compSources.join(', ')}]`
                });
            }

            const outConfig = sourceConfig?.out;
            if (!outConfig?.modifiers || !outConfig?.lambda) continue;

            for (const [fieldName, modifierDef] of Object.entries(outConfig.modifiers)) {
                if (typeof modifierDef !== 'object' || Object.keys(modifierDef).length === 0) continue;

                const varIds = Object.keys(modifierDef);
                const lambdaValue = outConfig.lambda[fieldName];

                // Assert expression — check nested AND array
                if (fieldName === 'expression' && typeof lambdaValue === 'object') {
                    const andArray = lambdaValue?.AND || [];
                    for (const varId of varIds) {
                        if (!JSON.stringify(andArray).includes(`{{{${varId}}}}`)) {
                            errors.push({
                                severity: 'critical', component: compId, rule: 'variable-mapping',
                                message: `Modifier "${varId}" in expression not referenced in lambda AND array`
                            });
                        }
                    }
                    continue;
                }

                // Normal field
                if (typeof lambdaValue === 'string') {
                    for (const varId of varIds) {
                        if (!lambdaValue.includes(`{{{${varId}}}}`)) {
                            errors.push({
                                severity: 'critical', component: compId, rule: 'variable-mapping',
                                message: `Modifier "${varId}" for "${fieldName}" not referenced in lambda. Lambda: "${lambdaValue}"`
                            });
                        }
                    }
                } else if (lambdaValue === '' || lambdaValue === undefined) {
                    errors.push({
                        severity: 'critical', component: compId, rule: 'variable-mapping',
                        message: `Lambda for "${fieldName}" is empty but modifier defines: ${varIds.join(', ')}`
                    });
                }
            }

            // Variable path → source.in check
            const checkPaths = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.variable && typeof obj.variable === 'string') {
                    const match = obj.variable.match(/^\$\.([^.]+)\./);
                    if (match) {
                        const ref = match[1];
                        const compSrcs = Object.keys(comp.source?.in || {});
                        if (!compSrcs.includes(ref) && ref !== compId) {
                            errors.push({
                                severity: 'critical', component: compId, rule: 'variable-path',
                                message: `Variable "${obj.variable}" references "${ref}" not in source.in`
                            });
                        }
                    }
                }
                for (const val of Object.values(obj)) {
                    if (typeof val === 'object') checkPaths(val);
                }
            };
            checkPaths(outConfig.modifiers);
        }
    }

    // ProcessE2EResults
    const processEntry = Object.entries(components).find(([, c]) => c.type === 'appmixer.utils.test.ProcessE2EResults');
    if (processEntry) {
        const [procId, procComp] = processEntry;
        if (!procComp.config?.properties?.successStoreId) {
            errors.push({ severity: 'critical', component: procId, rule: 'process-config', message: 'Missing successStoreId' });
        }
        if (!procComp.config?.properties?.failedStoreId) {
            errors.push({ severity: 'critical', component: procId, rule: 'process-config', message: 'Missing failedStoreId' });
        }

        const transformIn = procComp.config?.transform?.in;
        if (transformIn) {
            const sourceKey = Object.keys(transformIn)[0];
            const resultModifier = transformIn[sourceKey]?.out?.modifiers?.result;
            const resultLambda = transformIn[sourceKey]?.out?.lambda?.result;
            if (resultModifier && Object.keys(resultModifier).length > 0) {
                const varId = Object.keys(resultModifier)[0];
                if (!resultLambda || !resultLambda.includes(`{{{${varId}}}}`)) {
                    errors.push({
                        severity: 'critical', component: procId, rule: 'process-result',
                        message: `ProcessE2EResults result should be "{{{${varId}}}}" but got "${resultLambda}"`
                    });
                }
            }
        }
    }

    return errors;
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
    reviewerModel = 'sonnet',
    metaModel = 'sonnet',
    connectorContext = ''
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

            if (detErrors.length > 0) {
                console.log(`  ❌ Deterministic: ${detErrors.length} errors`);
                detErrors.forEach(e => console.log(`    [${e.severity}] ${e.rule}: ${e.message}`));
            } else {
                console.log('  ✅ Deterministic: PASSED');
            }

            // Step 2: LLM Review
            const reviewerPrompt = readPrompt('reviewer-system');
            const reviewInput = `Review this E2E test flow JSON:\n\n${JSON.stringify(currentFlow, null, 2)}` +
                (connectorContext ? `\n\nComponent schemas:\n${connectorContext}` : '') +
                (detErrors.length > 0 ? `\n\nDeterministic validation found:\n${JSON.stringify(detErrors, null, 2)}` : '');

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
            const allErrors = [...detErrors];
            for (const err of llmErrors) {
                const isDup = allErrors.some(e => e.rule === err.rule && e.component === err.component);
                if (!isDup) allErrors.push(err);
            }

            const criticalErrors = allErrors.filter(e => e.severity === 'critical');

            history.push({
                iteration: totalIterations,
                metaRound: metaRound + 1,
                deterministicErrors: detErrors,
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
