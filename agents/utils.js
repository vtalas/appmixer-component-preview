/**
 * Shared utilities for the self-improving test flow agent.
 */

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

            // Variable path → source.in check
            const checkPaths = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.variable && typeof obj.variable === 'string') {
                    const match = obj.variable.match(/^\$\.([^.]+)\./);
                    if (match) {
                        const ref = match[1];
                        const compSrcs = Object.keys(comp.source?.in || {});
                        if (!compSrcs.includes(ref) && ref !== compId) {
                            errors.push({ severity: 'critical', component: compId, rule: 'variable-path',
                                message: `Variable "${obj.variable}" references "${ref}" not in source.in` });
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
