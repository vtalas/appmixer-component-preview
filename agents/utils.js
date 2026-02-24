/**
 * Shared utilities for the self-improving test flow agent.
 */

import fs from 'fs';
import path from 'path';

export const extractJSON = (text) => {
    for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
        try { return JSON.parse(match[1].trim()); } catch { /* continue */ }
    }
    try { return JSON.parse(text.trim()); } catch { /* continue */ }
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

export const deterministicValidation = (flowJson) => {
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
    if (!types.includes('appmixer.utils.controls.OnStart'))
        errors.push({ severity: 'critical', component: null, rule: 'required-component', message: 'Missing OnStart component' });
    if (!types.includes('appmixer.utils.test.AfterAll'))
        errors.push({ severity: 'critical', component: null, rule: 'required-component', message: 'Missing AfterAll component' });
    if (!types.includes('appmixer.utils.test.ProcessE2EResults'))
        errors.push({ severity: 'critical', component: null, rule: 'required-component', message: 'Missing ProcessE2EResults component' });

    // AfterAll ↔ Assert connections
    const afterAllEntry = Object.entries(components).find(([, c]) => c.type === 'appmixer.utils.test.AfterAll');
    const assertIds = Object.entries(components)
        .filter(([, c]) => c.type === 'appmixer.utils.test.Assert')
        .map(([id]) => id);

    if (afterAllEntry && assertIds.length > 0) {
        const afterAllSources = Object.keys(afterAllEntry[1].source?.in || {});
        for (const id of assertIds) {
            if (!afterAllSources.includes(id)) {
                errors.push({ severity: 'critical', component: id, rule: 'afterall-connection',
                    message: `Assert "${id}" is NOT connected to AfterAll's source.in` });
            }
        }
    }

    // Variable mapping & source connection validation
    for (const [compId, comp] of Object.entries(components)) {
        if (!comp.config?.transform?.in) continue;

        for (const [sourceId, sourceConfig] of Object.entries(comp.config.transform.in)) {
            const compSources = Object.keys(comp.source?.in || {});
            if (!compSources.includes(sourceId)) {
                errors.push({ severity: 'critical', component: compId, rule: 'source-mismatch',
                    message: `Transform references "${sourceId}" but it's not in source.in [${compSources.join(', ')}]` });
            }

            const outConfig = sourceConfig?.out;
            if (!outConfig?.modifiers || !outConfig?.lambda) continue;

            for (const [fieldName, modifierDef] of Object.entries(outConfig.modifiers)) {
                if (typeof modifierDef !== 'object' || Object.keys(modifierDef).length === 0) continue;
                const varIds = Object.keys(modifierDef);
                const lambdaValue = outConfig.lambda[fieldName];

                if (fieldName === 'expression' && typeof lambdaValue === 'object') {
                    const andArray = lambdaValue?.AND || [];
                    for (const varId of varIds) {
                        if (!JSON.stringify(andArray).includes(`{{{${varId}}}}`)) {
                            errors.push({ severity: 'critical', component: compId, rule: 'variable-mapping',
                                message: `Modifier "${varId}" in expression not referenced in lambda AND array` });
                        }
                    }
                    continue;
                }

                if (typeof lambdaValue === 'string') {
                    for (const varId of varIds) {
                        if (!lambdaValue.includes(`{{{${varId}}}}`)) {
                            errors.push({ severity: 'critical', component: compId, rule: 'variable-mapping',
                                message: `Modifier "${varId}" for "${fieldName}" not referenced in lambda. Lambda: "${lambdaValue}"` });
                        }
                    }
                } else if (lambdaValue === '' || lambdaValue === undefined) {
                    errors.push({ severity: 'critical', component: compId, rule: 'variable-mapping',
                        message: `Lambda for "${fieldName}" is empty but modifier defines: ${varIds.join(', ')}` });
                }
            }

            // Variable path → check referenced component exists in flow
            // NOTE: We only check existence, NOT source.in membership.
            // In Appmixer, modifier variables can reference any upstream component,
            // not just those in source.in. source.in controls execution order, not data access.
            const allComponentIds = Object.keys(components);
            const checkPaths = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.variable && typeof obj.variable === 'string') {
                    const match = obj.variable.match(/^\$\.([^.]+)\./);
                    if (match) {
                        const ref = match[1];
                        if (ref !== compId && !allComponentIds.includes(ref)) {
                            errors.push({ severity: 'critical', component: compId, rule: 'variable-path',
                                message: `Variable "${obj.variable}" references "${ref}" which doesn't exist in the flow` });
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
        if (!procComp.config?.properties?.successStoreId)
            errors.push({ severity: 'critical', component: procId, rule: 'process-config', message: 'Missing successStoreId' });
        if (!procComp.config?.properties?.failedStoreId)
            errors.push({ severity: 'critical', component: procId, rule: 'process-config', message: 'Missing failedStoreId' });

        const transformIn = procComp.config?.transform?.in;
        if (transformIn) {
            const sourceKey = Object.keys(transformIn)[0];
            const resultModifier = transformIn[sourceKey]?.out?.modifiers?.result;
            const resultLambda = transformIn[sourceKey]?.out?.lambda?.result;
            if (resultModifier && Object.keys(resultModifier).length > 0) {
                const varId = Object.keys(resultModifier)[0];
                if (!resultLambda || !resultLambda.includes(`{{{${varId}}}}`)) {
                    errors.push({ severity: 'critical', component: procId, rule: 'process-result',
                        message: `ProcessE2EResults result should be "{{{${varId}}}}" but got "${resultLambda}"` });
                }
            }
        }
    }

    return errors;
};

// --- Component schema loading ---

/**
 * Load component.json for a given component type.
 * @param {string} componentType - e.g. 'appmixer.axiom.datasets.CreateDataset'
 * @param {string} connectorsDir - path to appmixer-connectors/src
 * @returns {Object|null} parsed component.json or null
 */
export const loadComponentSchema = (componentType, connectorsDir) => {
    // appmixer.axiom.datasets.CreateDataset → appmixer/axiom/datasets/CreateDataset
    const parts = componentType.split('.');
    const componentPath = path.join(connectorsDir, ...parts, 'component.json');
    try {
        return JSON.parse(fs.readFileSync(componentPath, 'utf-8'));
    } catch {
        return null;
    }
};

/**
 * Get input schema fields from component.json
 * @returns {{ properties: Object, required: string[] }}
 */
export const getInputSchema = (componentJson) => {
    const inPort = componentJson?.inPorts?.[0];
    const schema = inPort?.schema || {};
    return {
        properties: schema.properties || {},
        required: schema.required || []
    };
};

// --- Input coverage validation ---

const GENERIC_VALUES = new Set([
    '', 'test', 'string', 'value', 'example', 'foo', 'bar', 'baz',
    'undefined', 'null', 'none', 'n/a', 'todo', 'placeholder', 'xxx', 'abc', '123'
]);

const UTIL_COMPONENT_PREFIXES = [
    'appmixer.utils.controls.',
    'appmixer.utils.test.',
];

/**
 * Validate input coverage and data quality against component schemas.
 * @param {Object} flowJson - the flow
 * @param {string} connectorsDir - path to appmixer-connectors/src
 * @returns {Array} errors
 */
export const inputCoverageValidation = (flowJson, connectorsDir) => {
    const errors = [];
    if (!flowJson.flow || !connectorsDir) return errors;

    for (const [compId, comp] of Object.entries(flowJson.flow)) {
        const type = comp.type || '';

        // Skip utility components
        if (UTIL_COMPONENT_PREFIXES.some(p => type.startsWith(p))) continue;
        if (!type.startsWith('appmixer.')) continue;

        const componentJson = loadComponentSchema(type, connectorsDir);
        if (!componentJson) continue;

        const { properties: schemaProps, required: requiredFields } = getInputSchema(componentJson);
        const schemaFieldNames = Object.keys(schemaProps);
        if (schemaFieldNames.length === 0) continue;

        // Collect fields actually used in the flow for this component
        const usedFields = new Set();
        const transform = comp.config?.transform?.in || {};
        for (const sourceConfig of Object.values(transform)) {
            const lambda = sourceConfig?.out?.lambda || {};
            for (const fieldName of Object.keys(lambda)) {
                usedFields.add(fieldName);
            }
        }

        // Check required fields are covered
        for (const field of requiredFields) {
            if (!usedFields.has(field)) {
                errors.push({
                    severity: 'critical',
                    component: compId,
                    rule: 'input-coverage-required',
                    message: `Required field "${field}" is not provided (schema: ${type})`
                });
            }
        }

        // Check optional fields coverage (warning, not critical)
        const optionalFields = schemaFieldNames.filter(f => !requiredFields.includes(f));
        const missingOptional = optionalFields.filter(f => !usedFields.has(f));
        if (missingOptional.length > 0) {
            errors.push({
                severity: 'warning',
                component: compId,
                rule: 'input-coverage-optional',
                message: `Optional fields not tested: [${missingOptional.join(', ')}] (${missingOptional.length}/${schemaFieldNames.length} missing)`
            });
        }

        // Check for unknown fields (not in schema)
        for (const field of usedFields) {
            if (!schemaFieldNames.includes(field)) {
                errors.push({
                    severity: 'critical',
                    component: compId,
                    rule: 'unknown-field',
                    message: `Field "${field}" is not defined in component schema. Available: [${schemaFieldNames.join(', ')}]`
                });
            }
        }

        // Check data quality — look for generic/meaningless values in lambda
        for (const sourceConfig of Object.values(transform)) {
            const lambda = sourceConfig?.out?.lambda || {};
            for (const [fieldName, value] of Object.entries(lambda)) {
                if (typeof value !== 'string') continue;
                // Skip template references like {{{var}}}
                if (value.includes('{{{')) continue;

                const trimmed = value.trim().toLowerCase();
                if (GENERIC_VALUES.has(trimmed)) {
                    errors.push({
                        severity: 'warning',
                        component: compId,
                        rule: 'meaningless-data',
                        message: `Field "${fieldName}" has generic/empty value "${value}". Use realistic test data.`
                    });
                }

                // Check enum compliance
                const fieldSchema = schemaProps[fieldName];
                if (fieldSchema?.enum && !value.includes('{{{')) {
                    if (!fieldSchema.enum.includes(value)) {
                        errors.push({
                            severity: 'critical',
                            component: compId,
                            rule: 'invalid-enum',
                            message: `Field "${fieldName}" value "${value}" not in enum: [${fieldSchema.enum.join(', ')}]`
                        });
                    }
                }

                // Check type compliance for obvious cases
                if (fieldSchema?.type === 'integer' && !value.includes('{{{')) {
                    if (!/^-?\d+$/.test(value)) {
                        errors.push({
                            severity: 'warning',
                            component: compId,
                            rule: 'type-mismatch',
                            message: `Field "${fieldName}" expects integer but got "${value}"`
                        });
                    }
                }
                if (fieldSchema?.type === 'boolean' && !value.includes('{{{')) {
                    if (!['true', 'false'].includes(trimmed)) {
                        errors.push({
                            severity: 'warning',
                            component: compId,
                            rule: 'type-mismatch',
                            message: `Field "${fieldName}" expects boolean but got "${value}"`
                        });
                    }
                }
            }
        }
    }

    return errors;
};
