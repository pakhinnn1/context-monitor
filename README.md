# Antigravity Context Monitor

Local MCP App plugin for Antigravity Desktop that displays per-conversation context window usage in the side panel (`aux_pane`) and left sidebar (`global`).

## What it reads

- Local conversation transcripts at `~/.gemini/antigravity/brain/<conversation-id>/.system_generated/logs/transcript.jsonl` (and `transcript_full.jsonl` when `<= 4 MiB`)
- Disk-discoverable conversation artifacts at `~/.gemini/antigravity/brain/<conversation-id>/*.md` and optional `*.md.metadata.json`
- Local conversation titles from `~/.gemini/antigravity/annotations/<id>.pbtxt` and optional `ConversationService` enrichment when available
- Plugin enablement precedence from `~/.gemini/config/config.json` (`plugins.<name>.enabled`) over `plugin.json`
- Project-to-workspace mappings under `~/.gemini/config/projects/<projectId>.json` and MCP `roots/list`
- Local MCP tool schemas at `~/.gemini/antigravity/mcp/`
- Global and workspace rules and skills under `~/.gemini/GEMINI.md`, `~/.gemini/config/`, and active workspace `GEMINI.md`, `AGENTS.md`, `.agents`, `.agent`, `_agents`, and `_agent` directories

## Exact metrics vs local estimates

- Exact values from transcripts: active prompt context (`input_tokens + cache_read_tokens`), cached vs uncached input split, output tokens, compaction checkpoints, turn count, cumulative session input/cache-read/cache-invalidation counters, bounded context trajectories, model ID, and timestamps.
- Local estimates (clearly labeled in the UI): CLI-aligned category breakdown (`System and baseline`, `Tool calls`, `User messages`, `Agent responses`, conditional `Checkpoint buffer`, and conditional `System messages`), ranked top tool-call contributors, artifact byte estimates, and disk-based token estimates for configured MCP schemas, rules, and skill headers.

## Build and test

```bash
npm install
npm run build
npm test
```

## Install into Antigravity

Copy only the runtime plugin bundle (`dist/`, `plugin.json`, `mcp_config.json`, `assets/`, and `README.md` — excluding `docs/`, `src/`, `scripts/`, and `node_modules/`) into `~/.gemini/config/plugins/context-monitor/` and reload MCP servers from Antigravity settings.
