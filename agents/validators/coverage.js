/**
 * Input coverage validation — checks flow fields against component.json schemas.
 * Requires access to the connectors directory.
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Schema loading
// ---------------------------------------------------------------------------

export const loadComponentSchema = (componentType, connectorsDir) => {
    const parts = componentType.split('.');
    const componentPath = path.join(connectorsDir, ...parts, 'component.json');
    try {
        return JSON.parse(fs.readFileSync(componentPath, 'utf-8'));
    } catch {
        return null;
    }
};

export const getInputSchema = (componentJson) => {
    const schema = componentJson?.inPorts?.[0]?.schema || {};
    return {
        properties: schema.properties || {},
        required: schema.required || []
    };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENERIC_VALUES = new Set([
    '', 'test', 'string', 'value', 'example', 'foo', 'bar', 'baz',
    'undefined', 'null', 'none', 'n/a', 'todo', 'placeholder', 'xxx', 'abc', '123'
]);

const UTIL_PREFIXES = [
    'appmixer.utils.controls.',
    'appmixer.utils.test.',
];

const error = (severity, component, rule, message) => ({ severity, component, rule, message });

// ---------------------------------------------------------------------------
// Individual validators
// ---------------------------------------------------------------------------

const getUsedFields = (comp) => {
    const fields = new Set();
    for (const src of Object.values(comp.config?.transform?.in || {})) {
        for (const name of Object.keys(src?.out?.lambda || {})) fields.add(name);
    }
    return fields;
};

export const validateRequiredFields = (compId, usedFields, requiredFields, type) => {
    return requiredFields
        .filter(f => !usedFields.has(f))
        .map(f => error('critical', compId, 'input-coverage-required',
            `Required field "${f}" is not provided (schema: ${type})`));
};

export const validateOptionalCoverage = (compId, usedFields, schemaFieldNames, requiredFields) => {
    const missing = schemaFieldNames
        .filter(f => !requiredFields.includes(f) && !usedFields.has(f));
    if (missing.length === 0) return [];
    return [error('warning', compId, 'input-coverage-optional',
        `Optional fields not tested: [${missing.join(', ')}] (${missing.length}/${schemaFieldNames.length} missing)`)];
};

export const validateUnknownFields = (compId, usedFields, schemaFieldNames) => {
    return [...usedFields]
        .filter(f => !schemaFieldNames.includes(f))
        .map(f => error('critical', compId, 'unknown-field',
            `Field "${f}" is not defined in component schema. Available: [${schemaFieldNames.join(', ')}]`));
};

export const validateDataQuality = (compId, comp, schemaProps) => {
    const errors = [];
    for (const src of Object.values(comp.config?.transform?.in || {})) {
        for (const [fieldName, value] of Object.entries(src?.out?.lambda || {})) {
            if (typeof value !== 'string' || value.includes('{{{')) continue;

            const trimmed = value.trim().toLowerCase();
            const fieldSchema = schemaProps[fieldName];

            if (GENERIC_VALUES.has(trimmed)) {
                errors.push(error('warning', compId, 'meaningless-data',
                    `Field "${fieldName}" has generic/empty value "${value}". Use realistic test data.`));
            }

            if (fieldSchema?.enum && !fieldSchema.enum.includes(value)) {
                errors.push(error('critical', compId, 'invalid-enum',
                    `Field "${fieldName}" value "${value}" not in enum: [${fieldSchema.enum.join(', ')}]`));
            }

            if (fieldSchema?.type === 'integer' && !/^-?\d+$/.test(value)) {
                errors.push(error('warning', compId, 'type-mismatch',
                    `Field "${fieldName}" expects integer but got "${value}"`));
            }

            if (fieldSchema?.type === 'boolean' && !['true', 'false'].includes(trimmed)) {
                errors.push(error('warning', compId, 'type-mismatch',
                    `Field "${fieldName}" expects boolean but got "${value}"`));
            }
        }
    }
    return errors;
};

// ---------------------------------------------------------------------------
// Compose all coverage validations
// ---------------------------------------------------------------------------

export const inputCoverageValidation = (flowJson, connectorsDir) => {
    const errors = [];
    if (!flowJson.flow || !connectorsDir) return errors;

    for (const [compId, comp] of Object.entries(flowJson.flow)) {
        const type = comp.type || '';
        if (UTIL_PREFIXES.some(p => type.startsWith(p))) continue;
        if (!type.startsWith('appmixer.')) continue;

        const schema = loadComponentSchema(type, connectorsDir);
        if (!schema) continue;

        const { properties: schemaProps, required: requiredFields } = getInputSchema(schema);
        const schemaFieldNames = Object.keys(schemaProps);
        if (schemaFieldNames.length === 0) continue;

        const usedFields = getUsedFields(comp);

        errors.push(
            ...validateRequiredFields(compId, usedFields, requiredFields, type),
            ...validateOptionalCoverage(compId, usedFields, schemaFieldNames, requiredFields),
            ...validateUnknownFields(compId, usedFields, schemaFieldNames),
            ...validateDataQuality(compId, comp, schemaProps),
        );
    }

    return errors;
};
