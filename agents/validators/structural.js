/**
 * Structural validation rules for E2E test flows.
 * Pure deterministic checks — no LLM, no external dependencies.
 */

// ---------------------------------------------------------------------------
// Individual validators
// ---------------------------------------------------------------------------

const error = (severity, component, rule, message) => ({ severity, component, rule, message });

export const validateFlowName = (flowJson) => {
    if (!flowJson.name) return [error('critical', null, 'flow-name', 'Flow name is missing')];
    if (!flowJson.name.startsWith('E2E '))
        return [error('critical', null, 'flow-name', `Flow name must start with "E2E ". Got: "${flowJson.name}"`)];
    return [];
};

export const validateFlowStructure = (flowJson) => {
    if (!flowJson.flow) return [error('critical', null, 'flow-structure', 'Missing "flow" property')];
    return [];
};

const REQUIRED_TYPES = [
    ['appmixer.utils.controls.OnStart', 'OnStart'],
    ['appmixer.utils.test.AfterAll', 'AfterAll'],
    ['appmixer.utils.test.ProcessE2EResults', 'ProcessE2EResults'],
];

export const validateRequiredComponents = (components) => {
    const types = Object.values(components).map(c => c.type);
    return REQUIRED_TYPES
        .filter(([type]) => !types.includes(type))
        .map(([, name]) => error('critical', null, 'required-component', `Missing ${name} component`));
};

export const validateAfterAllConnections = (components) => {
    const errors = [];
    const afterAll = Object.entries(components).find(([, c]) => c.type === 'appmixer.utils.test.AfterAll');
    if (!afterAll) return errors;

    const afterAllSources = Object.keys(afterAll[1].source?.in || {});
    const assertIds = Object.entries(components)
        .filter(([, c]) => c.type === 'appmixer.utils.test.Assert')
        .map(([id]) => id);

    for (const id of assertIds) {
        if (!afterAllSources.includes(id)) {
            errors.push(error('critical', id, 'afterall-connection',
                `Assert "${id}" is NOT connected to AfterAll's source.in`));
        }
    }
    return errors;
};

export const validateSourceMismatch = (compId, comp) => {
    const errors = [];
    const compSources = Object.keys(comp.source?.in || {});

    for (const sourceId of Object.keys(comp.config?.transform?.in || {})) {
        if (!compSources.includes(sourceId)) {
            errors.push(error('critical', compId, 'source-mismatch',
                `Transform references "${sourceId}" but it's not in source.in [${compSources.join(', ')}]`));
        }
    }
    return errors;
};

export const validateVariableMapping = (compId, outConfig) => {
    const errors = [];
    if (!outConfig?.modifiers || !outConfig?.lambda) return errors;

    for (const [fieldName, modifierDef] of Object.entries(outConfig.modifiers)) {
        if (typeof modifierDef !== 'object' || Object.keys(modifierDef).length === 0) continue;

        const varIds = Object.keys(modifierDef);
        const lambdaValue = outConfig.lambda[fieldName];

        // Assert expression — check nested AND array
        if (fieldName === 'expression' && typeof lambdaValue === 'object') {
            const serialized = JSON.stringify(lambdaValue?.AND || []);
            for (const varId of varIds) {
                if (!serialized.includes(`{{{${varId}}}}`)) {
                    errors.push(error('critical', compId, 'variable-mapping',
                        `Modifier "${varId}" in expression not referenced in lambda AND array`));
                }
            }
            continue;
        }

        // Normal field
        if (typeof lambdaValue === 'string') {
            for (const varId of varIds) {
                if (!lambdaValue.includes(`{{{${varId}}}}`)) {
                    errors.push(error('critical', compId, 'variable-mapping',
                        `Modifier "${varId}" for "${fieldName}" not referenced in lambda. Lambda: "${lambdaValue}"`));
                }
            }
        } else if (lambdaValue === '' || lambdaValue === undefined) {
            errors.push(error('critical', compId, 'variable-mapping',
                `Lambda for "${fieldName}" is empty but modifier defines: ${varIds.join(', ')}`));
        }
    }
    return errors;
};

export const validateVariablePaths = (compId, outConfig, allComponentIds) => {
    const errors = [];
    if (!outConfig?.modifiers) return errors;

    // Variable path → check referenced component exists in flow.
    // We only check existence, NOT source.in membership.
    // In Appmixer, modifier variables can reference any upstream component.
    const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.variable && typeof obj.variable === 'string') {
            const match = obj.variable.match(/^\$\.([^.]+)\./);
            if (match) {
                const ref = match[1];
                if (ref !== compId && !allComponentIds.includes(ref)) {
                    errors.push(error('critical', compId, 'variable-path',
                        `Variable "${obj.variable}" references "${ref}" which doesn't exist in the flow`));
                }
            }
        }
        for (const val of Object.values(obj)) {
            if (typeof val === 'object') walk(val);
        }
    };
    walk(outConfig.modifiers);
    return errors;
};

export const validateProcessE2EResults = (components) => {
    const errors = [];
    const entry = Object.entries(components).find(([, c]) => c.type === 'appmixer.utils.test.ProcessE2EResults');
    if (!entry) return errors;

    const [procId, procComp] = entry;

    if (!procComp.config?.properties?.successStoreId)
        errors.push(error('critical', procId, 'process-config', 'Missing successStoreId'));
    if (!procComp.config?.properties?.failedStoreId)
        errors.push(error('critical', procId, 'process-config', 'Missing failedStoreId'));

    const transformIn = procComp.config?.transform?.in;
    if (transformIn) {
        const sourceKey = Object.keys(transformIn)[0];
        const resultModifier = transformIn[sourceKey]?.out?.modifiers?.result;
        const resultLambda = transformIn[sourceKey]?.out?.lambda?.result;
        if (resultModifier && Object.keys(resultModifier).length > 0) {
            const varId = Object.keys(resultModifier)[0];
            if (!resultLambda || !resultLambda.includes(`{{{${varId}}}}`)) {
                errors.push(error('critical', procId, 'process-result',
                    `ProcessE2EResults result should be "{{{${varId}}}}" but got "${resultLambda}"`));
            }
        }
    }
    return errors;
};

// ---------------------------------------------------------------------------
// Compose all structural validations
// ---------------------------------------------------------------------------

export const deterministicValidation = (flowJson) => {
    const errors = [
        ...validateFlowName(flowJson),
        ...validateFlowStructure(flowJson),
    ];

    if (!flowJson.flow) return errors;

    const components = flowJson.flow;
    const allComponentIds = Object.keys(components);

    errors.push(
        ...validateRequiredComponents(components),
        ...validateAfterAllConnections(components),
        ...validateProcessE2EResults(components),
    );

    for (const [compId, comp] of Object.entries(components)) {
        errors.push(...validateSourceMismatch(compId, comp));

        if (!comp.config?.transform?.in) continue;
        for (const sourceConfig of Object.values(comp.config.transform.in)) {
            const out = sourceConfig?.out;
            errors.push(
                ...validateVariableMapping(compId, out),
                ...validateVariablePaths(compId, out, allComponentIds),
            );
        }
    }

    return errors;
};
