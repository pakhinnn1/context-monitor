# Context Monitor v0.2: Metrics and Inventory v2 (Spec 1)

*   **Author:** pakhinnn1
*   **Status:** Proposed
*   **Date:** 2026-11-27

--------------------------------------------------------------------------------

## Overview

This specification (Spec 1) defines the v0.2 analyzer engine and MCP `structuredContent` contract for the local Antigravity Context Monitor plugin (this repository). It upgrades `src/analyzer.mjs` and `src/server.mjs` to align Context Monitor's breakdown and inventory with Antigravity CLI `/context` using local disk files.

Spec 1 delivers the following capabilities:

*   Subagent and background worker filtering with an opt-in show-all toggle.
*   CLI-aligned prompt breakdown `current.segments` (`User messages`, `Agent responses`, `Tool calls`, `System and baseline`, conditional `Checkpoint buffer`, and conditional `System messages`), with `Free space` reported under `exact`.
*   Disk-discoverable conversation artifact files (`~/.gemini/antigravity/brain/<id>/*.md`).
*   Bounded per-turn context trajectories with compaction markers, ranked top tool-call contributors, and cumulative session input/cache counters.
*   Plugin `enabled` precedence from `~/.gemini/config/config.json` and active workspace rules and skills discovery.

This schema defines the server contract before Spec 2 (`docs/designs/global_workspace_ux.md`, planned Spec 2, not yet created) implements the global sidebar workspace UI. All v0.1.0 payload fields remain populated alongside minimal CSS and JS compatibility updates in `src/ui/styles.css` and `src/ui/main.js` so the existing side-panel UI renders without visual regression.

### Resolved Architectural Decisions

*   **Thread filtering:** Interactive classification uses `~/.gemini/antigravity/annotations/<id>.pbtxt` or `ConversationService`, hiding `subagent` and `background` threads by default with an opt-in toggle.
*   **Prompt breakdown:** `current.segments` replaces v0.1.0 segment IDs in place with CLI-aligned identifiers (`baseline`, `tool_calls`, `user_messages`, `agent_responses`, `checkpoint_buffer`, and optional `system_messages`).
*   **Trajectory bounding:** Long sessions keep Turn 1, `checkpoint_peak` / `checkpoint_baseline` milestone pairs for earlier checkpoints, and up to 120 turns in the active post-checkpoint epoch.
*   **Model-visible payload isolation:** `open_context_monitor` (`visibility: ["model", "app"]`) passes `includeDetails: false` to omit `current.trajectory`, `current.topTools`, and `current.artifacts` from host model context; app-only `get_context_snapshot` (`visibility: ["app"]`) passes `includeDetails: true` to return full detail payloads.
*   **Release version policy:** Package, plugin, and server version strings stay at `0.1.0` during Spec 1 (`schemaVersion: 2` signals the v2 wire contract) and bump to `0.2.0` when Spec 2 ships the full UI.
*   **Workspace and fleet query boundary:** Workspace discovery resolves from explicit `workspacePath`, conversation `projectId` via `~/.gemini/config/projects/<projectId>.json`, and MCP `roots/list`, while fleet search and pagination live on a dedicated app-only `list_conversations` tool.

## The Problem

Context Monitor v0.1.0 reads local transcripts under `~/.gemini/antigravity/brain/` and renders exact token counters and local category estimates for a single turn, but five analyzer and inventory gaps separate it from CLI `/context`:

1.  **Subagents and background workers crowd the thread selector.** Across a local corpus of 500+ tracked transcripts, roughly 80% lack `~/.gemini/antigravity/annotations/<id>.pbtxt` files (which Antigravity writes for interactive user threads, sometimes asynchronously after transcript creation). The unannotated set includes linked `invoke_subagent` child transcripts, unlinked single-prompt workflow/background sessions, and zero-user-input transcripts. Because v0.1.0 lists the most recently modified `transcript.jsonl` files without filtering by kind, isolated subagent and worker prompts push interactive conversations out of the 35-item selector.
2.  **`ConversationService` enrichment returns an empty `Map` inside the MCP server.** `fetchConversationServiceTitles` in `src/analyzer.mjs` reads `ANTIGRAVITY_LS_ADDRESS` (`LS` = Antigravity language server) and `ANTIGRAVITY_CSRF_TOKEN`. While `ListConversations` succeeds from agent shell commands with header `x-antigravity-csrf-token` and returns `projectId`, `rootConversationId`, `parentConversationId`, and `runState`, Antigravity does not guarantee those variables in standalone stdio MCP server subprocesses. The analyzer lacks a disk-first thread classifier and optional non-blocking service status handling.
3.  **Single-turn snapshots lack CLI-aligned breakdown, artifact visibility, trajectory, and tool attribution.** v0.1.0 merges user prompts and agent replies into one `Messages` bucket and omits disk-discoverable conversation artifacts (`~/.gemini/antigravity/brain/<id>/*.md`). Users also cannot inspect turn-by-turn prompt growth around compaction `CHECKPOINT` events, see which tools contributed the largest outputs, or track cumulative session input and cache-invalidation counters. Unbounded per-turn arrays grow linearly across multi-hundred-turn sessions and compound with `conversations` and `inventory` payloads toward the 1 MiB Antigravity `CallToolResult` cap.
4.  **Local inventory misreports plugin state and misses workspace customizations.** `scanLocalInventory` checks only `plugin.json`'s `disabled` flag and ignores `~/.gemini/config/config.json` (`plugins.<dirName>.enabled`), which Antigravity treats as higher precedence. While `scanLocalInventory` already scans global skills under `~/.gemini/config/skills/`, it omits active workspace rules (`AGENTS.md`, `GEMINI.md`, `.agents/rules/*.md`) and workspace skills (`<workspace>/.agents/skills/*/SKILL.md`).
5.  **No paginated search and filter contract exists for 500+ threads.** `get_context_snapshot` slices the top `limit` (default 35, max 100) transcripts without filtering, search, or fleet-level aggregates, forcing Spec 2's global workspace to either pull oversized payloads or lack fleet visibility.

## Goals

*   **G1 — Deterministic disk-first thread list filtering:** Filter subagents and background workers out of the default interactive thread list without requiring `ConversationService`, while supporting an opt-in filter to show all threads.
*   **G2 — CLI `/context`-aligned breakdown and disk-discoverable artifacts:** Align `current.segments` with Antigravity CLI `/context` (`User messages`, `Agent responses`, `Tool calls`, `System and baseline`, conditional `Checkpoint buffer`, and conditional `System messages`, with `Free space` in `exact`), and surface disk-discoverable conversation artifact files (`~/.gemini/antigravity/brain/<id>/*.md`) alongside system and workspace rule files.
*   **G3 — Bounded per-turn trajectory and top tool-call attribution:** Expose per-turn prompt growth with `CHECKPOINT` markers, ranked top tool-call contributors, and cumulative session input/cache-read/cache-invalidation counters via app-only `get_context_snapshot` (`includeDetails: true`), while omitting `trajectory`, `topTools`, and `artifacts` from model-visible `open_context_monitor` (`includeDetails: false`) to keep every `CallToolResult` lean (target `< 256 KiB` typical, under `1 MiB`).
*   **G4 — Accurate local and workspace inventory:** Respect `~/.gemini/config/config.json` plugin `enabled` precedence over `plugin.json` and discover active workspace rules and skills (`AGENTS.md`, `GEMINI.md`, `.agents/rules/*.md`, `.agents/skills/*/SKILL.md`) under a `workspace` scope.
*   **G5 — Backwards-compatible MCP schema v2 and fleet query surface:** Preserve all v0.1.0 `structuredContent` fields and invariants (`sum(segments.tokens) === exact.activeTokens` and `sum(segments.percent) + exact.freePercent === 100.0`) while adding v2 fields and fleet search/filter/pagination support for Spec 2.
*   **G6 — Optional, non-blocking `ConversationService` enrichment:** Enrich titles, `runState`, `projectId`, and top-level thread metadata whenever `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN` are available, without throwing or setting `isError: true` and with bounded latency when unavailable.

## Non-Goals

*   **NG1 — Parent-child subagent token rollup:** Subagents run in isolated context windows and do not consume the parent thread's context window; Spec 1 filters subagents from the default thread list rather than aggregating child token spend onto parent threads.
*   **NG2 — Burn rate and estimated turns remaining:** Spec 1 does not forecast future turns remaining or compute token burn-rate projections.
*   **NG3 — Mid-thread model switch history:** Spec 1 continues resolving the active thread model from the latest planner turn and does not emit a mid-thread model switch timeline.
*   **NG4 — Global workspace UI, CSS, or host UX actions:** Container-query two-column layout, SVG chart rendering, search rail UI, keyboard shortcuts, `updateModelContext`, `toggle-aux-pane`, and follow-latest pin UI belong to Spec 2 (`docs/designs/global_workspace_ux.md`, planned Spec 2, not yet created).
*   **NG5 — Probing undocumented host services or bypassing environment boundaries:** The MCP server will not scan OS process tables, scrape host internals, or read undocumented sockets to obtain `ANTIGRAVITY_CSRF_TOKEN`.
*   **NG6 — Exact third-party tokenizer libraries:** Category breakdowns, tool attribution shares, artifact byte estimates, and rule/skill inventory sizes remain character-weighted local estimates derived from disk files and transcript character shares anchored to exact `PLANNER_RESPONSE` token counters.
*   **NG7 — Editing or mutating Antigravity transcripts, annotations, or configs:** All Context Monitor MCP tools remain read-only (`readOnlyHint: true`).
*   **NG8 — Syncing `docs/` into the installed plugin directory:** Design specifications live only under `docs/designs/` and are excluded when syncing runtime bundles to `~/.gemini/config/plugins/context-monitor/`.

## Open Questions

None.

## Critical User Journeys (CUJs)

### CUJ 1: Inspect Interactive Threads Without Subagent Noise (Opt-In Show All)

*   **Given:** A fixture or local corpus of 500 transcripts exists under `~/.gemini/antigravity/brain/`, consisting of 100 annotated interactive threads, 150 linked `invoke_subagent` children, and 250 unannotated background transcripts, and `ConversationService` env vars are unset in the MCP server process.
*   **When:** The user or host launches `open_context_monitor` with `{}` (default interactive filter) and later toggles the opt-in show-all filter.
*   **Then:** By default, the server selects the most recently updated interactive thread and omits subagents and background workers from the thread list; when the opt-in filter is enabled, subagent and background threads appear with a `kind` field (`"interactive"`, `"subagent"`, or `"background"`), all within a v0.1.0-compatible payload under 1 MiB.

### CUJ 2: Inspect CLI-Aligned Breakdown, Artifacts, Trajectory, and Top Tool Contributors

*   **Given:** A selected conversation has 100+ planner turns, at least one compaction `CHECKPOINT`, tool calls producing `GENERIC` outputs, and markdown artifact files under `~/.gemini/antigravity/brain/<id>/`.
*   **When:** The UI calls `get_context_snapshot` for that `conversationId`.
*   **Then:** `current` exposes CLI-aligned `segments` (`User messages`, `Agent responses`, `Tool calls`, `System and baseline`, conditional `Checkpoint buffer`, and conditional `System messages`) alongside `exact` `Free space` (preserving `sum(segments.tokens) === exact.activeTokens` and `sum(segments.percent) + exact.freePercent === 100.0`), disk-discoverable artifact metadata, a bounded per-turn trajectory array retaining all compaction points, ranked top tool contributors by attributed token share, and cumulative session input/cache counters.

### CUJ 3: Audit Active Workspace Rules, Skills, and True Plugin Enablement

*   **Given:** One installed plugin has `"enabled": false` in `~/.gemini/config/config.json` (while its `plugin.json` has no `disabled` field), another plugin ships `"disabled": true` in `plugin.json` but has `"enabled": true` in `config.json`, and the active workspace contains `AGENTS.md` and workspace skills under `<workspace>/.agents/skills/`.
*   **When:** The analyzer runs `scanLocalInventory` with resolved workspace context.
*   **Then:** Plugin active status follows `config.json` over `plugin.json` across MCP servers, rules, and skills; workspace rules and skills appear with `scope: "workspace"` and accurate `byScope.workspace` counts alongside `global`, `plugin`, and `builtin`.

### CUJ 4: Optional `ConversationService` Enrichment Without Fragility

*   **Given:** The MCP server runs either with valid `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN` env vars or without them (or with a timed-out/unreachable endpoint).
*   **When:** `open_context_monitor` or `get_context_snapshot` executes.
*   **Then:** When reachable, `ListConversations` enriches conversation titles, `runState`, `projectId`, and interactive classification within a bounded timeout; when unset or unreachable, the analyzer skips or times out without throwing within the 350 ms timeout, reporting service reachability metadata so callers know enrichment was offline.

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
~/.gemini/config/projects/*.json                   │
~/.gemini/config/plugins/* & mcp/*                 ▼
<workspace>/{AGENTS.md,GEMINI.md,.agents/} ──► src/analyzer.mjs (v2)
                                                   │
                                                   ▼
                                           src/server.mjs (MCP Tools)
                                             ├── open_context_monitor (aux_pane + global)
                                             ├── get_context_snapshot (app-only refresh)
                                             └── list_conversations   (app-only search/paging)
```

### Thread Discovery and Annotation-Gated Classification

Every tracked directory under `~/.gemini/antigravity/brain/<id>/` with a non-empty `.system_generated/logs/transcript.jsonl` is indexed into `summaryCache` keyed by resolved `transcriptPath` (with `mtimeMs` stored for staleness checks and deleted directories evicted on scan). Antigravity writes `~/.gemini/antigravity/annotations/<conversationId>.pbtxt` for interactive user threads (sometimes asynchronously after transcript creation); therefore, `.pbtxt` existence and title are evaluated outside the transcript `mtimeMs` cache hit check so newly flushed annotations update `kind` and `title` immediately.

To keep cold-start latency bounded on 500+ transcripts:

*   Default interactive filtering (`includeSubagents: false`, `open_context_monitor`, and `get_context_snapshot`) gates candidate transcripts upfront by checking `~/.gemini/antigravity/annotations/<id>.pbtxt` existence plus `serviceMap` entries before opening transcript file bodies, restricting synchronous parsing to the top `limit` (35) interactive candidates (plus an explicitly requested `conversationId`).
*   Full-corpus transcript indexing runs only when `includeSubagents: true` or `list_conversations` is called, skipping oversized files above a safe size guard during fast summary scans.
*   Parent-to-child subagent links (`linkedChildIds`) combine `serviceMap` entries with non-empty `parentConversationId` and `GENERIC` rows matching the structured `invoke_subagent` output marker (`Created the following subagent:` JSON block containing `"conversationId"`), excluding self-IDs so Context Monitor's own tool outputs cannot demote interactive threads.

Classification assigns `kind` in strict precedence order:

1.  `"subagent"`: `linkedChildIds.has(conversationId)` OR `serviceInfo?.parentConversationId` is non-empty.
2.  `"interactive"`: `~/.gemini/antigravity/annotations/<conversationId>.pbtxt` exists on disk OR `serviceInfo` returned the thread from `ListConversations({ includeArchived: false })` without a parent.
3.  `"background"`: all remaining unlinked, unannotated transcripts (workflow workers, zero-user-input agent sessions, and unannotated cron runs).

Default selection and zero-interactive fallback:

*   When `includeSubagents` is `false`, `conversations` contains only `kind === "interactive"` entries. If zero interactive threads exist, `conversations` is `[]` and default `selectedEntry` falls back to the latest transcript overall so `current` still renders.
*   If the caller passes an explicit `conversationId`, `selectedEntry` resolves that exact transcript even when `kind !== "interactive"`, so direct inspection of any subagent or background thread still works.

### Optional, Non-Blocking `ConversationService` Enrichment

`fetchConversationServiceTitles` checks `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN`. When either is absent, it returns `{ map: new Map(), status: { reachable: false, reason: "missing_env", enrichedCount: 0 } }` immediately with zero network I/O.

When both env vars are present, it queries `POST http://${ANTIGRAVITY_LS_ADDRESS}/product.v1.ConversationService/ListConversations` with headers `Content-Type: application/json`, `Connect-Protocol-Version: 1`, and `x-antigravity-csrf-token: ${ANTIGRAVITY_CSRF_TOKEN}`, passing `{ pageSize: 100, includeArchived: false }` and optional `pageToken` (set from page 1's `nextPageToken`) for up to 2 pages (200 recent conversations) within a single shared `350 ms` `AbortController` deadline:

*   Each entry reads `conv.id`, `conv.annotations?.title` or `conv.state?.summary`, `conv.state?.runState` (`"RUN_STATE_IDLE" | "RUN_STATE_RUNNING" | "RUN_STATE_CANCELLING"`), `conv.state?.updateTime`, `conv.metadata?.projectId`, `conv.metadata?.parentConversationId`, and `conv.metadata?.rootConversationId`.
*   `serviceStatus` uses shape `{ reachable: boolean, reason: "missing_env" | "ok" | "partial" | "http_error" | "timeout_or_network", enrichedCount: number }`. If page 1 succeeds and page 2 fails or times out, page 1 entries are retained with `reachable: true, reason: "partial"`. None throw or set `isError: true`.
*   To avoid repeated 350 ms stalls during 15-second UI polling, `fetchConversationServiceTitles` caches successful maps for 15 seconds and applies a 30-second negative cooldown after `http_error` or `timeout_or_network`, running concurrently with `resolveMcpRoots` in `src/server.mjs`.

### CLI-Aligned Breakdown (`segments`) and Cumulative Session Counters

`analyzeTranscriptRows` (newly exported from `src/analyzer.mjs`) replaces v0.1.0 segment identifiers in place on `current.segments` while keeping the schema shape `{ id, label, tokens, percent, colorKey, kind, detail }` and preserving both v0.1.0 invariants (`sum(segments.tokens) === exact.activeTokens`, and `sum(segments.percent) + exact.freePercent === 100.0` via largest-remainder tenths allocation).

Baseline and anchor definitions (building on v0.1.0 math):

*   `firstTotal` is Turn 1's active tokens (`input_tokens + cache_read_tokens`); `firstUserEst` is the first `USER_INPUT` character estimate (`bytes / 4`) clamped to `60%` of `firstTotal`; `turn1Baseline = firstTotal - firstUserEst`.
*   When `lastCheckpointIdx === -1`, `anchorIdx` is the first token-bearing planner turn (`firstPlannerIdx`), `baselineEst` is `turn1Baseline` clamped to `activeTokens`, `initialMessagesEst` is `firstUserEst` clamped to `activeTokens - baselineEst`, and `checkpointBufferEst = 0`.
*   When `lastCheckpointIdx >= 0` and a token-bearing planner turn follows it (`postCpPlannerIdx !== -1`), `postCpTotal` is that turn's active tokens, `anchorIdx = postCpPlannerIdx`, `baselineEst = min(turn1Baseline, postCpTotal, activeTokens)`, and `checkpointBufferEst` is `max(0, postCpTotal - baselineEst)` clamped to `activeTokens - baselineEst`. If no planner turn follows `lastCheckpointIdx`, `anchorIdx = lastCheckpointIdx`, `baselineEst = min(turn1Baseline, activeTokens)`, and `checkpointBufferEst = 0`.

| Segment ID | Label | Color Key | Kind | Character / Token Attribution & Tooltip Detail |
| :--- | :--- | :--- | :--- | :--- |
| `baseline` | `System and baseline` | `blue` | `estimated` | `baselineEst` (`min(turn1Baseline, postCpTotal, activeTokens)`). Covers system prompt, built-in tools, MCP index, rules, and skill headers. |
| `tool_calls` | `Tool calls` | `orange` | `estimated` | Post-anchor `GENERIC` row chars plus non-empty `PLANNER_RESPONSE.tool_calls` JSON chars. |
| `user_messages` | `User messages` | `green` | `estimated` | `initialMessagesEst` (when no checkpoint exists) plus post-anchor `USER_INPUT` row chars. |
| `agent_responses` | `Agent responses` | `amber` | `estimated` | Post-anchor `PLANNER_RESPONSE` `content` + `thinking` chars (excluding `tool_calls`); also receives zero-weight fallback if `deltaTokens > 0` and all weights equal `0`. |
| `checkpoint_buffer` | `Checkpoint buffer` | `violet` | `estimated` | `checkpointBufferEst` (emitted only when `> 0`). Compacted history carried forward after checkpoints. |
| `system_messages` | `System messages` | `slate` | `estimated` | Post-anchor `SYSTEM_MESSAGE` + `ERROR_MESSAGE` row chars (emitted only when `> 0`). System notifications and error rows in the active window. |

Post-anchor attribution and session counters:

*   When `latestPlannerIdx > anchorIdx` and `rows[anchorIdx]` is a `PLANNER_RESPONSE`, its `content` + `thinking` chars contribute to `agent_responses` and its `tool_calls` chars (only when `tool_calls.length > 0`, without applying a `1`-char floor to empty `tool_calls`) contribute to `tool_calls`.
*   `deltaTokens = max(0, activeTokens - anchorTotal)` is distributed proportionally via largest-remainder rounding across `{ toolCalls, userMessages, agentResponses, systemMessages }`, falling back to `agentResponses: 1` when `deltaTokens > 0` and all four weights are `0`.
*   `exact` adds three cumulative session counters summed across all token-bearing `PLANNER_RESPONSE` rows in the transcript:
    *   `cumulativeInputTokens`: sum of `input_tokens`.
    *   `cumulativeCacheReadTokens`: sum of `cache_read_tokens`.
    *   `cacheInvalidationCount`: compare consecutive token-bearing planner turns `(prev, cur)` without an intervening `CHECKPOINT` (coercing missing `cache_read_tokens` to `0`), incrementing once per turn transition where `prevCacheRead > 0 && (curCacheRead === 0 || curCacheRead <= prevCacheRead * 0.5)`.
*   When `latestPlannerIdx === -1` (no usage data yet), `exact.cumulativeInputTokens`, `exact.cumulativeCacheReadTokens`, and `exact.cacheInvalidationCount` default to `0`, `trajectory` is `{ points: [], totalTurnCount: 0, checkpointCount, isBounded: false }`, `topTools` is `[]`, and `artifacts` is still populated from disk.

### Bounded Per-Turn Context Trajectory (`trajectory`)

`current.trajectory` exposes `{ points, totalTurnCount, checkpointCount, isBounded }` where `totalTurnCount` equals `exact.turnCount`, and each entry in `points` has shape:

```text
{ turn, stepIndex, activeTokens, inputTokens, cacheReadTokens, outputTokens, kind, createdAt }
```

*   Field mapping: `stepIndex` uses `typeof row.step_index === "number" ? row.step_index : rowIndex`, `outputTokens` uses `Number(row.output_tokens || 0)`, `createdAt` uses `row.created_at || null`, and `kind` is `"turn" | "checkpoint_peak" | "checkpoint_baseline"`.
*   Bounding and deduplication rules:
    1.  Collect all token-bearing `PLANNER_RESPONSE` turns (`1..N`) and `CHECKPOINT` row indices.
    2.  When `checkpointCount > 0`, include Turn 1 (`"turn"`), each checkpoint's pre-checkpoint peak (`"checkpoint_peak"` — last planner turn before the checkpoint) and post-checkpoint baseline (`"checkpoint_baseline"` — first planner turn after the checkpoint), and active-epoch turns starting after `lastCheckpointIdx` (tagging `activeEpoch[0]` as `"checkpoint_baseline"`). If `lastCheckpointIdx > latestPlannerIdx` (a trailing checkpoint with no subsequent planner turn), emit the trailing checkpoint's pre-checkpoint peak and an empty `activeEpoch`.
    3.  Deduplicate milestone points by `turn` using precedence `"checkpoint_peak"` > `"checkpoint_baseline"` > `"turn"`.
    4.  If `activeEpoch` exceeds `120` entries, set `isBounded = true` and retain `activeEpoch[0]` plus the last `119` entries.

### Top Tool-Call Contributor Attribution (`topTools`)

`current.topTools` ranks the tools driving the `tool_calls` segment inside the active post-anchor window (`toolCallsTokens` equals the `tool_calls` segment's `tokens`):

1.  If `toolCallsTokens === 0` or `latestPlannerIdx <= anchorIdx` (e.g., 1-turn threads or the first turn after a checkpoint, where `anchorRow` belongs to baseline), return `[]`.
2.  For each `PLANNER_RESPONSE` row `i` in `[anchorIdx, latestPlannerIdx]` with non-empty `tool_calls` (verified item keys `{ name, args }`), collect subsequent `GENERIC` rows up to the next `PLANNER_RESPONSE`, `USER_INPUT`, or `CHECKPOINT` (skipping intervening `SYSTEM_MESSAGE` or `ERROR_MESSAGE` rows rather than halting the batch).
3.  Pair `GENERIC` outputs positionally when counts match `tool_calls.length`; otherwise allocate summed `GENERIC` chars across `tool_calls` proportionally by `max(1, serializedToolCallChars(tc))`, adding each call's own `serializedToolCallChars(tc)`.
4.  Aggregate raw weights by `tc.name || "unknown"`, allocate `toolCallsTokens` proportionally, compute `sharePercent` to one decimal place, sort by `estTokens` descending, then `calls` descending, then `name` ascending, and return the top `10` entries `{ name, calls, estTokens, sharePercent }`.

### Disk-Discoverable Conversation Artifacts (`current.artifacts`)

For the selected `conversationId`, perform a non-recursive regular `*.md` file scan of `~/.gemini/antigravity/brain/<conversationId>/`:

*   Each item has shape `{ name, bytes, estTokens, mtimeMs, userFacing, summary }` (`estTokens = Math.round(bytes / 4)`).
*   Read optional sibling `<name>.metadata.json`: `userFacing` defaults to `false` when absent (`Boolean(meta.UserFacing)`), and `summary` defaults to `null` when absent (otherwise collapsed to single-line whitespace and truncated to 160 chars).
*   Sort by `mtimeMs` descending. `count`, `totalBytes`, and `totalEstTokens` (`Math.round(totalBytes / 4)`) aggregate across all matching top-level `.md` files before slicing `items` to the top `20`.

### True Plugin Precedence, Workspace Discovery, and Inventory (`inventory`)

`scanLocalInventory({ workspacePath, mcpRoots, projectId })` resolves plugin enablement and active workspace customizations:

1.  **Plugin enablement precedence:** Read `~/.gemini/config/config.json` safely (treating missing or malformed JSON as `{}`). For each plugin directory `entry.name`, resolve `enabled` from `configJson?.plugins?.[entry.name]?.enabled`, falling back to `configJson?.plugins?.[pluginJson?.name]?.enabled`, and then `!pluginJson?.disabled`. Apply consistently across MCP servers, plugin rules, and plugin skills.
2.  **Workspace resolution:** Resolve at most one active workspace root in priority order, rejecting invalid directories, non-directories, `/`, and `os.homedir()`, and falling through to the next source if an explicit argument fails validation:
    *   Explicit `workspacePath` argument (`source: "arg"`).
    *   Selected conversation's `projectId` matched directly at `~/.gemini/config/projects/${projectId}.json` (after validating `projectId` contains no path separators, with a directory scan fallback over `projects/*.json` matching `data.id === projectId`), reading the first valid `file://` URI from `projectResources.resources[].gitFolder?.folderUri || localFolder?.folderUri` decoded via `url.fileURLToPath` (`source: "project_id"`).
    *   Valid `file://` URIs passed from MCP `roots/list` (`source: "mcp_roots"`).
    *   Otherwise `workspace = { path: null, source: "none" }`.
3.  **Workspace rules, skills, caching, and bounds:**
    *   When `workspace.path` resolves, inspect root `GEMINI.md` and `AGENTS.md` plus `.agents`, `.agent`, `_agents`, and `_agent` (`rules/*.md` and `skills/*/SKILL.md` — covering Antigravity's current and legacy/cross-tool customization directories).
    *   Guard every `fs.realpathSync` call in `try/catch` to skip broken symlinks (`ENOENT`) and reject symlink targets resolving outside `workspace.path`. Deduplicate rules and skills by resolved real path.
    *   Name workspace rules by workspace-relative POSIX path (`"AGENTS.md"`, `".agents/rules/foo.md"`), tag with `scope: "workspace"`, and apply `overPerFileCap: bytes > 24_000` uniformly across all `rules.items` (`plugin`, `global`, `workspace`).
    *   Extend `inventory.skills.byScope` to `{ workspace, plugin, global, builtin }`, cap `skills.items` at `80` (up from `60`), `rules.items` at `80`, and `mcp.servers` at `100` (sorted active-first), and return `inventory.workspace: { path: string | null, source: "arg" | "project_id" | "mcp_roots" | "none" }`.
    *   Cache `scanLocalInventory` across 15-second polls (keyed by workspace path and config/dir mtimes with a short TTL) and read only the first `4 KiB` of each `SKILL.md` in `inspectSkillMetadata` instead of full files.

### MCP Tool Surface and Fleet Pagination (`src/server.mjs`)

| Tool Name | Visibility | Input Parameters | Output Purpose |
| :--- | :--- | :--- | :--- |
| `open_context_monitor` | `["model", "app"]` (default) | `conversationId?`, `workspacePath?`, `includeSubagents?` | Primary UI entrypoint (`ui://context-monitor/app.html`, `aux_pane` + `global`). Calls `getContextSnapshot` with `includeDetails: false` (omitting `current.trajectory`, `current.topTools`, and `current.artifacts` to avoid bloating host model context). Returns `schemaVersion: 2`, `serviceStatus`, `fleet`, `current`, `conversations` (top 35), `inventory`. |
| `get_context_snapshot` | `["app"]` (hidden from model) | `conversationId?`, `workspacePath?`, `includeSubagents?`, `limit?` (`1..100`, def `35`) | App-only single-thread refresh and thread switching. Calls `getContextSnapshot` with `includeDetails: true` (returning full `current` including `trajectory`, `topTools`, and `artifacts`) and passes `mcpRoots` when `workspacePath` is omitted. |
| `list_conversations` | `["app"]` (hidden from model) | `query?`, `filter?` (`"interactive" \| "all" \| "high_usage" \| "checkpointed"`), `includeSubagents?`, `offset?` (`>= 0`, def `0`), `limit?` (`1..100`, def `50`) | App-only fleet search and pagination returning `{ schemaVersion: 2, totalMatching, offset, limit, hasMore, fleet, conversations }` plus concise `content` text. |

MCP `roots/list` orchestration in `src/server.mjs`:

*   `resolveMcpRoots(server)` checks `server.server.getClientCapabilities()?.roots` (`McpServer` wraps the low-level `Server` at `server.server`), skips querying when `args.workspacePath` is explicitly provided, calls `server.server.listRoots()` raced against a `250 ms` timeout, unwraps `(result?.roots ?? []).map(r => r.uri)`, and caches the URIs until `notifications/roots/list_changed`. Both `open_context_monitor` and `get_context_snapshot` pass `mcpRoots` into `getContextSnapshot`.

Schema and filter semantics:

*   `conversations[]` items add `kind`, `turnCount`, `projectId`, and `parentConversationId` (omitting `childConversationIds`), and `current` adds `kind`.
*   `list_conversations` filter rules: `filter === "all"` implies `includeSubagents = true`; `filter === "interactive"` requires `kind === "interactive"`; `filter === "high_usage"` (`usedPercent !== null && usedPercent >= 70`) and `filter === "checkpointed"` (`checkpointCount > 0`) respect `includeSubagents` (default `false`). Reuses `summaryCache` and cached `serviceMap`.
*   `fleet` summary object included on all three responses:

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

Payload budget target: `open_context_monitor` omits `current.trajectory`, `current.topTools`, and `current.artifacts` (`includeDetails: false`) while keeping `conversations` at 35 items, `rules.items` at 80, `skills.items` at 80, and `mcp.servers` at 100. App-only `get_context_snapshot` (`includeDetails: true`) additionally bounds `trajectory.points` to 120 active-epoch points plus earlier checkpoint pairs, `topTools` at 10, and `artifacts.items` at 20, targeting `< 256 KiB` typical and strictly under the 1 MiB `CallToolResult` cap.

## Alternatives Considered

### Alternative A: Heuristic Multi-Turn or Exclude-Only Thread Filtering

*   **Pros**: Surfaces untitled multi-turn or first-turn interactive sessions immediately when `ConversationService` is offline and annotations have not yet flushed to disk.
*   **Cons**: Leaks unannotated background sessions (multi-turn background threads and single-prompt workflow workers observed in the 500+ transcript corpus) into the default interactive selector.
*   **Reason for Rejection**: Annotation-gated interactive classification (`annotations/<id>.pbtxt` or `ConversationService`) keeps workflow and background worker noise out of the default list while preserving an opt-in show-all toggle and explicit `conversationId` inspection.

### Alternative B: Parallel `cliBreakdown` Array Alongside v0.1.0 `segments`

*   **Pros**: Leaves `current.segments` identifiers untouched for legacy v0.1.0 UI code.
*   **Cons**: Duplicates category objects in every `structuredContent` payload and forces UI consumers and contract tests to maintain two slightly different prompt decompositions.
*   **Reason for Rejection**: Replacing `segments` in place with CLI-aligned identifiers (`baseline`, `tool_calls`, `user_messages`, `agent_responses`, `checkpoint_buffer`, `system_messages`) eliminates schema duplication while maintaining exact `activeTokens` and `100.0%` rounding invariants.

### Alternative C: Full-Session Downsampling (200 Points) or Sliding 100-Turn Trajectory

*   **Pros**: Downsampling retains older intermediate shapes up to 200 entries; a 100-turn sliding window requires only simple array slicing.
*   **Cons**: Downsampling introduces uneven bucket intervals across older epochs, while a 100-turn sliding window drops Turn 1 and pre-checkpoint history on long sessions (133+ turns observed).
*   **Reason for Rejection**: Emitting the active post-checkpoint epoch (capped at 120 turns) plus explicit `checkpoint_peak` and `checkpoint_baseline` milestone pairs for earlier checkpoints preserves complete granularity in the active window and compaction boundaries within a compact payload budget.

### Alternative D: Transcript Path-Scraping Fallback or Server `cwd` Walk for Workspace Discovery

*   **Pros**: Attempts workspace resolution even when MCP `roots/list` and `ConversationService` are both unavailable.
*   **Cons**: Scraping file paths from transcripts misattributes the workspace when a thread touches multiple repositories, and walking `process.cwd()` fails whenever Antigravity launches the global plugin MCP server from `HOME` or the plugin folder.
*   **Reason for Rejection**: Resolving the workspace exclusively from explicit `workspacePath`, `ConversationService` `projectId` mappings under `~/.gemini/config/projects/*.json`, and MCP `roots/list` avoids heuristic misattribution.

### Alternative E: Extending `get_context_snapshot` or Returning All Summaries Upfront for Fleet Search

*   **Pros**: Preserves a two-tool MCP surface or eliminates server-side pagination logic.
*   **Cons**: Returning all 500+ summaries upfront grows `CallToolResult` size linearly with history toward the 1 MiB host limit, while overloading `get_context_snapshot` mixes single-thread analysis with search and offset pagination.
*   **Reason for Rejection**: Adding a dedicated app-only `list_conversations` tool separates paginated fleet queries from single-thread inspection and keeps `open_context_monitor` payloads compact.

## Non-Functional Requirements

*   **Performance & Latency**: Indexing 500+ local transcripts must reuse `summaryCache` keyed by resolved `transcriptPath` so repeated polls and `list_conversations` queries only parse newly modified transcripts, while default `open_context_monitor` / `get_context_snapshot` gate candidates via annotations and `serviceMap` before opening transcript bodies. Optional `ConversationService` requests are bounded to `350 ms` (with 15s success / 30s error cooldown) and MCP `roots/list` requests to `250 ms` (cached on `notifications/roots/list_changed`) and executed concurrently.
*   **Payload Size & Compatibility**: Every `CallToolResult` payload from `open_context_monitor` must stay below `1 MiB` (target `< 256 KiB` typical). All v0.1.0 top-level fields (`generatedAt`, `totalTrackedConversations`, `selectedConversationId`, `requestedConversationFound`, `current`, `conversations`, `inventory`) and rounding invariants remain intact alongside the minimal UI/CSS compatibility fixes.
*   **Security & Privacy**: All MCP tools remain read-only (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`). The server never scrapes OS process tables or undocumented host sockets, never exposes raw `ANTIGRAVITY_CSRF_TOKEN` values in tool output, validates `workspacePath` and resolved URIs via `fs.realpathSync` + `stat.isDirectory()`, and rejects `/`, `os.homedir()`, and non-directory paths.
*   **Rollout & Rollback**: Changes ship first to the source repository and are built and verified via `npm run build && npm test && agy plugin validate . --strict` (`agy` = Antigravity CLI) before syncing runtime files (`dist/`, `plugin.json`, `mcp_config.json`, `assets/`, `README.md`, excluding `docs/`, `src/`, `scripts/`, `node_modules/`) to `~/.gemini/config/plugins/context-monitor/`. `package.json`, `plugin.json`, `src/server.mjs`, and `src/ui/main.js` remain at version `0.1.0` during Spec 1 (`schemaVersion: 2` indicates the v2 wire contract) and bump to `0.2.0` when Spec 2 ships. Rolling back restores the prior `dist/` bundle and restarts `context-monitor_context-monitor` (the installed plugin MCP server ID).

## Risks & Limits

*   **Offline Unannotated Interactive Sessions:** If a user starts a brand-new conversation before `~/.gemini/antigravity/annotations/<id>.pbtxt` flushes to disk and `ConversationService` env vars are absent or timed out, the disk-first classifier classifies that session as `"background"` until `.pbtxt` appears or enrichment recovers. Mitigation: callers can pass `includeSubagents: true` or pass the explicit `conversationId`, and `summaryCache` checks `.pbtxt` state outside `transcript.jsonl` `mtimeMs` hits.
*   **Partial or Corrupt JSONL Rows Mid-Turn:** Active conversations can write partial trailing JSON lines while `fs.readFileSync` reads `transcript.jsonl` or `transcript_full.jsonl`. Mitigation: `parseJsonlFile` and `summarizeConversationFast` catch per-line `JSON.parse` errors and skip incomplete trailing lines without failing the snapshot.
*   **Broken or Escaping Symlinks in Workspace Customizations:** `.agents/rules/*.md` or `.agents/skills/*/SKILL.md` may contain dangling symlinks (`ENOENT`) or symlinks pointing outside `workspace.path`. Mitigation: `scanLocalInventory` wraps `fs.realpathSync` in `try/catch`, verifies targets stay within resolved `workspace.path`, and deduplicates by real path.
*   **Cold-Start & 15-Second Polling Latency:** Scanning 500+ transcripts or uncached `SKILL.md` files and unreachable external endpoints on every 15-second poll can stall UI refreshes. Mitigation: default views filter upfront by annotations + `serviceMap`, `scanLocalInventory` caches with mtimes and 4 KiB head reads, external requests run concurrently with cooldowns, and inventory/list arrays enforce explicit upper caps.

## Detailed Implementation Plan

### Required Skills for Execution Session

Load these skills at the start of the implementation session before editing any code (or before editing `src/ui/*` for `modern-web-guidance`):

1.  `mcp-app-development` (`~/.gemini/antigravity/builtin/skills/mcp-app-development/SKILL.md` — tool visibility, `structuredContent` 1 MiB cap, MCP server lifecycle)
2.  `agy-customizations` (`~/.gemini/antigravity/builtin/skills/agy-customizations/SKILL.md` — workspace `.agents/` discovery rules, 24,000-byte per-file rule cap, `config.json` plugin precedence)
3.  `conversations` (`~/.gemini/antigravity/builtin/skills/conversations/SKILL.md` — `ConversationService/ListConversations` Connect HTTP+JSON schema and headers)
4.  `modern-web-guidance` (`~/.gemini/config/plugins/modern-web-guidance-plugin/skills/modern-web-guidance/SKILL.md` — required before editing `src/ui/main.js` and `src/ui/styles.css`)

### Target Files to Modify

Note: `package.json` and `plugin.json` are intentionally excluded from Spec 1 edits because release version strings stay at `0.1.0` until Spec 2 ships.

#### 1. `src/analyzer.mjs` (Modify)

*   **Type / Scope**: Core local transcript analyzer, workspace/plugin inventory scanner, and fleet index engine.
*   **Rationale**: Implements v2 classification, CLI-aligned `segments`, `trajectory`, `topTools`, `artifacts`, cumulative counters, `listConversations`, `ConversationService` status/caching, `config.json` plugin precedence, and workspace customization scanning.
*   **Proposed Changes**:
    1.  **Dynamic `resolvePaths(overrides)` refactor**: Replace all module-level path constants (`GEMINI_HOME`, `ANTIGRAVITY_DIR`, `BRAIN_DIR`, `ANNOTATIONS_DIR`, `MCP_SCHEMAS_DIR`, `CONFIG_DIR`, `PLUGINS_DIR`, `BUILTIN_SKILLS_DIR`) with `resolvePaths(overrides)` reading `process.env.CONTEXT_MONITOR_GEMINI_HOME || path.join(os.homedir(), ".gemini")` so `readAnnotationTitle`, `loadBestTranscriptRows`, `scanLocalInventory`, and `getContextSnapshot` work cleanly against isolated test fixtures.
    2.  **`fetchConversationServiceTitles(maxCount = 200)`**: Implement `ListConversations` (`pageSize: 100`, `pageToken`, `includeArchived: false`, 2 pages max within `350 ms`), exact `conv.metadata?.{projectId, parentConversationId, rootConversationId}` extraction, `"partial"` page handling, 15s success / 30s error cooldown cache, and `{ map, status }` return value (updating the destructuring call site in `getContextSnapshot`).
    3.  **Upfront annotation gating, `summaryCache`, and `fleet` indexing**:
        *   Key `summaryCache` by resolved `transcriptPath`, evict deleted entries on scan, evaluate `~/.gemini/antigravity/annotations/<id>.pbtxt` outside transcript `mtimeMs` hits, and extract `childConversationIds` only from `GENERIC` rows matching the anchored `Created the following subagent:` JSON block (excluding self-ID) plus `turnCount` (omitting unused `hasUserInput`).
        *   For default `getContextSnapshot` (`includeSubagents: false`), filter candidate directories via `.pbtxt` + `serviceMap` before reading transcript bodies so synchronous reads stay bounded to top `limit`; run full-corpus indexing for `includeSubagents: true` or `listConversations`, computing `fleet` counters across indexed threads.
    4.  **`analyzeTranscriptRows` v2 extensions (export `analyzeTranscriptRows` & `scanLocalInventory`; accept `includeDetails = true`)**:
        *   Implement the six CLI-aligned `segments` with `kind: "estimated"` and `detail` copy, preserving `initialMessagesEst` in `user_messages`, `checkpoint_buffer` clamping when `postCpPlannerIdx === -1`, `rows[anchorIdx]` split (`content + thinking` vs non-empty `tool_calls` with no `1`-char floor on empty arrays), and `agent_responses` zero-weight fallback.
        *   Initialize `exact.cumulativeInputTokens`, `exact.cumulativeCacheReadTokens`, and `exact.cacheInvalidationCount` (including `0` defaults when `latestPlannerIdx === -1`), applying the consecutive non-checkpoint `cacheInvalidationCount` rule.
        *   When `includeDetails` is `true`, populate `trajectory` (`stepIndex` from `row.step_index ?? rowIndex`, `totalTurnCount: exact.turnCount`, kind precedence, `"checkpoint_baseline"` on `activeEpoch[0]`, trailing-checkpoint peak handling, 120-turn active-epoch cap), `topTools` (`serializedToolCallChars` distribution fallback, non-contiguous `GENERIC` batch scan stopping at `PLANNER_RESPONSE` / `USER_INPUT` / `CHECKPOINT`, skip `anchorIdx` when `latestPlannerIdx === anchorIdx`, tie-break by `name` ascending), and `artifacts` via non-recursive top-level `*.md` scan sorted by `mtimeMs` descending (`{ name, bytes, estTokens, mtimeMs, userFacing, summary }`, `false`/`null` defaults, single-line 160-char summary, totals over all matching files before slicing top 20). When `includeDetails` is `false`, omit `trajectory`, `topTools`, and `artifacts` from `current`.
    5.  **`scanLocalInventory({ workspacePath, mcpRoots, projectId } = {})`**:
        *   Apply `config.json` `plugins[entry.name]?.enabled ?? plugins[pluginJson?.name]?.enabled ?? !pluginJson?.disabled` across MCP, rules, and skills.
        *   Resolve workspace in priority order (`workspacePath` -> `projectId` via `projects/<projectId>.json` -> `mcpRoots`), validating paths with `fileURLToPath`, `fs.realpathSync`, `stat.isDirectory()`, and root/home rejection, falling through on invalid `workspacePath`.
        *   Scan workspace rules and skills across `.agents`, `.agent`, `_agents`, `_agent`, deduplicating via `realpathSync` with symlink-escape guards, setting uniform `overPerFileCap` across all rule scopes, extending `byScope.workspace`, capping `rules.items` (80), `skills.items` (80), and `mcp.servers` (100), caching scans by mtime/TTL, and bounding `inspectSkillMetadata` reads to 4 KiB.
    6.  **`getContextSnapshot` & `listConversations`**: Accept `includeDetails = true` in `getContextSnapshot` (passing it to `analyzeTranscriptRows` and `artifacts` scan), implement zero-interactive fallback (`current` picks latest overall, `conversations` returns `[]`), `conversations[]` and `current.kind` fields, and `listConversations` with `schemaVersion: 2`, `filter` / `includeSubagents` rules, `high_usage` (`usedPercent >= 70`), substring search, and pagination.

#### 2. `src/server.mjs` (Modify)

*   **Type / Scope**: MCP stdio server tool registration, capability queries, and response formatting.
*   **Rationale**: Exposes v2 parameters, resolves and caches MCP `roots/list`, registers `list_conversations`, and updates text summaries.
*   **Proposed Changes**:
    1.  Add `resolveMcpRoots(server)`: check `server.server.getClientCapabilities()?.roots`, skip when `workspacePath` is provided, race `server.server.listRoots()` against `250 ms`, unwrap `(res?.roots ?? []).map(r => r.uri)` into `string[]`, cache until `notifications/roots/list_changed`, and catch errors to `[]`.
    2.  Update `open_context_monitor` and `get_context_snapshot` Zod `inputSchema` to accept `conversationId?`, `workspacePath?`, `includeSubagents?` (plus `limit?` on `get_context_snapshot`), running `resolveMcpRoots(server)` in both tools when `workspacePath` is omitted, passing `includeDetails: false` in `open_context_monitor` and `includeDetails: true` in `get_context_snapshot`.
    3.  Register app-only `list_conversations` (`visibility: ["app"]`, read-only annotations, `query?`, `filter?`, `includeSubagents?`, `offset?` `int >= 0`, `limit?` `int 1..100`) returning concise `content` text and `structuredContent`.
    4.  Update `formatSummaryText(snapshot)` to include interactive vs total fleet counts and append the `ConversationService` status line whenever `!serviceStatus.reachable || serviceStatus.reason === "partial"`.

#### 3. `src/ui/main.js` (Modify)

*   **Type / Scope**: Minimal v0.1.0 side-panel compatibility sync (full v2 UI deferred to Spec 2).
*   **Rationale**: Keeps checkpoint tooltips working and ensures workspace skill counts appear in the skills scope summary.
*   **Proposed Changes**:
    1.  Update tooltip checks in `patchInPlace` and `render` from `seg.id === "baseline" || seg.id === "checkpoint_summary"` to include `seg.id === "checkpoint_buffer"` (keeping `checkpoint_summary` as a transitional fallback for older snapshots).
    2.  Update `skills-scope` in `patchInPlace` and `render` to append `${skillsInfo.byScope.workspace} workspace` whenever `skillsInfo.byScope?.workspace > 0`.

#### 4. `src/ui/styles.css` (Modify)

*   **Type / Scope**: Minimal v0.1.0 side-panel CSS compatibility fix.
*   **Rationale**: Prevents `Agent responses` (`colorKey: "amber"`) and `Checkpoint buffer` (`colorKey: "violet"`) from rendering identically in violet.
*   **Proposed Changes**:
    *   Define a distinct `--seg-amber` color variable (light and dark themes) and update `.swatch-amber, .bar-amber` to use `var(--seg-amber)` instead of `var(--seg-violet)`.

#### 5. `scripts/test-server.mjs` (Modify)

*   **Type / Scope**: Automated unit fixture tests and live MCP stdio integration tests.
*   **Rationale**: Validates v2 analyzer invariants directly in Phase 1A and MCP stdio contracts on `dist/server.mjs` in Phase 1B without touching `~/.gemini`.
*   **Proposed Changes**:
    1.  Support running pure `src/analyzer.mjs` unit fixture tests directly (or via `--unit` flag in Phase 1A before `dist/server.mjs` is built), and full `dist/server.mjs` stdio integration tests in Phase 1B.
    2.  Update live stdio checks against `dist/server.mjs` (`open_context_monitor`, `get_context_snapshot`, `list_conversations`, `ui://context-monitor/app.html`), asserting `schemaVersion === 2`, that `open_context_monitor` omits `current.trajectory`, `current.topTools`, and `current.artifacts` while `get_context_snapshot` includes them (`if (snap.current?.hasUsageData)`), `list_conversations` `_meta.ui.visibility` equals `["app"]`, `< 1 MiB` byte limit on both `structuredContent` and full serialized `CallToolResult`, and preserving `if (snap.current?.hasUsageData)` around segment/percentage invariants.
    3.  Add isolated temporary-directory (`fs.mkdtempSync`) fixture tests (via `CONTEXT_MONITOR_GEMINI_HOME`, cleaned up in `finally`) covering:
        *   Annotation-gated classification (`interactive`, `subagent`, `background`), self-ID/tool-output subagent false-positive guard, `includeSubagents` toggling, and direct subagent `conversationId` inspection.
        *   CLI breakdown allocation (all 6 segments, zero-weight fallback, `initialMessagesEst`, trailing checkpoint), cumulative session counters, and `cacheInvalidationCount`.
        *   `trajectory` bounding on a 150-turn, 2-checkpoint transcript (`isBounded: true`).
        *   `topTools` positional, diverged-batch, non-contiguous `GENERIC`, and 1-turn empty handling.
        *   `artifacts` scan (`*.md` + `.metadata.json`, defaults, top-20 cap).
        *   `config.json` precedence (`true` over `disabled: true`, `false` over active `plugin.json` without `disabled: true`), `projects/<projectId>.json` resolution, `resolveMcpRoots` (including 250 ms timeout), and workspace `.agents/` rules (`overPerFileCap`, symlink escape guard) + skills (`byScope.workspace`).
        *   `list_conversations` pagination, search, and `filter` modes, plus `ConversationService` (`missing_env`, mock HTTP `ok` / `partial`, timeout/cooldown).

#### 6. `README.md` (Modify)

*   **Type / Scope**: Plugin documentation.
*   **Rationale**: Documents v2 metrics, CLI-aligned categories, `list_conversations`, workspace discovery inputs, and exact runtime sync exclusions.
*   **Proposed Changes**:
    *   Update `"What it reads"` and `"Exact metrics vs local estimates"` for workspace `.agents/` discovery, `config.json` plugin precedence, conversation artifacts, trajectories, and `list_conversations`.
    *   Update `"Install into Antigravity"` to specify syncing only `dist/`, `plugin.json`, `mcp_config.json`, `assets/`, and `README.md` (excluding `docs/`, `src/`, `scripts/`, and `node_modules/`).

### Generated Build Outputs (Rebuilt via `npm run build`)

*   **Type / Scope**: Bundled runtime artifacts (`dist/server.mjs`, `dist/app.html`).
*   **Rationale**: Emitted automatically by `scripts/build.mjs` from `src/`; excluded from manual editing.

### Phased Execution Sequence

1.  **Phase 1A (Analyzer v2 & Unit Fixture Verification)**: Update `src/analyzer.mjs`, add pure unit fixture assertions in `scripts/test-server.mjs` (runnable directly against `src/analyzer.mjs`), and verify all pure analyzer invariants (`segments`, `trajectory`, `topTools`, `artifacts`, `fleet`, `listConversations`, `scanLocalInventory`, `projects/*.json`).
2.  **Phase 1B (MCP Server v2, UI/CSS Compatibility, Build & Stdio Integration)**: Update `src/server.mjs`, `src/ui/main.js`, `src/ui/styles.css`, `scripts/test-server.mjs` (stdio checks), and `README.md`; run `npm run build && npm test && agy plugin validate . --strict`.

### Verification Plan

*   **Compilation / Build**: `npm run build` in the repository root exits 0 and emits `dist/app.html` and `dist/server.mjs`.
*   **Unit & Integration Tests**: `npm test` exits 0, passing both pure analyzer fixture tests and live stdio checks across all three tools (`open_context_monitor`, `get_context_snapshot`, `list_conversations`), confirming both `structuredContent` and full serialized `CallToolResult` payloads stay `< 1 MiB` and every segment/percentage sum invariant holds.
*   **Static Validation**: `agy plugin validate . --strict` passes with zero errors.
*   **Sync Safety (Pre-Sync Diff Gate)**: Show `git status` / diffs and explicit sync commands (copying `dist/`, `plugin.json`, `mcp_config.json`, `assets/`, `README.md` while excluding `docs/`, `src/`, `scripts/`, `node_modules/`) to the user before updating `~/.gemini/config/plugins/context-monitor/` and refreshing `context-monitor_context-monitor`.
