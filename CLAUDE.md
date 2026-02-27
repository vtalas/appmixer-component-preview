# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Appmixer Component Preview — a development tool for browsing, editing, and testing Appmixer connector components. It connects to a local `appmixer-connectors` directory, renders component.json files visually, and integrates with the Appmixer API and GitHub for E2E test flow management.

## Commands

```bash
npm run dev          # Dev server on port 5151
npm run build        # Production build (adapter-node → ./build/)
npm start            # Run production build (node build)
npm run check        # Svelte type checking (svelte-check with jsconfig.json)
npm run check:watch  # Same, in watch mode
```

### Agent tests

```bash
node --test agents/test.js   # Unit tests for agent validators and utilities
```

### Running AI agents

```bash
# Local flow validation agent (deterministic + LLM review loop)
node agents/run.js path/to/flow.json --connectors-dir /path/to/appmixer-connectors/src

# Server flow validation agent (upload → validate → start loop)
node agents/runServer.js path/to/flow.json
```

## Architecture

### Tech Stack

- **SvelteKit 2** with **Svelte 5** (runes: `$state`, `$derived`, `$props`)
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin
- **shadcn-svelte** (bits-ui based) UI components in `src/lib/components/ui/`
- **adapter-node** for production (outputs to `./build/`, deployed on Vercel)
- JavaScript only (no TypeScript), using JSDoc types with `checkJs: true`

### SvelteKit App (`src/`)

The page is rendered client-side (`ssr = false` in `+layout.js`), but server-side API routes are active. The `hooks.js` reroutes `/connector/*` paths to `/` for SPA routing.

- **`src/routes/+page.svelte`** — Main SPA page with connector browser sidebar, component preview, AI chat panel, settings, and E2E flow dashboard
- **`src/routes/api/`** — Server-side API endpoints:
  - `connectors` — Scan local connectors directory
  - `component` — Read/write individual component.json files
  - `e2e-flows/*` — Full E2E flow CRUD, sync with GitHub, upload to Appmixer, diff, results
  - `auth` — Connector auth detection and account management
  - `settings` — Runtime Appmixer/GitHub instance config
  - `chat`, `planning`, `shell`, `terminal` — AI and dev tool integrations

### Appmixer API Client (`appmixerApi/`)

Framework-agnostic HTTP client for the Appmixer REST API. Used both by the SvelteKit server routes and by standalone agents.

- `client.js` — Axios-based client with token caching (55min TTL)
- `flows.js` — Flow CRUD, start/stop, validate, clone, trigger
- `accounts.js` — Account management
- `store.js` — Data store operations
- `helpers.js` — Utility functions (no API calls)

### Server-Side State (`src/lib/server/`)

- `state.js` — Module-level in-memory state for connectors directory path and multi-instance Appmixer/GitHub configurations
- `appmixer.js` — SvelteKit wrapper over `appmixerApi/`, resolves config from `$env/dynamic/private` + runtime overrides
- `github.js` — GitHub API client for syncing test flows with `appmixer-connectors` repo

### AI Agents (`agents/`)

Self-improving agents for generating/validating E2E test flows using Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). Two main loops:

- **`selfImprovingTestFlowAgent.js`** — Local validation: deterministic checks → LLM review → fix → meta-improvement of prompts
- **`serverFlowAgent.js`** — Server validation: upload → validate → start → fix → meta-improvement

Prompts in `agents/prompts/` are editable files (not hardcoded). The meta-improver modifies them between rounds. Revert with `git checkout agents/prompts/` if degraded.

### Client-Side Store (`src/lib/stores/fileSync.svelte.js`)

Svelte 5 runes-based store managing the connection to the local connectors directory. All filesystem operations go through the backend API (`/api/connectors`, `/api/component`). Persists the last opened directory path in localStorage.

## Environment Variables

See `.env.example`:
- `APPMIXER_BASE_URL`, `APPMIXER_USERNAME`, `APPMIXER_PASSWORD` — Appmixer API credentials
- `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, `GITHUB_REPO_BRANCH` — GitHub repo for test flow sync

Runtime overrides are possible via the Settings panel (stored in-memory on the server).

## Conventions

- Svelte 5 runes only (`$state`, `$derived`, `$props`, `$effect`) — no legacy `$:` or stores
- UI components follow shadcn-svelte patterns: `src/lib/components/ui/{component}/index.js` re-exports
- Path alias `$lib` maps to `src/lib/`
- Icons from `lucide-svelte`
- CSS utility classes via Tailwind with `tailwind-merge` and `tailwind-variants`
