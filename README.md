# Antigravity Context Monitor

Local MCP App plugin for Antigravity Desktop that displays per-conversation context window usage in the side panel (`aux_pane`) and left sidebar (`global`).

## What it reads

- Local conversation transcripts at `~/.gemini/antigravity/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`
- Local conversation titles from `~/.gemini/antigravity/annotations/<id>.pbtxt` and `ConversationService` when available
- Local MCP tool schemas at `~/.gemini/antigravity/mcp/`
- Local global rules and installed skills under `~/.gemini/config/` and `~/.gemini/GEMINI.md`

## Exact metrics vs local estimates

- Exact values from transcripts: active prompt context (`input_tokens + cache_read_tokens`), cached vs uncached input split, output tokens, compaction checkpoints, turn count, model ID, and timestamps.
- Local estimates (clearly labeled in the UI): Turn-1 baseline overhead, post-checkpoint summary size, proportional share of tool outputs vs messages vs system messages, and disk-based token estimates for configured MCP schemas, rules, and skill headers.

## Build and test

```bash
npm install
npm run build
npm test
```

## Install into Antigravity

Copy the plugin bundle (excluding `node_modules`) into `~/.gemini/config/plugins/context-monitor/` and reload MCP servers from Antigravity settings.
