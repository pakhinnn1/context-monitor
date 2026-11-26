# Context Monitor v0.2: Metrics and Inventory v2

*   **Author:** pakhinnn1
*   **Status:** Proposed
*   **Date:** 2026-11-27

--------------------------------------------------------------------------------

## Overview

This specification defines the v0.2 analyzer engine and MCP `structuredContent` contract for the local Antigravity Context Monitor plugin (this repository). It upgrades `src/analyzer.mjs` and `src/server.mjs` to align Context Monitor's breakdown and inventory as closely as possible with Antigravity CLI `/context` using verifiable local disk files.

Specifically, v0.2 adds subagent and background worker filtering with an opt-in show-all toggle, CLI-aligned prompt breakdown categories (`User messages`, `Agent responses`, `Tool calls`, `System and baseline`, `Checkpoint buffer`, and `Free space`), disk-discoverable conversation artifact files, bounded per-turn context trajectories with compaction markers, top tool-call contributor attribution, cumulative session input/cache counters, true plugin `enabled` precedence from `~/.gemini/config/config.json`, and active workspace rules and skills discovery.

The v2 schema locks the server contract before Spec 2 (`docs/designs/global_workspace_ux.md`) builds the wide global sidebar workspace. All v0.1.1 payload fields remain populated and backwards-compatible so the existing side-panel UI continues to render without breakage during the transition.

## The Problem

Context Monitor v0.1.1 reads local transcripts under `~/.gemini/antigravity/brain/` and renders an accurate single-turn snapshot, but five analyzer and inventory blind spots separate it from CLI `/context` on real workloads:

1.  **Subagents and background workers flood the thread selector.** Of 499 tracked transcripts on disk, 393 lack `annotations/<id>.pbtxt` files (150 link to parent transcripts via `invoke_subagent` outputs, 204 are unlinked single-prompt workflow/background transcripts, and 44 have zero `USER_INPUT` rows). Because v0.1.1 lists the most recently modified `transcript.jsonl` files indiscriminately, isolated subagent and worker prompts push interactive conversations out of the top list.
2.  **`ConversationService` enrichment silently returns empty data inside the MCP server.** `fetchConversationServiceTitles` in `src/analyzer.mjs` reads `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN`. While `ListConversations` succeeds from agent shell commands with header `x-antigravity-csrf-token` and returns `projectId`, `rootConversationId`, `parentConversationId`, and `runState`, Antigravity does not guarantee those variables in standalone stdio MCP server subprocesses. The analyzer lacks a disk-first thread classifier and optional non-blocking service status handling.
3.  **Single-turn snapshots lack CLI-aligned breakdown, artifact visibility, trajectory, and tool attribution.** v0.1.1 merges user prompts and agent replies into one `Messages` bucket and omits disk-discoverable conversation artifacts (`~/.gemini/antigravity/brain/<id>/*.md`). Users also cannot inspect turn-by-turn prompt growth around compaction `CHECKPOINT` events, see which tools contributed the largest outputs, or track cumulative session input and cache-invalidation counters. Long conversations already reach 133 turns (6 local threads exceed 100 turns), risking trajectory payloads that breach the 1 MiB Antigravity `CallToolResult` cap if left unbounded.
4.  **Local inventory misreports plugin state and misses workspace customizations.** `scanLocalInventory` checks only `plugin.json`'s `disabled` flag and ignores `~/.gemini/config/config.json` (`plugins.<dirName>.enabled`), which Antigravity treats as higher precedence. It also scans only global (`~/.gemini/config/`), plugin, and built-in directories, reporting 0 global skills while omitting active workspace rules (`AGENTS.md`, `GEMINI.md`, `.agents/rules/*.md`) and skills (`.agents/skills/*/SKILL.md` — for example, 35 skills in `<workspace>/.agents/skills/`).
5.  **No scalable query contract exists for 495+ threads.** `get_context_snapshot` slices the top `limit` (default 35, max 100) transcripts without filtering, search, or fleet-level aggregates, forcing Spec 2's global workspace to either pull oversized payloads or lack fleet visibility.

## Goals

*   **G1 — Deterministic disk-first thread list filtering:** Filter subagents and background workers out of the default interactive thread list without requiring `ConversationService`, while supporting an opt-in filter to show all threads.
*   **G2 — CLI `/context`-aligned breakdown and disk-discoverable artifacts:** Align prompt breakdown categories with Antigravity CLI `/context` (`User messages`, `Agent responses`, `Tool calls`, `System and baseline`, `Checkpoint buffer`, and `Free space`), and surface disk-discoverable conversation artifact files (`~/.gemini/antigravity/brain/<id>/*.md`) alongside system and workspace rule files.
*   **G3 — Bounded per-turn trajectory and top tool-call attribution:** Expose per-turn prompt growth with `CHECKPOINT` markers, ranked top tool-call contributors, and cumulative session input/cache-read/cache-invalidation counters while keeping every `open_context_monitor` `CallToolResult` strictly under 1 MiB (target `< 256 KiB` typical).
*   **G4 — Accurate local and workspace inventory:** Respect `~/.gemini/config/config.json` plugin `enabled` precedence over `plugin.json` and discover active workspace rules and skills (`AGENTS.md`, `GEMINI.md`, `.agents/rules/*.md`, `.agents/skills/*/SKILL.md`) under a `workspace` scope.
*   **G5 — Backwards-compatible MCP schema v2 and fleet query surface:** Preserve all v0.1.1 `structuredContent` fields and invariants (`sum(segments.tokens) === exact.activeTokens` and `sum(segments.percent) + exact.freePercent === 100.0`) while adding v2 fields and fleet search/filter/pagination support for Spec 2.
*   **G6 — Optional, non-blocking `ConversationService` enrichment:** Enrich titles, `runState`, `projectId`, and top-level thread metadata whenever `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN` are available, with zero user-facing errors and bounded latency when unavailable.

## Non-Goals

*   **NG1 — Parent-child subagent token rollup:** Subagents run in isolated context windows and do not consume the parent thread's context window; Spec 1 filters subagents from the default thread list rather than aggregating child token spend onto parent threads.
*   **NG2 — Burn rate and estimated turns remaining:** Spec 1 does not forecast future turns remaining or compute token burn-rate projections.
*   **NG3 — Mid-thread model switch history:** Spec 1 continues resolving the active thread model from the latest planner turn and does not emit a mid-thread model switch timeline.
*   **NG4 — Global workspace UI, CSS, or host UX actions:** Container-query two-column layout, SVG chart rendering, search rail UI, keyboard shortcuts, `updateModelContext`, `toggle-aux-pane`, and follow-latest pin UI belong to Spec 2 (`docs/designs/global_workspace_ux.md`).
*   **NG5 — Probing undocumented host services or bypassing environment boundaries:** The MCP server will not scan OS process tables, scrape host internals, or read undocumented sockets to obtain `ANTIGRAVITY_CSRF_TOKEN`.
*   **NG6 — Exact third-party tokenizer libraries:** Category breakdowns, tool attribution shares, artifact byte estimates, and rule/skill inventory sizes remain honest local estimates derived from disk files and transcript character shares anchored to exact `PLANNER_RESPONSE` token counters.
*   **NG7 — Editing or mutating Antigravity transcripts, annotations, or configs:** All Context Monitor MCP tools remain strictly read-only (`readOnlyHint: true`).
*   **NG8 — Syncing `docs/` into the installed plugin directory:** Design specifications live only under `docs/designs/` and are excluded when syncing runtime bundles to `~/.gemini/config/plugins/context-monitor/`.

## Open Questions

None. All four architectural questions were resolved before drafting the Technical Plan:

*   Thread filtering uses annotation-gated interactive classification (`annotations/<id>.pbtxt` or `ConversationService`), hiding `subagent` and `background` threads by default with an opt-in filter.
*   Prompt breakdown replaces `segments` in place with CLI-aligned identifiers (`baseline`, `tool_calls`, `user_messages`, `agent_responses`, `checkpoint_buffer`, and optional `system_messages`).
*   Per-turn trajectory bounds long sessions to the active post-checkpoint epoch (max 120 turns) plus milestone peaks and baselines for earlier checkpoints.
*   Workspace discovery uses explicit `workspacePath`, MCP `roots/list`, and `ConversationService` `projectId` mapped via `~/.gemini/config/projects/*.json`, while fleet search and pagination live on a dedicated app-only `list_conversations` tool.

## Critical User Journeys (CUJs)

### CUJ 1: Inspect Interactive Threads Without Subagent Noise (Opt-In Show All)

*   **Given:** 499 local transcripts exist under `~/.gemini/antigravity/brain/`, including 106 annotated interactive threads, 150 linked `invoke_subagent` children, and 248 other unannotated transcripts, and `ConversationService` env vars are unset in the MCP server process.
*   **When:** The user or host launches `open_context_monitor` with `{}` (default interactive filter) and later toggles the opt-in show-all filter.
*   **Then:** By default, the server selects the most recently updated interactive thread and omits subagents and background workers from the thread list; when the opt-in filter is enabled, subagent and background threads appear with a clear classification badge, all within a valid v0.1.1-compatible payload under 1 MiB.

### CUJ 2: Inspect CLI-Aligned Breakdown, Artifacts, Trajectory, and Top Tool Contributors

*   **Given:** A selected conversation has 100+ planner turns, at least one compaction `CHECKPOINT`, tool calls producing `GENERIC` outputs, and markdown artifact files under `~/.gemini/antigravity/brain/<id>/`.
*   **When:** The UI calls `get_context_snapshot` for that `conversationId`.
*   **Then:** `current` exposes CLI-aligned breakdown segments (`User messages`, `Agent responses`, `Tool calls`, `System and baseline`, `Checkpoint buffer`, and `Free space` while preserving `sum(segments.tokens) === exact.activeTokens` and `sum(segments.percent) + exact.freePercent === 100.0`), disk-discoverable artifact metadata, a bounded per-turn trajectory array retaining all compaction points, ranked top tool contributors by attributed token share, and cumulative session input/cache counters.

### CUJ 3: Audit Active Workspace Rules, Skills, and True Plugin Enablement

*   **Given:** One installed plugin has `"enabled": false` in `~/.gemini/config/config.json` (while its `plugin.json` has no `disabled` field), another plugin ships `"disabled": true` in `plugin.json` but has `"enabled": true` in `config.json`, and the active workspace contains `AGENTS.md` and 35 skills under `.agents/skills/`.
*   **When:** The analyzer runs `scanLocalInventory` with resolved workspace context.
*   **Then:** Plugin active status follows `config.json` over `plugin.json` across MCP servers, rules, and skills; workspace rules and skills appear with `scope: "workspace"` and accurate `byScope.workspace` counts alongside `global`, `plugin`, and `builtin`.

### CUJ 4: Optional `ConversationService` Enrichment Without Fragility

*   **Given:** The MCP server runs either with valid `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN` env vars or without them (or with a timed-out/unreachable endpoint).
*   **When:** `getContextSnapshot` executes.
*   **Then:** When reachable, `ListConversations` enriches conversation titles, `runState`, `projectId`, and interactive classification within a bounded timeout; when unset or unreachable, the analyzer skips or times out cleanly without raising errors, reporting service reachability metadata so callers know enrichment was offline.

## Technical Plan (Architecture)

### System Data Flow

Context Monitor v0.2 keeps `~/.gemini/antigravity/` and `~/.gemini/config/` on local disk as the authoritative data plane, treating `ConversationService` and MCP `roots/list` as bounded optional enrichment signals.

```text
Local Disk Sources                         Optional Host Signals
──────────────────                         ─────────────────────
~/.gemini/antigravity/brain/<id>/          ANTIGRAVITY_LS_ADDRESS + CSRF_TOKEN
  ├── .system_generated/logs/transcript*     └─► ConversationService (350ms cap)
  └── *.md (+ *.md.metadata.json)          MCP Client roots/list (250ms cap)
~/.gemini/antigravity/annotations/*.pbtxt  Explicit tool args (workspacePath, etc.)
~/.gemini/config/config.json                       │
~/.gemini/config/projects/*.json                   │
~/.gemini/config/plugins/* & mcp/*                 ▼
<workspace>/{AGENTS.md,GEMINI.md,.agents/} ──► src/analyzer.mjs (v2)
                                                   │
                                                   ▼
                                           src/server.mjs (MCP Tools)
                                             ├── open_context_monitor (default UI + 35 threads)
                                             ├── get_context_snapshot (app-only single-thread refresh)
                                             └── list_conversations   (app-only fleet search/paging)
```

### 1. Thread Discovery and Annotation-Gated Classification

Every tracked directory under `~/.gemini/antigravity/brain/<id>/` with a non-empty `.system_generated/logs/transcript.jsonl` is indexed into `summaryCache` keyed by `mtimeMs`. Each entry also extracts any spawned child UUIDs (`Created the following subagent:` / `conversationId` UUID regex) during its single-pass line scan so the parent-to-child link set (`linkedChildIds`) is built in memory without a second file read.

Classification assigns `kind` in strict precedence order:

1.  `"subagent"`: `linkedChildIds.has(conversationId)` OR `serviceInfo?.parentConversationId` is non-empty.
2.  `"interactive"`: an `annotations/<conversationId>.pbtxt` file exists on disk OR `serviceInfo` returned the thread from `ListConversations({ includeArchived: false })` without a parent.
3.  `"background"`: all remaining unlinked, unannotated transcripts (workflow workers, zero-user-input agent sessions, and unannotated cron runs).

Default selection and list behavior:

*   `open_context_monitor` and `get_context_snapshot` default `includeSubagents` to `false`, filtering `conversations` and default `selectedEntry` selection to `kind === "interactive"` (falling back to the latest transcript overall only when zero interactive transcripts exist).
*   If the caller passes an explicit `conversationId`, `selectedEntry` resolves that exact transcript even when `kind !== "interactive"`, so direct inspection of any subagent or background thread still works.

### 2. Optional, Non-Blocking `ConversationService` Enrichment

`fetchConversationServiceTitles` checks `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN`. When either is absent, it returns `{ map: new Map(), status: { reachable: false, reason: "missing_env", enrichedCount: 0 } }` immediately with zero network I/O.

When both env vars are present, it queries `POST http://${ANTIGRAVITY_LS_ADDRESS}/product.v1.ConversationService/ListConversations` with headers `Content-Type: application/json`, `Connect-Protocol-Version: 1`, and `x-antigravity-csrf-token: ${ANTIGRAVITY_CSRF_TOKEN}`, fetching up to 2 pages (`pageSize: 100`, total 200 recent conversations) within a shared `350ms` `AbortController` deadline.

*   Each entry stores `{ title, runState, updateTime, projectId, parentConversationId, rootConversationId }`.
*   HTTP failures map to `reason: "http_error"`, aborts/network errors map to `reason: "timeout_or_network"`, and successes map to `reason: "ok"`. None throw or inject error banners into the UI.

### 3. CLI-Aligned Breakdown (`segments`) and Cumulative Session Counters

`analyzeTranscriptRows` replaces v0.1.1 segment identifiers in place on `current.segments` while keeping the exact schema object shape `{ id, label, tokens, percent, colorKey, kind, detail }` and preserving both v0.1.1 invariants (`sum(segments.tokens) === exact.activeTokens`, and `sum(segments.percent) + exact.freePercent === 100.0` via `allocatePercentageTenths`):

| Segment ID | Label | Color Key | Character / Token Attribution Source |
| :--- | :--- | :--- | :--- |
| `baseline` | `System and baseline` | `blue` | `turn1Baseline` clamped to `activeTokens` (or `postCpTotal`) |
| `tool_calls` | `Tool calls` | `orange` | Post-anchor `GENERIC` row chars + `PLANNER_RESPONSE.tool_calls` JSON chars |
| `user_messages` | `User messages` | `green` | `firstUserEst` (when no checkpoint) + post-anchor `USER_INPUT` row chars |
| `agent_responses` | `Agent responses` | `amber` | Post-anchor `PLANNER_RESPONSE` `content` + `thinking` chars (excluding `tool_calls`) |
| `checkpoint_buffer` | `Checkpoint buffer` | `violet` | `postCpTotal - baselineEst` (emitted only when `> 0`) |
| `system_messages` | `System messages` | `slate` | Post-anchor `SYSTEM_MESSAGE` + `ERROR_MESSAGE` row chars (emitted only when `> 0`) |

Anchor and allocation rules:

*   `firstUserEst` and `turn1Baseline` follow the existing Turn 1 clamp (`Math.min(firstUserRawEst, Math.floor(firstTotal * 0.6))`).
*   When `lastCheckpointIdx >= 0`, `anchorIdx` is the first token-bearing `PLANNER_RESPONSE` after `lastCheckpointIdx` (or `lastCheckpointIdx` if none), and `checkpointBufferEst = Math.max(0, postCpTotal - baselineEst)` clamped to `activeTokens - baselineEst`.
*   Post-anchor delta tokens (`activeTokens - anchorTotal`) are distributed across `{ toolCalls, userMessages, agentResponses, systemMessages }` via `allocateProportionally`.
*   `exact` adds three cumulative session counters summed across all token-bearing `PLANNER_RESPONSE` rows in the transcript:
    *   `cumulativeInputTokens`: sum of `input_tokens`
    *   `cumulativeCacheReadTokens`: sum of `cache_read_tokens`
    *   `cacheInvalidationCount`: count of planner turns after Turn 1 where `cache_read_tokens === 0` after a previous turn had `cache_read_tokens > 0`, or where `cache_read_tokens` drops by `>= 50%` between consecutive planner turns without an intervening `CHECKPOINT`.

### 4. Bounded Per-Turn Context Trajectory (`trajectory`)

`current.trajectory` exposes `{ points, totalTurnCount, checkpointCount, isBounded }`, where each entry in `points` has shape:

```text
{ turn, stepIndex, activeTokens, inputTokens, cacheReadTokens, outputTokens, kind, createdAt }
```

`kind` is `"turn" | "checkpoint_peak" | "checkpoint_baseline"`. Bounding algorithm:

1.  Collect all token-bearing `PLANNER_RESPONSE` turns (`1..N`) and `CHECKPOINT` indices.
2.  If `checkpointCount > 0`, split into epochs separated by `CHECKPOINT` rows:
    *   Always include Turn 1 (`kind: "turn"`) if not already represented.
    *   For every `CHECKPOINT` prior to the active epoch, emit its pre-checkpoint peak (last planner turn before the checkpoint, `kind: "checkpoint_peak"`) and its post-checkpoint baseline (first planner turn after the checkpoint, `kind: "checkpoint_baseline"`), deduplicated by `turn`.
    *   Active epoch starts at the first planner turn after `lastCheckpointIdx`.
3.  If `checkpointCount === 0`, the active epoch is turns `1..N`.
4.  Bound the active epoch to at most `120` entries: if `activeEpoch.length <= 120`, emit all of them; otherwise set `isBounded = true` and keep `activeEpoch[0]` plus the last `119` entries (`activeEpoch.slice(-119)`).

### 5. Top Tool-Call Contributor Attribution (`topTools`)

`current.topTools` ranks the tools driving the `tool_calls` segment inside the active context window (from `anchorIdx` to `latestPlannerIdx`, plus total `calls` in that window):

1.  For each `PLANNER_RESPONSE` row `i` in `[anchorIdx, latestPlannerIdx]` with `Array.isArray(row.tool_calls)` and `row.tool_calls.length > 0`, collect the immediately following contiguous `GENERIC` rows (`j = i + 1` while `rows[j]?.type === "GENERIC"`).
2.  If `tool_calls.length === genericRows.length`, pair positionally: tool `k` receives `estimateRowChars(genericRows[k]) + serializedToolCallChars(tool_calls[k])`.
3.  If lengths diverge, sum `estimateRowChars` across `genericRows` in that batch and allocate proportionally across `tool_calls` by `Math.max(1, serializedToolCallChars(tc))`, adding each call's own serialized length.
4.  Aggregate raw weighted chars by `tc.name || "unknown"`, allocate `toolCallsTokens` across tool names with `allocateProportionally`, compute `sharePercent` (`toolCallsTokens > 0 ? Math.round((tokens / toolCallsTokens) * 1000) / 10 : 0`), sort descending by `estTokens` then `calls`, and return the top `10` entries `{ name, calls, estTokens, sharePercent }`.

### 6. Disk-Discoverable Conversation Artifacts (`current.artifacts`)

For the selected `conversationId`, scan `~/.gemini/antigravity/brain/<conversationId>/` non-recursively for regular `.md` files (ignoring `scratch/`, hidden directories, and `*.metadata.json`). For each markdown file:

*   Read `stat.size` (`bytes`), `mtimeMs`, and optional sibling `<filename>.metadata.json` (`UserFacing` -> `userFacing`, `Summary` -> `summary` normalized to single-line max 160 chars).
*   Estimate `estTokens = Math.round(bytes / 4)`.
*   Sort by `mtimeMs` descending and return `{ count, totalBytes, totalEstTokens, items: items.slice(0, 20) }`.

### 7. True Plugin Precedence, Workspace Discovery, and Inventory (`inventory`)

`scanLocalInventory({ workspacePath, mcpRoots, projectId })` resolves plugin enablement and active workspace customizations as follows:

1.  **Plugin enablement precedence**: Parse `~/.gemini/config/config.json` (`plugins` map). A plugin directory `entry.name` is active iff `typeof configJson?.plugins?.[entry.name]?.enabled === "boolean" ? configJson.plugins[entry.name].enabled : !pluginJson?.disabled`. Apply this check consistently across MCP servers, plugin rules, and plugin skills.
2.  **Workspace resolution**: Resolve at most one active `workspaceRoot` in priority order:
    *   `workspacePath` argument (validated via `fs.realpathSync` to be an existing directory, `source: "arg"`).
    *   First valid `file://` URI from MCP `roots/list` (queried only if `server.server.getClientCapabilities()?.roots` is truthy, bounded by a `250ms` timeout, `source: "mcp_roots"`).
    *   `projectId` from `ConversationService` for the selected conversation matched against `~/.gemini/config/projects/*.json` (`projectResources.resources[].gitFolder.folderUri`, `source: "project_id"`).
    *   Otherwise `workspace = { path: null, source: "none" }`.
3.  **Workspace rules and skills scanning**: When `workspace.path` resolves, inspect:
    *   Root rule files `GEMINI.md` and `AGENTS.md` directly inside `workspace.path`.
    *   Customization directories `.agents`, `.agent`, `_agents`, `_agent` inside `workspace.path`: `rules/*.md` and `skills/*/SKILL.md`.
    *   Deduplicate rules by `fs.realpathSync(filePath)` and tag with `scope: "workspace"`. Include `bytes`, `estTokens`, and `overPerFileCap: bytes > 24_000` (matching Antigravity's 24,000-byte per-file rule limit).
    *   Extend `inventory.skills.byScope` to `{ workspace, plugin, global, builtin }` and return `inventory.workspace`.

### 8. MCP Tool Surface and Fleet Pagination (`src/server.mjs`)

| Tool Name | Visibility | Input Parameters | Output Purpose |
| :--- | :--- | :--- | :--- |
| `open_context_monitor` | `["model", "app"]` | `conversationId?`, `workspacePath?`, `includeSubagents?` | Primary UI entrypoint (`aux_pane` + `global`). Returns `schemaVersion: 2`, `serviceStatus`, `fleet`, `current`, `conversations` (top 35), `inventory`. |
| `get_context_snapshot` | `["app"]` | `conversationId?`, `workspacePath?`, `includeSubagents?`, `limit?` (`1..100`, def `35`) | Single-thread refresh and thread switching without re-emitting model-visible trajectory steps. |
| `list_conversations` | `["app"]` | `query?`, `filter?` (`"interactive" \| "all" \| "high_usage" \| "checkpointed"`), `includeSubagents?`, `offset?`, `limit?` (`1..100`, def `50`) | Fleet search and pagination across all tracked local transcripts, returning `{ totalMatching, offset, limit, hasMore, fleet, conversations }`. |

`fleet` summary object included on all three responses:

```text
{
  totalTracked: number,
  interactiveCount: number,
  subagentCount: number,
  backgroundCount: number,
  highUsageInteractiveCount: number,   // interactive threads with usedPercent >= 70
  checkpointedInteractiveCount: number // interactive threads with checkpointCount > 0
}
```

Payload budget verification: `open_context_monitor` keeps `conversations` at 35 items, `trajectory.points` capped at 120 active-epoch points + earlier checkpoint pairs, `topTools` at 10, `artifacts.items` at 20, and `skills.items` at 80, keeping typical `structuredContent` responses well below 150 KiB and strictly under the 1 MiB `CallToolResult` cap.

## Alternatives Considered

### Alternative A: Heuristic Multi-Turn or Exclude-Only Thread Filtering

*   **Pros**: Surfaces untitled multi-turn or first-turn interactive sessions immediately when `ConversationService` is offline and annotations have not yet flushed to disk.
*   **Cons**: Leaks unannotated background sessions (`15` multi-turn background threads or `204` single-prompt workflow workers observed in the `499`-transcript corpus) into the default interactive selector.
*   **Reason for Rejection**: Rejected by author: annotation-gated interactive classification (`annotations/<id>.pbtxt` or `ConversationService`) keeps workflow and background worker noise out of the default list while preserving an opt-in show-all toggle and explicit `conversationId` inspection.

### Alternative B: Parallel `cliBreakdown` Array Alongside v0.1.1 `segments`

*   **Pros**: Leaves `current.segments` identifiers untouched for legacy v0.1.1 UI code.
*   **Cons**: Duplicates category objects in every `structuredContent` payload and forces UI consumers and contract tests to maintain two slightly different prompt decompositions.
*   **Reason for Rejection**: Rejected by author: replacing `segments` in place with CLI-aligned identifiers (`baseline`, `tool_calls`, `user_messages`, `agent_responses`, `checkpoint_buffer`, `system_messages`) eliminates schema duplication while maintaining exact `activeTokens` and `100.0%` rounding invariants.

### Alternative C: Full-Session Downsampling (200 Points) or Sliding 100-Turn Trajectory

*   **Pros**: Downsampling retains older intermediate shapes up to 200 entries; a 100-turn sliding window requires only simple array slicing.
*   **Cons**: Downsampling introduces uneven bucket intervals across older epochs, while a 100-turn sliding window drops Turn 1 and pre-checkpoint history on long sessions (`133` turns observed).
*   **Reason for Rejection**: Rejected by author: emitting the active post-checkpoint epoch (capped at 120 turns) plus explicit `checkpoint_peak` and `checkpoint_baseline` milestone pairs for earlier checkpoints preserves complete granularity in the active window and compaction boundaries within a tight payload budget.

### Alternative D: Transcript Path-Scraping Fallback or Server `cwd` Walk for Workspace Discovery

*   **Pros**: Attempts workspace resolution even when MCP `roots/list` and `ConversationService` are both unavailable.
*   **Cons**: Scraping file paths from transcripts misattributes the workspace when a thread touches multiple repositories, and walking `process.cwd()` fails whenever Antigravity launches the global plugin MCP server from `HOME` or the plugin folder.
*   **Reason for Rejection**: Rejected by author: resolving the workspace exclusively from explicit `workspacePath`, MCP `roots/list`, and `ConversationService` `projectId` mappings under `~/.gemini/config/projects/*.json` avoids heuristic misattribution.

### Alternative E: Extending `get_context_snapshot` or Returning All Summaries Upfront for Fleet Search

*   **Pros**: Preserves a two-tool MCP surface or eliminates server-side pagination logic.
*   **Cons**: Returning all `499+` summaries upfront grows `CallToolResult` size linearly with history toward the 1 MiB host limit, while overloading `get_context_snapshot` mixes single-thread analysis with search and offset pagination.
*   **Reason for Rejection**: Rejected by author: adding a dedicated app-only `list_conversations` tool separates paginated fleet queries from single-thread inspection and keeps `open_context_monitor` trajectory payloads compact.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Performance & Latency**: Indexing `499+` local transcripts must reuse `summaryCache` keyed by `mtimeMs` so repeated polls and `list_conversations` queries only parse newly modified transcripts. Optional `ConversationService` requests are bounded to `350ms` total and MCP `roots/list` requests to `250ms` so tool calls remain responsive when offline.
*   **Payload Size & Compatibility**: Every `CallToolResult` payload from `open_context_monitor` must stay strictly below `1 MiB` (target `< 256 KiB` typical). All v0.1.1 top-level fields (`generatedAt`, `totalTrackedConversations`, `selectedConversationId`, `requestedConversationFound`, `current`, `conversations`, `inventory`) and rounding invariants remain intact.
*   **Security & Privacy**: All MCP tools remain strictly read-only (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`). The server never scrapes OS process tables or undocumented host sockets, never exposes raw `ANTIGRAVITY_CSRF_TOKEN` values in tool output, and validates `workspacePath` via `fs.realpathSync` before scanning.
*   **Rollout & Rollback**: Changes ship first to the source repository and are built and verified via `npm run build && npm test && agy plugin validate . --strict` before syncing runtime files (`dist/`, `plugin.json`, `mcp_config.json`, `assets/`, `README.md`, excluding `docs/`) to `~/.gemini/config/plugins/context-monitor/`. Rolling back restores the prior `dist/` bundle and restarts `context-monitor_context-monitor`.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Required Skills for Execution Session

Load these skills at the start of the implementation session before editing any code:

1.  `mcp-app-development` (tool visibility, `structuredContent` 1 MiB cap, MCP server lifecycle, and plugin refresh command)
2.  `agy-customizations` (workspace `.agents/` discovery rules, 24,000-byte per-file rule cap, `config.json` plugin precedence)
3.  `conversations` (`ConversationService/ListConversations` Connect HTTP+JSON schema and headers)
4.  `modern-web-guidance` (mandatory before editing `src/ui/main.js`)

### Target Files to Modify

#### 1. `src/analyzer.mjs` (Modify)

*   **Type / Scope**: Core local transcript analyzer, workspace/plugin inventory scanner, and fleet index engine.
*   **Rationale**: Implements v2 classification, CLI-aligned `segments`, `trajectory`, `topTools`, `artifacts`, cumulative session counters, `listConversations`, `ConversationService` status reporting, `config.json` plugin enablement precedence, and workspace customization scanning.
*   **Proposed Changes**:
    1.  **Configurable path roots for testing**: Resolve `GEMINI_HOME` from `process.env.CONTEXT_MONITOR_GEMINI_HOME || path.join(os.homedir(), ".gemini")` inside a `resolvePaths(overrides)` helper so unit and stdio tests can run against isolated fixture directories without touching `~/.gemini`.
    2.  **`fetchConversationServiceTitles(maxCount = 200)`**:
        *   Return `{ map: new Map(), status: { reachable: false, reason: "missing_env", enrichedCount: 0 } }` when `ANTIGRAVITY_LS_ADDRESS` or `ANTIGRAVITY_CSRF_TOKEN` is missing.
        *   Otherwise fetch up to 2 pages (`pageSize: 100`, passing `nextPageToken` once) of `POST http://${lsAddress}/product.v1.ConversationService/ListConversations` (`includeArchived: false`) within a single shared `350ms` `AbortController` deadline, using `x-antigravity-csrf-token`.
        *   Store `{ title, runState, updateTime, projectId, parentConversationId, rootConversationId }` per conversation ID. Map non-OK responses to `reason: "http_error"`, aborts/throws to `reason: "timeout_or_network"`, and successes to `reason: "ok"`.
    3.  **Annotation + subagent link index + `summarizeConversationFast`**:
        *   Cache per-transcript parsed fast summary in `summaryCache` keyed by `mtimeMs`, additionally extracting: `hasUserInput` (`boolean`), `childConversationIds` (`string[]` matched from `GENERIC` rows containing `Created the following subagent:` or `"conversationId"` UUIDs), and `turnCount`.
        *   Across all indexed transcripts, build `linkedChildIds` (`Set<string>`) from every cached `childConversationIds` list plus any `serviceMap` entry with a non-empty `parentConversationId`.
        *   Assign `kind`: `"subagent"` if in `linkedChildIds`; else `"interactive"` if `annotations/<id>.pbtxt` exists OR `serviceInfo` is present without a parent; else `"background"`.
        *   Compute `fleet` counters across the full corpus: `{ totalTracked, interactiveCount, subagentCount, backgroundCount, highUsageInteractiveCount, checkpointedInteractiveCount }` (`highUsageInteractiveCount`: `kind === "interactive" && usedPercent !== null && usedPercent >= 70`; `checkpointedInteractiveCount`: `kind === "interactive" && checkpointCount > 0`).
    4.  **`analyzeTranscriptRows` CLI breakdown, cumulative counters, trajectory, topTools, and artifacts**:
        *   Export `analyzeTranscriptRows` and `scanLocalInventory` for direct unit fixture tests.
        *   Replace `segments` IDs and labels with CLI-aligned buckets: `baseline` (`System and baseline`, `blue`), `tool_calls` (`Tool calls`, `orange`), `user_messages` (`User messages`, `green`), `agent_responses` (`Agent responses`, `amber`), optional `checkpoint_buffer` (`Checkpoint buffer`, `violet` when `> 0`), and optional `system_messages` (`System messages`, `slate` when `> 0`).
        *   Compute post-anchor weights separately across `toolCalls` (`GENERIC` chars + serialized `PLANNER_RESPONSE.tool_calls` chars), `userMessages` (`USER_INPUT` chars), `agentResponses` (`PLANNER_RESPONSE` `content` + `thinking` chars excluding `tool_calls`), and `systemMessages` (`SYSTEM_MESSAGE` + `ERROR_MESSAGE` chars). Allocate `deltaTokens` via `allocateProportionally` and segment/free tenths via `allocatePercentageTenths`.
        *   Add `cumulativeInputTokens`, `cumulativeCacheReadTokens`, and `cacheInvalidationCount` to `exact`. Increment `cacheInvalidationCount` on planner turn `t > 0` when `prevCacheRead > 0 && curCacheRead === 0`, or when there was no `CHECKPOINT` between `t - 1` and `t` and `curCacheRead < prevCacheRead * 0.5`.
        *   Build `trajectory: { points, totalTurnCount, checkpointCount, isBounded }`: collect Turn 1, `checkpoint_peak` / `checkpoint_baseline` pairs for every `CHECKPOINT` before the active epoch, and active-epoch turns from the latest post-checkpoint planner turn forward (capped to `[activeEpoch[0], ...activeEpoch.slice(-119)]` with `isBounded: true` when `activeEpoch.length > 120`).
        *   Build `topTools` (top 10 `{ name, calls, estTokens, sharePercent }`) over `[anchorIdx, latestPlannerIdx]`, pairing `PLANNER_RESPONSE.tool_calls` positionally with contiguous `GENERIC` rows when counts match and falling back to proportional arg-size distribution when counts diverge, then scaling to `toolCallsTokens` via `allocateProportionally`.
        *   Scan conversation markdown artifacts in `~/.gemini/antigravity/brain/<conversationId>/` (`*.md`, ignoring `scratch/` and hidden dirs), reading optional `<file>.metadata.json` (`UserFacing`, `Summary` truncated to 160 chars), returning `artifacts: { count, totalBytes, totalEstTokens, items }` (max 20 sorted by mtime desc).
        *   For empty/no-usage threads (`latestPlannerIdx === -1`), initialize `exact.cumulativeInputTokens = 0`, `cumulativeCacheReadTokens = 0`, `cacheInvalidationCount = 0`, `trajectory = { points: [], totalTurnCount: 0, checkpointCount, isBounded: false }`, `topTools = []`, and populated `artifacts`.
    5.  **`scanLocalInventory({ workspacePath, mcpRoots, projectId } = {})`**:
        *   Read `~/.gemini/config/config.json` and evaluate `isPluginEnabled(dirName, pluginJson)`: use `configJson.plugins[dirName].enabled` when boolean, else `!pluginJson?.disabled`. Apply to MCP servers, rules, and skills.
        *   Resolve `workspace` in order: validated `workspacePath` arg (`source: "arg"`), first valid `file://` URI from `mcpRoots` (`source: "mcp_roots"`), `projectId` matched in `~/.gemini/config/projects/*.json` (`source: "project_id"`), or `{ path: null, source: "none" }`.
        *   Scan workspace root `GEMINI.md` / `AGENTS.md` and `{.agents,.agent,_agents,_agent}/{rules/*.md,skills/*/SKILL.md}`, deduplicating rules by `fs.realpathSync`, marking `scope: "workspace"` and `overPerFileCap: bytes > 24_000`. Include `byScope.workspace` in `skills.byScope` and return up to `80` `skills.items`.
    6.  **`getContextSnapshot` and `listConversations` exports**:
        *   `getContextSnapshot({ conversationId, workspacePath, mcpRoots, includeSubagents = false, limit = 35 })`: filters default `conversations` and default `selectedEntry` to `kind === "interactive"` when `includeSubagents` is false (still honoring explicit `conversationId`), resolves `projectId` from `serviceMap` for the selected conversation, invokes `scanLocalInventory`, and returns `{ schemaVersion: 2, generatedAt, serviceStatus, fleet, totalTrackedConversations, selectedConversationId, requestedConversationFound, current, conversations, inventory }`.
        *   `listConversations({ query = "", filter = "interactive", includeSubagents = false, offset = 0, limit = 50 })`: reuses the indexed transcript summaries and `serviceMap`, filters by `filter` (`"interactive" | "all" | "high_usage" | "checkpointed"`) and `includeSubagents` (`filter === "all"` implies `includeSubagents = true`), applies case-insensitive substring match across `title`, `conversationId`, and `modelName`, slices `[offset, offset + limit]`, and returns `{ schemaVersion: 2, totalMatching, offset, limit, hasMore, fleet, conversations }`.

#### 2. `src/server.mjs` (Modify)

*   **Type / Scope**: MCP stdio server tool registration, capability queries, and response formatting.
*   **Rationale**: Exposes the v2 parameters, passes MCP client `roots/list` when supported, registers the new app-only `list_conversations` tool, and updates text summaries.
*   **Proposed Changes**:
    1.  Add `resolveMcpRoots(server)` helper: checks `server.server.getClientCapabilities()?.roots`; when truthy, calls `server.server.listRoots()` raced against a `250ms` timeout, catching any error and returning `[]` on failure.
    2.  Update `open_context_monitor` Zod `inputSchema` to accept optional `conversationId`, `workspacePath`, and `includeSubagents`, passing `mcpRoots` into `getContextSnapshot`.
    3.  Update `get_context_snapshot` Zod `inputSchema` (`visibility: ["app"]`) to accept optional `conversationId`, `workspacePath`, `includeSubagents`, and `limit` (`1..100`).
    4.  Register app-only `list_conversations` (`visibility: ["app"]`, `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`) accepting `{ query?, filter?, includeSubagents?, offset?, limit? }` and returning both concise `content` text and `structuredContent`.
    5.  Update `formatSummaryText(snapshot)` to include interactive vs total fleet counts and `serviceStatus` offline/online state when applicable.

#### 3. `src/ui/main.js` (Modify)

*   **Type / Scope**: Minimal v0.1.1 side-panel compatibility sync (full v2 UI deferred to Spec 2).
*   **Rationale**: Keeps the checkpoint tooltip working in the existing side-panel UI after `checkpoint_summary` is renamed to `checkpoint_buffer` in `segments`.
*   **Proposed Changes**:
    *   Update the two tooltip checks (`patchInPlace` and `render`) from `seg.id === "baseline" || seg.id === "checkpoint_summary"` to `seg.id === "baseline" || seg.id === "checkpoint_buffer" || seg.id === "checkpoint_summary"`.

#### 4. `scripts/test-server.mjs` (Modify)

*   **Type / Scope**: Automated unit fixture tests and live MCP stdio integration tests.
*   **Rationale**: Validates every new v2 invariant, bounding rule, precedence rule, and MCP tool contract without modifying live `~/.gemini` files.
*   **Proposed Changes**:
    1.  Keep existing live stdio MCP checks against `dist/server.mjs` (`open_context_monitor`, `get_context_snapshot`, `list_conversations`, `ui://context-monitor/app.html`), asserting `schemaVersion === 2`, `fleet` counts, CLI segment IDs, exact segment token and `100.0%` tenths rounding invariants, and `< 1 MiB` payload size.
    2.  Add isolated temporary-directory (`fs.mkdtempSync`) fixture test suite (via `CONTEXT_MONITOR_GEMINI_HOME` + `server.mjs` subprocess and/or direct `analyzer.mjs` calls, cleaned up in `finally`) covering:
        *   Annotation-gated classification (`interactive`, `subagent`, `background`), `includeSubagents: false` default filtering, `includeSubagents: true` override, and direct `conversationId` selection of a subagent.
        *   CLI breakdown allocation (`baseline`, `tool_calls`, `user_messages`, `agent_responses`, `checkpoint_buffer`, `system_messages`), cumulative session input/cache counters, and `cacheInvalidationCount` (both zero-drop and >=50% non-checkpoint drop).
        *   `trajectory` bounding on a synthetic 150-turn, 2-checkpoint transcript (`checkpoint_peak`, `checkpoint_baseline`, max 120 active-epoch points, `isBounded: true`).
        *   `topTools` positional matching and diverged-batch fallback attribution.
        *   `artifacts` scan (`.md` + `.metadata.json`, ignoring `scratch/`).
        *   `config.json` `plugins[name].enabled` override precedence (`true` over `disabled: true`, `false` over enabled `plugin.json`) + workspace `.agents/rules/*.md` (`overPerFileCap`) and `.agents/skills/*/SKILL.md` (`byScope.workspace`).
        *   `list_conversations` pagination (`offset`, `limit`, `hasMore`), `query` search, and `filter` modes (`interactive`, `all`, `high_usage`, `checkpointed`).
        *   `ConversationService` `missing_env`, mock HTTP server `ok`, and timeout/error paths.

#### 5. `README.md` (Modify)

*   **Type / Scope**: Plugin documentation.
*   **Rationale**: Documents v2 metrics, CLI-aligned categories, `list_conversations`, workspace discovery inputs, and notes that `docs/` is excluded from installed plugin syncs.
*   **Proposed Changes**:
    *   Update "What it reads" and "Exact metrics vs local estimates" to reflect workspace `.agents/` discovery, `config.json` plugin precedence, conversation artifacts, bounded trajectories, and `list_conversations`, and clarify excluding `docs/` alongside `node_modules/` when syncing to `~/.gemini/config/plugins/context-monitor/`.

#### 6. Generated Build Outputs (Rebuilt via `npm run build`)

*   `dist/server.mjs` and `dist/app.html` (rebuilt by `scripts/build.mjs`; excluded from manual editing).

### Phased Execution Sequence

1.  **Phase 1A (Analyzer v2 & Fixture Verification)**: Update `src/analyzer.mjs`, add unit fixture assertions, and verify all pure analyzer invariants (`segments`, `trajectory`, `topTools`, `artifacts`, `fleet`, `listConversations`, `scanLocalInventory`).
2.  **Phase 1B (MCP Server v2, UI Sync, Build & Integration Verification)**: Update `src/server.mjs`, `src/ui/main.js`, `scripts/test-server.mjs`, and `README.md`; run full build, tests, and strict plugin validation.

### Verification Plan

*   **Compilation / Build**: `npm run build` in the repository root exits 0 and emits `dist/app.html` and `dist/server.mjs`.
*   **Unit & Integration Tests**: `npm test` exits 0, passing both live stdio checks across all three tools (`open_context_monitor`, `get_context_snapshot`, `list_conversations`) and all isolated fixture tests, confirming every `CallToolResult` is strictly `< 1 MiB` and every segment/percentage sum invariant holds.
*   **Static Validation**: `agy plugin validate . --strict` passes with zero errors.
*   **Sync Safety (Pre-Sync Diff Gate)**: Show `git status` / diffs and explicit sync commands (copying `dist/`, `plugin.json`, `mcp_config.json`, `assets/`, `README.md` while excluding `docs/`, `src/`, `scripts/`, `node_modules/`) to the user before updating `~/.gemini/config/plugins/context-monitor/` and refreshing `context-monitor_context-monitor`.

--------------------------------------------------------------------------------

*Drafted with EGM*
