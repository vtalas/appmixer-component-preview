#!/usr/bin/env node

/**
 * Tests for the self-improving test flow agent.
 * Run: node --test agents/test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractJSON, deterministicValidation } from './utils.js';

// =========================================================================
// extractJSON
// =========================================================================

describe('extractJSON', () => {
    it('parses raw JSON', () => {
        assert.deepEqual(extractJSON('{"ok": true, "errors": []}'), { ok: true, errors: [] });
    });

    it('parses JSON from markdown code fence', () => {
        assert.deepEqual(
            extractJSON('Here is the result:\n```json\n{"ok": false}\n```\nDone.'),
            { ok: false }
        );
    });

    it('parses JSON from generic code fence', () => {
        assert.deepEqual(extractJSON('```\n{"key": "value"}\n```'), { key: 'value' });
    });

    it('extracts JSON embedded in text', () => {
        assert.deepEqual(
            extractJSON('The flow is: {"name": "E2E Test", "flow": {}} and that is it.'),
            { name: 'E2E Test', flow: {} }
        );
    });

    it('returns null for non-JSON text', () => {
        assert.equal(extractJSON('no json here'), null);
    });

    it('returns null for empty string', () => {
        assert.equal(extractJSON(''), null);
    });

    it('handles nested JSON objects', () => {
        assert.deepEqual(extractJSON('{"a": {"b": {"c": 1}}}'), { a: { b: { c: 1 } } });
    });
});

// =========================================================================
// deterministicValidation
// =========================================================================

// Helper: minimal valid flow (no errors)
const minimalValidFlow = (overrides = {}) => ({
    name: 'E2E Connector - Test',
    flow: {
        'on-start': { type: 'appmixer.utils.controls.OnStart', source: {} },
        'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: {} } },
        'process': { type: 'appmixer.utils.test.ProcessE2EResults', config: { properties: { successStoreId: 'x', failedStoreId: 'y' } } },
        ...overrides
    }
});

describe('deterministicValidation', () => {

    describe('flow name', () => {
        it('rejects missing name', () => {
            const errors = deterministicValidation({ flow: {} });
            assert.ok(errors.some(e => e.rule === 'flow-name'));
        });

        it('rejects name not starting with E2E', () => {
            const errors = deterministicValidation({ name: 'Test Flow', flow: {} });
            assert.ok(errors.some(e => e.rule === 'flow-name' && e.message.includes('E2E')));
        });

        it('accepts valid E2E name', () => {
            const errors = deterministicValidation(minimalValidFlow());
            assert.ok(!errors.some(e => e.rule === 'flow-name'));
        });
    });

    describe('flow structure', () => {
        it('rejects missing flow property', () => {
            const errors = deterministicValidation({ name: 'E2E Test' });
            assert.ok(errors.some(e => e.rule === 'flow-structure'));
        });
    });

    describe('required components', () => {
        it('detects all missing', () => {
            const errors = deterministicValidation({ name: 'E2E Test', flow: {} });
            assert.ok(errors.some(e => e.message.includes('OnStart')));
            assert.ok(errors.some(e => e.message.includes('AfterAll')));
            assert.ok(errors.some(e => e.message.includes('ProcessE2EResults')));
        });

        it('passes when all present', () => {
            const errors = deterministicValidation(minimalValidFlow());
            assert.ok(!errors.some(e => e.rule === 'required-component'));
        });
    });

    describe('AfterAll ↔ Assert connections', () => {
        it('detects assert not connected to AfterAll', () => {
            const errors = deterministicValidation(minimalValidFlow({
                'assert-1': { type: 'appmixer.utils.test.Assert' },
                'assert-2': { type: 'appmixer.utils.test.Assert' },
                'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: { 'assert-1': ['out'] } } },
            }));
            const missing = errors.filter(e => e.rule === 'afterall-connection');
            assert.equal(missing.length, 1);
            assert.ok(missing[0].message.includes('assert-2'));
        });

        it('passes when all asserts connected', () => {
            const errors = deterministicValidation(minimalValidFlow({
                'assert-1': { type: 'appmixer.utils.test.Assert' },
                'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: { 'assert-1': ['out'] } } },
            }));
            assert.ok(!errors.some(e => e.rule === 'afterall-connection'));
        });
    });

    describe('source-mismatch', () => {
        it('detects transform referencing component not in source.in', () => {
            const errors = deterministicValidation(minimalValidFlow({
                'create': {
                    type: 'appmixer.some.Create',
                    source: { in: { 'on-start': ['out'] } },
                    config: { transform: { in: {
                        'ghost': { out: { modifiers: {}, lambda: {} } }
                    }}}
                }
            }));
            assert.ok(errors.some(e => e.rule === 'source-mismatch' && e.component === 'create'));
        });
    });

    describe('variable-mapping', () => {
        it('detects modifier not referenced in lambda', () => {
            const errors = deterministicValidation(minimalValidFlow({
                'create': {
                    type: 'appmixer.some.Create',
                    source: { in: { 'on-start': ['out'] } },
                    config: { transform: { in: {
                        'on-start': { out: {
                            modifiers: { title: { 'v1': { variable: '$.on-start.out.x' } } },
                            lambda: { title: 'hardcoded' }
                        }}
                    }}}
                }
            }));
            assert.ok(errors.some(e => e.rule === 'variable-mapping' && e.component === 'create'));
        });

        it('passes when modifier correctly referenced', () => {
            const errors = deterministicValidation(minimalValidFlow({
                'create': {
                    type: 'appmixer.some.Create',
                    source: { in: { 'on-start': ['out'] } },
                    config: { transform: { in: {
                        'on-start': { out: {
                            modifiers: { title: { 'v1': { variable: '$.on-start.out.x' } } },
                            lambda: { title: '{{{v1}}}' }
                        }}
                    }}}
                }
            }));
            assert.ok(!errors.some(e => e.rule === 'variable-mapping'));
        });

        it('detects missing reference in assert expression AND array', () => {
            const errors = deterministicValidation(minimalValidFlow({
                'assert-x': {
                    type: 'appmixer.utils.test.Assert',
                    source: { in: { 'create': ['out'] } },
                    config: { transform: { in: {
                        'create': { out: {
                            modifiers: { expression: { 'v1': { variable: '$.create.out.id' } } },
                            lambda: { expression: { AND: [{ field: 'wrong', op: 'isNotEmpty' }] } }
                        }}
                    }}}
                },
                'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: { 'assert-x': ['out'] } } },
            }));
            assert.ok(errors.some(e => e.rule === 'variable-mapping' && e.component === 'assert-x'));
        });

        it('passes assert expression when variable referenced in AND', () => {
            const errors = deterministicValidation(minimalValidFlow({
                'assert-x': {
                    type: 'appmixer.utils.test.Assert',
                    source: { in: { 'create': ['out'] } },
                    config: { transform: { in: {
                        'create': { out: {
                            modifiers: { expression: { 'v1': { variable: '$.create.out.id' } } },
                            lambda: { expression: { AND: [{ field: '{{{v1}}}', op: 'isNotEmpty' }] } }
                        }}
                    }}}
                },
                'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: { 'assert-x': ['out'] } } },
            }));
            assert.ok(!errors.some(e => e.rule === 'variable-mapping' && e.component === 'assert-x'));
        });
    });

    describe('variable-path', () => {
        it('detects reference to component not in source.in', () => {
            const errors = deterministicValidation(minimalValidFlow({
                'update': {
                    type: 'appmixer.some.Update',
                    source: { in: { 'on-start': ['out'] } },
                    config: { transform: { in: {
                        'on-start': { out: {
                            modifiers: { id: { 'v1': { variable: '$.create.out.id' } } },
                            lambda: { id: '{{{v1}}}' }
                        }}
                    }}}
                }
            }));
            assert.ok(errors.some(e => e.rule === 'variable-path' && e.message.includes('create')));
        });

        it('passes when reference is in source.in', () => {
            const errors = deterministicValidation(minimalValidFlow({
                'create': { type: 'appmixer.some.Create', source: { in: { 'on-start': ['out'] } } },
                'update': {
                    type: 'appmixer.some.Update',
                    source: { in: { 'create': ['out'] } },
                    config: { transform: { in: {
                        'create': { out: {
                            modifiers: { id: { 'v1': { variable: '$.create.out.id' } } },
                            lambda: { id: '{{{v1}}}' }
                        }}
                    }}}
                }
            }));
            assert.ok(!errors.some(e => e.rule === 'variable-path'));
        });
    });

    describe('ProcessE2EResults config', () => {
        it('detects missing successStoreId', () => {
            const errors = deterministicValidation({
                name: 'E2E Test', flow: {
                    'on-start': { type: 'appmixer.utils.controls.OnStart' },
                    'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: {} } },
                    'process': { type: 'appmixer.utils.test.ProcessE2EResults', config: { properties: { failedStoreId: 'y' } } }
                }
            });
            assert.ok(errors.some(e => e.rule === 'process-config' && e.message.includes('successStoreId')));
        });

        it('detects missing failedStoreId', () => {
            const errors = deterministicValidation({
                name: 'E2E Test', flow: {
                    'on-start': { type: 'appmixer.utils.controls.OnStart' },
                    'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: {} } },
                    'process': { type: 'appmixer.utils.test.ProcessE2EResults', config: { properties: { successStoreId: 'x' } } }
                }
            });
            assert.ok(errors.some(e => e.rule === 'process-config' && e.message.includes('failedStoreId')));
        });
    });

    describe('complete valid flow', () => {
        it('returns zero errors for correct flow', () => {
            const errors = deterministicValidation({
                name: 'E2E Connector - CRUD',
                flow: {
                    'on-start': { type: 'appmixer.utils.controls.OnStart', source: {} },
                    'create': {
                        type: 'appmixer.some.Create',
                        source: { in: { 'on-start': ['out'] } },
                        config: { transform: { in: {
                            'on-start': { out: {
                                modifiers: { name: { 'v1': { variable: '$.on-start.out.value' } } },
                                lambda: { name: '{{{v1}}}' }
                            }}
                        }}}
                    },
                    'assert-create': {
                        type: 'appmixer.utils.test.Assert',
                        source: { in: { 'create': ['out'] } },
                        config: { transform: { in: {
                            'create': { out: {
                                modifiers: { expression: { 'v-id': { variable: '$.create.out.id' } } },
                                lambda: { expression: { AND: [{ field: '{{{v-id}}}', op: 'isNotEmpty' }] } }
                            }}
                        }}}
                    },
                    'after-all': { type: 'appmixer.utils.test.AfterAll', source: { in: { 'assert-create': ['out'] } } },
                    'process': {
                        type: 'appmixer.utils.test.ProcessE2EResults',
                        source: { in: { 'after-all': ['out'] } },
                        config: {
                            properties: { successStoreId: 's', failedStoreId: 'f' },
                            transform: { in: {
                                'after-all': { out: {
                                    modifiers: { result: { 'vr': { variable: '$.after-all.out' } } },
                                    lambda: { result: '{{{vr}}}' }
                                }}
                            }}
                        }
                    }
                }
            });
            assert.equal(errors.length, 0, `Expected 0 errors, got: ${JSON.stringify(errors, null, 2)}`);
        });
    });
});
