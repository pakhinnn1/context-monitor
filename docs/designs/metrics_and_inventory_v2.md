# Context Monitor v0.2: Metrics and Inventory v2 (Spec 1)

*   **Author:** pakhinnn1
*   **Status:** Proposed
*   **Date:** 2026-11-27

--------------------------------------------------------------------------------

## Overview

This specification (Spec 1) defines the v0.2 analyzer engine and MCP `structuredContent` contract for the local Antigravity Context Monitor plugin (this repository). It upgrades `src/analyzer.mjs` and `src/server.mjs` to align Context Monitor's breakdown and inventory with Antigravity CLI `/context` using local disk files.

Spec 1 delivers the following capabilities:

*   Subagent and background worker filtering with an opt-in show-all toggle.
*   CLI-aligned prompt breakdown `current.segments` (`User messages`, `Agent responses`, `Tool calls`, `System and baseline`, conditional `Checkpoint buffer`, and conditional `System messages`), with `exact.freeTokens` and `exact.freePercent` (displayed as "Free space" in the UI).
*   Disk-discoverable conversation artifact files (`~/.gemini/antigravity/brain/<id>/*.md`).
*   Bounded per-turn context trajectories with compaction markers, ranked top tool-call contributors, and cumulative session input/cache counters.
*   Plugin `enabled` precedence from `~/.gemini/config/config.json` and active workspace rules and skills discovery.

This specification defines the v2 server contract before Spec 2 (`docs/designs/global_workspace_ux.md`, not yet created) implements the global sidebar workspace UI. Spec 1 preserves all v0.1.0 top-level `structuredContent` keys and rounding invariants while replacing `current.segments` IDs in place (signaled by `schemaVersion: 2`), and therefore includes three scoped UI/CSS compatibility edits in `src/ui/main.js` and `src/ui/styles.css` so the existing side-panel UI renders without visual regression.

### Resolved Architectural Decisions

*   **Thread filtering:** Interactive classification uses `~/.gemini/antigravity/annotations/<id>.pbtxt` or `ConversationService`, hiding `subagent` and `background` threads by default with an opt-in toggle.
*   **Prompt breakdown:** `current.segments` replaces v0.1.0 segment IDs in place with CLI-aligned identifiers (`baseline`, `tool_calls`, `user_messages`, `agent_responses`, `checkpoint_buffer`, and optional `system_messages`).
*   **Trajectory bounding:** Long sessions keep Turn 1, `checkpoint_peak` / `checkpoint_baseline` milestone pairs for earlier checkpoints, and up to 120 turns in the active epoch (whether checkpointed or uncheckpointed).
*   **Model-visible payload isolation:** `open_context_monitor` (default `_meta.ui.visibility` `["model", "app"]`, the MCP Apps host rule controlling whether the model and/or UI iframe may invoke a tool) retains v0.1.0 `conversations` (capped at 35) and `inventory` fields for zero-roundtrip v0.1.0 UI first paint while passing `includeDetails: false` to omit `current.trajectory`, `current.topTools`, and `current.artifacts` from host model context. App-only `get_context_snapshot` (`visibility: ["app"]`) passes `includeDetails: true` to return full detail payloads. In Spec 2, when the v2 UI receives an initial `ontoolresult` snapshot with `hasUsageData: true` and `trajectory === undefined`, it triggers `get_context_snapshot` on mount rather than waiting for the 15-second poll.
*   **Release version policy:** `package.json`, `plugin.json`, `src/server.mjs`, and `src/ui/main.js` keep release version `0.1.0` during Spec 1 (`package.json` updates only its `"test"` script; `schemaVersion: 2` signals the v2 wire contract) and bump to `0.2.0` when Spec 2 ships the full UI.
*   **Workspace boundary & Spec 2 deferrals:** Workspace discovery resolves from explicit `workspacePath`, conversation `projectId` via `~/.gemini/config/projects/<projectId>.json`, and MCP `roots/list`. Fleet aggregate counters (`fleet`) and paginated search/filtering (`list_conversations`) are deferred to Spec 2 so Spec 1 maintains one annotation-gated top-`limit` interactive path.

## The Problem

Context Monitor v0.1.0 reads local transcripts under `~/.gemini/antigravity/brain/` and renders exact token counters and local category estimates for the latest turn, but four analyzer and inventory gaps separate it from CLI `/context`:

1.  **Subagents and background workers crowd the thread selector.** Across a local corpus of 500+ tracked transcripts, roughly 80% lack `~/.gemini/antigravity/annotations/<id>.pbtxt` files (which Antigravity writes for interactive user threads, sometimes asynchronously after transcript creation). The unannotated set includes `invoke_subagent` child transcripts, unlinked single-prompt workflow/background sessions, and zero-user-input transcripts. Because v0.1.0 lists the most recently modified `transcript.jsonl` files without filtering by kind, isolated subagent and worker prompts push interactive conversations out of the 35-item selector.
2.  **`ConversationService` enrichment returns an empty `Map` when host env vars are absent or the RPC fails.** `fetchConversationServiceTitles` in `src/analyzer.mjs` reads `ANTIGRAVITY_LS_ADDRESS` (`LS` = Antigravity language server) and `ANTIGRAVITY_CSRF_TOKEN`. While `ListConversations` succeeds from agent shell commands with header `x-antigravity-csrf-token` and returns `projectId`, `rootConversationId`, `parentConversationId`, and `runState`, Antigravity does not guarantee those variables in standalone stdio MCP server subprocesses. The analyzer lacks a disk-first thread classifier and optional non-blocking service status handling.
3.  **Latest-turn snapshots lack CLI-aligned breakdown, artifact visibility, trajectory, and tool attribution.** v0.1.0 merges user prompts and agent replies into one `Messages` bucket and omits disk-discoverable conversation artifacts (`~/.gemini/antigravity/brain/<id>/*.md`). Users also cannot inspect turn-by-turn prompt growth around compaction `CHECKPOINT` events, see which tools contributed the largest outputs, or track cumulative session input and cache-invalidation counters. Unbounded per-turn arrays grow linearly across multi-hundred-turn sessions and compound with `conversations` and `inventory` payloads toward the 1 MiB Antigravity `CallToolResult` cap.
4.  **Local inventory misreports plugin state and misses workspace customizations.** `scanLocalInventory` checks only `plugin.json`'s `disabled` flag and ignores `~/.gemini/config/config.json` (`plugins.<dirName>.enabled`), which Antigravity treats as higher precedence. While `scanLocalInventory` already scans global skills under `~/.gemini/config/skills/`, it omits active workspace rules (`AGENTS.md`, `GEMINI.md`, and `.agents`, `.agent`, `_agents`, `_agent` `rules/*.md`) and workspace skills (`skills/*/SKILL.md` under those same four workspace customization directories).

## Goals

*   **G1 — Deterministic disk-first thread list filtering:** Filter subagents and background workers out of the default interactive thread list without requiring `ConversationService`, while supporting an opt-in filter to show all threads.
*   **G2 — CLI `/context`-aligned breakdown and disk-discoverable artifacts:** Align `current.segments` with Antigravity CLI `/context` (`User messages`, `Agent responses`, `Tool calls`, `System and baseline`, conditional `Checkpoint buffer`, and conditional `System messages`), expose `exact.freeTokens` and `exact.freePercent` (labeled "Free space" in the UI), and surface disk-discoverable conversation artifact files (`~/.gemini/antigravity/brain/<id>/*.md`) alongside system and workspace rule files.
*   **G3 — Bounded per-turn trajectory and top tool-call attribution:** Expose per-turn prompt growth with `CHECKPOINT` markers, ranked top tool-call contributors, and cumulative session input/cache-read/cache-invalidation counters via app-only `get_context_snapshot` (`includeDetails: true`), while omitting `trajectory`, `topTools`, and `artifacts` from model-visible `open_context_monitor` (`includeDetails: false`) to target `< 256 KiB` typical and stay well under `1 MiB`.
*   **G4 — Accurate local and workspace inventory:** Respect `~/.gemini/config/config.json` plugin `enabled` precedence over `plugin.json` and discover active workspace rules and skills (`AGENTS.md`, `GEMINI.md`, and `.agents`, `.agent`, `_agents`, `_agent` `rules/*.md` and `skills/*/SKILL.md`, per `agy-customizations/SKILL.md`) under a `workspace` scope.
*   **G5 — Backwards-compatible top-level contract with v2 segments and scoped UI sync:** Preserve all v0.1.0 top-level `structuredContent` keys and rounding invariants (`sum(segments.tokens) === exact.activeTokens` and `sum(segments.percent) + exact.freePercent === 100.0`) while updating `current.segments` in place (`schemaVersion: 2`) and applying the three scoped `src/ui/main.js` and `src/ui/styles.css` compatibility updates.
*   **G6 — Optional, non-blocking `ConversationService` enrichment:** Enrich titles, `runState`, `projectId`, and top-level thread metadata whenever `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN` are available, without throwing or setting `isError: true` and with bounded latency when unavailable.

## Non-Goals

*   **NG1 — Parent-child subagent token rollup:** Subagents run in isolated context windows and do not consume the parent thread's context window; Spec 1 filters subagents from the default thread list rather than aggregating child token spend onto parent threads.
*   **NG2 — Burn rate and estimated turns remaining:** Spec 1 does not forecast future turns remaining or compute token burn-rate projections.
*   **NG3 — Mid-thread model switch history:** Spec 1 continues resolving the active thread model from the latest planner turn and does not emit a mid-thread model switch timeline.
*   **NG4 — Global workspace UI redesign, fleet search/pagination, and host UX actions:** Container-query two-column layout, SVG chart rendering, search rail UI, keyboard shortcuts, `fleet` aggregate counters, paginated `list_conversations` search/filtering, and host UI bridge actions (`updateModelContext`, `toggle-aux-pane`) belong to Spec 2 (`docs/designs/global_workspace_ux.md`, not yet created).
*   **NG5 — Probing undocumented host services or bypassing environment boundaries:** The MCP server will not scan OS process tables, scrape host internals, or read undocumented sockets to obtain `ANTIGRAVITY_CSRF_TOKEN`.
*   **NG6 — Third-party tokenizer libraries:** Category breakdowns, tool attribution shares, artifact byte estimates, and rule/skill inventory sizes remain character-weighted local estimates derived from disk files and transcript character shares anchored to `PLANNER_RESPONSE` token counters.
*   **NG7 — Editing or mutating Antigravity transcripts, annotations, or configs:** All Context Monitor MCP tools remain read-only (`readOnlyHint: true`).
*   **NG8 — Syncing `docs/` into the installed plugin directory:** Design specifications live only under `docs/designs/` and are excluded when syncing runtime bundles to `~/.gemini/config/plugins/context-monitor/`.

## Open Questions

None.

## Critical User Journeys (CUJs)

### CUJ 1: Inspect Interactive Threads Without Subagent Noise (Opt-In Show All)

*   **Given:** A fixture or local corpus of 500 transcripts exists under `~/.gemini/antigravity/brain/`, consisting of 100 annotated interactive threads and 400 unannotated subagent/background transcripts, and `ConversationService` env vars are unset in the MCP server process.
*   **When:** The user or host launches `open_context_monitor` with `{}` (default interactive filter) and later toggles `includeSubagents: true`.
*   **Then:** By default, the server selects the most recently updated interactive thread and omits unannotated subagent and background threads from `conversations`; when `includeSubagents: true` is passed, unannotated transcripts appear with `kind: "background"` (or `"subagent"` when `ConversationService` supplies `parentConversationId`), all within a `schemaVersion: 2` payload under 1 MiB.

### CUJ 2: Inspect CLI-Aligned Breakdown, Artifacts, Trajectory, and Top Tool Contributors

*   **Given:** A selected conversation has 100+ planner turns, at least one compaction `CHECKPOINT`, tool calls producing `GENERIC` outputs, and markdown artifact files under `~/.gemini/antigravity/brain/<id>/`.
*   **When:** The UI calls `get_context_snapshot` for that `conversationId`.
*   **Then:** `current` exposes CLI-aligned `segments` (`User messages`, `Agent responses`, `Tool calls`, `System and baseline`, conditional `Checkpoint buffer`, and conditional `System messages`) alongside `exact.freeTokens` and `exact.freePercent` (labeled "Free space" in the UI, preserving `sum(segments.tokens) === exact.activeTokens` and `sum(segments.percent) + exact.freePercent === 100.0`), disk-discoverable artifact metadata, a bounded per-turn trajectory array retaining all compaction points, ranked top tool contributors by attributed token share, and cumulative session input/cache counters.

### CUJ 3: Audit Active Workspace Rules, Skills, and True Plugin Enablement

*   **Given:** One installed plugin has `"enabled": false` in `~/.gemini/config/config.json` (while its `plugin.json` has no `disabled` field), another plugin ships `"disabled": true` in `plugin.json` but has `"enabled": true` in `config.json`, and the active workspace contains `AGENTS.md` and workspace skills under `<workspace>/.agents/skills/`.
*   **When:** The analyzer runs `scanLocalInventory` with resolved workspace context.
*   **Then:** Plugin active status follows `config.json` over `plugin.json` across MCP servers, rules, and skills; workspace rules and skills across `.agents`, `.agent`, `_agents`, and `_agent` appear with `scope: "workspace"` and accurate `byScope.workspace` counts alongside `global`, `plugin`, and `builtin`.

### CUJ 4: Optional `ConversationService` Enrichment Without Fragility

*   **Given:** The MCP server runs either with valid `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN` env vars or without them (or with a timed-out/unreachable endpoint).
*   **When:** `open_context_monitor` or `get_context_snapshot` executes.
*   **Then:** When reachable, `ListConversations` enriches conversation titles, `runState`, `projectId`, and interactive/subagent classification within a bounded timeout; when unset or unreachable, the analyzer skips or times out within `350 ms` without throwing, reporting service reachability metadata so callers know enrichment was offline.

## Technical Plan (Architecture)

### System Data Flow

Context Monitor v0.2 keeps `~/.gemini/antigravity/` and `~/.gemini/config/` on local disk as the authoritative data source, treating `ConversationService` and MCP `roots/list` as bounded optional enrichment signals.

```text
Local Disk Sources                         Optional Host Signals
──────────────────                         ─────────────────────
~/.gemini/antigravity/brain/<id>/          ANTIGRAVITY_LS_ADDRESS + CSRF_TOKEN
  ├── .system_generated/logs/transcript*     └─► ConversationService (350ms cap)
  └── *.md (+ *.md.metadata.json)          MCP Client roots/list (250ms cap)
~/.gemini/antigravity/annotations/*.pbtxt  Explicit tool args (conversationId,
~/.gemini/config/config.json                 workspacePath, includeSubagents)
~/.gemini/config/projects/<projectId>.json         │
~/.gemini/config/plugins/* & mcp/*                 ▼
<workspace>/{AGENTS.md,GEMINI.md,          ──► src/analyzer.mjs (v2)
  .agents,.agent,_agents,_agent}                   │
                                                   ▼
                                           src/server.mjs (MCP Tools)
                                             ├── open_context_monitor (aux_pane + global)
                                             └── get_context_snapshot (app-only refresh)
```

Host and MCP App concepts used in this diagram:
*   `aux_pane`: Antigravity's conversation side panel UI entrypoint.
*   `global`: Antigravity's left sidebar workspace UI entrypoint.
*   `ui://context-monitor/app.html`: Bundled single-file MCP App HTML/JS/CSS resource served via `registerAppResource`.
*   `_meta.ui.visibility`: MCP Apps metadata array controlling whether the model and/or UI iframe can call a tool (`["model", "app"]` or `["app"]`).

### Local Data Sources & Transcript Format

*   **`transcript.jsonl` vs `transcript_full.jsonl`:** Each tracked conversation stores a compact `transcript.jsonl` (truncated tool payloads) and optionally an untruncated `transcript_full.jsonl` under `.system_generated/logs/`. Fast list summaries always read `transcript.jsonl`; full single-thread analysis reads `transcript_full.jsonl` when it is `<= 4 MiB` for higher-precision proportional character weights, otherwise falling back to `transcript.jsonl`.
*   **`annotations/<id>.pbtxt`:** Protobuf-text metadata written by Antigravity for interactive user threads (containing `title: "..."`).
*   **Transcript JSONL row types:**
    *   `PLANNER_RESPONSE`: carries exact prompt counters (`input_tokens`, `cache_read_tokens`, `output_tokens`), `model`, `content`, `thinking`, `tool_calls`, `step_index`, and `created_at`.
    *   `USER_INPUT`: carries `content` (the user prompt text).
    *   `GENERIC`: carries tool execution output payloads (`content`).
    *   `CHECKPOINT`: marks a context compaction boundary in the conversation log.
    *   `SYSTEM_MESSAGE` and `ERROR_MESSAGE`: carry system notifications and error payloads (`content`).
*   **Local token approximation:** Where Antigravity does not record per-category token counts, estimates weight raw UTF-8 characters on transcript rows (`content`, `thinking`, serialized `tool_calls`) or UTF-8 bytes on disk files at approximately `4` chars/bytes per token.

### Baseline v0.1.0 Snapshot Shape

Spec 1 builds on the existing v0.1.0 `structuredContent` contract:
*   Top-level keys: `generatedAt`, `totalTrackedConversations`, `selectedConversationId`, `requestedConversationFound`, `current`, `conversations`, `inventory` (Spec 1 adds `schemaVersion: 2` and `serviceStatus`).
*   `current.exact`: `activeTokens` (`input_tokens + cache_read_tokens` of the latest token-bearing planner turn), `inputTokens`, `cacheReadTokens`, `cacheHitPercent`, `lastOutputTokens`, `totalOutputTokens`, `postCheckpointOutputTokens`, `turnCount`, `checkpointCount`, `freeTokens`, `freePercent`, and `usedPercent`.
*   `conversations[]`: summary items with `conversationId`, `title`, `modelId`, `modelName`, `activeTokens`, `contextWindow`, `usedPercent`, `checkpointCount`, `runState`, `lastUpdated`, and `mtimeMs` (Spec 1 adds `kind`, `turnCount`, `projectId`, and `parentConversationId`).
*   `inventory`: `mcp` (`servers[]`, active/cached counts and token estimates), `rules` (`items[]`, `count`, `estTokens`), and `skills` (`count`, `estIndexTokens`, `byScope`, `items[]`; Spec 1 adds `inventory.workspace` and `byScope.workspace`).

### Thread Discovery and Annotation-Gated Classification

Every directory under `~/.gemini/antigravity/brain/<id>/` with a non-empty `.system_generated/logs/transcript.jsonl` is counted toward `totalTrackedConversations`. Parsed summaries are stored in `summaryCache` keyed by resolved `transcriptPath` (with `mtimeMs` stored for staleness checks and deleted directories evicted on scan). Because Antigravity may flush `~/.gemini/antigravity/annotations/<conversationId>.pbtxt` asynchronously after transcript creation, `.pbtxt` existence and title are evaluated outside the transcript `mtimeMs` cache-hit check so newly flushed annotations update `kind` and `title` immediately.

To bound cold-start latency on 500+ transcripts without dropping large interactive threads:

*   Default interactive filtering (`includeSubagents: false`) gates candidates upfront by checking `~/.gemini/antigravity/annotations/<id>.pbtxt` existence and `serviceMap` entries before opening transcript file bodies, restricting synchronous parsing to the top `limit` (default 35, max 100) interactive candidates plus a valid explicit `conversationId`.
*   When `includeSubagents: true`, transcript indexing scans the top `limit` transcripts by `mtimeMs` across all tracked brain directories. Compact `transcript.jsonl` files are never skipped by size (the `4 MiB` cap in `loadBestTranscriptRows` applies solely when deciding whether to upgrade from `transcript.jsonl` to `transcript_full.jsonl`).
*   Explicit `conversationId` inputs are validated as a safe single path segment (rejecting empty strings, `/`, `\`, `..`, and null bytes). Invalid `conversationId` arguments never touch disk outside `brain/` or `annotations/`, and set `requestedConversationFound: false` before falling back to default selection.

Classification assigns `kind` in strict precedence order:

1.  `"subagent"`: `serviceInfo?.parentConversationId` is non-empty.
2.  `"interactive"`: `~/.gemini/antigravity/annotations/<conversationId>.pbtxt` exists on disk OR `serviceInfo` returned the thread from `ListConversations({ includeArchived: false })` without a parent.
3.  `"background"`: all remaining unannotated transcripts (workflow workers, zero-user-input agent sessions, unannotated cron runs, and offline subagents).

Default selection and zero-interactive fallback:

*   When `includeSubagents` is `false`, `conversations` contains only `kind === "interactive"` entries. If zero interactive threads exist, `conversations` is `[]` and default selection falls back to the latest transcript overall so `current` still renders.
*   If the caller passes a valid explicit `conversationId`, `selectedEntry` resolves that transcript even when `kind !== "interactive"`, so direct inspection of any subagent or background thread still works.

### Optional, Non-Blocking `ConversationService` Enrichment

`fetchConversationServiceTitles` checks `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN`. When either is absent, it returns `{ map: new Map(), status: { reachable: false, reason: "missing_env", enrichedCount: 0 } }` immediately with zero network I/O.

When both env vars are present, it queries `POST http://${ANTIGRAVITY_LS_ADDRESS}/product.v1.ConversationService/ListConversations` with headers `Content-Type: application/json`, `Connect-Protocol-Version: 1`, and `x-antigravity-csrf-token: ${ANTIGRAVITY_CSRF_TOKEN}`, passing `{ pageSize: 100, includeArchived: false }` and optional `pageToken` (from page 1's `nextPageToken`) for up to 2 pages (200 recent conversations) within a single shared `350 ms` `AbortController` deadline:

*   Each entry reads `id`, title (`annotations.title` or `state.summary`), `state.runState` (`"RUN_STATE_IDLE" | "RUN_STATE_RUNNING" | "RUN_STATE_CANCELLING"`), `state.updateTime`, and `metadata` fields (`projectId`, `parentConversationId`, `rootConversationId`).
*   `serviceStatus` uses shape `{ reachable: boolean, reason: "missing_env" | "ok" | "partial" | "http_error" | "timeout_or_network", enrichedCount: number }`. If page 1 succeeds and page 2 fails or times out, page 1 entries are retained with `reachable: true, reason: "partial"`. None throw or set `isError: true`.
*   No cross-poll TTL or negative cooldown cache is used on `ConversationService` in Spec 1 so manual refreshes never serve stale failures; `fetchConversationServiceTitles` runs concurrently with MCP `roots/list` in `src/server.mjs`.

### CLI-Aligned Breakdown (`segments`) and Cumulative Session Counters

`analyzeTranscriptRows` replaces v0.1.0 segment identifiers in place on `current.segments` while keeping the schema shape `{ id, label, tokens, percent, colorKey, kind, detail }` and preserving both v0.1.0 invariants (`sum(segments.tokens) === exact.activeTokens`, and `sum(segments.percent) + exact.freePercent === 100.0` via largest-remainder tenths allocation).

Baseline and anchor definitions (building on v0.1.0 math):

*   `latestPlanner` is the last token-bearing `PLANNER_RESPONSE` turn at row index `latestPlannerIdx`. Its active context is `activeTokens = input_tokens + cache_read_tokens`.
*   `firstTotal` is Turn 1's active tokens (`input_tokens + cache_read_tokens`); `firstUserEst` is the first `USER_INPUT` character estimate (`bytes / 4`) clamped to `60%` of `firstTotal`; `turn1Baseline = max(0, firstTotal - firstUserEst)`.
*   For segment attribution, `effectiveCheckpointIdx` is the largest `CHECKPOINT` row index strictly before `latestPlannerIdx` (or `-1` if none precedes `latestPlannerIdx`). Anchoring on `effectiveCheckpointIdx` guarantees that `anchorIdx <= latestPlannerIdx` always holds, while any trailing `CHECKPOINT` emitted after `latestPlannerIdx` still increments `exact.checkpointCount` and appears in `trajectory`:
    *   **When `effectiveCheckpointIdx === -1`:** `anchorIdx` is the first token-bearing planner turn, `baselineEst` is `turn1Baseline` clamped to `activeTokens`, `initialMessagesEst` is `firstUserEst` clamped to `activeTokens - baselineEst`, `checkpointBufferEst = 0`, and `anchorTotal = baselineEst + initialMessagesEst`.
    *   **When `effectiveCheckpointIdx >= 0`:** `anchorIdx` is the first token-bearing planner turn after `effectiveCheckpointIdx` (guaranteed to exist and be `<= latestPlannerIdx`). Let `postCpTotal` be that turn's active tokens; then `baselineEst = min(turn1Baseline, postCpTotal, activeTokens)`, `checkpointBufferEst = min(max(0, postCpTotal - baselineEst), max(0, activeTokens - baselineEst))`, `initialMessagesEst = 0`, and `anchorTotal = baselineEst + checkpointBufferEst`.

| Segment ID | Label | Color Key | Kind | Character / Token Attribution & Tooltip Detail |
| :--- | :--- | :--- | :--- | :--- |
| `baseline` | `System and baseline` | `blue` | `estimated` | `baselineEst` (defined in the anchor rules above). Covers system prompt, built-in tools, MCP index, rules, and skill headers. |
| `tool_calls` | `Tool calls` | `orange` | `estimated` | Post-anchor `GENERIC` row chars plus non-empty `PLANNER_RESPONSE.tool_calls` JSON chars. |
| `user_messages` | `User messages` | `green` | `estimated` | `initialMessagesEst + allocated.userMessages` (`initialMessagesEst` added as a fixed token offset, plus `deltaTokens` share from post-anchor `USER_INPUT` row chars). |
| `agent_responses` | `Agent responses` | `amber` | `estimated` | Post-anchor `PLANNER_RESPONSE` `content` + `thinking` chars (excluding `tool_calls`); also receives zero-weight fallback if `deltaTokens > 0` and all weights equal `0`. |
| `checkpoint_buffer` | `Checkpoint buffer` | `violet` | `estimated` | `checkpointBufferEst` (emitted only when `> 0`). Compacted history carried forward after checkpoints. |
| `system_messages` | `System messages` | `slate` | `estimated` | Post-anchor `SYSTEM_MESSAGE` + `ERROR_MESSAGE` row chars (emitted only when `> 0`). System notifications and error rows in the active window. |

Post-anchor attribution and session counters:

*   A planner turn's own output (`content`, `thinking`, `tool_calls`) enters context only on subsequent turns. Therefore, when `latestPlannerIdx > anchorIdx`, the anchor planner turn's `content` + `thinking` chars contribute to `agent_responses` and its non-empty `tool_calls` JSON chars contribute to `tool_calls` (with no `1`-char floor on empty `tool_calls`). When `latestPlannerIdx === anchorIdx`, the anchor turn's own outputs are excluded.
*   `deltaTokens = max(0, activeTokens - anchorTotal)` is distributed proportionally via largest-remainder rounding across `{ toolCalls, userMessages, agentResponses, systemMessages }`, falling back to `agentResponses: 1` when `deltaTokens > 0` and all four weights are `0`.
*   `exact` adds three cumulative session counters summed across all token-bearing `PLANNER_RESPONSE` rows in the transcript:
    *   `cumulativeInputTokens`: sum of `input_tokens`.
    *   `cumulativeCacheReadTokens`: sum of `cache_read_tokens`.
    *   `cacheInvalidationCount`: compare consecutive token-bearing planner turns without an intervening `CHECKPOINT` (treating missing `cache_read_tokens` as `0`), incrementing once per transition where `prevCacheRead > 0 && (curCacheRead === 0 || curCacheRead <= prevCacheRead * 0.5)`.
*   When no token-bearing planner turn exists (`hasUsageData: false`), `exact.cumulativeInputTokens`, `exact.cumulativeCacheReadTokens`, and `exact.cacheInvalidationCount` default to `0`, `trajectory` is `{ points: [], totalTurnCount: 0, checkpointCount, isBounded: false }`, `topTools` is `[]`, and `artifacts` is still populated from disk when `includeDetails` is `true`.

### Bounded Per-Turn Context Trajectory (`trajectory`)

`current.trajectory` exposes `{ points, totalTurnCount, checkpointCount, isBounded }` where `totalTurnCount` equals `exact.turnCount`, and each entry in `points` has shape:

```text
{ turn, stepIndex, activeTokens, inputTokens, cacheReadTokens, outputTokens, kind, createdAt }
```

*   Field mapping: `stepIndex` reads numeric `step_index` falling back to the transcript row index, `outputTokens` defaults missing values to `0`, `createdAt` defaults to `null`, and `kind` is `"turn" | "checkpoint_peak" | "checkpoint_baseline"`.
*   Bounding and deduplication rules:
    1.  Collect all token-bearing `PLANNER_RESPONSE` turns (`1..N`) and `CHECKPOINT` row indices.
    2.  When `checkpointCount === 0`, the active epoch covers all turns `1..N` (tagged `"turn"`).
    3.  When `checkpointCount > 0`, include Turn 1 (`"turn"`), each checkpoint's pre-checkpoint peak (`"checkpoint_peak"` — last planner turn before the checkpoint) and post-checkpoint baseline (`"checkpoint_baseline"` — first planner turn after the checkpoint), and active-epoch turns starting after the final checkpoint (tagging the first entry of the active epoch as `"checkpoint_baseline"`). If a trailing checkpoint has no subsequent planner turn, emit that checkpoint's pre-checkpoint peak and an empty active epoch.
    4.  Deduplicate milestone points by `turn` using precedence `"checkpoint_peak"` > `"checkpoint_baseline"` > `"turn"`.
    5.  In both `checkpointCount === 0` and `checkpointCount > 0`, if the active epoch exceeds `120` entries, set `isBounded = true` and retain the first entry of the active epoch plus its last `119` entries.

### Top Tool-Call Contributor Attribution (`topTools`)

`current.topTools` ranks the tools driving the `tool_calls` segment inside the active post-anchor window (`toolCallsTokens` equals the `tool_calls` segment's `tokens`):

1.  If `toolCallsTokens === 0` or `latestPlannerIdx <= anchorIdx` (e.g., 1-turn threads or the first turn after a checkpoint, because a turn's own tool calls are not part of its own input prompt), return `[]`.
2.  For each `PLANNER_RESPONSE` row in `[anchorIdx, latestPlannerIdx]` with non-empty `tool_calls` (verified item keys `{ name, args }`), collect subsequent `GENERIC` rows up to `latestPlannerIdx` inclusive, stopping at the next `PLANNER_RESPONSE`, `USER_INPUT`, or `CHECKPOINT` (skipping intervening `SYSTEM_MESSAGE` or `ERROR_MESSAGE` rows rather than halting the batch).
3.  Pair `GENERIC` outputs positionally when counts match `tool_calls.length`; otherwise allocate summed `GENERIC` chars across `tool_calls` proportionally by `max(1, serialized tool-call JSON chars)`, adding each call's own serialized tool-call JSON chars.
4.  Aggregate raw weights by tool name (defaulting missing names to `"unknown"`), allocate `toolCallsTokens` proportionally, compute `sharePercent` to one decimal place, sort by `estTokens` descending, then `calls` descending, then `name` ascending, and return the top `10` entries `{ name, calls, estTokens, sharePercent }`.

### Disk-Discoverable Conversation Artifacts (`current.artifacts`)

For the selected validated `conversationId`, perform a non-recursive regular `*.md` file scan of `~/.gemini/antigravity/brain/<conversationId>/`:

*   Each item has shape `{ name, bytes, estTokens, mtimeMs, userFacing, summary }` (`estTokens = Math.round(bytes / 4)`).
*   Read optional sibling `<name>.metadata.json`: `userFacing` reads `userFacing` (with `UserFacing` fallback, boolean, default `false`), and `summary` reads `summary` (with `Summary` fallback, string, default `null`, collapsed to single-line whitespace and truncated to 160 chars).
*   Sort by `mtimeMs` descending. `count`, `totalBytes`, and `totalEstTokens` (`Math.round(totalBytes / 4)`) aggregate across all matching top-level `.md` files before slicing `items` to the top `20`.

### True Plugin Precedence, Workspace Discovery, and Inventory (`inventory`)

`scanLocalInventory({ workspacePath, mcpRoots, projectId })` resolves plugin enablement and active workspace customizations:

1.  **Plugin enablement precedence:** Read `~/.gemini/config/config.json` safely (treating missing or malformed JSON as `{}`). For each plugin directory, resolve `enabled` from `configJson.plugins[dirName].enabled`, falling back to `configJson.plugins[pluginJson.name].enabled`, and then `!pluginJson.disabled`. Apply consistently across MCP servers, plugin rules, and plugin skills.
2.  **Workspace resolution:** Resolve at most one active workspace root in priority order, validating directories (must resolve to an existing directory and not `/` or `os.homedir()`) and falling through to the next source if an explicit argument fails validation:
    *   Explicit `workspacePath` argument (`source: "arg"`).
    *   Selected conversation's `projectId` (available only when `ConversationService` enrichment succeeded) matched directly at `~/.gemini/config/projects/<projectId>.json` (after validating `projectId` contains no path separators), reading the first valid `file://` URI from `projectResources.resources[].gitFolder.folderUri` or `localFolder.folderUri` (`source: "project_id"`).
    *   Valid `file://` URIs passed from MCP `roots/list`, guarding URI-to-path decoding per entry so one malformed URI does not discard valid subsequent URIs (`source: "mcp_roots"`).
    *   Otherwise `workspace = { path: null, source: "none" }`.
3.  **Workspace rules, skills, and bounds:**
    *   When `workspace.path` resolves, inspect root `GEMINI.md` and `AGENTS.md` plus `.agents`, `.agent`, `_agents`, and `_agent` (`rules/*.md` and `skills/*/SKILL.md` — the official Antigravity workspace customization directories documented in `agy-customizations/SKILL.md`).
    *   Skip broken symlinks and reject symlink targets resolving outside `workspace.path`; deduplicate rules and skills by resolved real path.
    *   Name workspace rules by workspace-relative POSIX path (`"AGENTS.md"`, `".agents/rules/foo.md"`), tag with `scope: "workspace"`, and apply `overPerFileCap: bytes > 24_000` uniformly across all `rules.items` (`plugin`, `global`, `workspace`).
    *   Sort `rules.items` by `estTokens` descending, then `name` ascending before slicing to `80`; compute `rules.count`, `rules.estTokens`, and `mcp` aggregate totals across all discovered items prior to slicing.
    *   Add `workspace` to `inventory.skills.byScope` (`{ workspace, plugin, global, builtin }`), cap `skills.items` at `80` (up from `60`), `rules.items` at `80`, and `mcp.servers` at `100` (sorted active-first), and return `inventory.workspace: { path: string | null, source: "arg" | "project_id" | "mcp_roots" | "none" }`.
    *   Read only the first `4 KiB` of each `SKILL.md` for frontmatter header estimation; `scanLocalInventory` performs direct filesystem reads without an unprofiled TTL cache so in-place edits reflect immediately.

### MCP Tool Surface (`src/server.mjs`)

| Tool Name | Visibility | Input Parameters | Output Purpose |
| :--- | :--- | :--- | :--- |
| `open_context_monitor` | `["model", "app"]` (default) | `conversationId?`, `workspacePath?`, `includeSubagents?` | Primary UI entrypoint (`ui://context-monitor/app.html`, `aux_pane` + `global`). Calls `getContextSnapshot` with `includeDetails: false` (retaining v0.1.0 `conversations` and `inventory` for zero-roundtrip v0.1.0 UI paint while omitting `current.trajectory`, `current.topTools`, and `current.artifacts` from host model context). Returns `schemaVersion: 2`, `serviceStatus`, `current`, `conversations` (top 35), `inventory`. |
| `get_context_snapshot` | `["app"]` (hidden from model) | `conversationId?`, `workspacePath?`, `includeSubagents?`, `limit?` (`1..100`, def `35`) | App-only single-thread refresh, mount-time detail hydration, and thread switching. Calls `getContextSnapshot` with `includeDetails: true` (returning full `current` including `trajectory`, `topTools`, and `artifacts`) and passes `mcpRoots` when `workspacePath` is invalid or omitted. |

MCP `roots/list` orchestration in `src/server.mjs`:

*   `resolveMcpRoots(server)` checks `server.server.getClientCapabilities()?.roots` (`McpServer` wraps the low-level `Server` at `server.server`), validates `args.workspacePath` before deciding to skip `resolveMcpRoots` (so invalid `workspacePath` still falls through to `mcpRoots`), calls `server.server.listRoots(undefined, { timeout: 250 })` inside `try/catch`, and unwraps `(result?.roots ?? []).map(r => r.uri)`.
*   Cache the URI list only when the response is non-empty AND the client declared `capabilities.roots.listChanged === true`, clearing on `notifications/roots/list_changed`; never cache empty results, timeouts, or errors.

Schema additions and payload budget:

*   `conversations[]` items add `kind`, `turnCount`, `projectId`, and `parentConversationId` (sourced exclusively from `serviceInfo?.parentConversationId || null`), and `current` adds `kind`.
*   Payload budget target: using the array caps above (`35` conversations, `80` rules, `80` skills, `100` MCP servers, `120`-turn active-epoch trajectory, `10` topTools, `20` artifacts) and `includeDetails: false` on `open_context_monitor`, responses target `< 256 KiB` typical and stay well under the `1 MiB` `CallToolResult` cap (asserted in integration tests).

### Scoped v0.1.0 Side-Panel UI & CSS Compatibility Sync

Because Spec 1 replaces `current.segments` IDs in place (`checkpoint_buffer` replaces `checkpoint_summary`) and adds `workspace` skill counts before Spec 2's full UI redesign, Spec 1 updates `src/ui/main.js` and `src/ui/styles.css` in three scoped places:

1.  Render and patch segment tooltips whenever `Boolean(seg.detail)` is true rather than hardcoding a segment-ID allowlist (`baseline` / `checkpoint_summary`).
2.  Append `workspace` skill counts in `skills-scope` and include `inventory.skills?.byScope` in `computeSnapshotFingerprint` so in-place DOM patching detects scope shifts.
3.  Define `--seg-amber: #f59e0b;` on `:root` in `src/ui/styles.css` and point `.swatch-amber, .bar-amber` to `var(--seg-amber)` so `Agent responses` (`amber`) does not render in violet alongside `Checkpoint buffer`.

## Alternatives Considered

### Alternative A: Heuristic Multi-Turn or Exclude-Only Thread Filtering

*   **Pros**: Surfaces untitled multi-turn or first-turn interactive sessions immediately when `ConversationService` is offline and annotations have not yet flushed to disk.
*   **Cons**: Leaks unannotated background sessions (multi-turn background threads and single-prompt workflow workers observed in the 500+ transcript corpus) into the default interactive selector.
*   **Reason for Rejection**: Annotation-gated interactive classification (`annotations/<id>.pbtxt` or `ConversationService`) keeps workflow and background worker noise out of the default list while preserving an opt-in show-all toggle and explicit `conversationId` inspection.

### Alternative B: Parallel `cliBreakdown` Array Alongside v0.1.0 `segments`

*   **Pros**: Leaves `current.segments` identifiers untouched for legacy v0.1.0 UI code.
*   **Cons**: Duplicates category objects in every `structuredContent` payload and forces UI consumers and contract tests to maintain two slightly different prompt decompositions.
*   **Reason for Rejection**: Replacing `segments` in place with CLI-aligned identifiers (`baseline`, `tool_calls`, `user_messages`, `agent_responses`, `checkpoint_buffer`, `system_messages`) eliminates schema duplication while maintaining `activeTokens` and `100.0%` rounding invariants and keeping UI sync edits small.

### Alternative C: Full-Session Downsampling (200 Points) or Sliding 100-Turn Trajectory

*   **Pros**: Downsampling retains older intermediate shapes up to 200 entries; a 100-turn sliding window requires only simple array slicing.
*   **Cons**: Downsampling introduces uneven bucket intervals across older epochs, while a 100-turn sliding window drops Turn 1 and pre-checkpoint history on long sessions (133+ turns observed).
*   **Reason for Rejection**: Emitting the active post-checkpoint epoch (capped at 120 turns) plus explicit `checkpoint_peak` and `checkpoint_baseline` milestone pairs for earlier checkpoints preserves complete granularity in the active window and compaction boundaries within a compact payload budget.

### Alternative D: Transcript Path-Scraping Fallback or Server `cwd` Walk for Workspace Discovery

*   **Pros**: Attempts workspace resolution even when MCP `roots/list` and `ConversationService` are both unavailable.
*   **Cons**: Scraping file paths from transcripts misattributes the workspace when a thread touches multiple repositories, and walking `process.cwd()` fails whenever Antigravity launches the global plugin MCP server from `HOME` or the plugin folder.
*   **Reason for Rejection**: Resolving the workspace exclusively from explicit `workspacePath`, `ConversationService` `projectId` mappings under `~/.gemini/config/projects/<projectId>.json`, and MCP `roots/list` avoids heuristic misattribution.

### Alternative E: Building Fleet Aggregates (`fleet`) and `list_conversations` Search/Pagination in Spec 1

*   **Pros**: Ships a search/pagination contract and fleet counters upfront before Spec 2 starts.
*   **Cons**: Computing full-corpus `fleet` metrics (`highUsageInteractiveCount`, `checkpointedInteractiveCount`, offline `subagent` vs `background` counts) contradicts Spec 1's upfront top-35 interactive gating, and locks in unvalidated Spec 2 UI filter and query semantics before `docs/designs/global_workspace_ux.md` exists.
*   **Reason for Rejection**: Deferring `fleet` and `list_conversations` to Spec 2 keeps Spec 1 on one consistent, fast annotation-gated top-`limit` path (`open_context_monitor` + `get_context_snapshot`).

## Non-Functional Requirements

*   **Performance & Latency**: Indexing transcripts reuses `summaryCache` keyed by resolved `transcriptPath` so repeated polls only parse newly modified transcripts, while default `includeSubagents: false` gates candidates via `.pbtxt` annotations and `serviceMap` before opening transcript bodies. Optional `ConversationService` requests are bounded to `350 ms` and MCP `roots/list` requests to `250 ms` (cached only on non-empty responses when `roots.listChanged` is declared) and executed concurrently.
*   **Payload Size & Compatibility**: Every `CallToolResult` payload from `open_context_monitor` targets `< 256 KiB` typical and stays well under `1 MiB` (asserted in integration tests). All v0.1.0 top-level keys (`generatedAt`, `totalTrackedConversations`, `selectedConversationId`, `requestedConversationFound`, `current`, `conversations`, `inventory`) and rounding invariants remain intact alongside `schemaVersion: 2` segments and the scoped UI/CSS compatibility updates.
*   **Security & Privacy**: All MCP tools remain read-only (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`). The server never scrapes OS process tables or undocumented host sockets, never exposes raw `ANTIGRAVITY_CSRF_TOKEN` values in tool output, rejects path-traversal `conversationId` and `projectId` inputs (`/`, `\`, `..`, null bytes), validates `workspacePath` and resolved URIs via `fs.realpathSync` + `stat.isDirectory()`, and rejects `/`, `os.homedir()`, and non-directory paths.
*   **Rollout & Rollback**: Changes ship first to the source repository and are built and verified via `npm run build && npm test && agy plugin validate . --strict` (`agy` = Antigravity CLI) before syncing runtime files (`dist/`, `plugin.json`, `mcp_config.json`, `assets/`, `README.md`, excluding `docs/`, `src/`, `scripts/`, `node_modules/`) to `~/.gemini/config/plugins/context-monitor/`. `package.json`, `plugin.json`, `src/server.mjs`, and `src/ui/main.js` remain at version `0.1.0` during Spec 1 (`schemaVersion: 2` indicates the v2 wire contract) and bump to `0.2.0` when Spec 2 ships. Rolling back restores the prior `dist/` bundle and restarts `context-monitor_context-monitor` (the installed plugin MCP server ID).

## Risks & Limits

*   **Offline Unannotated Interactive Sessions:** If a user starts a brand-new conversation before `~/.gemini/antigravity/annotations/<id>.pbtxt` flushes to disk and `ConversationService` env vars are absent or timed out, the disk-first classifier classifies that session as `"background"` until `.pbtxt` appears or enrichment recovers. Mitigation: callers can pass `includeSubagents: true` or pass the explicit `conversationId`, and `summaryCache` checks `.pbtxt` state outside `transcript.jsonl` `mtimeMs` hits.
*   **Partial or Corrupt JSONL Rows Mid-Turn:** Active conversations can write partial trailing JSON lines while `fs.readFileSync` reads `transcript.jsonl` or `transcript_full.jsonl`. Mitigation: `parseJsonlFile` and `summarizeConversationFast` catch per-line `JSON.parse` errors and skip incomplete trailing lines without failing the snapshot.
*   **Broken or Escaping Symlinks in Workspace Customizations:** `.agents/rules/*.md` or `.agents/skills/*/SKILL.md` may contain dangling symlinks (`ENOENT`) or symlinks pointing outside `workspace.path`. Mitigation: `scanLocalInventory` wraps `fs.realpathSync` in `try/catch`, verifies targets stay within resolved `workspace.path`, and deduplicates by real path.
*   **Cold-Start & 15-Second Polling Latency:** Scanning 500+ transcripts or large `SKILL.md` files and unreachable external endpoints on every 15-second poll can stall UI refreshes. Mitigation: default views filter upfront by annotations + `serviceMap`, `inspectSkillMetadata` reads only `4 KiB` headers, external requests run concurrently within `350 ms` / `250 ms` timeouts, and inventory/list arrays enforce explicit upper caps.

## Detailed Implementation Plan

### Required Skills for Execution Session

Load these skills at the start of the implementation session before editing any code:

1.  `mcp-app-development` (`~/.gemini/antigravity/builtin/skills/mcp-app-development/SKILL.md` — tool visibility, `structuredContent` 1 MiB cap, MCP server lifecycle)
2.  `agy-customizations` (`~/.gemini/antigravity/builtin/skills/agy-customizations/SKILL.md` — workspace `.agents/` discovery rules, 24,000-byte per-file rule cap, `config.json` plugin precedence)
3.  `conversations` (`~/.gemini/antigravity/builtin/skills/conversations/SKILL.md` — `ConversationService/ListConversations` Connect HTTP+JSON schema and headers)
4.  `modern-web-guidance` (`~/.gemini/config/plugins/modern-web-guidance-plugin/skills/modern-web-guidance/SKILL.md` — required before editing `src/ui/main.js` and `src/ui/styles.css`)

### Target Files to Modify

Note: `plugin.json` is excluded from Spec 1 edits because release version strings stay at `0.1.0` until Spec 2 ships (`package.json` updates only `"scripts.test"`, keeping `"version": "0.1.0"`).

#### 1. `src/analyzer.mjs` (Modify)

*   **Type / Scope**: Core local transcript analyzer and workspace/plugin inventory scanner.
*   **Rationale**: Implements v2 classification, CLI-aligned `segments`, `trajectory`, `topTools`, `artifacts`, cumulative counters, `ConversationService` status, `config.json` plugin precedence, and workspace customization scanning.
*   **Proposed Changes**:
    1.  **Dynamic `resolvePaths({ geminiHome } = {})` refactor**: Replace all module-level path constants (`GEMINI_HOME`, `ANTIGRAVITY_DIR`, `BRAIN_DIR`, `ANNOTATIONS_DIR`, `MCP_SCHEMAS_DIR`, `CONFIG_DIR`, `PLUGINS_DIR`, `BUILTIN_SKILLS_DIR`) with `resolvePaths({ geminiHome } = {})` reading `geminiHome || process.env.CONTEXT_MONITOR_GEMINI_HOME || path.join(os.homedir(), ".gemini")` so `readAnnotationTitle`, `loadBestTranscriptRows`, `scanConversationArtifacts`, `scanLocalInventory`, and `getContextSnapshot` resolve against isolated test fixtures.
    2.  **`fetchConversationServiceTitles(maxCount = 200)`**: Implement `ListConversations` (`pageSize: 100`, `pageToken`, `includeArchived: false`, 2 pages max within `350 ms`), extracting `projectId`, `parentConversationId`, and `rootConversationId` from `conv.metadata`, `"partial"` page-1 retention, and `{ map, status }` return value (updating the destructuring call site in `getContextSnapshot`, without any 15s/30s cache).
    3.  **Validation, annotation gating, and `summaryCache`**:
        *   Add `isSafeSingleSegment(id)` rejecting empty strings, `/`, `\`, `..`, and null bytes; apply it to `conversationId` and `projectId` before touching disk.
        *   Key `summaryCache` by resolved `transcriptPath`, evict deleted entries on scan, evaluate `~/.gemini/antigravity/annotations/<id>.pbtxt` outside transcript `mtimeMs` hits, and store `turnCount` in summary entries.
        *   For default `getContextSnapshot` (`includeSubagents: false`), filter candidate directories via `.pbtxt` + `serviceMap` before reading transcript bodies so synchronous reads stay bounded to top `limit` (plus any valid explicit `conversationId`); when `includeSubagents: true`, parse top `limit` transcripts by `mtimeMs` without skipping large compact `transcript.jsonl` files. Classify `"subagent"` only when `serviceInfo?.parentConversationId` is non-empty.
    4.  **`analyzeTranscriptRows` v2 extensions (export `analyzeTranscriptRows` and `scanConversationArtifacts`)**:
        *   Signature: `analyzeTranscriptRows(conversationId, rows, mtimeIso, titleOverride, runState, usedFullTranscript, { includeDetails = true, kind = "interactive", annotationTitle = undefined } = {})`.
        *   **Segments & anchor math**: Compute `effectiveCheckpointIdx` (largest `CHECKPOINT` index `< latestPlannerIdx`, else `-1`). Implement both anchor branches (`effectiveCheckpointIdx === -1` and `>= 0`), six CLI-aligned `segments` with `kind: "estimated"` and `detail` tooltip descriptions, `user_messages = initialMessagesEst + allocated.userMessages`, `rows[anchorIdx]` split (`content + thinking` vs non-empty `tool_calls` with no `1`-char floor on empty arrays) only when `latestPlannerIdx > anchorIdx`, and `agent_responses` zero-weight fallback.
        *   **Cumulative counters**: Initialize `exact.cumulativeInputTokens`, `exact.cumulativeCacheReadTokens`, and `exact.cacheInvalidationCount` (including `0` defaults when `latestPlannerIdx === -1`), applying the consecutive non-checkpoint `cacheInvalidationCount` rule.
        *   **`trajectory` (`includeDetails: true`)**: Populate `points` (`stepIndex` from `typeof row.step_index === "number" ? row.step_index : rowIndex`, `totalTurnCount: exact.turnCount`), kind precedence, `activeEpoch` for both `checkpointCount === 0` (`1..N` tagged `"turn"`) and `checkpointCount > 0` (`activeEpoch[0]` tagged `"checkpoint_baseline"`), trailing-checkpoint peak handling, and `> 120` active-epoch cap (`activeEpoch[0]` + last `119`, `isBounded: true`).
        *   **`topTools` (`includeDetails: true`)**: Return `[]` immediately when `toolCallsTokens === 0 || latestPlannerIdx <= anchorIdx`; scan `GENERIC` rows bounded to `j <= latestPlannerIdx` (stopping at `PLANNER_RESPONSE` / `USER_INPUT` / `CHECKPOINT` and skipping `SYSTEM_MESSAGE` / `ERROR_MESSAGE`), apply positional vs `max(1, serializedToolCallChars(tc))` weighting, and tie-break by `name` ascending.
        *   **`scanConversationArtifacts(conversationId, paths)`**: Validate `conversationId` via `isSafeSingleSegment`, perform non-recursive top-level `*.md` scan sorted by `mtimeMs` descending (`{ name, bytes, estTokens, mtimeMs, userFacing, summary }`), read `<name>.metadata.json` (`Boolean(meta.userFacing ?? meta.UserFacing)` with `false` default; `typeof (meta.summary ?? meta.Summary) === "string"` collapsed to single-line whitespace and truncated to 160 chars, `null` default), and aggregate totals across all matching files before slicing top `20`.
        *   When `includeDetails` is `false`, omit `trajectory`, `topTools`, and `artifacts` from `current`.
    5.  **`scanLocalInventory({ workspacePath, mcpRoots, projectId } = {})`**:
        *   Apply `config.json` `plugins[entry.name]?.enabled ?? plugins[pluginJson?.name]?.enabled ?? !pluginJson?.disabled` across MCP, rules, and skills.
        *   Extract a shared `validateWorkspaceDir(candidatePath)` helper (rejecting non-directories, `/`, and `os.homedir()` via `fs.realpathSync`) and export it for `server.mjs`. Resolve workspace in priority order (`workspacePath` -> `projectId` via direct `projects/<projectId>.json` lookup, falling through on missing/invalid `projectId` -> `mcpRoots` with per-URI `url.fileURLToPath` `try/catch`).
        *   Scan workspace rules and skills across `GEMINI.md`, `AGENTS.md`, `.agents`, `.agent`, `_agents`, and `_agent`, deduplicating via `realpathSync` with symlink-escape guards, setting uniform `overPerFileCap` across all rule scopes, sorting `rules.items` by `estTokens` descending then `name` ascending pre-slice, computing `rules` and `mcp` aggregate totals pre-slice, adding `workspace` to `inventory.skills.byScope`, capping `rules.items` (80), `skills.items` (80), and `mcp.servers` (100), and bounding `inspectSkillMetadata` reads to `4 KiB` (no inventory cache).
    6.  **`getContextSnapshot`**: Accept `includeDetails = true` (passing it to `analyzeTranscriptRows` and gating `scanConversationArtifacts`), enforce `isSafeSingleSegment(conversationId)` (setting `requestedConversationFound: false` on invalid IDs without reading outside `brain/`/`annotations/`), implement zero-interactive fallback (`current` picks latest overall, `conversations` returns `[]`), and populate `schemaVersion: 2`, `serviceStatus`, `current.kind`, and `conversations[]` fields (`kind`, `turnCount`, `projectId`, `parentConversationId`).

#### 2. `src/server.mjs` (Modify)

*   **Type / Scope**: MCP stdio server tool registration, capability queries, and response formatting.
*   **Rationale**: Exposes v2 parameters, resolves and conditionally caches MCP `roots/list`, and updates text summaries.
*   **Proposed Changes**:
    1.  Add `resolveMcpRoots(server, { workspacePath } = {})`: validate `workspacePath` with `validateWorkspaceDir` from `src/analyzer.mjs` before deciding to skip; if valid `workspacePath` is absent, check `server.server.getClientCapabilities()?.roots`, call `server.server.listRoots(undefined, { timeout: 250 })` in `try/catch`, unwrap `(res?.roots ?? []).map(r => r.uri)`, and cache the URI list only when non-empty AND `capabilities.roots.listChanged === true` (invalidating on `notifications/roots/list_changed`). Never cache empty results, timeouts, or errors.
    2.  Update `open_context_monitor` and `get_context_snapshot` Zod `inputSchema` to accept `conversationId?`, `workspacePath?`, `includeSubagents?` (plus `limit?` on `get_context_snapshot`), calling `resolveMcpRoots(server, args)` concurrently with `getContextSnapshot` when `validateWorkspaceDir(args?.workspacePath)` is null, passing `includeDetails: false` in `open_context_monitor` and `includeDetails: true` in `get_context_snapshot`.
    3.  Update `formatSummaryText(snapshot)`:
        *   Preserve existing `!cur` and `!cur.hasUsageData` messages (`src/server.mjs` lines 40-46).
        *   On the full summary (`cur && cur.hasUsageData`), add `Tracked conversations: ${snapshot.conversations.length} shown / ${snapshot.totalTrackedConversations} tracked`.
        *   On all three return branches (including `!cur` and `!cur.hasUsageData`), append `\nConversationService: offline (${serviceStatus.reason})` when `serviceStatus && !serviceStatus.reachable` or `\nConversationService: partial (${serviceStatus.enrichedCount} enriched)` when `serviceStatus?.reason === "partial"`.

#### 3. `src/ui/main.js` (Modify)

*   **Type / Scope**: Scoped v0.1.0 side-panel compatibility sync (full v2 UI deferred to Spec 2).
*   **Rationale**: Keeps segment tooltips working after `checkpoint_summary` (the v0.1.0 checkpoint segment ID) is replaced by `checkpoint_buffer` and surfaces workspace skill counts in `skills-scope` (the UI text slot summarizing skill counts by scope).
*   **Proposed Changes**:
    1.  Update tooltip checks in `patchInPlace` and `render` to show and patch segment tooltips whenever `Boolean(seg.detail)` is true, removing the hardcoded `seg.id === "baseline" || seg.id === "checkpoint_summary"` allowlist.
    2.  Update `skills-scope` in `patchInPlace` and `render` to append `, ${skillsInfo.byScope.workspace} workspace` whenever `skillsInfo.byScope?.workspace > 0`, and include `inventory.skills?.byScope` in `computeSnapshotFingerprint`.

#### 4. `src/ui/styles.css` (Modify)

*   **Type / Scope**: Scoped v0.1.0 side-panel CSS compatibility fix.
*   **Rationale**: Prevents `Agent responses` (`colorKey: "amber"`) and `Checkpoint buffer` (`colorKey: "violet"`) from rendering identically in violet.
*   **Proposed Changes**:
    *   Define `--seg-amber: #f59e0b;` once on `:root` alongside the existing `--seg-*` tokens, and split `.swatch-amber, .bar-amber` into their own rule using `background: var(--seg-amber);` instead of `var(--seg-violet)`.

#### 5. `scripts/test-analyzer.mjs` (Create)

*   **Type / Scope**: Pure unit fixture tests for `src/analyzer.mjs` using `node:test`.
*   **Rationale**: Validates v2 analyzer invariants directly in Phase 1A against isolated temporary directories (`fs.mkdtempSync` via `CONTEXT_MONITOR_GEMINI_HOME`, cleaned up in `finally`) without touching `~/.gemini` or starting stdio transports.
*   **Proposed Changes**:
    *   Add unit test suites covering:
        1.  Annotation-gated classification (`interactive`, `subagent` via `parentConversationId`, `background`), `includeSubagents` toggling, zero-interactive fallback, explicit subagent `conversationId` inspection, and `conversationId` path-traversal rejection (`../`, `/`, `\`, null byte).
        2.  CLI breakdown allocation (all 6 segments, zero-weight fallback, `initialMessagesEst` offset, `effectiveCheckpointIdx` trailing-checkpoint handling, `rows[anchorIdx]` inclusion/exclusion), cumulative session counters, and `cacheInvalidationCount`.
        3.  `trajectory` bounding on a 150-turn, 2-checkpoint transcript (`isBounded: true`), on a 150-turn, 0-checkpoint transcript (`isBounded: true`), and on trailing checkpoints.
        4.  `topTools` positional pairing, diverged-batch weighting, non-contiguous `GENERIC` batch scan, exclusion of `GENERIC` rows past `latestPlannerIdx`, and 1-turn empty array handling.
        5.  `scanConversationArtifacts` (`*.md` + `.metadata.json` with camelCase primary and PascalCase fallback, defaults, 160-char summary collapse, top-20 cap).
        6.  `config.json` plugin precedence (`true` over `disabled: true`, `false` over active `plugin.json`), direct `projects/<projectId>.json` resolution + fall-through, and workspace `.agents`/`.agent`/`_agents`/`_agent` rules (`overPerFileCap`, `rules.items` pre-slice sort, symlink escape guard) + skills (`byScope.workspace`).
        7.  `fetchConversationServiceTitles` (`missing_env`, mock HTTP `ok`, page-2 `partial` retention, `http_error`, and `350 ms` timeout).

#### 6. `scripts/test-server.mjs` (Modify)

*   **Type / Scope**: Live MCP stdio integration tests against `dist/server.mjs`.
*   **Rationale**: Validates compiled MCP tool schemas, payload budgets, `open_context_monitor` vs `get_context_snapshot` detail isolation, and real MCP SDK `roots/list` timeout/invalidation in Phase 1B.
*   **Proposed Changes**:
    1.  Keep existing checks for `open_context_monitor`, `get_context_snapshot`, and `ui://context-monitor/app.html`, asserting `schemaVersion === 2` and `< 1 MiB` byte limit on both `structuredContent` and full serialized `CallToolResult`.
    2.  When `snap.current?.hasUsageData` is true, assert segment/percentage sum invariants, confirm `open_context_monitor` omits `current.trajectory`, `current.topTools`, and `current.artifacts`, and confirm `get_context_snapshot` populates them.
    3.  Add a dedicated stdio `Client` test advertising `capabilities: { roots: { listChanged: true } }` with a mock `ListRootsRequestSchema` handler verifying: (a) fast `roots/list` resolution and `listChanged` caching, (b) `notifications/roots/list_changed` invalidation, and (c) `> 250 ms` delayed response falling back to `[]` without caching the timeout.

#### 7. `package.json` (Modify)

*   **Type / Scope**: Test runner script update (version stays `"0.1.0"`).
*   **Rationale**: Runs pure `node:test` analyzer suites before live compiled stdio integration tests.
*   **Proposed Changes**:
    *   Update `"scripts.test"` to `"node --test scripts/test-analyzer.mjs && node scripts/test-server.mjs"`, leaving `"version": "0.1.0"` unchanged.

#### 8. `README.md` (Modify)

*   **Type / Scope**: Plugin documentation.
*   **Rationale**: Documents v2 metrics, CLI-aligned categories, workspace discovery inputs, and runtime sync exclusions.
*   **Proposed Changes**:
    *   Update `"What it reads"` and `"Exact metrics vs local estimates"` for workspace `.agents/` discovery, `config.json` plugin precedence, conversation artifacts, trajectories, and tool attribution.
    *   Update `"Install into Antigravity"` to specify syncing only `dist/`, `plugin.json`, `mcp_config.json`, `assets/`, and `README.md` (excluding `docs/`, `src/`, `scripts/`, and `node_modules/`).

### Generated Build Outputs (Rebuilt via `npm run build`)

*   **Type / Scope**: Bundled runtime artifacts (`dist/server.mjs`, `dist/app.html`).
*   **Rationale**: Emitted automatically by `scripts/build.mjs` from `src/`; excluded from manual editing.

### Phased Execution Sequence

1.  **Phase 1A (Analyzer v2 & Unit Fixture Verification)**: Update `src/analyzer.mjs`, create `scripts/test-analyzer.mjs`, and verify all pure analyzer and inventory invariants via `node --test scripts/test-analyzer.mjs`.
2.  **Phase 1B (MCP Server v2, UI/CSS Compatibility, Build & Stdio Integration)**: Update `src/server.mjs`, `src/ui/main.js`, `src/ui/styles.css`, `scripts/test-server.mjs`, `package.json`, and `README.md`; run `npm run build && npm test && agy plugin validate . --strict`.

### Verification Plan

*   **Phase 1A Unit Tests**: `node --test scripts/test-analyzer.mjs` in the repository root exits 0.
*   **Compilation / Build**: `npm run build` exits 0 and emits `dist/app.html` and `dist/server.mjs`.
*   **Full Test Suite**: `npm test` exits 0, passing both `scripts/test-analyzer.mjs` and `scripts/test-server.mjs` (confirming `structuredContent` and full serialized `CallToolResult` payloads stay `< 1 MiB`, `roots/list` timeout/invalidation works, and every segment/percentage sum invariant holds).
*   **Static Validation**: `agy plugin validate . --strict` passes with zero errors.
*   **Sync Safety (Pre-Sync Diff Gate)**: Show `git status` / diffs and explicit sync commands (copying `dist/`, `plugin.json`, `mcp_config.json`, `assets/`, `README.md` while excluding `docs/`, `src/`, `scripts/`, `node_modules/`) to the user before updating `~/.gemini/config/plugins/context-monitor/` and refreshing `context-monitor_context-monitor`.
