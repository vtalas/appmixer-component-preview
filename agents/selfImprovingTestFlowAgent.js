/**
 * Self-Improving Test Flow Agent
 *
 * Orchestrates a generate → review → fix loop for E2E test flows.
 * After N failed iterations, invokes a meta-improver that edits
 * the generator and reviewer system prompts to reduce recurring errors.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPTS_DIR = path.join(__dirname, 'prompts');
const LOGS_DIR = path.join(__dirname, 'logs');

// --- Helpers ---

const readPrompt = (name) => fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf-8');
const writePrompt = (name, content) => fs.writeFileSync(path.join(PROMPTS_DIR, `${name}.md`), content);

const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };

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

    let finalResult = null;
    for await (const message of result) {
        if (message.type === 'assistant' && !silent) {
            const text = message.message?.content?.find(b => b.type === 'text')?.text;
            if (text) console.log(chalk.gray(text.substring(0, 200) + '...'));
        }
        if (message.type === 'result') finalResult = message;
    }
    return finalResult?.result || '';
};

const extractJSON = (text) => {
    // Try fenced code blocks
    for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
        try { return JSON.parse(match[1].trim()); } catch { /* continue */ }
    }
    // Try raw JSON
    try { return JSON.parse(text); } catch { /* continue */ }
    // Try finding JSON object
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch { /* continue */ }
    }
    return null;
};

// --- Deterministic validation (from testFlowAgent.js patterns) ---

const deterministicValidation = (flowJson, componentSchemas = {}) => {
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
    const componentIds = Object.keys(components);

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

    // Find AfterAll and count assert connections
    const afterAllEntry = Object.entries(components).find(([, c]) => c.type === 'appmixer.utils.test.AfterAll');
    const assertIds = Object.entries(components)
        .filter(([, c]) => c.type === 'appmixer.utils.test.Assert')
        .map(([id]) => id);

    if (afterAllEntry && assertIds.length > 0) {
        const afterAllSources = Object.keys(afterAllEntry[1].source?.in || {});
        const missingAsserts = assertIds.filter(id => !afterAllSources.includes(id));
        for (const id of missingAsserts) {
            errors.push({
                severity: 'critical', component: id, rule: 'afterall-connection',
                message: `Assert "${id}" is NOT connected to AfterAll's source.in. This will cause silent test failure.`
            });
        }
    }

    // Variable mapping validation
    for (const [compId, comp] of Object.entries(components)) {
        if (!comp.config?.transform?.in) continue;

        for (const [sourceId, sourceConfig] of Object.entries(comp.config.transform.in)) {
            // Check source exists in source.in
            const compSources = Object.keys(comp.source?.in || {});
            if (!compSources.includes(sourceId)) {
                errors.push({
                    severity: 'critical', component: compId, rule: 'source-mismatch',
                    message: `Transform references "${sourceId}" but it's not in source.in [${compSources.join(', ')}]`
                });
            }

            const outConfig = sourceConfig?.out;
            if (!outConfig?.modifiers || !outConfig?.lambda) continue;

            // Check each modifier has corresponding lambda reference
            for (const [fieldName, modifierDef] of Object.entries(outConfig.modifiers)) {
                if (typeof modifierDef !== 'object' || Object.keys(modifierDef).length === 0) continue;

                const varIds = Object.keys(modifierDef);
                const lambdaValue = outConfig.lambda[fieldName];

                // Special handling for expression (assert) - check nested
                if (fieldName === 'expression' && typeof lambdaValue === 'object') {
                    // Check inside AND array
                    const andArray = lambdaValue?.AND || [];
                    for (const varId of varIds) {
                        const referenced = JSON.stringify(andArray).includes(`{{{${varId}}}}`);
                        if (!referenced) {
                            errors.push({
                                severity: 'critical', component: compId, rule: 'variable-mapping',
                                message: `Modifier variable "${varId}" in expression is not referenced in lambda AND array`
                            });
                        }
                    }
                    continue;
                }

                // Normal field - lambda should contain {{{varId}}}
                if (typeof lambdaValue === 'string') {
                    for (const varId of varIds) {
                        if (!lambdaValue.includes(`{{{${varId}}}`)) {
                            errors.push({
                                severity: 'critical', component: compId, rule: 'variable-mapping',
                                message: `Modifier defines "${varId}" for field "${fieldName}" but lambda value is "${lambdaValue}" — should contain {{{${varId}}}}`
                            });
                        }
                    }
                } else if (lambdaValue === '' || lambdaValue === undefined) {
                    errors.push({
                        severity: 'critical', component: compId, rule: 'variable-mapping',
                        message: `Lambda for "${fieldName}" is empty but modifier defines variables: ${varIds.join(', ')}`
                    });
                }
            }

            // Check variable paths reference accessible components
            const checkVariablePaths = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.variable && typeof obj.variable === 'string') {
                    const match = obj.variable.match(/^\$\.([^.]+)\./);
                    if (match) {
                        const referencedComp = match[1];
                        if (!compSources.includes(referencedComp) && referencedComp !== compId) {
                            errors.push({
                                severity: 'critical', component: compId, rule: 'variable-path',
                                message: `Variable path "${obj.variable}" references "${referencedComp}" which is not in source.in`
                            });
                        }
                    }
                }
                for (const val of Object.values(obj)) {
                    if (typeof val === 'object') checkVariablePaths(val);
                }
            };
            checkVariablePaths(outConfig.modifiers);
        }
    }

    // ProcessE2EResults validation
    const processEntry = Object.entries(components).find(([, c]) => c.type === 'appmixer.utils.test.ProcessE2EResults');
    if (processEntry) {
        const [procId, procComp] = processEntry;
        if (!procComp.config?.properties?.successStoreId) {
            errors.push({ severity: 'critical', component: procId, rule: 'process-config', message: 'Missing successStoreId' });
        }
        if (!procComp.config?.properties?.failedStoreId) {
            errors.push({ severity: 'critical', component: procId, rule: 'process-config', message: 'Missing failedStoreId' });
        }

        // Check result variable mapping
        const transformIn = procComp.config?.transform?.in;
        if (transformIn) {
            const sourceKey = Object.keys(transformIn)[0];
            const resultModifier = transformIn[sourceKey]?.out?.modifiers?.result;
            const resultLambda = transformIn[sourceKey]?.out?.lambda?.result;
            if (resultModifier && Object.keys(resultModifier).length > 0) {
                const varId = Object.keys(resultModifier)[0];
                if (!resultLambda || !resultLambda.includes(`{{{${varId}}}`)) {
                    errors.push({
                        severity: 'critical', component: procId, rule: 'process-result',
                        message: `ProcessE2EResults result lambda should be "{{{${varId}}}}" but got "${resultLambda}"`
                    });
                }
            }
        }
    }

    return errors;
};

// --- JSON Schema validation ---

const schemaValidation = (flowJson, schemaPath) => {
    if (!schemaPath || !fs.existsSync(schemaPath)) return [];
    try {
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
        const ajv = new Ajv({ allErrors: true, strict: false });
        const validate = ajv.compile(schema);
        if (!validate(flowJson.flow || flowJson)) {
            return validate.errors.map(err => ({
                severity: 'critical',
                component: null,
                rule: 'json-schema',
                message: `${err.instancePath} ${err.message}`
            }));
        }
    } catch (e) {
        return [{ severity: 'warning', component: null, rule: 'json-schema', message: `Schema validation error: ${e.message}` }];
    }
    return [];
};

// --- Main orchestrator ---

/**
 * @param {Object} options
 * @param {Object} options.flowJson - Initial flow JSON to improve
 * @param {Object} options.componentSchemas - Map of componentType -> schema info (from component.json)
 * @param {string} [options.flowSchemaPath] - Path to flow-schema.json for JSON schema validation
 * @param {number} [options.maxIterations=5] - Max generate→review iterations before meta-improvement
 * @param {number} [options.maxMetaRounds=3] - Max meta-improvement rounds
 * @param {string} [options.generatorModel='sonnet'] - Model for generator
 * @param {string} [options.reviewerModel='sonnet'] - Model for reviewer (use different for diversity)
 * @param {string} [options.metaModel='sonnet'] - Model for meta-improver
 * @param {string} [options.connectorContext] - Additional context about the connector
 * @returns {Promise<{flowJson: Object, iterations: number, metaRounds: number, history: Array}>}
 */
export const run = async ({
    flowJson,
    componentSchemas = {},
    flowSchemaPath = null,
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
        console.log(chalk.blue(`\n=== Meta Round ${metaRound + 1}/${maxMetaRounds} ===\n`));

        const roundErrors = []; // Collect errors across iterations for meta-improver

        for (let iteration = 0; iteration < maxIterations; iteration++) {
            totalIterations++;
            console.log(chalk.cyan(`--- Iteration ${iteration + 1}/${maxIterations} (total: ${totalIterations}) ---`));

            // Step 1: Deterministic validation
            const detErrors = deterministicValidation(currentFlow, componentSchemas);
            const schemaErrors = schemaValidation(currentFlow, flowSchemaPath);
            const allDetErrors = [...detErrors, ...schemaErrors];

            if (allDetErrors.length > 0) {
                console.log(chalk.red(`Deterministic validation: ${allDetErrors.length} errors`));
                allDetErrors.forEach(e => console.log(chalk.red(`  [${e.severity}] ${e.rule}: ${e.message}`)));
            } else {
                console.log(chalk.green('Deterministic validation: PASSED'));
            }

            // Step 2: LLM Review (even if deterministic passed — catches semantic issues)
            const reviewerPrompt = readPrompt('reviewer-system');
            const reviewInput = `Review this E2E test flow JSON:\n\n${JSON.stringify(currentFlow, null, 2)}` +
                (connectorContext ? `\n\nComponent schemas for reference:\n${connectorContext}` : '') +
                (allDetErrors.length > 0 ? `\n\nDeterministic validation already found these errors (confirm and find more):\n${JSON.stringify(allDetErrors, null, 2)}` : '');

            console.log(chalk.yellow('Running LLM review...'));
            const reviewRaw = await runLLM({
                systemPrompt: reviewerPrompt,
                userPrompt: reviewInput,
                model: reviewerModel,
                silent: true
            });

            const reviewResult = extractJSON(reviewRaw);
            const llmErrors = reviewResult?.errors || [];

            // Merge errors (dedup by rule+component)
            const allErrors = [...allDetErrors];
            for (const err of llmErrors) {
                const isDup = allErrors.some(e => e.rule === err.rule && e.component === err.component && e.message === err.message);
                if (!isDup) allErrors.push(err);
            }

            const criticalErrors = allErrors.filter(e => e.severity === 'critical');

            const iterationLog = {
                iteration: totalIterations,
                metaRound: metaRound + 1,
                deterministicErrors: allDetErrors,
                llmErrors,
                totalErrors: allErrors.length,
                criticalErrors: criticalErrors.length,
                flow: currentFlow
            };
            history.push(iterationLog);
            roundErrors.push(...allErrors);

            // All clear?
            if (criticalErrors.length === 0) {
                console.log(chalk.green(`\n✅ Flow passed all validations after ${totalIterations} iterations!`));

                // Save final result
                const logPath = path.join(LOGS_DIR, `run-${Date.now()}.json`);
                fs.writeFileSync(logPath, JSON.stringify({ history, result: currentFlow }, null, 2));

                return {
                    flowJson: currentFlow,
                    iterations: totalIterations,
                    metaRounds: metaRound,
                    history,
                    success: true
                };
            }

            console.log(chalk.red(`${criticalErrors.length} critical errors. Sending to generator for fix...`));

            // Step 3: Generator fixes
            const generatorPrompt = readPrompt('generator-system');
            const fixInput = `Fix the following E2E test flow. Here are the errors found by the reviewer:

${JSON.stringify(allErrors, null, 2)}

Current flow JSON:
${JSON.stringify(currentFlow, null, 2)}

${connectorContext ? `Component schemas for reference:\n${connectorContext}` : ''}

Fix ALL errors and return the complete corrected flow JSON.`;

            console.log(chalk.yellow('Running generator fix...'));
            const fixRaw = await runLLM({
                systemPrompt: generatorPrompt,
                userPrompt: fixInput,
                model: generatorModel,
                silent: true
            });

            const fixedFlow = extractJSON(fixRaw);
            if (fixedFlow && fixedFlow.flow) {
                currentFlow = fixedFlow;
                console.log(chalk.green('Generator produced fixed flow.'));
            } else {
                console.log(chalk.red('Generator failed to produce valid JSON. Retrying...'));
            }
        }

        // Step 4: Meta-improvement — iterations exhausted
        if (metaRound < maxMetaRounds - 1) {
            console.log(chalk.magenta(`\n🔧 Meta-improvement round ${metaRound + 1}...`));

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

            const metaInput = `## Current Generator Prompt
${currentGeneratorPrompt}

## Current Reviewer Prompt
${currentReviewerPrompt}

## Error History (${roundErrors.length} total errors across ${maxIterations} iterations)

### Error Pattern Summary
${Object.values(errorSummary)
    .sort((a, b) => b.count - a.count)
    .map(e => `- **${e.rule}** (${e.severity}, ${e.count}x): ${e.message}`)
    .join('\n')}

### Full Iteration History
${history.slice(-maxIterations).map((h, i) =>
    `Iteration ${i + 1}: ${h.totalErrors} errors (${h.criticalErrors} critical)\n${
        [...h.deterministicErrors, ...h.llmErrors].map(e => `  - [${e.severity}] ${e.rule}: ${e.message}`).join('\n')
    }`
).join('\n\n')}

Analyze the patterns and improve both prompts to prevent these recurring errors.`;

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
                    console.log(chalk.magenta('✏️  Updated generator prompt'));
                }
                if (metaResult.reviewer_prompt) {
                    writePrompt('reviewer-system', metaResult.reviewer_prompt);
                    console.log(chalk.magenta('✏️  Updated reviewer prompt'));
                }
                if (metaResult.changes) {
                    console.log(chalk.magenta('Changes:'));
                    metaResult.changes.forEach(c => console.log(chalk.magenta(`  • ${c}`)));
                }
                if (metaResult.analysis) {
                    console.log(chalk.magenta(`Analysis: ${metaResult.analysis}`));
                }
            } else {
                console.log(chalk.red('Meta-improver failed to produce valid output.'));
            }
        }
    }

    // Exhausted all meta rounds
    console.log(chalk.red(`\n❌ Failed to produce valid flow after ${totalIterations} iterations and ${maxMetaRounds} meta rounds.`));

    const logPath = path.join(LOGS_DIR, `run-failed-${Date.now()}.json`);
    fs.writeFileSync(logPath, JSON.stringify({ history, lastFlow: currentFlow }, null, 2));

    return {
        flowJson: currentFlow,
        iterations: totalIterations,
        metaRounds: maxMetaRounds,
        history,
        success: false
    };
};

export default { run };
