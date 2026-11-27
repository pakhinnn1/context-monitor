# Antigravity Context Monitor

Local MCP App plugin for Antigravity Desktop (`v0.2.0`) that displays per-conversation context window usage in both the compact side panel (`aux_pane`) and the full-page sidebar fleet workspace (`global`).

## Features

- **Dual-surface responsive UI:** Adapts via CSS Container Queries between the compact `aux_pane` inspector (`< 760px`) and a two-column master-detail `global` sidebar workspace (`>= 760px`).
- **Paginated fleet explorer (`list_conversations`):** Displays interactive fleet KPIs (`Interactive / Total`, `>= 70% used`, `Checkpointed`, `Running`), debounced text search, `Interactive | Show all | Subagents | Background` filtering, usage/checkpoint/running filter chips, sorting, and `Load more` pagination.
- **Offline workspace picker & persistence:** Discovers registered projects from `~/.gemini/config/projects/*.json` and persists user workspace and filter preferences server-side in `${PLUGIN_DATA}/preferences.json` via `set_context_preferences`.
- **Mount-hydrated detail telemetry:** Hydrates `get_context_snapshot` on mount to render an inline SVG context trajectory chart (with compaction markers and interactive turn scrubbing), ranked `Top tools`, disk `Artifacts`, cumulative session input/cache counters, `> 24 KB` rule cap warnings, and `ConversationService` status.
- **Capability-gated host actions:** Supports `Attach context` (`app.updateModelContext`) and click-to-open artifact/rule files (`com.google.antigravity/toggle-aux-pane`) in conversation-bound views.

## What it reads & writes

- **Reads (local disk):**
  - Conversation transcripts at `~/.gemini/antigravity/brain/<conversation-id>/.system_generated/logs/transcript.jsonl` (and `transcript_full.jsonl` when `<= 4 MiB`)
  - Conversation artifacts at `~/.gemini/antigravity/brain/<conversation-id>/*.md` and optional `*.md.metadata.json`
  - Conversation titles from `~/.gemini/antigravity/annotations/<id>.pbtxt` and optional `ConversationService` enrichment when available
  - Plugin enablement precedence from `~/.gemini/config/config.json` (`plugins.<name>.enabled`) over `plugin.json`
  - Project-to-workspace mappings under `~/.gemini/config/projects/*.json` and MCP `roots/list`
  - Local MCP tool schemas at `~/.gemini/antigravity/mcp/`
  - Global and workspace rules and skills under `~/.gemini/GEMINI.md`, `~/.gemini/config/`, and active workspace `GEMINI.md`, `AGENTS.md`, `.agents`, `.agent`, `_agents`, and `_agent` directories
- **Writes (plugin-private only):**
  - `${PLUGIN_DATA}/preferences.json` (workspace override and `includeSubagents` preference; falls back to in-memory-only mode if `--data-dir` is unset or unexpanded)

## Exact metrics vs local estimates

- **Exact values from transcripts:** active prompt context (`input_tokens + cache_read_tokens`), cached vs uncached input split, output tokens, compaction checkpoints, turn count, cumulative session input/cache-read/cache-invalidation counters, bounded context trajectories, model ID, and timestamps.
- **Local estimates (clearly labeled in the UI):** CLI-aligned category breakdown (`System and baseline`, `Tool calls`, `User messages`, `Agent responses`, conditional `Checkpoint buffer`, and conditional `System messages`), ranked top tool-call contributors, artifact byte estimates, and disk-based token estimates for configured MCP schemas, rules, and skill headers.

## Build and test

```bash
npm ci
npm run build
npm test
npm run validate
```

## Install into Antigravity

### From a GitHub Release archive

Download `context-monitor-v0.2.0.zip` (and optional `.sha256`), remove any previous installation directory so stale files do not linger, and extract into Antigravity's plugins folder:

```bash
rm -rf ~/.gemini/config/plugins/context-monitor
unzip -q context-monitor-v0.2.0.zip -d ~/.gemini/config/plugins/
```

Then reload `context-monitor_context-monitor` from Antigravity Desktop settings.

### Maintainer local sync & release packaging

Preview or apply an atomic allowlist-only sync (`plugin.json`, `mcp_config.json`, `README.md`, `assets/`, `dist/`) into `~/.gemini/config/plugins/context-monitor`, or package a validated release zip into `release/`:

```bash
npm run sync -- --dry-run
npm run sync
npm run package
```

After running `npm run sync`, reload `context-monitor_context-monitor` manually from Antigravity Desktop settings.
