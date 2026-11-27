# Context Monitor v0.2: Global Workspace UX & Fleet Explorer (Spec 2)

- **Author:** pakhinnn1
- **Status:** Implemented (Synced & Verified)
- **Date:** 2026-11-27

---

## Overview

This specification (Spec 2) defines the v0.2.0 global sidebar workspace UX, paginated fleet explorer, offline workspace persistence, full Spec 1 detail visualization, and capability-gated host actions for the Antigravity Context Monitor plugin (this repository).

Spec 1 ([Metrics and Inventory v2](./metrics_and_inventory_v2.md)) implemented and verified the `schemaVersion: 2` analyzer and MCP contract (`open_context_monitor` and `get_context_snapshot`), including CLI-aligned `segments`, `trajectory`, `topTools`, `artifacts`, cumulative session counters, `config.json` plugin precedence, and workspace customization scanning. Spec 2 builds directly on that contract to complete the v0.2.0 release across both Antigravity UI entrypoints:

- **Responsive dual-surface layout:** Adapts smoothly between the narrow `aux_pane` side panel (`< 760px`) and the full-page `global` sidebar workspace (`>= 760px`) via CSS Container Queries (`@container cm-shell`).
- **Paginated fleet explorer:** Adds app-only `list_conversations` (`visibility: ["app"]`) with interactive fleet KPIs, search, filtering, sorting, pagination, and a `Show all` toggle for `subagent` and `background` threads.
- **Offline workspace discovery and persistence:** Solves the live Spec 1 observation where standalone MCP stdio subprocesses lack `ANTIGRAVITY_LS_ADDRESS`/`ANTIGRAVITY_CSRF_TOKEN` and MCP `roots/list` by discovering registered Antigravity projects from `~/.gemini/config/projects/*.json`, carrying initial `workspacePath` args across polls, and persisting user-selected workspace and filter preferences server-side in `${PLUGIN_DATA}/preferences.json`.
- **Spec 1 detail visualization & mount hydration:** Hydrates `trajectory`, `topTools`, and `artifacts` on mount via `get_context_snapshot` when `open_context_monitor` omits them (`includeDetails: false`), rendering a zero-dependency inline SVG trajectory chart, ranked tool micro-bars, disk artifact rows, cumulative session counters, rule `overPerFileCap` badges, and `serviceStatus` telemetry.
- **Capability-gated host bridge actions:** Surfaces `Attach context` (`app.updateModelContext`) and click-to-open file actions (`com.google.antigravity/toggle-aux-pane` with `tabType: "fileView"`) only where supported, and ships the `0.2.0` release bump.

### Resolved Architectural Decisions

- **Workspace path handling when `ConversationService` and MCP `roots/list` are unavailable:**
  1. Scan `~/.gemini/config/projects/*.json` to populate `inventory.knownWorkspaces[]`, giving users a deterministic Workspace Picker in both `aux_pane` and `global` without scraping transcripts or walking `process.cwd()`.
  2. Capture explicit `workspacePath` from `open_context_monitor` in `app.ontoolinput` (`selectedWorkspacePath`) so subsequent 15-second polls and thread switches preserve model-passed workspace context.
  3. Persist user-selected `workspacePath` and `includeSubagents` server-side in `${PLUGIN_DATA}/preferences.json` via app-only `set_context_preferences` (passing `--data-dir=${PLUGIN_DATA}` in `mcp_config.json`, falling back cleanly to in-memory-only mode when `--data-dir` is absent or unexpanded).
  4. Extend `resolveWorkspaceRoot` precedence in `src/analyzer.mjs` to `arg` > `project_id` > `mcp_roots` > `saved` > `none`. Selecting a workspace in the UI passes `workspacePath` explicitly (overriding `mcp_roots` / `project_id` and persisting as `saved` across reloads); choosing `Auto` clears the saved override and omits `workspacePath` so automatic `project_id` / `mcp_roots` resolution resumes.
- **Paginated fleet explorer separation:** Introduce app-only `list_conversations` (`visibility: ["app"]`) returning paginated, filtered, and sorted `items` alongside interactive-scoped `fleet` KPIs, keeping `open_context_monitor` on Spec 1's fast top-35 interactive gating (`< 256 KiB` typical, `< 1 MiB` hard cap).
- **Dual-surface layout via CSS Container Queries:** Because Antigravity reports `hostContext.displayMode: "inline"` for inline, `aux_pane`, and `global` surfaces alike, layout breakpoints use `@container cm-shell (min-width: 760px)` rather than `displayMode`, while conversation-bound host actions (`updateModelContext`, `toggle-aux-pane`) remain strictly gated on `app.getHostCapabilities()`.
- **Mount-time detail hydration & concurrency cap:** When `ontoolresult` receives a snapshot with `hasUsageData: true` and `trajectory === undefined`, immediately issue a silent `get_context_snapshot` on mount (and `list_conversations` when the wide rail is active), serialized through a 2-lane client request queue so the app stays safely below Antigravity's 4-in-flight `callServerTool` limit.
- **Zero-dependency inline SVG trajectory chart:** Render `current.trajectory` with native inline SVG styled from host CSS variables (the default MCP App CSP blocks external scripts/styles, and zero new npm dependencies are required).
- **Release version `0.2.0` bump:** Bump `package.json`, `plugin.json`, `src/server.mjs`, `src/ui/main.js`, and `scripts/test-server.mjs` test client version strings from `0.1.0` to `0.2.0` as Spec 2 ships.

## The Problem

Live desktop verification of Spec 1 in both `aux_pane` and `global` surfaced four UX, data-hydration, and workspace-discovery gaps that Spec 2 resolves:

1. **The full-page `global` sidebar reuses the narrow `aux_pane` single-column layout.** `.panel` constrains content to `max-width: 520px`, leaving large blank margins in the full-page sidebar and forcing users to navigate 500+ tracked conversations through an unsearchable `<select>` capped at 35 interactive threads, with no UI control to toggle `includeSubagents`.
2. **Spec 1 detail payloads remain invisible and unhydrated on mount.** `open_context_monitor` passes `includeDetails: false` to protect model context size, while `src/ui/main.js` does not request `get_context_snapshot` until the 15-second timer fires and renders none of `current.trajectory`, `current.topTools`, `current.artifacts`, `exact.cumulativeInputTokens`, `exact.cumulativeCacheReadTokens`, `exact.cacheInvalidationCount`, rule `overPerFileCap`, or `serviceStatus`.
3. **Workspace rules and skills stay at `0` in standalone stdio MCP sessions.** Live smoke testing confirmed that standalone MCP stdio subprocesses receive neither `ANTIGRAVITY_LS_ADDRESS`/`ANTIGRAVITY_CSRF_TOKEN` (`ConversationService: offline (missing_env)`) nor MCP `roots/list`, and app-only `get_context_snapshot` refreshes do not forward `workspacePath`. Without `arg`, `project_id`, or `mcp_roots`, `inventory.workspace` falls back to `{ path: null, source: "none" }` and `byScope.workspace` stays `0` even when workspace rules and skills exist on disk.
4. **No host workflow actions exist in the UI.** Users in `aux_pane` cannot attach a concise context summary pill to their next prompt (`app.updateModelContext`) or click an artifact or rule file to inspect it directly in an Antigravity side-pane tab (`com.google.antigravity/toggle-aux-pane`).

## Goals

- **G1 — Dual-surface container-query UI:** Deliver a crisp two-column master-detail workspace at `>= 760px` (`global`) while preserving the compact, scannable `aux_pane` flow at `< 760px` without visual bloat or horizontal overflow.
- **G2 — Paginated fleet explorer (`list_conversations`):** Provide fleet-wide interactive KPIs (`totalTracked`, `interactiveCount`, `nonInteractiveCount`, `highUsageInteractiveCount`, `checkpointedInteractiveCount`, `runningCount`), debounced text search, kind/status filters, sort modes, pagination, and a `Show all` subagent/background toggle.
- **G3 — Deterministic offline workspace discovery and persistence:** Surface Antigravity's registered projects (`~/.gemini/config/projects/*.json`) via `inventory.knownWorkspaces`, preserve initial `open_context_monitor` `workspacePath` arguments via `ontoolinput`, persist user workspace/filter choices in `${PLUGIN_DATA}/preferences.json` via `set_context_preferences`, and support `saved` fallback resolution in `resolveWorkspaceRoot`.
- **G4 — Mount-time hydration & full Spec 1 metrics visualization:** Immediately hydrate `get_context_snapshot` on mount when `trajectory === undefined`, and render the inline SVG trajectory chart, top tool contributors, disk artifacts, cumulative session counters, `overPerFileCap` rule warnings, and non-alarming `serviceStatus` telemetry.
- **G5 — Capability-gated host bridge actions:** Enable explicit user-triggered `Attach context` (`app.updateModelContext`) and artifact/rule `Open file` (`com.google.antigravity/toggle-aux-pane`) in conversation-bound views while cleanly hiding or guarding them in `global` and non-Antigravity hosts.
- **G6 — Keyboard navigation, accessibility, and strict platform budgets:** Support keyboard shortcuts, focus preservation across 15-second polls, `prefers-reduced-motion`, `forced-colors`, `44px` coarse-pointer targets, `<= 2` concurrent client MCP calls (under the 4-call cap), and `< 1 MiB` payloads.
- **G7 — v0.2.0 release packaging and verification:** Bump release versions to `0.2.0`, expand `scripts/test-analyzer.mjs` and `scripts/test-server.mjs`, pass `npm run build && npm test && agy plugin validate . --strict`, obtain pre-sync diff approval, sync runtime files, and smoke-test `aux_pane` and `global`.

## Non-Goals

- **NG1 — Scraping undocumented host internals or `process.cwd()`:** Never read `conversation_summaries.db`, `antigravity_state.pbtxt`, OS process tables, or transcript file paths to guess `workspacePath` or `ANTIGRAVITY_CSRF_TOKEN`.
- **NG2 — Mutating Antigravity user data:** Never modify transcripts, annotations, or `~/.gemini/config/` files; server writes are strictly scoped to plugin-private `${PLUGIN_DATA}/preferences.json`.
- **NG3 — External chart libraries or CDN dependencies:** Do not add Chart.js, ECharts, Recharts, or remote stylesheet/script origins (blocked by default MCP App CSP).
- **NG4 — Subagent token rollup, burn-rate forecasting, or model switch timelines:** Keep Spec 1's per-thread exact accounting and latest-turn model attribution unchanged.
- **NG5 — Browser storage persistence:** Do not rely on `localStorage`, `IndexedDB`, or cookies, because Antigravity MCP App iframes load on ephemeral isolated origins.
- **NG6 — Automatic `updateModelContext` injection:** Never attach model context automatically on mount, thread switch, or background poll; only attach or clear on explicit user button clicks.
- **NG7 — Syncing dev/docs artifacts to the installed plugin:** Keep `docs/`, `src/`, `scripts/`, and `node_modules/` out of `~/.gemini/config/plugins/context-monitor/`.

## Open Questions

None.

## Critical User Journeys (CUJs)

### CUJ 1: Explore and Triage a 500+ Thread Corpus in the `global` Sidebar

- **Given:** A local corpus of 500+ transcripts exists under `~/.gemini/antigravity/brain/`, including 100 interactive threads (several `>= 70%` context usage or with `checkpointCount > 0`) and 400 unannotated subagent/background threads.
- **When:** The user opens Context Monitor from the left sidebar (`global` entrypoint, viewport `>= 760px`), inspects the fleet KPI strip, types a query into the search box, toggles the `>= 70%` or `Checkpointed` filter chip, switches sort order to `Highest usage`, clicks `Load more`, or toggles `Show all` threads.
- **Then:** The UI invokes app-only `list_conversations`, displays accurate interactive fleet counts alongside paginated matching items without overflowing memory or DOM nodes, and clicking any thread loads its full snapshot into the right-hand inspector without clearing the user's search input or scroll position.

### CUJ 2: Select and Persist a Workspace Offline (`ConversationService` & MCP `roots/list` Unavailable)

- **Given:** The MCP server runs standalone without `ANTIGRAVITY_LS_ADDRESS`/`ANTIGRAVITY_CSRF_TOKEN` and without MCP `roots/list`, and `~/.gemini/config/projects/*.json` contains valid project entries pointing to repositories with `AGENTS.md` and `.agents/skills/*/SKILL.md`.
- **When:** The user opens the Workspace Picker, selects a registered workspace from `inventory.knownWorkspaces`, reloads the `global` view (or opens `aux_pane`), and later resets the picker to `Auto`.
- **Then:** Selecting a workspace persists it via `set_context_preferences` to `${PLUGIN_DATA}/preferences.json` and immediately refreshes `inventory.workspace` (`source: "arg"` on the explicit picker call, `source: "saved"` on subsequent default launches) with non-zero `byScope.workspace` and workspace rule rows; resetting to `Auto` clears the saved override (`workspacePath: null`) so `project_id` or `mcp_roots` precedence resumes.

### CUJ 3: Inspect Mount-Hydrated Trajectory, Top Tools, Artifacts, and Cumulative Counters

- **Given:** The selected conversation has 130+ turns, at least one `CHECKPOINT`, tool outputs, and `.md` artifacts in `~/.gemini/antigravity/brain/<id>/`, and `open_context_monitor` initially delivered `includeDetails: false` (`trajectory === undefined`).
- **When:** The MCP App mounts in either `aux_pane` or `global`.
- **Then:** The client immediately calls `get_context_snapshot` on mount without waiting 15 seconds, renders the inline SVG trajectory chart (with compaction markers, hover/focus turn scrubbing, and bounded-epoch caption), ranked `Top tools`, disk `Artifacts`, cumulative session counters (`Cumulative input`, `Cumulative cache read`, `Cache invalidations`), `> 24 KB` rule badges, and `Service` status in `Exact transcript counters`.

### CUJ 4: Capability-Gated Host Actions in `aux_pane` vs `global`

- **Given:** The user views the same thread in `aux_pane` (where `app.getHostCapabilities().updateModelContext` is present) and in `global` (where conversation-scoped host capabilities are absent).
- **When:** The user inspects the action toolbar, clicks `Attach context` (and later `Clear`) in `aux_pane`, and clicks a workspace rule or conversation artifact row.
- **Then:** In `aux_pane`, `Attach context` calls `app.updateModelContext` with a concise structured summary pill (and `Clear` resets it with `content: []`), and clicking an artifact or rule row invokes `com.google.antigravity/toggle-aux-pane` with `tabType: "fileView"` and `fileUri`; in `global`, `Attach context` is hidden and file-open controls remain hidden or cleanly no-op with an accessible status note if unsupported.

## Technical Plan (Architecture)

### System & Surface Data Flow

Context Monitor v0.2.0 separates read-only local telemetry from plugin-private preference state while adapting one bundled `ui://context-monitor/app.html` document across both Antigravity surfaces:

```text
Local Disk & Plugin Data                    MCP Server (dist/server.mjs v0.2.0)
────────────────────────                    ───────────────────────────────────
~/.gemini/antigravity/brain/<id>/           src/preferences.mjs
~/.gemini/antigravity/annotations/*.pbtxt     ├── --data-dir=${PLUGIN_DATA}
~/.gemini/config/projects/*.json              └── preferences.json (atomic, <= 4 KiB)
~/.gemini/config/{config,mcp_config}.json   src/analyzer.mjs
<workspace>/{GEMINI,AGENTS}.md & .agents/*    ├── getContextSnapshot (+ saved fallback)
${PLUGIN_DATA}/preferences.json               ├── listConversations (+ fleet KPIs)
        │                                     └── scanLocalInventory (+ knownWorkspaces, fileUri)
        └──────────────────────────────────► src/server.mjs
                                              ├── open_context_monitor  ["model", "app"]
                                              ├── get_context_snapshot  ["app"]
                                              ├── list_conversations    ["app"]
                                              └── set_context_preferences ["app"]
                                                        │
                                                        ▼ (JSON-RPC postMessage)
                                            Single-File UI (dist/app.html)
                                              ├── @container cm-shell (< 760px: aux_pane)
                                              ├── @container cm-shell (>= 760px: global)
                                              └── Capability-gated Host Bridge
                                                    ├── app.updateModelContext
                                                    └── com.google.antigravity/toggle-aux-pane
```

### Workspace Path Handling & Preference Persistence (`src/preferences.mjs`, `src/analyzer.mjs`, `mcp_config.json`)

1. **Plugin Data Directory Wiring (`mcp_config.json` & `src/preferences.mjs`):**
   - Update `mcp_config.json` `args` to `["${PLUGIN_ROOT}/dist/server.mjs", "--data-dir=${PLUGIN_DATA}"]`.
   - `src/preferences.mjs` exposes `resolveDataDir(argv = process.argv.slice(2), env = process.env)`: reads `--data-dir=<dir>` (or `--data-dir <dir>`), falling back to `env.CONTEXT_MONITOR_DATA_DIR`. If the value is empty, whitespace, or an unexpanded literal `"${PLUGIN_DATA}"`, it returns `null` so unit tests and standalone CLI runs operate cleanly in in-memory-only mode (`persisted: false`) without writing to unexpected paths.
   - Preference file path: `<dataDir>/preferences.json` with validated schema:

     ```json
     { "version": 1, "workspacePath": null, "includeSubagents": false }
     ```

   - `loadPreferences(dataDir)`: reads `<dataDir>/preferences.json` safely, treats missing/corrupt JSON as defaults, and validates `workspacePath` through `validateWorkspaceDir` from `src/analyzer.mjs` (discarding deleted, root, or home-dir paths as `null`).
   - `savePreferences(dataDir, patch)`: merges `workspacePath` (string validated via `validateWorkspaceDir`, or `null` to clear; throws a clean validation error if a non-null string fails `validateWorkspaceDir`) and `includeSubagents` (boolean), rejects payloads exceeding `4096` bytes, ensures `dataDir` exists (`fs.mkdirSync(dataDir, { recursive: true })`), and writes atomically via a sibling temp file + `fs.renameSync`. Returns `{ workspacePath, includeSubagents, persisted: Boolean(dataDir) }`.

2. **Known Workspaces Discovery (`listKnownWorkspaces` in `src/analyzer.mjs`):**
   - Scan `paths.projectsDir` (`~/.gemini/config/projects/*.json`) for valid project descriptors.
   - Skip entries without valid directory `file://` URIs (such as `default-cli-project.json` with empty `projectResources` or sidecar descriptors like `swarm/swarm_board`).
   - Extract the first valid directory URI per project from `projectResources.resources[].gitFolder.folderUri`, `localFolder.folderUri`, or direct `folderUri`, resolving and validating via `validateWorkspaceDir` (rejecting non-existent directories, `/`, and `os.homedir()`).
   - Deduplicate by resolved realpath (keeping the project entry with a non-empty `name`), sort by `name` ascending (tie-breaking by `path` ascending), and cap at `50` entries (`{ id, name, path }`).
   - Expose on `inventory.knownWorkspaces: Array<{ id: string, name: string, path: string }>`.

3. **Updated Workspace Resolution Precedence (`resolveWorkspaceRoot`):**
   - Update signature to `resolveWorkspaceRoot({ workspacePath, mcpRoots, projectId, savedWorkspacePath }, paths)`:
     1. `workspacePath` argument validated via `validateWorkspaceDir` -> `{ path, source: "arg" }`.
     2. `projectId` (via `~/.gemini/config/projects/<projectId>.json`) -> `{ path, source: "project_id" }`.
     3. `mcpRoots` `file://` URIs -> `{ path, source: "mcp_roots" }`.
     4. `savedWorkspacePath` validated via `validateWorkspaceDir` -> `{ path, source: "saved" }`.
     5. Fallback -> `{ path: null, source: "none" }`.
   - Pass `savedWorkspacePath` through `getContextSnapshot` into `scanLocalInventory`.

4. **Client Carry-Through & Manual Override Semantics (`src/ui/main.js`):**
   - `app.ontoolinput` captures valid `args.workspacePath` into session-local `selectedWorkspacePath` (without mutating disk `preferences.json`) so 15-second `get_context_snapshot` polls keep the model-supplied workspace active.
   - On initial `ontoolresult`, if `selectedWorkspacePath` is still unset and `result.structuredContent.preferences?.workspacePath` is set, hydrate `selectedWorkspacePath` from `preferences.workspacePath` (and sync `includeSubagents` from `preferences.includeSubagents`).
   - When the user picks a workspace in the Workspace Picker:
     - UI calls `set_context_preferences({ workspacePath })`, sets `selectedWorkspacePath = workspacePath`, and refreshes `get_context_snapshot` passing `workspacePath` explicitly (which wins at priority 1 `source: "arg"`, overriding even if `mcp_roots` is present, and survives reloads via priority 4 `source: "saved"`).
   - When the user chooses `Auto` in the Workspace Picker:
     - UI calls `set_context_preferences({ workspacePath: null })`, clears `selectedWorkspacePath = null`, and refreshes `get_context_snapshot` omitting `workspacePath` so `project_id` or `mcp_roots` take precedence automatically.

5. **File URIs for `toggle-aux-pane` (`src/analyzer.mjs`):**
   - Attach `fileUri: pathToFileURL(realPath).href` to each item in `current.artifacts.items[]` and `inventory.rules.items[]` (workspace, global, and plugin rules) so the UI can open any artifact or rule file safely without reconstructing paths client-side.

### Paginated Fleet Explorer & Aggregates (`listConversations` in `src/analyzer.mjs`)

Add `export async function listConversations({ query = "", kind = "interactive", filter = "all", sort = "recent", offset = 0, limit = 35, geminiHome } = {})`:

1. **Inputs & Validation:**
   - `query`: trimmed string; case-insensitive substring match across `title`, `conversationId`, `modelName`, and `modelId`.
   - `kind`: `"interactive" | "all" | "subagent" | "background"` (default `"interactive"`).
   - `filter`: `"all" | "high_usage" | "checkpointed" | "running"` (default `"all"`, where `high_usage` matches `usedPercent !== null && usedPercent >= 70`, `checkpointed` matches `checkpointCount > 0`, and `running` matches `runState === "RUN_STATE_RUNNING"`).
   - `sort`: `"recent"` (`mtimeMs` desc), `"usage_desc"` (`usedPercent` desc, nulls last, tie-break `mtimeMs` desc), `"tokens_desc"` (`activeTokens` desc, tie-break `mtimeMs` desc), `"checkpoints_desc"` (`checkpointCount` desc, tie-break `mtimeMs` desc).
   - `offset`: integer `>= 0` (default `0`).
   - `limit`: integer clamped to `1..100` (default `35`).

2. **Bounded Fleet Scanning Strategy:**
   - Reuse the shared directory scan and `summaryCache` (keyed by resolved `transcriptPath` with `mtimeMs` check + `.pbtxt` evaluation outside cache hits) and `fetchConversationServiceTitles(200)`.
   - Compute `interactiveCount` and `nonInteractiveCount` from fast `.pbtxt` + `serviceMap` classification across all `transcriptEntries` without opening non-interactive transcript bodies.
   - Summarize all interactive transcripts (cached in `summaryCache` after first warm pass) to compute exact `fleet` KPIs scoped to interactive threads (`fleetScope: "interactive"`):
     - `totalTracked`: `transcriptEntries.length`
     - `interactiveCount`: count of `kind === "interactive"`
     - `nonInteractiveCount`: `totalTracked - interactiveCount`
     - `highUsageInteractiveCount`: interactive threads with `usedPercent !== null && usedPercent >= 70`
     - `checkpointedInteractiveCount`: interactive threads with `checkpointCount > 0`
     - `runningCount`: interactive threads with `runState === "RUN_STATE_RUNNING"`
   - Only open and summarize `subagent`/`background` transcripts when `kind !== "interactive"` (with pre-filter short-circuiting when `filter === "running"` via `serviceMap`).
   - Apply `query`, `kind`, `filter`, and `sort`, then slice `[offset, offset + limit]` to produce `items` (`totalMatching`, `hasMore = offset + items.length < totalMatching`).

3. **Response Shape:**

   ```json
   {
     "schemaVersion": 2,
     "generatedAt": "...",
     "serviceStatus": { "reachable": false, "reason": "missing_env", "enrichedCount": 0 },
     "fleet": {
       "totalTracked": 537,
       "interactiveCount": 120,
       "nonInteractiveCount": 417,
       "highUsageInteractiveCount": 14,
       "checkpointedInteractiveCount": 9,
       "runningCount": 1,
       "fleetScope": "interactive"
     },
     "totalMatching": 120,
     "offset": 0,
     "limit": 35,
     "hasMore": true,
     "items": []
   }
   ```

### MCP Tool Surface (`src/server.mjs`, Version `0.2.0`)

| Tool Name                 | Visibility                   | Input Parameters                                                                         | Output Purpose                                                                                                                                                                                                                                                                                                                                                      |
| :------------------------ | :--------------------------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `open_context_monitor`    | `["model", "app"]` (default) | `conversationId?`, `workspacePath?`, `includeSubagents?`                                 | Primary UI entrypoint (`ui://context-monitor/app.html`, `aux_pane` + `global`). Applies saved `preferences.includeSubagents` when `includeSubagents` is omitted and passes `savedWorkspacePath: preferences.workspacePath`. Keeps `includeDetails: false` so model context stays `< 256 KiB` typical (`< 1 MiB` max). Appends `preferences` to `structuredContent`. |
| `get_context_snapshot`    | `["app"]`                    | `conversationId?`, `workspacePath?`, `includeSubagents?`, `limit?` (`1..100`, def `35`)  | App-only mount hydration, single-thread refresh, and workspace refresh (`includeDetails: true`). Applies saved preferences when omitted and returns full `trajectory`, `topTools`, `artifacts`, `inventory` (with `knownWorkspaces` and `fileUri`), and `preferences`.                                                                                              |
| `list_conversations`      | `["app"]`                    | `query?`, `kind?`, `filter?`, `sort?`, `offset?` (`>= 0`), `limit?` (`1..100`, def `35`) | App-only paginated fleet explorer returning `fleet` KPIs, `totalMatching`, `hasMore`, and matching `items[]`.                                                                                                                                                                                                                                                       |
| `set_context_preferences` | `["app"]`                    | `workspacePath?` (`string \| null`), `includeSubagents?` (`boolean`)                     | App-only server-side persistence in `${PLUGIN_DATA}/preferences.json` (or in-memory fallback when `--data-dir` is unset/unexpanded). Validates `workspacePath` via `validateWorkspaceDir` and returns `{ workspacePath, includeSubagents, persisted }`.                                                                                                             |

All four tools declare `annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }` except `set_context_preferences`, which updates only plugin-private preference state (`readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false`).

### Dual-Surface UI Architecture & Modular Structure (`src/ui/`)

`scripts/build.mjs` bundles `src/ui/main.js` and `src/ui/styles.css` via `esbuild` into single-file `dist/app.html`, so splitting client UI helpers into focused ES modules requires zero build pipeline changes:

- `src/ui/format.js`: Pure formatting and escaping helpers (`formatTokens`, `formatExactNumber`, `formatPercent`, `formatRelativeTime`, `escapeHtml`, `formatSkillsScope`, `formatWorkspaceLabel`, `formatAttachedContextSummary`).
- `src/ui/charts.js`: Inline SVG Context Trajectory chart renderer (`renderTrajectoryChart`) and interactive hover/focus scrubber binding (`bindTrajectoryScrubber`).
- `src/ui/rail.js`: Wide-mode conversation rail renderer (`renderFleetKpis`, `renderRailControls`, `renderRailList`, `renderRailFooter`) preserving scroll position and focus across refreshes.
- `src/ui/main.js`: `App` SDK lifecycle (`version: "0.2.0"`), 2-lane request coordinator, mount hydration, `ontoolinput` carry-through, Workspace Picker orchestration, host bridge actions, `patchInPlace` / structural `render`, keyboard shortcuts, and 15-second background polling.
- `src/ui/styles.css`: `@container cm-shell` and `@container cm-inspector` responsive grid rules, chart/rail/toolbar/chip/picker styling, and full dark/light/reduced-motion/forced-colors support.
- `src/ui/index.html`: Container-aware skeleton loader showing single-column placeholders below `760px` and two-column rail + inspector placeholders at `>= 760px`.

#### Responsive Breakpoints & Layout Behavior

1. **Outer Container (`.shell`):** `container-type: inline-size; container-name: cm-shell; width: 100%; min-height: 100vh;`.
2. **Compact Mode (`< 760px`, `aux_pane`):**
   - `.inspector` centers content up to `max-width: 520px` with compact `14px 16px 20px` padding, preserving v0.1.0 side-panel density.
   - Top bar displays the title, Workspace Picker compact trigger/select, capability-gated `Attach context` icon/pill button, methodology info toggletip, and `Refresh` button.
   - Thread bar keeps the `<select id="thread-select">` dropdown plus a compact `Show all` toggle (`includeSubagents`) and thread metadata (`modelName`, `windowSource`, `kind` badge when non-interactive, compactions).
   - Usage summary + segmented bar + CLI breakdown rows + secondary rows (`Prompt cache hit`, `MCP tools`, `Rules & skill index`).
   - Collapsible `<details>` drawers:
     - `Trajectory` (rendered when `points.length >= 2`, collapsed by default in compact mode to preserve side-panel vertical budget)
     - `Top tools` (ranked micro-bars when `topTools.length > 0`)
     - `Artifacts` (disk `.md` list with `userFacing` badge, `estTokens`, summary tooltip, and capability-gated `Open file` action)
     - `MCP tools` (Configured vs Cached on disk)
     - `Rules & skills` (with inline Workspace Picker summary + `> 24 KB` badge for `overPerFileCap` rules + capability-gated `Open file` action)
     - `Exact transcript counters` (exact counters + `Cumulative input`, `Cumulative cache read`, `Cache invalidations`, and `Service` row reporting `serviceStatus`).
3. **Wide Mode (`>= 760px`, `global` sidebar):**
   - `@container cm-shell (min-width: 760px)` switches `.shell` to a 2-column master-detail CSS grid:

     ```css
     grid-template-columns: clamp(276px, 28cqi, 336px) minmax(0, 1fr);
     height: 100vh;
     overflow: hidden;
     ```

   - **Left Rail (`<aside class="thread-rail">`):** Independent vertical scroll region with sticky top section:
     - **Fleet KPI Strip:** Compact 3-cell summary (`Interactive` / `Total`, `>= 70%`, `Checkpointed`, plus active `Running` indicator when `> 0`).
     - **Search & Filter Toolbar:** Search input (`#rail-search`, debounced `180 ms`), `Show all` (`includeSubagents` / kind selector `Interactive | All | Subagents | Background`), filter pills (`All`, `>= 70%`, `Checkpointed`, `Running`), and sort `<select id="rail-sort">` (`Recent`, `Highest usage`, `Most tokens`, `Checkpoints`).
     - **Thread List:** Virtual-friendly compact cards/rows showing title, model badge, relative time, `usedPercent` mini progress bar, checkpoint badge, and `subagent`/`background` tag when visible. Active row highlighted with `aria-current="true"`.
     - **Pagination Footer:** `Showing X of Y` counter and `Load more` button (`hasMore`).
   - **Right Inspector (`<section class="inspector">`):** `container-type: inline-size; container-name: cm-inspector;` independent scroll region (`max-width: 960px` centered inside the pane):
     - Header with selected thread title, thread metadata, Workspace Picker (`Auto` + `knownWorkspaces[]` + current active `source` label such as `saved` / `arg` / `project_id` / `mcp_roots`), and `Refresh` button (`Attach context` hidden automatically in `global`).
     - Usage Breakdown card (hero percentage + segmented bar + breakdown & secondary rows).
     - Context Trajectory SVG card (expanded by default in wide mode when `hasUsageData` is true).
     - `@container cm-inspector (min-width: 680px)` places `Top tools` and `Artifacts` side-by-side in a 2-column grid card row.
     - Full-width Inventory & Exact Counters cards/drawers below (`Rules & skills`, `MCP tools`, `Exact transcript counters` with cumulative counters + `Service` status).

#### Inline SVG Trajectory Chart Specification (`src/ui/charts.js`)

- Renders inside `<svg viewBox="0 0 600 180" role="img" aria-labelledby="...">` with `preserveAspectRatio="none"` on grid/area/line layers or uniform coordinate mapping (`padding: { top: 16, right: 16, bottom: 26, left: 48 }`).
- **Visual layers:**
  - Horizontal reference gridlines (0%, 50%, 100% of `maxY`, where `maxY = max(contextWindow || 0, maxPointActiveTokens)`), plus a subtle dashed 75% compaction-watch threshold when `contextWindow` is known.
  - Subtle translucent area fill for `cacheReadTokens` (`var(--seg-green)` at low opacity) beneath a crisp `2px` polyline for `activeTokens` (`var(--seg-blue)`).
  - Vertical dashed compaction rules at every `checkpoint_peak` -> `checkpoint_baseline` transition (`var(--seg-violet)`).
  - Interactive point nodes: distinct diamond/ring markers for `checkpoint_peak` (`var(--seg-amber)`/`var(--seg-violet)`) and `checkpoint_baseline` (`var(--seg-violet)`), plus subtle hit targets (`r="10"` transparent `<circle>` overlays, keyboard-focusable with `tabindex="0"`) on milestone and sampled turns.
- **Interactive Scrubber:** Hovering or focusing any point updates a pinned readout line above/below the SVG (`Turn 84 · 214k active (198k cached, 92.5%) · 1.4k out · Checkpoint peak`), defaulting to the latest turn when idle.
- **Edge Cases & Caption:**
  - When `trajectory.points.length < 2`: show a compact single-turn summary note instead of a flat 1-point chart.
  - When `trajectory.isBounded === true`: render caption `"Showing Turn 1, checkpoint milestones, and last 120 active-epoch turns of ${trajectory.totalTurnCount}"`.

#### Request Coordination & Mount-Time Hydration (`src/ui/main.js`)

- Antigravity enforces a strict cap of **4 concurrent `callServerTool` requests** per MCP App and aborts in-flight calls on frame reload.
- Implement a lightweight **2-lane coordinator** (`enqueueToolCall(lane, fn)`):
  - `snapshot` lane (`get_context_snapshot`): latest-wins sequence token (`snapshotSeq`); older stale results are discarded before patching DOM.
  - `rail` lane (`list_conversations`): latest-wins sequence token (`railSeq`).
  - `prefs` lane (`set_context_preferences`): serialized before the triggered refresh so saved preferences are visible on the subsequent snapshot.
  - Enforces `inFlightCount <= 2` (leaving 2 slots headroom under the 4-call host limit).
- **Mount hydration flow:**
  1. `app.ontoolinput` captures `args.conversationId` and `args.workspacePath`.
  2. `app.ontoolresult` paints the immediate `open_context_monitor` payload (zero blank wait), syncs `preferences` state, and checks:
     - If `current?.hasUsageData && current.trajectory === undefined`, immediately calls `refreshSnapshot(selectedConversationId, { silent: true, reason: "hydrate" })`.
     - If the container width is `>= 760px` (measured via `ResizeObserver` on `.shell`), immediately calls `refreshRail({ silent: true, resetOffset: true })`.
  3. 15-second `setInterval` refreshes the active snapshot (and the rail when wide mode is active and `document.visibilityState === "visible"`).

#### Capability-Gated Host Bridge Actions (`src/ui/main.js`)

- **`Attach context` (`app.updateModelContext`):**
  - Check `const canUpdateContext = Boolean(app.getHostCapabilities()?.updateModelContext);` after `app.connect()`.
  - Render `#attach-context-btn` ONLY when `canUpdateContext` is `true` and `current?.hasUsageData` is `true` (automatically hidden in `global` sidebar views).
  - On click, format a compact plain-text context block (`formatAttachedContextSummary(currentSnapshot)`) containing thread title, model, exact `activeTokens` / `contextWindow` (`usedPercent%`), `cacheHitPercent%`, `checkpointCount`, top 3 `segments`, and active `workspace.path` (under `600` chars). Call `await app.updateModelContext({ content: [{ type: "text", text }] })`.
  - Toggle button state to `Attached` with a secondary `Clear` button that calls `await app.updateModelContext({ content: [] })`. Reset attached state if the user switches to a different `conversationId`.
- **`Open file` (`com.google.antigravity/toggle-aux-pane`):**
  - `toggle-aux-pane` is an unadvertised Antigravity host extension that fails on `global` views (`{ isError: true }`) and returns `-32601` on non-Antigravity hosts.
  - Gate interactive file-open buttons (`data-open-file-uri`) on `Boolean(caps?.updateModelContext || caps?.message)` (which distinguishes conversation-bound `aux_pane`/inline views from `global` views) AND `!auxPaneOpenUnsupported` AND valid `file://` URI.
  - Invoke via the MCP Apps SDK generic request API (with Zod v4 schema verified in this repo):

    ```js
    const ToggleAuxPaneResultSchema = z.object({ isError: z.boolean().optional() }).passthrough();
    const res = await app.request(
      {
        method: "com.google.antigravity/toggle-aux-pane",
        params: { tabType: "fileView", uri: fileUri },
      },
      ToggleAuxPaneResultSchema,
    );
    ```

  - If the host throws `-32601` (Method not found), set `auxPaneOpenUnsupported = true` for the session and hide file-open buttons; if `res?.isError === true`, announce `"Could not open file in side pane"` via `announceStatus`.

#### Keyboard Shortcuts & Focus Preservation

- `/` (outside `<input>`, `<textarea>`, `<select>`): focus `#rail-search` in wide mode.
- `r` (no modifier keys, outside inputs): trigger manual refresh (`refreshSnapshot` + `refreshRail` if wide).
- `ArrowDown` / `ArrowUp` (and `j` / `k` when focus is inside `#rail-list`): move between visible rail items; `Enter` selects the focused thread.
- `Escape`: clear `#rail-search` if focused and non-empty, or dismiss open popovers.
- Extend `isUserInteracting()` in `src/ui/main.js` to check `#rail-search`, `#rail-sort`, `#workspace-select`, `#thread-select`, open `[popover]`, and active text selection inside `rootEl`, deferring structural re-renders until interaction ends so 15-second background polls never disrupt typing or scrolling.

## Alternatives Considered

### Alternative A: Browser `localStorage` for Workspace & Filter Preferences

- **Pros**: Zero server-side files or extra MCP tools.
- **Cons**: Antigravity loads each MCP App view in an isolated iframe on a fresh or opaque origin (`mcp-app-development` Isolation & CSP), so `localStorage`, `IndexedDB`, and cookies are discarded on reload and never shared between `aux_pane` and `global`.
- **Reason for Rejection**: Persisting preferences in `${PLUGIN_DATA}/preferences.json` via `set_context_preferences` survives reloads and shares state consistently across both entrypoints.

### Alternative B: Scraping `conversation_summaries.db`, `antigravity_state.pbtxt`, or Transcript Paths for Workspace Inference

- **Pros**: Could attempt workspace attribution even without user selection or `ConversationService`.
- **Cons**: Violates Spec 1's boundary against scraping undocumented host internals (`NG5`) and risks misattributing multi-repo conversations when a transcript mentions paths in another repository.
- **Reason for Rejection**: Discovering registered projects from `~/.gemini/config/projects/*.json` (`knownWorkspaces`), honoring `ontoolinput` carry-through, and persisting explicit user choices in `${PLUGIN_DATA}/preferences.json` keeps workspace resolution deterministic, transparent, and reversible.

### Alternative C: Bundling a Third-Party Charting Library (Chart.js, ECharts, or Recharts)

- **Pros**: Prebuilt axes, tooltips, and animations.
- **Cons**: Adds significant bundle size to `dist/app.html` (which must remain a single self-contained HTML document under 10 MiB and loads every view open), introduces React or canvas runtime overhead, and complicates host CSS variable theming and forced-colors accessibility.
- **Reason for Rejection**: A ~180-line native inline SVG renderer in `src/ui/charts.js` themes directly with host `--color-*` and `--seg-*` tokens, supports crisp vector scaling and keyboard scrubbing, and keeps `dist/app.html` fast and dependency-free.

### Alternative D: Switching Layouts via `hostContext.displayMode`

- **Pros**: Relies on an explicit host-provided enum rather than CSS measurements.
- **Cons**: Antigravity documents `displayMode: "inline"` as the only mode offered across inline, `aux_pane`, and `global` views (`mcp-app-development/SKILL.md`), so `displayMode` cannot distinguish a 420px side pane from a 1280px sidebar workspace.
- **Reason for Rejection**: CSS Container Queries (`@container cm-shell (min-width: 760px)`) respond accurately to actual frame dimensions across `aux_pane`, `global`, and split window sizes, while `app.getHostCapabilities()` handles surface capability differences.

### Alternative E: Embedding Full Fleet Explorer Results Inside `open_context_monitor`

- **Pros**: One tool call populates the entire wide sidebar rail on mount.
- **Cons**: Summarizing and serializing 500+ transcripts inside `open_context_monitor` inflates model-visible `structuredContent` toward the 1 MiB `CallToolResult` cap and slows initial tool calls.
- **Reason for Rejection**: Keeping `open_context_monitor` bounded to 35 interactive summaries (`includeDetails: false`) and delegating paginated search/filtering/KPIs to app-only `list_conversations` protects model context and payload size budgets.

## Non-Functional Requirements

- **Performance & Concurrency**: `listConversations` reads `summaryCache`-backed summaries so warm search/filter/sort queries resolve in milliseconds without re-parsing unchanged `transcript.jsonl` files, and non-interactive transcripts are only opened when `kind !== "interactive"`. The client enforces at most `2` concurrent `callServerTool` calls (well under Antigravity's `4` in-flight limit).
- **Payload Size & Bundle Budget**: Every `open_context_monitor`, `get_context_snapshot`, and `list_conversations` response stays `< 256 KiB` typical and `< 1 MiB` hard max (asserted in integration tests). Single-file `dist/app.html` stays well under `1 MiB` (limit `10 MiB`), and `preferences.json` is capped at `4 KiB`.
- **Accessibility & Responsive Polish**: All interactive controls support keyboard navigation (`Tab`, `Enter`, `/`, `r`, `ArrowUp`/`ArrowDown`, `Escape`), ARIA `aria-current="true"` / `aria-live="polite"` status announcements, `prefers-reduced-motion: reduce`, `@media (forced-colors: active)`, and `44px` minimum hit targets on `@media (pointer: coarse)`.
- **Security & Privacy**: `set_context_preferences` validates `workspacePath` with `validateWorkspaceDir` (rejecting non-directories, `/`, `os.homedir()`, and traversal/unreadable paths) and writes only to `${PLUGIN_DATA}/preferences.json`. `fileUri` values on artifacts and rules derive exclusively from `realpathSync`-verified paths inside `brainDir`, `pluginsDir`, `configDir`, `geminiHome`, or `workspace.path`. `Attach context` is strictly user-triggered.
- **Rollout & Rollback**: Release version bumps from `0.1.0` to `0.2.0` across `package.json`, `plugin.json`, `src/server.mjs`, `src/ui/main.js`, and `scripts/test-server.mjs`. Build and verify via `npm run build && npm test && agy plugin validate . --strict`, present the diff and sync command to the user for approval before copying runtime files (`dist/`, `plugin.json`, `mcp_config.json`, `assets/`, `README.md`, excluding `docs/`, `src/`, `scripts/`, `node_modules/`) to `~/.gemini/config/plugins/context-monitor/`, and refresh `context-monitor_context-monitor`. Rollback restores the prior `0.1.0` runtime bundle and refreshes the MCP server.

## Risks & Limits

- **Unexpanded `${PLUGIN_DATA}` or Missing `--data-dir` in Dev/Test Runs:** Standalone `node dist/server.mjs` invocations outside Antigravity do not receive `${PLUGIN_DATA}`. Mitigation: `resolveDataDir` ignores empty or unexpanded `"${PLUGIN_DATA}"` values and switches `set_context_preferences` cleanly to in-memory-only mode (`persisted: false`) without crashing or writing literal `${PLUGIN_DATA}` directories.
- **Host 4-Call Concurrency Cap on Fast Thread/Filter Switching:** Rapidly clicking threads while typing search queries and polling could exceed 4 concurrent `callServerTool` calls. Mitigation: the 2-lane client coordinator queues requests, cancels stale UI application via sequence tokens, and skips 15-second background polls while `isRefreshing` or `isUserInteracting()` is true.
- **Cold-Start Cost of Summarizing All Interactive Transcripts on First `list_conversations`:** On a corpus with hundreds of interactive threads not yet in `summaryCache`, the first `list_conversations` call reads compact `transcript.jsonl` files for interactive entries. Mitigation: `list_conversations` runs asynchronously via app-only call after initial `open_context_monitor` paint, skips non-interactive transcripts unless `kind !== "interactive"`, and populates `summaryCache` for instant subsequent queries.
- **`com.google.antigravity/toggle-aux-pane` Unavailability:** Non-Antigravity MCP Apps hosts return `-32601`, and `global` views return `{ isError: true }`. Mitigation: gate file-open controls on conversation-bound capabilities (`updateModelContext || message`), handle `{ isError: true }` gracefully with an accessible status announcement, and disable further attempts for the session on `-32601`.
- **Compact `aux_pane` Density Regression:** Adding Spec 1 detail drawers and the Workspace Picker could crowd the `380px–520px` side panel. Mitigation: keep `Trajectory`, `Top tools`, and `Artifacts` inside collapsed-by-default `<details>` drawers in `< 760px` mode, preserve v0.1.0 typography and row spacing, and smoke-test both `aux_pane` and `global` views live.

## Detailed Implementation Plan

### Required Skills for Execution Session

Load these skills at the start of the implementation session before editing any code:

1. `mcp-app-development` (`~/.gemini/antigravity/builtin/skills/mcp-app-development/SKILL.md` — `visibility: ["app"]`, `updateModelContext`, `com.google.antigravity/toggle-aux-pane`, `${PLUGIN_DATA}`, 4-call concurrency cap)
2. `modern-web-guidance` (`~/.gemini/config/plugins/modern-web-guidance-plugin/skills/modern-web-guidance/SKILL.md` — container queries, popovers, focus management, accessibility)
3. `agy-customizations` (`~/.gemini/antigravity/builtin/skills/agy-customizations/SKILL.md` — workspace rule/skill discovery and plugin structure)
4. `impeccable` (visual hierarchy, spacing, typography, dark/light contrast)
5. `emil-design-eng` (interaction polish, micro-transitions, reduced-motion discipline)

### Target Files to Create or Modify

#### 1. `src/preferences.mjs` (Create)

- **Type / Scope**: Plugin-private preference persistence helper.
- **Proposed Changes**:
  - Export `resolveDataDir(argv, env)` handling `--data-dir=<path>`, `--data-dir <path>`, and `CONTEXT_MONITOR_DATA_DIR`, returning `null` for empty or unexpanded `"${PLUGIN_DATA}"`.
  - Export `loadPreferences(dataDir)` and `savePreferences(dataDir, patch)` with `validateWorkspaceDir` validation, `4096`-byte size cap, and atomic temp-file + `fs.renameSync` write.

#### 2. [`src/analyzer.mjs`](../../src/analyzer.mjs) (Modify)

- **Type / Scope**: Core analyzer, workspace discovery, and fleet explorer.
- **Proposed Changes**:
  - Export `listKnownWorkspaces(paths)` scanning `paths.projectsDir` (`~/.gemini/config/projects/*.json`), deduplicating by realpath, sorting by name, and capping at `50`.
  - Update `resolveWorkspaceRoot` to accept `savedWorkspacePath` (`source: "saved"` at priority 4) and attach `knownWorkspaces` to `scanLocalInventory` return value.
  - Add `fileUri` (`pathToFileURL(realPath).href`) to `scanConversationArtifacts` items and `inventory.rules.items`.
  - Update `getContextSnapshot` to accept `savedWorkspacePath` and forward it to `scanLocalInventory`.
  - Export `listConversations({ query, kind, filter, sort, offset, limit, geminiHome })` returning `fleet` KPIs (`fleetScope: "interactive"`) and paginated matching `items`.

#### 3. [`src/server.mjs`](../../src/server.mjs) (Modify)

- **Type / Scope**: MCP stdio server (`version: "0.2.0"`).
- **Proposed Changes**:
  - Bump `McpServer` version to `"0.2.0"`.
  - Initialize preference store from `resolveDataDir()` on startup (keeping an in-memory preference object synced with `preferences.json`).
  - Update `open_context_monitor` and `get_context_snapshot` to apply saved `includeSubagents` when omitted, pass `savedWorkspacePath: prefs.workspacePath`, and attach `preferences: { workspacePath, includeSubagents, persisted }` to snapshot `structuredContent`.
  - Register app-only `list_conversations` (`visibility: ["app"]`) and `set_context_preferences` (`visibility: ["app"]`).

#### 4. [`mcp_config.json`](../../mcp_config.json) (Modify)

- **Type / Scope**: Plugin MCP launch configuration.
- **Proposed Changes**:
  - Pass `--data-dir=${PLUGIN_DATA}` in `mcpServers.context-monitor.args`: `["${PLUGIN_ROOT}/dist/server.mjs", "--data-dir=${PLUGIN_DATA}"]`.

#### 5. `src/ui/format.js`, `src/ui/charts.js`, `src/ui/rail.js` (Create) & [`src/ui/main.js`](../../src/ui/main.js), [`src/ui/styles.css`](../../src/ui/styles.css), [`src/ui/index.html`](../../src/ui/index.html) (Modify)

- **Type / Scope**: Dual-surface responsive MCP App UI (`version: "0.2.0"`).
- **Proposed Changes**:
  - Extract pure formatting (`src/ui/format.js`), inline SVG trajectory chart + scrubber (`src/ui/charts.js`), and wide-mode conversation rail (`src/ui/rail.js`).
  - Implement container-query responsive grid (`@container cm-shell (min-width: 760px)` and `@container cm-inspector (min-width: 680px)`), mount-time detail hydration, 2-lane request coordinator, `ontoolinput` `workspacePath` carry-through, Workspace Picker (`Auto` + `knownWorkspaces[]`), `Show all` toggle, `Top tools`, `Artifacts`, cumulative counters, `overPerFileCap` rule badges, `serviceStatus` display, `Attach context` (`app.updateModelContext`), `Open file` (`com.google.antigravity/toggle-aux-pane`), keyboard shortcuts, and extended `isUserInteracting()` guards.
  - Update `index.html` skeleton for container-aware first paint.

#### 6. [`scripts/test-analyzer.mjs`](../../scripts/test-analyzer.mjs) & [`scripts/test-server.mjs`](../../scripts/test-server.mjs) (Modify)

- **Type / Scope**: Unit and live stdio integration test suites.
- **Proposed Changes**:
  - `scripts/test-analyzer.mjs`: Add suites for `preferences.mjs` (valid/invalid `workspacePath`, unexpanded `${PLUGIN_DATA}`, corrupt JSON recovery, atomic persistence), `listKnownWorkspaces`, `resolveWorkspaceRoot` `saved` fallback vs `arg` override, `fileUri` on artifacts/rules, and `listConversations` (`fleet` KPIs, `query`, `kind`, `filter`, `sort`, `offset`/`limit` pagination).
  - `scripts/test-server.mjs`: Bump test client version to `"0.2.0"`, assert tool registration and `["app"]` visibility for `list_conversations` and `set_context_preferences`, test `--data-dir` persistence across simulated server restart, test `list_conversations` filters/pagination under `< 1 MiB`, and verify `preferences` echo on `open_context_monitor` and `get_context_snapshot`.

#### 7. [`package.json`](../../package.json), [`plugin.json`](../../plugin.json), [`README.md`](../../README.md) (Modify)

- **Type / Scope**: Release metadata and user documentation.
- **Proposed Changes**:
  - Bump `"version"` to `"0.2.0"` in `package.json` and `plugin.json`.
  - Update `README.md` with Spec 2 global sidebar workspace, fleet search/filters, Workspace Picker (`${PLUGIN_DATA}/preferences.json`), trajectory chart, and host actions.

### Phased Execution Sequence

1. **Phase 2A (Preferences Store & Analyzer Extensions)**: Implement `src/preferences.mjs` and `src/analyzer.mjs` additions (`listKnownWorkspaces`, `saved` workspace precedence, `fileUri`, `listConversations` + `fleet`), and verify via `node --test scripts/test-analyzer.mjs`.
2. **Phase 2B (MCP Server v0.2.0 & Integration Tests)**: Update `src/server.mjs`, `mcp_config.json`, `package.json`, `plugin.json`, and `scripts/test-server.mjs`; verify via `npm run build && npm test`.
3. **Phase 2C (Dual-Surface UI, Docs, Strict Validation & Live Smoke Test)**: Implement `src/ui/*` modules, update `README.md`, run `npm run build && npm test && agy plugin validate . --strict`, present the diff and sync commands for user approval before syncing runtime files to `~/.gemini/config/plugins/context-monitor/`, refresh `context-monitor_context-monitor`, and smoke-test in both `aux_pane` and `global`.

### Verification Plan

- **Phase 2A Unit Tests**: `node --test scripts/test-analyzer.mjs` exits 0.
- **Build & Full Test Suite**: `npm run build && npm test` exits 0, keeping `dist/app.html` well under `1 MiB` and every MCP tool `CallToolResult` under `1 MiB`.
- **Strict Plugin Validation**: `agy plugin validate . --strict` passes with zero errors.
- **Sync Safety (Pre-Sync Diff Gate)**: Present `diff -rq` / file diffs between the staged runtime bundle and `~/.gemini/config/plugins/context-monitor/` and explicit sync commands (copying `dist/`, `plugin.json`, `mcp_config.json`, `assets/`, `README.md` while excluding `docs/`, `src/`, `scripts/`, `node_modules/`) before syncing and refreshing `context-monitor_context-monitor`.
- **Live Desktop Smoke Test**: Verify `aux_pane` (`< 760px`) and `global` (`>= 760px`) views after refresh: mount hydration without 15s wait, Workspace Picker selection + reload persistence + `Auto` reset, fleet search/filter/sort/pagination + `Show all`, inline SVG trajectory scrubbing, `Top tools`, `Artifacts`, `Attach context` (`aux_pane` only), and `Open file` (`aux_pane` only).
