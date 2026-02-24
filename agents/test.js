#!/usr/bin/env node

/**
 * Tests for the self-improving test flow agent.
 * Run: node --test agents/test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { extractJSON, deterministicValidation, inputCoverageValidation, getInputSchema } from './utils.js';

// =========================================================================
// Test fixtures
// =========================================================================

const CONNECTORS_DIR = '/Users/vladimir/Projects/appmixer-connectors/src';
const HAS_CONNECTORS = (() => { try { return fs.statSync(CONNECTORS_DIR).isDirectory(); } catch { return false; } })();
const TEST_FLOWS_DIR = `${CONNECTORS_DIR}/appmixer/axiom/artifacts/ai-artifacts/test-flows`;

/** Minimal valid flow — override components via spread */
const validFlow = (components = {}) => ({
    name: 'E2E Connector - Test',
    flow: {
        'on-start': { type: 'appmixer.utils.controls.OnStart', source: {} },
        'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: {} } },
        'process': {
            type: 'appmixer.utils.test.ProcessE2EResults',
            config: { properties: { successStoreId: 'x', failedStoreId: 'y' } }
        },
        ...components
    }
});

/** Component with transform config shorthand */
const withTransform = (type, sourceIn, lambdaFields, modifierFields) => ({
    type,
    source: { in: sourceIn },
    config: { transform: { in: Object.fromEntries(
        Object.entries(lambdaFields).map(([src, fields]) => [
            src, { out: {
                modifiers: modifierFields?.[src] || {},
                lambda: fields
            }}
        ])
    )}}
});

// =========================================================================
// extractJSON
// =========================================================================

describe('extractJSON', () => {
    const cases = [
        ['raw JSON', '{"ok": true}', { ok: true }],
        ['markdown fence', '```json\n{"ok": false}\n```', { ok: false }],
        ['generic fence', '```\n{"k": "v"}\n```', { k: 'v' }],
        ['embedded in text', 'Result: {"a": 1} done.', { a: 1 }],
        ['nested objects', '{"a":{"b":{"c":1}}}', { a: { b: { c: 1 } } }],
    ];
    for (const [label, input, expected] of cases) {
        it(`parses ${label}`, () => assert.deepEqual(extractJSON(input), expected));
    }

    it('returns null for non-JSON', () => assert.equal(extractJSON('nope'), null));
    it('returns null for empty string', () => assert.equal(extractJSON(''), null));
});

// =========================================================================
// deterministicValidation
// =========================================================================

describe('deterministicValidation', () => {
    const hasError = (errors, rule, match) =>
        errors.some(e => e.rule === rule && (!match || e.message.includes(match)));

    describe('flow name', () => {
        it('rejects missing', () => assert.ok(hasError(deterministicValidation({ flow: {} }), 'flow-name')));
        it('rejects non-E2E', () => assert.ok(hasError(deterministicValidation({ name: 'Bad', flow: {} }), 'flow-name', 'E2E')));
        it('accepts valid', () => assert.ok(!hasError(deterministicValidation(validFlow()), 'flow-name')));
    });

    describe('structure', () => {
        it('rejects missing flow', () => assert.ok(hasError(deterministicValidation({ name: 'E2E X' }), 'flow-structure')));
    });

    describe('required components', () => {
        it('detects all missing', () => {
            const errors = deterministicValidation({ name: 'E2E X', flow: {} });
            assert.ok(hasError(errors, 'required-component', 'OnStart'));
            assert.ok(hasError(errors, 'required-component', 'AfterAll'));
            assert.ok(hasError(errors, 'required-component', 'ProcessE2EResults'));
        });
        it('passes when present', () => {
            assert.ok(!hasError(deterministicValidation(validFlow()), 'required-component'));
        });
    });

    describe('AfterAll ↔ Assert', () => {
        it('detects unconnected assert', () => {
            const errors = deterministicValidation(validFlow({
                'assert-1': { type: 'appmixer.utils.test.Assert' },
                'assert-2': { type: 'appmixer.utils.test.Assert' },
                'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: { 'assert-1': ['out'] } } },
            }));
            const missing = errors.filter(e => e.rule === 'afterall-connection');
            assert.equal(missing.length, 1);
            assert.ok(missing[0].message.includes('assert-2'));
        });

        it('passes when all connected', () => {
            const errors = deterministicValidation(validFlow({
                'assert-1': { type: 'appmixer.utils.test.Assert' },
                'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: { 'assert-1': ['out'] } } },
            }));
            assert.ok(!hasError(errors, 'afterall-connection'));
        });
    });

    describe('source-mismatch', () => {
        it('detects transform ref not in source.in', () => {
            const errors = deterministicValidation(validFlow({
                'create': withTransform('appmixer.x.Create', { 'on-start': ['out'] },
                    { 'ghost': { title: '{{{v}}}' } },
                    { 'ghost': { title: { v: { variable: '$.ghost.out.x' } } } }
                )
            }));
            assert.ok(hasError(errors, 'source-mismatch', 'ghost'));
        });
    });

    describe('variable-mapping', () => {
        it('detects modifier not in lambda', () => {
            const errors = deterministicValidation(validFlow({
                'c': withTransform('appmixer.x.C', { 'on-start': ['out'] },
                    { 'on-start': { title: 'hardcoded' } },
                    { 'on-start': { title: { v1: { variable: '$.on-start.out.x' } } } }
                )
            }));
            assert.ok(hasError(errors, 'variable-mapping', 'v1'));
        });

        it('passes correct mapping', () => {
            const errors = deterministicValidation(validFlow({
                'c': withTransform('appmixer.x.C', { 'on-start': ['out'] },
                    { 'on-start': { title: '{{{v1}}}' } },
                    { 'on-start': { title: { v1: { variable: '$.on-start.out.x' } } } }
                )
            }));
            assert.ok(!hasError(errors, 'variable-mapping'));
        });

        it('detects missing ref in assert AND array', () => {
            const errors = deterministicValidation(validFlow({
                'a': {
                    type: 'appmixer.utils.test.Assert',
                    source: { in: { 'on-start': ['out'] } },
                    config: { transform: { in: { 'on-start': { out: {
                        modifiers: { expression: { v1: { variable: '$.on-start.out.id' } } },
                        lambda: { expression: { AND: [{ field: 'wrong', op: 'isNotEmpty' }] } }
                    }}}}}
                },
                'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: { a: ['out'] } } },
            }));
            assert.ok(hasError(errors, 'variable-mapping', 'v1'));
        });

        it('passes assert when variable in AND', () => {
            const errors = deterministicValidation(validFlow({
                'a': {
                    type: 'appmixer.utils.test.Assert',
                    source: { in: { 'on-start': ['out'] } },
                    config: { transform: { in: { 'on-start': { out: {
                        modifiers: { expression: { v1: { variable: '$.on-start.out.id' } } },
                        lambda: { expression: { AND: [{ field: '{{{v1}}}', op: 'isNotEmpty' }] } }
                    }}}}}
                },
                'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: { a: ['out'] } } },
            }));
            assert.ok(!hasError(errors, 'variable-mapping'));
        });
    });

    describe('variable-path', () => {
        it('detects ref to nonexistent component', () => {
            const errors = deterministicValidation(validFlow({
                'u': withTransform('appmixer.x.U', { 'on-start': ['out'] },
                    { 'on-start': { id: '{{{v1}}}' } },
                    { 'on-start': { id: { v1: { variable: '$.ghost.out.id' } } } }
                )
            }));
            assert.ok(hasError(errors, 'variable-path', 'ghost'));
        });

        it('passes when component exists (even if not in source.in)', () => {
            const errors = deterministicValidation(validFlow({
                'create': { type: 'appmixer.x.Create', source: { in: { 'on-start': ['out'] } } },
                'u': withTransform('appmixer.x.U', { 'on-start': ['out'] },
                    { 'on-start': { id: '{{{v1}}}' } },
                    { 'on-start': { id: { v1: { variable: '$.create.out.id' } } } }
                )
            }));
            assert.ok(!hasError(errors, 'variable-path'));
        });
    });

    describe('ProcessE2EResults', () => {
        it('detects missing successStoreId', () => {
            const errors = deterministicValidation(validFlow({
                'process': { type: 'appmixer.utils.test.ProcessE2EResults', config: { properties: { failedStoreId: 'y' } } }
            }));
            assert.ok(hasError(errors, 'process-config', 'successStoreId'));
        });
        it('detects missing failedStoreId', () => {
            const errors = deterministicValidation(validFlow({
                'process': { type: 'appmixer.utils.test.ProcessE2EResults', config: { properties: { successStoreId: 'x' } } }
            }));
            assert.ok(hasError(errors, 'process-config', 'failedStoreId'));
        });
    });

    describe('complete valid flow', () => {
        it('zero errors', () => {
            const errors = deterministicValidation(validFlow({
                'create': withTransform('appmixer.x.Create', { 'on-start': ['out'] },
                    { 'on-start': { name: '{{{v1}}}' } },
                    { 'on-start': { name: { v1: { variable: '$.on-start.out.value' } } } }
                ),
                'assert-create': {
                    type: 'appmixer.utils.test.Assert',
                    source: { in: { create: ['out'] } },
                    config: { transform: { in: { create: { out: {
                        modifiers: { expression: { vid: { variable: '$.create.out.id' } } },
                        lambda: { expression: { AND: [{ field: '{{{vid}}}', op: 'isNotEmpty' }] } }
                    }}}}}
                },
                'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: { 'assert-create': ['out'] } } },
                'process': {
                    type: 'appmixer.utils.test.ProcessE2EResults',
                    source: { in: { 'after-all': ['out'] } },
                    config: {
                        properties: { successStoreId: 's', failedStoreId: 'f' },
                        transform: { in: { 'after-all': { out: {
                            modifiers: { result: { vr: { variable: '$.after-all.out' } } },
                            lambda: { result: '{{{vr}}}' }
                        }}}}
                    }
                }
            }));
            assert.equal(errors.length, 0, `Got: ${JSON.stringify(errors, null, 2)}`);
        });
    });
});

// =========================================================================
// getInputSchema
// =========================================================================

describe('getInputSchema', () => {
    it('extracts properties and required', () => {
        const s = getInputSchema({ inPorts: [{ schema: {
            properties: { name: { type: 'string' }, id: { type: 'integer' } },
            required: ['name']
        }}]});
        assert.deepEqual(Object.keys(s.properties), ['name', 'id']);
        assert.deepEqual(s.required, ['name']);
    });
    it('returns empty for missing', () => {
        const s = getInputSchema({});
        assert.deepEqual(s.properties, {});
        assert.deepEqual(s.required, []);
    });
});

// =========================================================================
// inputCoverageValidation (requires real connectors dir)
// =========================================================================

describe('inputCoverageValidation', () => {
    const hasError = (errors, rule, match) =>
        errors.some(e => e.rule === rule && (!match || e.message.includes(match)));

    const axiomCreate = (lambda) => ({
        flow: { 'c': {
            type: 'appmixer.axiom.datasets.CreateDataset',
            config: { transform: { in: { src: { out: { lambda } } } } }
        }}
    });

    if (!HAS_CONNECTORS) {
        it('skips — connectors dir not available', () => {
            assert.equal(inputCoverageValidation({ flow: {} }, '/nonexistent').length, 0);
        });
        return;
    }

    it('detects missing required field', () => {
        assert.ok(hasError(
            inputCoverageValidation(axiomCreate({ description: 'x' }), CONNECTORS_DIR),
            'input-coverage-required', 'name'
        ));
    });

    it('warns about untested optional fields', () => {
        assert.ok(hasError(
            inputCoverageValidation(axiomCreate({ name: '{{{v}}}' }), CONNECTORS_DIR),
            'input-coverage-optional'
        ));
    });

    it('detects unknown field', () => {
        assert.ok(hasError(
            inputCoverageValidation(axiomCreate({ name: '{{{v}}}', bogus: 'x' }), CONNECTORS_DIR),
            'unknown-field', 'bogus'
        ));
    });

    it('detects generic data', () => {
        assert.ok(hasError(
            inputCoverageValidation(axiomCreate({ name: 'test', description: '' }), CONNECTORS_DIR),
            'meaningless-data'
        ));
    });

    it('detects invalid enum', () => {
        assert.ok(hasError(
            inputCoverageValidation(axiomCreate({ name: '{{{v}}}', kind: 'nope' }), CONNECTORS_DIR),
            'invalid-enum', 'kind'
        ));
    });

    it('passes valid enum', () => {
        assert.ok(!hasError(
            inputCoverageValidation(axiomCreate({ name: '{{{v}}}', kind: 'axiom:events:v1' }), CONNECTORS_DIR),
            'invalid-enum'
        ));
    });

    it('skips utility components', () => {
        assert.equal(inputCoverageValidation({
            flow: {
                a: { type: 'appmixer.utils.controls.OnStart', config: {} },
                b: { type: 'appmixer.utils.test.AfterAll', config: {} }
            }
        }, CONNECTORS_DIR).length, 0);
    });

    it('real flow: dataset-lifecycle — no critical errors', () => {
        const flow = JSON.parse(fs.readFileSync(`${TEST_FLOWS_DIR}/test-flow-dataset-lifecycle.json`, 'utf-8'));
        const critical = inputCoverageValidation(flow, CONNECTORS_DIR).filter(e => e.severity === 'critical');
        assert.equal(critical.length, 0, `Got: ${JSON.stringify(critical, null, 2)}`);
    });
});
