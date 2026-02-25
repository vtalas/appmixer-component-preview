# Appmixer E2E Test Flow Agents

Two self-improving agents for generating, validating, and deploying Appmixer E2E test flows.

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │         selfImprovingTestFlowAgent          │
                    │                                             │
                    │  Deterministic ──▶ LLM Review ──▶ Fix      │
                    │       ▲                              │      │
                    │       └──────────────────────────────┘      │
                    │              repeat × N iterations          │
                    │                      │                      │
                    │               after N failures              │
                    │                      ▼                      │
                    │              Meta-Improver                  │
                    │           (edits prompt files)              │
                    └──────────────────┬──────────────────────────┘
                                       │ --upload or standalone
                                       ▼
                    ┌─────────────────────────────────────────────┐
                    │            serverFlowAgent                  │
                    │                                             │
                    │  Upload ──▶ Validate ──▶ Start ──▶ Fix     │
                    │    ▲                                  │     │
                    │    └──────────────────────────────────┘     │
                    │              repeat × N iterations          │
                    │                      │                      │
                    │               after N failures              │
                    │                      ▼                      │
                    │              Meta-Improver                  │
                    │         (edits generator prompt)            │
                    └─────────────────────────────────────────────┘
```

### selfImprovingTestFlowAgent

Local validation loop. Catches structural issues, input coverage gaps, and semantic problems **before** hitting the server.

1. **Deterministic validation** — variable mapping, source connections, AfterAll wiring, ProcessE2EResults config
2. **Input coverage validation** — fields vs component.json schemas, required fields, enums, data quality (needs `--connectors-dir`)
3. **LLM Review** — semantic check by a separate model (haiku by default)
4. **Generator fix** — receives all errors, outputs corrected flow JSON
5. **Meta-improver** — after exhausting iterations, analyzes error patterns and edits prompt files to prevent recurring mistakes

### serverFlowAgent

Server round-trip loop. Takes a (locally validated) flow and makes sure it actually works on the Appmixer server.

1. **Upload** — `POST /flows` (create) or `PUT /flows/:id` (update)
2. **Validate** — `GET /flows/:id/validate`
3. **Start** — `POST /flows/:id/coordinator` with `{ command: 'start' }`
4. **Parse errors** — server validation errors, start failures
5. **Generator fix** — same LLM fixer, but fed with server-side errors
6. **Meta-improver** — same pattern, improves generator prompt based on server error patterns

## Requirements

- Node.js 18+
- `@anthropic-ai/claude-agent-sdk` — uses your authenticated `claude` CLI (Claude Max subscription)
- `.env` with `APPMIXER_BASE_URL`, `APPMIXER_USERNAME`, `APPMIXER_PASSWORD` (for server agent)

```bash
claude --version  # verify CLI auth
```

## Usage

### Local validation + fix

```bash
# Basic (5 iterations, 3 meta rounds)
node agents/run.js path/to/flow.json

# With component schema validation (recommended)
node agents/run.js path/to/flow.json \
  --connectors-dir /path/to/appmixer-connectors/src

# Custom models
node agents/run.js path/to/flow.json \
  --generator-model opus --reviewer-model sonnet --meta-model opus

# Quick test
node agents/run.js path/to/flow.json --max-iterations 3 --max-meta-rounds 1

# Full pipeline: local validate → fix → upload → server validate → start
node agents/run.js path/to/flow.json --upload
```

### Server validation + fix (standalone)

```bash
# Upload, validate, and try to start
node agents/runServer.js path/to/flow.json

# Validate only (don't try to start)
node agents/runServer.js path/to/flow.json --no-start

# Keep the flow on the server after done
node agents/runServer.js path/to/flow.json --no-cleanup

# Custom limits
node agents/runServer.js path/to/flow.json --max-iterations 10 --max-meta-rounds 3

# Write output to a different file
node agents/runServer.js path/to/flow.json --output /tmp/fixed.json
```

### CLI Options

#### `run.js` (local agent)

| Option | Default | Description |
|--------|---------|-------------|
| `--connectors-dir PATH` | — | Path to `appmixer-connectors/src` for schema validation |
| `--max-iterations N` | 5 | Fix iterations per meta round |
| `--max-meta-rounds N` | 3 | Meta-improvement rounds |
| `--generator-model M` | sonnet | Model for fixing flows |
| `--reviewer-model M` | haiku | Model for reviewing |
| `--meta-model M` | sonnet | Model for prompt improvement |
| `--output PATH` | input file | Where to write the result |
| `--upload` | off | Upload to server on success |

#### `runServer.js` (server agent)

| Option | Default | Description |
|--------|---------|-------------|
| `--max-iterations N` | 5 | Fix iterations per meta round |
| `--max-meta-rounds N` | 2 | Meta-improvement rounds |
| `--generator-model M` | sonnet | Model for fixing flows |
| `--meta-model M` | sonnet | Model for prompt improvement |
| `--output PATH` | input file | Where to write the result |
| `--no-start` | — | Only validate, don't try to start |
| `--no-cleanup` | — | Don't delete flow from server when done |

## Programmatic Usage

```javascript
// Local validation loop
import { run } from './selfImprovingTestFlowAgent.js';
const result = await run({ flowJson, maxIterations: 5, upload: false });

// Server validation loop
import { run } from './serverFlowAgent.js';
const result = await run({ flowJson, maxIterations: 5, tryStart: true, cleanup: true });

// result: { flowJson, success, iterations, metaRounds, history, flowId? }
```

## Project Structure

```
agents/
├── README.md                          ← you are here
├── run.js                             ← CLI: local validation agent
├── runServer.js                       ← CLI: server validation agent
├── selfImprovingTestFlowAgent.js      ← local orchestrator
├── serverFlowAgent.js                 ← server orchestrator
├── utils.js                           ← shared utils (extractJSON, validator re-exports)
├── test.js                            ← tests (node --test agents/test.js)
├── validators/
│   ├── structural.js                  ← flow structure, wiring, variable mapping
│   └── coverage.js                    ← input coverage vs component.json schemas
├── prompts/
│   ├── generator-system.md            ← system prompt for fixer (editable by meta-improver)
│   ├── reviewer-system.md             ← system prompt for reviewer
│   └── meta-improver-system.md        ← system prompt for meta-improver
└── logs/
    ├── run-<timestamp>.json           ← local agent logs
    └── server-run-<timestamp>.json    ← server agent logs
```

## Prompt Files

Prompts are **files, not hardcoded strings**. The meta-improver edits them between rounds.

- `generator-system.md` — Rules for generating/fixing flows
- `reviewer-system.md` — Checklist for reviewing flows
- `meta-improver-system.md` — Instructions for the meta-improver itself

**Tip:** Version control these. If prompts degrade: `git checkout agents/prompts/`

## What Gets Validated

### Local — Deterministic (instant, no LLM)
- Flow name format (`E2E ...`)
- Required components (OnStart, AfterAll, ProcessE2EResults)
- Assert → AfterAll wiring
- Variable mapping: modifier ↔ `{{{varId}}}` in lambda
- Source connections: transform refs exist in `source.in`
- Variable paths: `$.component-id.out.field` → component exists
- ProcessE2EResults config (store IDs, result mapping)

### Local — Input Coverage (instant, needs `--connectors-dir`)
- Required fields provided
- No unknown fields
- Enum values match schema
- Type compliance
- Data quality warnings (generic/meaningless values)

### Local — LLM Review (semantic)
- CRUD sequence logic
- Assert expressions test meaningful values
- Data flow completeness

### Server — Validation endpoint
- Schema validation of properties and inputs
- Invalid variable references
- Missing component manifests

### Server — Start attempt
- Runtime errors on flow start
- Missing auth/accounts
- Component initialization failures

## Tests

```bash
node --test agents/test.js
```

Tests cover: `extractJSON`, `deterministicValidation` (all rules), `getInputSchema`, `inputCoverageValidation` (with real connectors if available).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Cannot find `@anthropic-ai/claude-agent-sdk` | `npm install @anthropic-ai/claude-agent-sdk` |
| Timeout / SIGTERM | Run directly in terminal, not through short-timeout wrappers |
| Meta-improver made prompts worse | `git checkout agents/prompts/` |
| LLM returns invalid JSON | Retries next iteration; try `--generator-model opus` |
| Server auth fails | Check `.env` — `APPMIXER_BASE_URL`, `APPMIXER_USERNAME`, `APPMIXER_PASSWORD` |
