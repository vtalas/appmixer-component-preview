# Self-Improving Test Flow Agent

Generates, validates, and iteratively fixes Appmixer E2E test flows using a multi-model agent loop with automatic prompt improvement.

## How It Works

```
┌───────────────┐     ┌───────────┐     ┌───────────┐
│  Deterministic│────▶│ LLM       │────▶│ Generator │──┐
│  Validation   │     │ Reviewer  │     │ (fixer)   │  │
└───────────────┘     └───────────┘     └───────────┘  │
       ▲                                               │
       └───────────────────────────────────────────────┘
                    repeat max N times
                          │
                   after N failures
                          ▼
                 ┌───────────────────┐
                 │  Meta-Improver    │
                 │  edits prompts/   │
                 │  generator-system │
                 │  reviewer-system  │
                 └───────────────────┘
```

1. **Deterministic validation** — checks variable mapping, source connections, AfterAll wiring, ProcessE2EResults config (no LLM needed)
2. **Input coverage validation** — compares flow fields against component.json schemas, checks required fields, enum values, data quality (requires `--connectors-dir`)
3. **LLM Review** — a different model (haiku by default) checks semantics, logic, field names
4. **Generator fix** — receives all errors, outputs corrected flow JSON
5. **Repeat** up to `--max-iterations` times (default: 5)
6. **Meta-improver** — after exhausting iterations, analyzes error patterns and **edits the prompt files** in `prompts/` to prevent recurring mistakes. Then reruns the loop with improved prompts.

## Requirements

- Node.js 18+
- `@anthropic-ai/claude-agent-sdk` (installed in this project)
- **Claude Max subscription** (no API key needed — SDK uses your authenticated `claude` CLI)

Make sure you're logged into Claude Code CLI:
```bash
claude --version  # should work without errors
```

## Usage

```bash
cd /Users/vladimir/Projects/appmixer-component-preview

# Basic — fix a flow with defaults (5 iterations, 3 meta rounds, sonnet model)
node agents/run.js path/to/test-flow.json

# With component schema validation (recommended)
node agents/run.js path/to/test-flow.json \
  --connectors-dir /Users/vladimir/Projects/appmixer-connectors/src

# Custom models and limits
node agents/run.js path/to/test-flow.json \
  --connectors-dir /Users/vladimir/Projects/appmixer-connectors/src \
  --max-iterations 5 \
  --max-meta-rounds 3 \
  --generator-model sonnet \
  --reviewer-model opus \
  --meta-model opus

# Write output to a different file (default: overwrites input)
node agents/run.js path/to/test-flow.json --output /tmp/fixed-flow.json

# Pass connector context (component schemas, instructions)
```

### CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--connectors-dir PATH` | — | Path to `appmixer-connectors/src` for schema validation |
| `--max-iterations N` | 5 | Generate→review cycles per meta round |
| `--max-meta-rounds N` | 3 | How many times meta-improver rewrites prompts |
| `--generator-model M` | sonnet | Model for fixing flows |
| `--reviewer-model M` | haiku | Model for reviewing (fast; use opus for thorough review) |
| `--meta-model M` | sonnet | Model for prompt improvement |
| `--output PATH` | input file | Where to write the result |
| `--upload` | off | Upload to Appmixer server on success, validate + start |

### Recommended Configurations

```bash
# Fast iteration (cheap, good for most flows)
node agents/run.js flow.json --reviewer-model sonnet --generator-model sonnet

# High quality (more expensive, catches more issues)
node agents/run.js flow.json --reviewer-model opus --meta-model opus

# Quick test (1 round, 3 iterations)
node agents/run.js flow.json --max-iterations 3 --max-meta-rounds 1

# Full pipeline: validate → fix → upload → server validate → start
node agents/run.js flow.json --upload
```

## Project Structure

```
agents/
├── README.md                          ← you are here
├── run.js                             ← CLI runner
├── selfImprovingTestFlowAgent.js      ← orchestrator (validate → review → fix → meta-improve)
├── utils.js                           ← re-exports from validators + extractJSON
├── test.js                            ← tests (node --test agents/test.js)
├── validators/
│   ├── structural.js                  ← flow name, required components, AfterAll wiring, variable mapping, source refs
│   └── coverage.js                    ← input coverage, field names vs schema, enum/type checks, data quality
├── prompts/
│   ├── generator-system.md            ← system prompt for flow fixer (editable by meta-improver)
│   ├── reviewer-system.md             ← system prompt for reviewer (editable by meta-improver)
│   └── meta-improver-system.md        ← system prompt for meta-improver
└── logs/
    └── run-<timestamp>.json           ← full history of each run
```

## Prompt Files

The key feature: **prompts are files, not hardcoded strings**. The meta-improver literally edits them.

- `prompts/generator-system.md` — Rules for how to generate/fix flows. After meta-improvement, you'll see a `## Changelog` section at the bottom.
- `prompts/reviewer-system.md` — Checklist for reviewing flows. Gets stricter over time as the meta-improver adds emphasis to frequently-violated rules.
- `prompts/meta-improver-system.md` — Instructions for the meta-improver itself. You can edit this to change improvement strategy.

**Tip:** Version control these files. If prompts degrade after meta-improvement, `git checkout` them.

## Programmatic Usage

```javascript
import { run } from './selfImprovingTestFlowAgent.js';

const result = await run({
    flowJson: JSON.parse(fs.readFileSync('flow.json', 'utf-8')),
    maxIterations: 5,
    maxMetaRounds: 3,
    generatorModel: 'sonnet',
    reviewerModel: 'opus',
    metaModel: 'opus',
    connectorContext: 'component schemas here...'
});

if (result.success) {
    console.log(`Fixed in ${result.iterations} iterations`);
    fs.writeFileSync('flow.json', JSON.stringify(result.flowJson, null, 4));
} else {
    console.log(`Failed after ${result.iterations} iterations`);
    // result.flowJson still has the best attempt
}
```

## What Gets Validated

### Deterministic (no LLM, instant)
- Flow name format (`E2E ...`)
- Required components (OnStart, AfterAll, ProcessE2EResults)
- All Assert components connected to AfterAll's `source.in`
- Variable mapping: every modifier has matching `{{{varId}}}` in lambda
- Source connections: transform references exist in `source.in`
- Variable paths: `$.component-id.out.field` → component-id must exist in flow
- ProcessE2EResults: successStoreId, failedStoreId, result mapping

### Input Coverage (requires `--connectors-dir`, instant)
- Required fields from component.json are provided
- No unknown fields (not in schema)
- Enum values match allowed values
- Type compliance (integer, boolean)
- Warns about untested optional fields
- Warns about generic/meaningless data ("test", "", "foo"...)

### LLM Review (semantic, haiku by default)
- CRUD operation sequence makes logical sense
- Assert expressions test meaningful values
- Data flow is complete (no missing intermediate steps)

### Server-side (with `--upload`)
After local validation passes, the flow is uploaded to Appmixer and validated server-side:
- Schema validation of properties and inputs
- Invalid variable references (components that no longer exist)
- Missing component manifests

Errors are classified as:
- **Fixable** → sent back to generator for another fix attempt
- **Human required** (auth, missing components) → agent stops, prints instructions

## Logs

Every run saves a full log to `logs/run-<timestamp>.json` containing:
- All iterations with error counts
- Deterministic + LLM errors per iteration
- Final flow JSON (success or best attempt)

## Troubleshooting

**"Cannot find package '@anthropic-ai/claude-agent-sdk'"**
```bash
cd /Users/vladimir/Projects/appmixer-component-preview
npm install @anthropic-ai/claude-agent-sdk
```

**Timeout / SIGTERM**
Each LLM call takes ~30-60s. A full run with 5 iterations × 2 LLM calls = ~5-10 minutes. Run it directly in terminal, not through a wrapper with short timeouts.

**Meta-improver made prompts worse**
```bash
git checkout agents/prompts/
```

**LLM returns invalid JSON**
The agent retries in the next iteration. If it keeps failing, try `--generator-model opus`.
