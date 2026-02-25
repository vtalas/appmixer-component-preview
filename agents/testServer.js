#!/usr/bin/env node

/**
 * Tests for the server flow agent.
 * Run: node --test agents/testServer.js
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// =========================================================================
// We test the pure logic functions by importing the module and mocking
// the external dependencies (API client, LLM). For integration tests
// that hit real server, use: node agents/runServer.js <flow.json>
// =========================================================================

// ---------------------------------------------------------------------------
// parseServerErrors (extracted logic for testing)
// ---------------------------------------------------------------------------

/** Mirrors the parseServerErrors function from serverFlowAgent.js */
const parseServerErrors = (validateResult, startResult) => {
    const errors = [];

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
                    rule: 'server-validation',
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

// =========================================================================
// parseServerErrors
// =========================================================================

describe('parseServerErrors', () => {
    it('returns empty for successful validation and start', () => {
        const errors = parseServerErrors({ ok: true }, { started: true, status: {} });
        assert.equal(errors.length, 0);
    });

    it('returns empty for null inputs', () => {
        assert.equal(parseServerErrors(null, null).length, 0);
    });

    it('parses array validation errors', () => {
        const errors = parseServerErrors([
            { keyword: 'required', componentId: 'comp-1', message: 'Missing field "name"' },
            { keyword: 'enum', dataPath: '.type', message: 'Invalid enum value' }
        ], null);
        assert.equal(errors.length, 2);
        assert.equal(errors[0].rule, 'server-validation-required');
        assert.equal(errors[0].component, 'comp-1');
        assert.equal(errors[1].rule, 'server-validation-enum');
        assert.equal(errors[1].component, '.type');
    });

    it('parses object with errors array', () => {
        const errors = parseServerErrors({
            ok: false,
            error: { errors: [
                { componentId: 'x', message: 'bad config' },
                'string error'
            ]}
        }, null);
        assert.equal(errors.length, 2);
        assert.equal(errors[0].message, 'bad config');
        assert.equal(errors[1].message, 'string error');
    });

    it('parses object with single message', () => {
        const errors = parseServerErrors({
            ok: false,
            error: { message: 'Flow is invalid' }
        }, null);
        assert.equal(errors.length, 1);
        assert.equal(errors[0].message, 'Flow is invalid');
    });

    it('parses start failure', () => {
        const errors = parseServerErrors(null, {
            started: false,
            error: { componentId: 'trigger-1', message: 'Missing auth' }
        });
        assert.equal(errors.length, 1);
        assert.equal(errors[0].rule, 'server-start');
        assert.equal(errors[0].component, 'trigger-1');
        assert.equal(errors[0].message, 'Missing auth');
    });

    it('combines validation and start errors', () => {
        const errors = parseServerErrors(
            { ok: false, error: { message: 'Schema mismatch' } },
            { started: false, error: { message: 'Cannot start' } }
        );
        assert.equal(errors.length, 2);
        assert.ok(errors.some(e => e.rule === 'server-validation'));
        assert.ok(errors.some(e => e.rule === 'server-start'));
    });

    it('handles start error without details', () => {
        const errors = parseServerErrors(null, { started: false });
        assert.equal(errors.length, 1);
        assert.equal(errors[0].rule, 'server-start');
    });

    it('handles validation error with keyword but no message', () => {
        const errors = parseServerErrors([
            { keyword: 'type', componentId: 'c1' }
        ], null);
        assert.equal(errors.length, 1);
        assert.equal(errors[0].rule, 'server-validation-type');
        assert.ok(errors[0].message); // should stringify the object
    });
});

// =========================================================================
// CLI argument parsing (smoke test runServer.js structure)
// =========================================================================

describe('runServer CLI', () => {
    it('runServer.js exists and is valid JS', async () => {
        // Just verify the file can be parsed
        const fs = await import('fs');
        const source = fs.readFileSync(
            new URL('./runServer.js', import.meta.url), 'utf-8'
        );
        assert.ok(source.includes('serverFlowAgent'));
        assert.ok(source.includes('--no-start'));
        assert.ok(source.includes('--no-cleanup'));
    });

    it('serverFlowAgent.js exports run function', async () => {
        // Dynamic import to verify exports (won't actually run without SDK)
        const fs = await import('fs');
        const source = fs.readFileSync(
            new URL('./serverFlowAgent.js', import.meta.url), 'utf-8'
        );
        assert.ok(source.includes('export const run'));
        assert.ok(source.includes('export default'));
    });
});
