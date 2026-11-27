# Context Monitor Git Reconstruction, Release Packaging, and Agent Workflow

*   **Author:** pakhinnn1
*   **Status:** Approved
*   **Date:** 2026-11-27

---

## Overview

Context Monitor v0.2.0 is a local MCP App plugin for Antigravity Desktop that exposes the `open_context_monitor` MCP tool and runs under the `context-monitor_context-monitor` Antigravity MCP server identifier. Today its source files live in an unversioned scratch directory (`<legacy-scratch-dir>`) while Antigravity Desktop loads a manually copied five-entry runtime bundle from `~/.gemini/config/plugins/context-monitor`.

This design covers two migration phases—Era 1 (historical transcript reconstruction from initial scaffold through v0.2.0) and Era 2 (post-reconstruction repository hygiene, permanent tooling, release packaging, and governance)—to deliver four outcomes for the solo maintainer:
1. Establish a canonical public Git repository at `~/Developer/personalities/temporaries/context-monitor` under the `pakhinnn1` GitHub account using its GitHub noreply commit email, isolated from the workstation's default GitHub account.
2. Reconstruct the 13 kept historical Antigravity development transcripts (out of 14 total sessions) into one initial commit (`v0.1.0`) plus 12 chronological merge-commit pull requests with aligned semantic version milestones (`v0.1.0`, `v0.1.1`, `v0.1.2`, and `v0.2.0` tagged after Era 2 tooling and documentation merge) and zero leaked local paths, sibling account handles, or personal email addresses.
3. Replace manual copying with one shared build, strict-validation, atomic local-sync, and release-packaging pipeline driven by a single five-entry runtime allowlist, shipping a single-folder wrapped `.zip` archive on GitHub Releases while keeping `main` source-only.
4. Codify repeatable pull-request, semantic-versioning, privacy-scanning, and Thai PR-body authoring rules in repository governance docs so future agent sessions follow the same workflow without drift.

## The Problem

Keeping Context Monitor inside an unversioned scratch directory creates four operational risks:

*   **No durable history or rollback path:** Fourteen development sessions produced Context Monitor v0.2.0, including Spec 1 (`docs/designs/metrics_and_inventory_v2.md`) and Spec 2 (`docs/designs/global_workspace_ux.md`) plus multiple verification passes, yet none of those changes exist in Git. Reverting a regression or auditing why a contract changed requires digging through raw transcript logs.
*   **Drift between source and installed runtime:** Installing updates requires manually copying five runtime entries (`plugin.json`, `mcp_config.json`, `README.md`, `assets/`, and `dist/`) into `~/.gemini/config/plugins/context-monitor` while excluding `src/`, `docs/`, `scripts/`, and `node_modules/`. Manual copies skip strict plugin validation and do not enforce the 1 MiB ceiling on `dist/app.html` or manifest version parity.
*   **Cross-account identity and public privacy exposure:** The workstation defaults global Git and GitHub CLI (`gh`) authentication to a sibling host default GitHub account and personal email address. Publishing a public repository under `pakhinnn1` without repo-local credential isolation risks pushing commits or opening pull requests under the wrong account or breaking sibling repositories. In addition, four design documents under `docs/designs/` currently contain local home directory paths, scratch paths, full local skill paths, and sibling author metadata that must not reach public Git history.
*   **Unstandardized agent handoffs:** Without repository-level instructions, future agent sessions can commit build artifacts directly to `main`, skip strict validation, bump versions inconsistently, or omit structured before-and-after verification evidence from pull requests.

## Goals

*   **Canonical public repository with isolated account binding:** Host the source-only `main` branch at `~/Developer/personalities/temporaries/context-monitor` and `https://github.com/pakhinnn1/context-monitor` using `pakhinnn1` and its GitHub noreply email, while leaving global Git and `gh` defaults bound to the host default GitHub account.
*   **Proven historical reconstruction with zero known privacy leaks:** Replay all 13 kept historical sessions into one initial commit (`v0.1.0`) plus 12 chronological merge-commit pull requests, excluding the temporary drift report (`docs/designs/2026-11-27_DRIFT_REPORT.md`) and its single-file session (`b4cf0822`, raw Session 7). Prove zero diff against all 21 raw scratch files in memory during Stage 1, and prove zero diff between deterministically scrubbed scratch (20 kept files) and raw Session 14 (`1232e578`) in Stage 2. Pass both pre-push and post-merge leak scans across commit trees, commit messages, headers, branch names, tag messages, and drafted pull request bodies.
*   **Milestone-aligned Era 1 semantic versions:** Apply a deterministic post-snapshot version-alignment overlay across the five versioned code and manifest files (`package.json`, `plugin.json`, `src/server.mjs`, `src/ui/main.js`, and `scripts/test-server.mjs`) so historical tags match development milestones: `v0.1.0` at initial scaffold (`20103b35`), `v0.1.1` at bugfix and visual polish (`17dbe26e`), `v0.1.2` at Spec 1 implementation (`9691f551`), and verbatim `v0.2.0` from Spec 2 implementation (`c1b37902`) through final verification (`1232e578`), leaving design document baseline prose untouched.
*   **Unified runtime allowlist pipeline:** Maintain one shared staging pipeline for the five runtime entries (`plugin.json`, `mcp_config.json`, `README.md`, `assets/`, and `dist/`) that builds `dist/`, enforces `dist/app.html` under 1 MiB and seven-file Era 2 version parity, validates the staged bundle via Antigravity CLI (`agy plugin validate --strict`), powers one-command atomic local sync with dry-run support and manual MCP reload instructions, and packages a macOS-clean single-folder wrapped `.zip` (`context-monitor/` at archive root) with deterministic commit-epoch timestamps and SHA-256 checksum for GitHub Releases.
*   **Standardized agent workflow and documentation:** Require all Era 1, Era 2, and future pull requests to use the `pr` skill template (defining Summary, Changes, Before and After Evidence, and Merge Danger sections) written in natural Thai via the `kien-thai` skill. Document build, test, identity, privacy-scan, sync, release, and PR rules in repo `AGENTS.md` (referencing skills by name only to avoid embedding local home paths) and `README.md`, and add a single-line repository pointer in the home workspace `AGENTS.md` (`~/repos/personalities/home/AGENTS.md`).
*   **Verified exit gates before retiring scratch:** Keep `<legacy-scratch-dir>` read-only until all six exit gates pass with raw command output:
    1. Stage 1 raw 21-file replay and Stage 2 scrubbed 20-file parity both produce zero diff.
    2. Pre-push and post-merge scans across Git objects, messages, headers, tags, branches, and PR bodies find zero host paths, sibling account handles, or personal email strings.
    3. Local Git config, remote URL, `npm run check:identity`, and `npm run gh` bind to `pakhinnn1` with its noreply email while global `gh auth status` remains on the host default GitHub account.
    4. Fresh `npm ci`, `npm run build`, `npm test` (including tooling unit and negative tests), and `npm run validate` pass in the canonical repository with `dist/app.html` under 1 MiB and empty `git status`.
    5. The generated `v0.2.0` wrapped `.zip` contains only the five runtime entries under `context-monitor/`, zero macOS metadata files, passes `agy plugin validate --strict`, and is attached with its `.sha256` to the `v0.2.0` GitHub Release.
    6. Local sync dry-run and atomic apply leave zero allowlist diff against `~/.gemini/config/plugins/context-monitor`, and `open_context_monitor` renders live in Antigravity Desktop after manual MCP server reload.

## Non-Goals

*   No npm registry publishing.
*   No GitHub Actions workflows or automated CI/CD release pipelines in this phase.
*   No code signing or Antigravity Marketplace submission.
*   No functional, UI, or runtime behavior changes to Context Monitor v0.2.0.
*   No direct edits to `~/.gemini/config/config.json` (Antigravity Desktop's global plugin and settings file) and no scripted killing or restarting of Antigravity host processes.
*   No support for direct `github.com` branch URL plugin installation against the source-only `main` branch.

## Open Questions

None. Two open questions from ideation were resolved before drafting:
*   **Release `.zip` archive layout:** Locked to a single-folder wrapped archive with `context-monitor/` as the sole top-level directory, verified via `agy plugin validate --strict` (exit code 0 when `__MACOSX` is absent).
*   **Spec 1 (`9691f551`) version tag:** Locked to tagging `v0.1.2` on the Session 6 (`9691f551`) merge commit, with the five-file overlay applying `0.1.1` on kept Sessions 2 through 5 and `0.1.2` on kept Sessions 6 through 9.

## Critical User Journeys (CUJs)

### CUJ 1: Reconstruct Historical Sessions Into a Public Repository

*   **Given:** The read-only scratch directory holds all 21 v0.2.0 files, all 14 Antigravity session transcripts exist locally, and `pakhinnn1` is authenticated in `gh` with web-commit email privacy enabled while the host default GitHub account remains active globally.
*   **When:** The maintainer runs the two-stage local replay and scrub pipeline, runs the pre-push leak scan across all commits, headers, branches, tags, and drafted Thai PR bodies, pushes the initial `v0.1.0` commit, merges the 12 chronological pull requests with tags `v0.1.1` and `v0.1.2`, and runs a post-merge scan over fetched `origin/main`.
*   **Then:** Stage 1 proves zero diff against all 21 raw scratch files, Stage 2 proves zero diff against the 20 scrubbed kept files at pre-push and post-PR #12 `HEAD`, all leak scans report zero matches, `main` excludes `dist/` and `node_modules/`, and global Git and `gh` defaults remain unchanged.

### CUJ 2: Build, Validate, and Sync Locally to Antigravity Desktop

*   **Given:** The canonical repository is checked out with dependencies installed via `npm ci`.
*   **When:** The maintainer runs local sync in `--dry-run` mode to inspect planned changes, then runs local sync in apply mode and reloads `context-monitor_context-monitor` from Antigravity Desktop settings.
*   **Then:** The shared staging pipeline builds `dist/`, verifies `dist/app.html` is under 1 MiB and seven-file Era 2 versions match, passes `agy plugin validate --strict` on the staged five-entry bundle, atomically swaps `~/.gemini/config/plugins/context-monitor` with zero allowlist diff and zero non-allowlist files, prints manual MCP reload steps, and `open_context_monitor` renders live in Antigravity Desktop.

### CUJ 3: Package and Publish a Validated GitHub Release Archive

*   **Given:** All Era 2 tooling and documentation pull requests are merged to `main` and `npm test` passes.
*   **When:** The maintainer runs the release packager for `v0.2.0`, creates and pushes the `v0.2.0` annotated tag on `main`, and publishes the `v0.2.0` GitHub Release via `npm run gh`.
*   **Then:** The generated `.zip` contains only the five runtime entries nested under `context-monitor/`, contains zero macOS metadata files (`__MACOSX`, `.DS_Store`), passes `agy plugin validate <zip> --strict`, attaches with its `.sha256` to the GitHub Release, and extracts into `~/.gemini/config/plugins/` after clearing any prior install folder.

### CUJ 4: Execute Future Agent Changes Under Repo Governance

*   **Given:** A future agent session opens the canonical repository to implement a bug fix or feature.
*   **When:** The agent reads repository `AGENTS.md`, develops on a feature branch, runs build, tests, validation, dry-run sync, and `npm run check:privacy`, and opens a pull request via `npm run gh`.
*   **Then:** Git commits and pushes isolate automatically to `pakhinnn1` via conditional Git config, `gh` commands isolate fail-closed through `npm run gh` (aborting if `pakhinnn1` auth or repo identity mismatches), `dist/` stays untracked, the pull request body follows the `pr` template in natural Thai via `kien-thai` with privacy-checked evidence, and version bumps stay synchronized across all tracked manifests, code, tests, and runtime `README.md`.

### CUJ 5: Safely Retire the Legacy Scratch Directory

*   **Given:** All six exit gates pass with recorded command output and the single-line pointer in the home workspace `AGENTS.md` is updated.
*   **When:** The maintainer explicitly confirms deletion of `<legacy-scratch-dir>`.
*   **Then:** The legacy scratch directory is removed only after explicit approval, leaving the canonical repository as the sole source of truth and `~/.gemini/config/plugins/context-monitor` as the active runtime installation.

## Technical Plan (Architecture)

The system separates one-time historical migration from permanent repository tooling and isolates `pakhinnn1` credentials from the host default GitHub account.

```text
+-----------------------------------------------------------------------------+
| LAYER 1: Identity & Privacy Isolation (Host Local + Era 2 Repo Tooling)     |
|                                                                             |
|  ~/.gitconfig (global default untouched)                                    |
|    +-- includeIf gitdir:~/Developer/personalities/temporaries/              |
|        context-monitor/ -> ~/.gitconfig-pakhinnn1 (user, noreply, helper)   |
|  Era 1: Inline preflight + leak scan in external harness                    |
|  Era 2 (PR #14+): scripts/check-identity.mjs, scripts/gh.mjs (npm run gh),  |
|                   scripts/check-privacy.mjs (structural + local patterns)   |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
| LAYER 2: One-Off Era 1 Replay Harness (Outside Canonical Repo)              |
|                                                                             |
|  14 transcripts + Read-Only Scratch (21 authored files)                     |
|    -> Stage 1: In-memory raw replay -> Assert 0 diff vs 21 raw scratch files|
|    -> Stage 2: Drop drift report & Session 7 b4cf0822 (20 kept files)       |
|                Apply deterministic scrub (3 kept design docs)               |
|                Apply 5-file version overlay (0.1.1 -> 0.1.2 -> verbatim 0.2)|
|                Assert 0 diff vs 20 scrubbed scratch files (pre-push & HEAD) |
|                Scan blobs, headers, tags, branches, PR titles & PR bodies   |
|    -> Emit 1 initial commit (v0.1.0) + 12 PRs + post-merge origin/main scan |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
| LAYER 3: Permanent Era 2 Build, Sync, & Packaging Pipeline (In Repo)        |
|                                                                             |
|  Source-only main (no dist/, no node_modules/, no release/)                 |
|    -> scripts/build.mjs (esbuild + hard 1 MiB dist/app.html ceiling)        |
|    -> scripts/lib/runtime-stage.mjs (single 5-entry allowlist source)       |
|         1. Assert 7-file Era 2 version parity                               |
|         2. Stage allowlist into temp dir (strip macOS metadata files)       |
|         3. Validate staged bundle via agy plugin validate --strict          |
|            |                                       |                        |
|            v                                       v                        |
|  scripts/sync-plugin.mjs                 scripts/package-release.mjs        |
|    --dry-run diff or sibling-temp          Deterministic-mtime wrapped zip  |
|    atomic swap with backup rollback        (context-monitor/<allowlist>)    |
|    -> ~/.gemini/config/plugins/            Verify entry list + strict zip   |
|       context-monitor/                     validate + write .sha256         |
+-----------------------------------------------------------------------------+
```

### Workstream A: Account Isolation and Repository Bootstrap

#### Host Git and Credential Configuration
Global `~/.gitconfig` remains bound to the host default GitHub account and `gh auth git-credential`. Immediately after interactive `gh auth login` for `pakhinnn1`, the workflow runs `gh auth switch` back to the host default GitHub account so sibling repositories remain unaffected. Context Monitor isolates Git via:
1. **Resolved noreply commit email:** Query `pakhinnn1` user metadata via scoped `GH_TOKEN` to form `359503387+pakhinnn1@users.noreply.github.com`.
2. **GitHub web-commit email privacy preflight:** Verify `pakhinnn1` has GitHub's `Keep my email addresses private` setting enabled before any pull request merge so server-side merge commits never expose a personal email.
3. **Conditional Git configuration:** Add `[includeIf "gitdir:~/Developer/personalities/temporaries/context-monitor/"]` in `~/.gitconfig` pointing to `~/.gitconfig-pakhinnn1`, and mirror `user.name`, `user.email`, and the credential helper in `.git/config` as defense-in-depth against symlink or alternate-path invocations.
4. **Fail-closed Git HTTPS credential helper:** Clear inherited helpers and register a `get`-only shell function helper that exits 0 on `store` or `erase`, retrieves the `pakhinnn1` token via the Homebrew `gh` binary (needed because non-interactive Git invocations may omit Homebrew from `PATH`), and exits non-zero if token retrieval fails.

#### Scoped `gh` Wrapper and Repo Identity Preflight
Because `gh` CLI ignores `.git/config` and `includeIf`, bare `gh` commands revert to the host default GitHub account after `gh auth switch`.
*   **Era 1 preflight:** The external replay harness runs an inline identity and token check before any Era 1 push, PR creation, or merge, and injects scoped `GH_TOKEN` into every `gh` child process.
*   **Era 2 permanent tooling (PR #14+):** `scripts/check-identity.mjs` (`npm run check:identity`) verifies local `user.name`, noreply email pattern, `origin` URL, and fail-closed `gh auth token` + `gh api user` identity, supporting environment overrides so forks and external contributors are not locked out and keeping `npm test` / `npm run build` independent of maintainer identity. `scripts/gh.mjs` (`npm run gh -- <args>`) runs identity preflight, retrieves the scoped token, and spawns `gh` with `GH_TOKEN` scoped to that child process.

### Workstream B: Era 1 Historical Reconstruction and Privacy Pipeline

A one-off replay harness runs outside the canonical repository (in the conversation scratch directory) so raw transcript paths and migration tooling never enter public Git history.

#### Two-Stage Replay and Parity Proof
*   **Stage 1 (In-memory raw replay):** Read `transcript_full.jsonl` (falling back to `transcript.jsonl`) across all 14 chronological sessions. Apply every succeeded `write_file` and `edit_file` mutation targeting the scratch directory onto an in-memory file map without modifying any text, avoiding downstream patch failures on `edit_file` targets. At the end of Session 14, diff the in-memory map against all 21 authored files in read-only scratch (17 code, config, asset, and test files plus 4 design documents under `docs/designs/`, excluding generated `dist/`, `node_modules/`, and npm-generated `package-lock.json`). Fail on any byte difference.
*   **Stage 2 (Scrubbed emission and version overlay):** Drop `docs/designs/2026-11-27_DRIFT_REPORT.md` and skip raw Session 7 (`b4cf0822`, which touched only that file), leaving 13 kept sessions (numbered Order 1 through 13 below, ending at raw Session 14 `1232e578`) and 20 kept authored files. Apply two pure transforms to each kept session snapshot:
    1. **Deterministic scrub transform (three kept design docs only):** Replace sibling author metadata in `docs/designs/SITEMAP.md`, `docs/designs/metrics_and_inventory_v2.md`, and `docs/designs/global_workspace_ux.md` with `pakhinnn1`; strip local home skill paths in `docs/designs/global_workspace_ux.md` leaving only the `impeccable` and `emil-design-eng` skill names and descriptions; and rewrite scratch directory references using deterministic per-occurrence repository-relative phrases. Primary-source inspection verified zero host paths, sibling handles, or personal emails exist in any of the 17 code, config, asset, and test files; if any intermediate commit ever triggered a leak hit, the gate aborts rather than guessing an unverified rewrite.
    2. **Five-file version-alignment overlay:** Update version strings only in `package.json`, `plugin.json`, `src/server.mjs`, `src/ui/main.js`, and `scripts/test-server.mjs` (never altering design document baseline prose referencing `0.1.0`): keep `0.1.0` on Order 1 (`20103b35`), set `0.1.1` on Orders 2–5, set `0.1.2` on Orders 6–9, and keep verbatim `0.2.0` on Orders 10–13. Era 1 commits are verified by Stage 2 parity; full `npm ci && npm test` executes once PR #13 adds `.gitignore` and the seeded `0.2.0` `package-lock.json`.
*   **Pre-push and post-merge parity assertions:** Apply the same `scrubDesignDoc` transform to the 20 kept scratch files and assert zero byte diff against the in-memory Order 13 (raw Session 14) snapshot before pushing, then re-verify zero diff against `origin/main` `HEAD` after PR #12 merges.

#### Chronological Era 1 Commit, Pull Request, and Tag Graph
Each branch commit preserves the session's recorded completion timestamp. Order 1 lands as the initial commit on `main`; Orders 2 through 13 land as chronological merge-commit pull requests (PR #1 through PR #12) with bodies following the `pr` skill template in natural Thai via `kien-thai`.

| Order (PR) | Raw Session | Session ID | Recorded Date (UTC) | Scope | Version / Tag |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 (Initial) | 1 | `20103b35` | 2026-11-26T16:36:05Z | 12 scaffold files on `main` | `0.1.0` / tag `v0.1.0` |
| 2 (PR #1) | 2 | `17dbe26e` | 2026-11-26T17:35:48Z | 5 code/UI files (bugfix and visual polish) | `0.1.1` / tag `v0.1.1` |
| 3 (PR #2) | 3 | `a1cfe805` | 2026-11-26T19:03:21Z | Docs-only (`SITEMAP.md`, `metrics_and_inventory_v2.md`) | `0.1.1` |
| 4 (PR #3) | 4 | `cc8dafd1` | 2026-11-27T03:01:39Z | Docs-only (`metrics_and_inventory_v2.md` review pass) | `0.1.1` |
| 5 (PR #4) | 5 | `0b184f2b` | 2026-11-27T04:09:10Z | Docs-only (`metrics_and_inventory_v2.md` resolution) | `0.1.1` |
| 6 (PR #5) | 6 | `9691f551` | 2026-11-27T04:23:33Z | 8 files (Spec 1 v2 analyzer, server, UI, tests) | `0.1.2` / tag `v0.1.2` |
| — (Skipped) | 7 | `b4cf0822` | 2026-11-27T04:41:30Z | Dropped (`2026-11-27_DRIFT_REPORT.md` only) | — |
| 7 (PR #6) | 8 | `a1f2a1f5` | 2026-11-27T06:49:26Z | 3 files (Spec 1 drift reconciliation and tests) | `0.1.2` |
| 8 (PR #7) | 9 | `524c9462` | 2026-11-27T07:47:44Z | Docs-only (`metrics_and_inventory_v2.md` verification) | `0.1.2` |
| 9 (PR #8) | 10 | `2718387e` | 2026-11-27T07:57:06Z | Docs-only (`SITEMAP.md`, `global_workspace_ux.md`) | `0.1.2` |
| 10 (PR #9) | 11 | `c1b37902` | 2026-11-27T08:11:53Z | 16 files (Spec 2 global UX and fleet explorer) | `0.2.0` (verbatim) |
| 11 (PR #10) | 12 | `f6c7dda6` | 2026-11-27T09:27:47Z | 5 files (Spec 2 verification fixes) | `0.2.0` (verbatim) |
| 12 (PR #11) | 13 | `7c9c763d` | 2026-11-27T09:57:52Z | 4 files (Spec 2 UI and trajectory chart polish fixes) | `0.2.0` (verbatim) |
| 13 (PR #12) | 14 | `1232e578` | 2026-11-27T10:19:44Z | 4 files (Spec 2 UI and chart verification fixes) | `0.2.0` (verbatim; `v0.2.0` tagged after PR #16) |

*   **PR Evidence Rule:** Code PRs cite recorded or verified build and test results in the `pr` template Evidence section. The five docs-only PRs (`a1cfe805`, `cc8dafd1`, `0b184f2b`, `524c9462`, `2718387e`) cite document state and section diff evidence before and after each revision.

#### Pre-Push and Post-Merge Privacy Gates
Before pushing any ref or opening any pull request, a local leak scanner inspects every Git object blob, commit message, author/committer header, branch name, annotated tag message, PR title, and drafted Thai PR body against blocked host home paths, host username, sibling handle, and personal email patterns (allowing only `pakhinnn1` noreply addresses). Any hit aborts push and PR creation. After PR #12 merges on GitHub, the harness fetches `origin/main` and runs the full commit and header scan again to confirm server-side merge commits introduced zero leaked email headers before proceeding to Era 2.

### Workstream C: Era 2 Permanent Tooling, Sync, and Release Packaging

All Era 2 additions land after Era 1 parity proof via scoped Thai `pr`-template pull requests so Order 13 (`1232e578`) preserves 20-file scrubbed parity. All new scripts use Node.js standard library modules only (zero added npm dependencies).

#### Repository Hygiene and Seeded Lockfile (PR #13)
*   Add MIT `LICENSE` (`Copyright (c) 2026 pakhinnn1`).
*   Add `.gitignore` excluding `dist/`, `node_modules/`, `release/`, `.DS_Store`, `*.tgz`, and `*.log`.
*   Seed `package-lock.json` from the verified read-only scratch lockfile and reconcile its root metadata to `0.2.0` via `npm install --package-lock-only` so `npm ci` reproduces the pinned dependency tree whose `dist/app.html` bundle fits under 1 MiB.
*   Add `author`, `homepage`, and `repository` metadata to `plugin.json`.

#### Identity, `gh` Wrapper, Privacy Scanner, and Build Guard (PR #14)
*   PR #13 uses the Era 1 `scanForLeaks` scanner and scoped `GH_TOKEN` directly; PR #14 lands permanent repository identity and privacy tooling.
*   Add `scripts/check-identity.mjs`, `scripts/gh.mjs`, and `scripts/check-privacy.mjs`, and wire `"check:identity"`, `"check:privacy"`, and `"gh"` into `package.json` `scripts` immediately so PR #14 through PR #16 and future sessions can invoke `npm run check:identity`, `npm run gh -- <args>`, and `npm run check:privacy` across unpushed commits, tracked files, and PR body files (constructing structural patterns dynamically so scanner and test files never self-match, plus optional host-local exact patterns stored outside the repository).
*   Update `scripts/build.mjs` to enforce the hard 1 MiB (`1048576` bytes) ceiling on `dist/app.html`, failing the build if exceeded.

#### Shared Runtime Staging, Atomic Sync, Release Packager, and Tooling Tests (PR #15)
*   **Shared staging (`scripts/lib/runtime-stage.mjs`):** Single source of truth for the five-entry runtime allowlist (`plugin.json`, `mcp_config.json`, `README.md`, `assets`, `dist`), the 1 MiB `dist/app.html` ceiling, Era 2 seven-file version parity (`package.json`, `package-lock.json`, `plugin.json`, `README.md` line 3, `src/server.mjs`, `src/ui/main.js`, and `scripts/test-server.mjs`), temporary bundle staging free of macOS metadata files, and `agy plugin validate --strict --json`.
*   **Atomic local sync (`scripts/sync-plugin.mjs`):** Validates the target path against a safety allowlist, previews file-hash diffs in `--dry-run` mode (treating a missing target as an empty tree), stages the validated bundle into a sibling temporary directory on the same filesystem, swaps into `~/.gemini/config/plugins/context-monitor` atomically with backup rollback on failure, re-verifies zero allowlist diff, and prints manual MCP reload steps for `context-monitor_context-monitor`.
*   **Release zip packager (`scripts/package-release.mjs`):** Recreates `release/context-monitor-v<version>.zip` from scratch (removing any prior archive first so deleted entries never linger), clamps staged file and directory modification timestamps to the `HEAD` Git commit epoch so repeated builds from the same commit emit identical SHA-256 digests, wraps the five allowlist entries under a single `context-monitor/` archive root, verifies the entry list and zero macOS metadata files, runs `agy plugin validate <zip> --strict --json`, and writes the `.sha256` checksum. Local packaging requires macOS Info-ZIP (`zip`/`unzip`) and `agy` CLI in `PATH`.
*   **Package scripts and tooling tests (`package.json`, `scripts/test-tooling.mjs`):** Expose standardized npm scripts (`build`, `test`, `check:identity`, `check:privacy`, `gh`, `validate`, `sync`, `package`) and add zero-dependency `node:test` coverage for build ceiling enforcement, version parity, sync target safety and atomic cleanup, privacy scanning, and release archive validation, ensuring `dist/server.mjs` is built before tests execute on a fresh clone.

#### Release Tag Timing (`v0.2.0`)
Tags `v0.1.0`, `v0.1.1`, and `v0.1.2` are applied during Workstreams A and B, and Stage 2 20-file scrubbed parity is verified both pre-push and at post-PR #12 `HEAD`. The `v0.2.0` annotated tag is created and pushed once on `main` after PR #16 merges, and the `v0.2.0` GitHub Release publishes from that tag with deterministic commit-epoch zip mtimes so checking out `v0.2.0` reproduces the attached `.zip` and `.sha256` from the same source tree and packaging script.

### Workstream D: Governance, Live Verification, and Scratch Retirement

#### Repository Governance and Design Registration (PR #16)
*   Add repository `AGENTS.md` codifying: `npm run check:identity`, `npm run gh`, and `npm run check:privacy` usage; branch-based PR workflow; source-only `main` invariant; seven-file Era 2 version parity; required pre-PR verification (`npm test`, `npm run validate`, `npm run sync -- --dry-run`); manual MCP reload after `npm run sync`; and Thai PR authoring citing `pr` and `kien-thai` by skill name only.
*   Update `README.md` to document GitHub Release zip installation (removing any existing plugin folder before unzipping), local npm scripts, and manual MCP reload.
*   Copy this approved design document into `docs/designs/git_reconstruction_and_release_packaging.md` (replacing legacy scratch path literals with `<legacy-scratch-dir>`, stripping the internal workflow provenance footer, and passing `npm run check:privacy -- --strict-local`) and register it in `docs/designs/SITEMAP.md`.

#### Branch Protection, Live Verification, and Scratch Retirement
*   Optionally enable public `main` branch protection requiring pull requests with zero required approving reviews (solo maintainer cannot self-approve) and blocking force-pushes and branch deletion.
*   Run `npm run sync -- --dry-run` and `npm run sync`, manually reload `context-monitor_context-monitor` in Antigravity Desktop settings, and invoke `open_context_monitor` to verify live UI rendering.
*   Submit a single-line addition in home workspace `AGENTS.md` (`~/repos/personalities/home/AGENTS.md`) registering `context-monitor` at `~/Developer/personalities/temporaries/context-monitor` (matching that file's full-path style).
*   Present raw command outputs for all six exit gates (Stage 1/2 replay parity, pre-push and post-merge leak scans, isolated `pakhinnn1` identity vs unchanged global `gh`, fresh `npm ci && npm run build && npm test && npm run validate`, validated `v0.2.0` release zip and GitHub Release assets, and zero-diff local sync plus live `open_context_monitor` verification) and delete `<legacy-scratch-dir>` only after explicit user confirmation.

## Alternatives Considered

### Alternative A: Group Era 1 Into 4 to 6 Milestone Pull Requests or Push 14 Commits Directly to `main`

*   **Pros:** Fewer pull requests to create and merge during one-time migration; lower GitHub API setup effort.
*   **Cons:** Loses 1-to-1 traceability between each kept Antigravity session and its pull request record; pushing directly to `main` breaks parity with the ongoing solo pull-request workflow.
*   **Reason for Rejection:** One chronological merge-commit pull request per kept historical conversation gives complete per-session traceability and mirrors the ongoing solo pull-request workflow from PR #1 onward.

### Alternative B: Leave Historical Manifests Frozen at `0.1.0`, Omit `v0.1.2`, or Tag `v0.1.2` at Session 8 (`a1f2a1f5`)

*   **Pros:** Skipping version overlays avoids modifying any historical snapshot beyond privacy scrubbing; tagging `v0.1.2` at `a1f2a1f5` places the tag after Spec 1 drift reconciliation tests.
*   **Cons:** Leaving manifests at `0.1.0` leaves both `v0.1.1` polish and the Spec 1 v2 schema/analyzer upgrade unlabeled; moving `v0.1.2` to `a1f2a1f5` places the tag one pull request after the initial Spec 1 code commit while Order 6 (`9691f551`) already carries `0.1.2`.
*   **Reason for Rejection:** The deterministic five-file overlay aligns tags directly with the code milestones (`v0.1.1` at `17dbe26e`, `v0.1.2` at Spec 1 implementation `9691f551`, and verbatim `v0.2.0` from `c1b37902` through `1232e578`).

### Alternative C: Retain `docs/designs/2026-11-27_DRIFT_REPORT.md` Scrubbed in Git History

*   **Pros:** Preserves all 14 sessions including `b4cf0822` with no skipped transcript.
*   **Cons:** Commits a temporary, unlisted Spec 1 audit report that adds noise to `docs/designs/` after its findings were already reconciled in `a1f2a1f5`.
*   **Reason for Rejection:** `2026-11-27_DRIFT_REPORT.md` was a temporary Spec 1 audit artifact and raw Session 7 (`b4cf0822`) touched nothing else; excluding it avoids committing an obsolete audit file and keeps the repository at 20 historical files.

### Alternative D: Create a Private Repository First and Flip to Public Later

*   **Pros:** Allows pushing to GitHub before running a final privacy audit and delaying public exposure.
*   **Cons:** Weakens pre-push discipline and still requires destructive history rewrites if sensitive strings are pushed; delays open-source public availability.
*   **Reason for Rejection:** Starting as a public repository immediately with an MIT license limits exposure of known host paths, sibling handles, and personal emails when gated by the pre-push and post-merge pattern scans, web-commit email privacy verification, and GitHub noreply commit email.

### Alternative E: Toggle Global `gh auth switch` or Provision SSH Host Aliases Immediately

*   **Pros:** Global `gh auth switch` requires no repo-local credential helper; SSH host aliases avoid HTTPS credential helpers altogether.
*   **Cons:** Global `gh auth switch` disrupts sibling repositories bound to the host default GitHub account; SSH host aliases require extra key setup and non-standard remote URLs before broader multi-account usage justifies them.
*   **Reason for Rejection:** A `gitdir` conditional include, repo-local HTTPS credential helper calling `gh auth token --user pakhinnn1`, and scoped `npm run gh` wrapper isolate `context-monitor` over HTTPS without affecting sibling repositories.

### Alternative F1: Separate Sync and Release Scripts

*   **Pros:** Simpler single-purpose scripts without a shared staging library.
*   **Cons:** Duplicates the five-entry runtime allowlist, version-parity checks, and strict plugin validation logic across two files that drift over time.
*   **Reason for Rejection:** One shared staging module (`scripts/lib/runtime-stage.mjs`) keeps validation, local sync, and release zip packaging aligned on a single allowlist.

### Alternative F2: Commit `dist/` to `main`

*   **Pros:** Allows running `agy plugin validate . --strict` on the raw repository root and supports direct `github.com` URL plugin installs.
*   **Cons:** Adds roughly 2.2 MiB of minified build churn (`dist/app.html` ~757 KiB and `dist/server.mjs` ~1.4 MiB) on every source edit.
*   **Reason for Rejection:** Excluding `dist/` keeps `main` source-only while the shared staging pipeline validates built bundles before sync or release packaging.

### Alternative F3: Omit `package-lock.json` or Generate Fresh Without Seeding

*   **Pros:** Avoids reconciling the stale `0.1.0` scratch lockfile.
*   **Cons:** Leaves dependency versions unpinned or resolves newer semver releases that may alter bundled dependencies and breach the 1 MiB `dist/app.html` ceiling.
*   **Reason for Rejection:** Seeding `package-lock.json` from the verified scratch lockfile and reconciling root version metadata to `0.2.0` keeps `npm ci` deterministic on the verified dependency tree.

### Alternative G: Build-Time Version Injection via `esbuild define`

*   **Pros:** Eliminates hardcoded `"0.2.0"` strings in `src/server.mjs`, `src/ui/main.js`, and `scripts/test-server.mjs`, narrowing parity checks to manifests and docs.
*   **Cons:** Modifies Context Monitor v0.2.0 source files (`src/server.mjs` and `src/ui/main.js`), violating Non-Goal #4 (zero functional or runtime source changes in v0.2.0).
*   **Reason for Rejection:** Preserving verbatim v0.2.0 source files keeps Stage 2 parity exact; build-time version injection is deferred to `Future Improvements` for v0.3.0+.

### Alternative H: Flat-Root Release `.zip` Layout (`plugin.json` at Archive Root)

*   **Pros:** `agy plugin validate --strict` reads `plugin.json` directly at archive root without single-folder unwrapping.
*   **Cons:** Extracting directly into `~/.gemini/config/plugins/` without specifying a target subfolder scatters loose plugin files (`plugin.json`, `README.md`, `dist/`, `assets/`) across the shared plugins directory.
*   **Reason for Rejection:** Empirical probing confirmed a single-folder wrapped zip (`context-monitor/` at archive root) passes `agy plugin validate --strict` with zero findings when macOS metadata files are stripped, and extracts into `~/.gemini/config/plugins/context-monitor/`.

### Alternative I: Require Approving Pull Request Reviews on `main` Branch Protection

*   **Pros:** Enforces review sign-off before merges on multi-contributor repositories.
*   **Cons:** GitHub blocks pull request authors from approving their own pull requests, making merges impossible for a solo maintainer.
*   **Reason for Rejection:** A solo maintainer cannot self-approve pull requests on GitHub, so required approving reviews must remain zero.

## Risks & Mitigations

*   **GitHub server-side merge commits exposing personal email:** `gh pr merge --merge` creates merge commits on GitHub servers after local pre-push scans pass. **Mitigation:** Verify `pakhinnn1` has `Keep my email addresses private` enabled during Workstream A preflight, and run a mandatory post-merge `git fetch origin main` leak scan after PR #12 merges before tagging `v0.2.0`.
*   **Unscoped bare `gh` commands acting under the host default account:** Git config isolation does not apply to `gh`, so bare `gh` invocations default to the sibling account after `gh auth switch`. **Mitigation:** Route all Era 2 and future `gh` invocations through `npm run gh -- <args>` (`scripts/gh.mjs`), which validates identity and scopes `GH_TOKEN` to the child process.
*   **Partial failure mid-sequence across 12 Era 1 PRs:** Network errors or rate limits during PR #1–#12 could leave half-merged branches on GitHub. **Mitigation:** External replay harness emits deterministic branch names (`era1/02-...` through `era1/14-...`), checks whether a branch/PR already exists or is merged before acting, and supports resuming from the first unmerged session.
*   **Intermediate non-design commit privacy leak hits:** `scrubDesignDoc` transforms only the three design docs; if any intermediate commit in sessions 1–13 contained a host path or personal handle before Session 14 overwrote it, a public push would leak it. **Mitigation:** Primary inspection confirmed zero sensitive strings in the 17 code/config/asset/test files, and `scanForLeaks` inspects every commit blob across all 13 sessions and aborts fail-closed on any match.
*   **Transcript log fallback or failed tool calls during Era 1 replay:** Missing `transcript_full.jsonl`, JSON-quoted tool argument strings, or errored `write_file`/`edit_file` steps could corrupt replay snapshots. **Mitigation:** `verifyRawReplay` decodes double-quoted JSON arguments, skips paired `GENERIC` `status: "ERROR"` steps, supports `Append`, and proves zero byte diff against all 21 raw scratch files before Stage 2 runs.
*   **Torn plugin runtime directory or live MCP server file reads during sync:** In-place copying or deleting files inside `~/.gemini/config/plugins/context-monitor` while Antigravity Desktop holds the server process open risks partial state or cross-device rename errors. **Mitigation:** `scripts/sync-plugin.mjs` stages inside a sibling directory on the same filesystem, swaps atomically with backup rollback, validates zero allowlist diff, and instructs manual reload of `context-monitor_context-monitor` (note `dist/app.html` is read per tool call while `dist/server.mjs` runs in memory until reload).
*   **Missing `agy` CLI or macOS Info-ZIP binaries:** Fresh environments or future Linux CI runners lack macOS `/usr/bin/zip` or Antigravity Desktop's `agy` binary. **Mitigation:** `scripts/lib/runtime-stage.mjs` and `scripts/package-release.mjs` fail closed with explicit missing-binary errors, macOS Info-ZIP + `agy` CLI are documented as local v0.2.0 packaging prerequisites, and portable zip/CI validation is scoped under `Future Improvements`.
*   **Bundle headroom beneath the 1 MiB ceiling:** `dist/app.html` is ~757 KiB (~267 KiB headroom beneath `1048576` bytes). **Mitigation:** Seeded `package-lock.json` pins tested dependencies and `scripts/build.mjs` enforces the 1 MiB byte-length ceiling as a hard build failure.

## Non-Functional Requirements

*   **Security & Privacy:**
    *   Public repository exposure is fail-closed: before any `git push` or `gh pr create`, local scans (`scanForLeaks` in Era 1, `npm run check:privacy` in Era 2+) inspect unpushed Git object blobs, commit messages, headers, branch names, tag messages, PR titles, and PR bodies for host home directory prefixes, host username, sibling handle, and non-noreply emails. A post-merge `origin/main` scan verifies server-side merge commits after PR #12.
    *   Commits use `pakhinnn1` and its GitHub noreply email (`359503387+pakhinnn1@users.noreply.github.com`); personal email addresses never enter Git history.
    *   GitHub tokens are read dynamically from `gh auth token --user pakhinnn1` at runtime and never written to tracked files, logs, or scripts.
    *   The one-off transcript replay harness stays outside the canonical repository so raw local transcript paths never enter Git history.
*   **Performance & Bundle Budget:**
    *   `scripts/build.mjs` enforces `dist/app.html` UTF-8 byte length below `1048576` bytes (1 MiB, currently ~757 KiB) as a hard build failure.
    *   All Era 2 scripts use Node.js built-ins only, adding zero npm dependencies and avoiding extra runtime package resolution.
*   **Rollout & Rollback:**
    *   `<legacy-scratch-dir>` stays read-only until all six exit gates pass and the maintainer explicitly confirms deletion.
    *   `scripts/sync-plugin.mjs` provides a read-only `--dry-run` preview mode, swaps atomically via a sibling backup directory, never modifies `~/.gemini/config/config.json`, and never kills or restarts host processes.
    *   Rolling back a synced runtime update checks out the prior Git tag (for example `v0.2.0`), runs `npm ci && npm run sync`, and reloads `context-monitor_context-monitor` manually in Antigravity Desktop settings.

## Additional Resources

*   Predecessor ideation brief: local brainstorm artifact `concepts_brief.md` (locked decisions, primary-source transcript findings, contradiction analysis, and six exit gates).
*   Existing Context Monitor design specs: `docs/designs/metrics_and_inventory_v2.md` (Spec 1) and `docs/designs/global_workspace_ux.md` (Spec 2).
*   Antigravity plugin authoring and strict validation CLI (`agy plugin validate --strict --json`).
*   Pull request authoring skills: `pr` and `kien-thai`.

## Future Improvements

*   **Automated CI workflow:** Add a GitHub Actions workflow running `npm ci`, `npm test`, and portable manifest/bundle validation on every pull request (providing headless schema validation when `agy` CLI is absent).
*   **Automated release publishing:** Replace macOS Info-ZIP dependency with portable Node/cross-platform archiving so `npm run package` and GitHub Release asset uploads can run in CI when pushing `v*` tags.
*   **Build-time version injection (`v0.3.0+`):** Inject `package.json.version` into `src/server.mjs` and `src/ui/main.js` via esbuild `define` and read `package.json` in `scripts/test-server.mjs`, reducing permanent parity checks to `package.json`, `package-lock.json`, `plugin.json`, and `README.md`.
*   **Dedicated SSH host alias:** Migrate from repo-local HTTPS credential helper to SSH host aliases if multi-account GitHub usage expands beyond a single isolated repository.

---

## Detailed Implementation Plan

### Target Files to Create, Modify, or Delete

#### 1. `~/.gitconfig` (Modify — Host Local, Untracked)

*   **Type / Scope:** Host Git configuration.
*   **Rationale:** Bind `context-monitor` automatically to `pakhinnn1` without altering global defaults for sibling repositories.
*   **Proposed Changes:** Append `[includeIf "gitdir:~/Developer/personalities/temporaries/context-monitor/"]` with `path = ~/.gitconfig-pakhinnn1`. Leave existing global `[user]` and `[credential]` blocks untouched.

#### 2. `~/.gitconfig-pakhinnn1` (Create — Host Local, Untracked)

*   **Type / Scope:** Conditional host Git configuration.
*   **Rationale:** Isolate commit author/committer identity and fail-closed HTTPS authentication to `pakhinnn1`.
*   **Proposed Changes:** Set `user.name = pakhinnn1` and `user.email = 359503387+pakhinnn1@users.noreply.github.com` (resolved via `GH_TOKEN="$(gh auth token --user pakhinnn1)" gh api user --jq .id`). Under `[credential "https://github.com"]`, clear inherited helpers (`helper = `) and register the exact `sh -c` shell-function helper (necessary because Git passes the operation in `$0` unless wrapped in `f() { ...; }; f`, and exits `0` on `store`/`erase` while using Apple Silicon Homebrew's `/opt/homebrew/bin/gh`):
    ```ini
    [user]
        name = pakhinnn1
        email = 359503387+pakhinnn1@users.noreply.github.com
    [credential "https://github.com"]
        helper =
        helper = !f() { [ "$1" = "get" ] || exit 0; tok="$(/opt/homebrew/bin/gh auth token --user pakhinnn1)" || exit 1; [ -n "$tok" ] || exit 1; printf "protocol=https\nhost=github.com\nusername=pakhinnn1\npassword=%s\n" "$tok"; }; f
    ```

#### 3. `~/Developer/personalities/temporaries/context-monitor/.git/config` (Modify — Repo Local, Untracked)

*   **Type / Scope:** Repository-local Git configuration.
*   **Rationale:** Mirror `pakhinnn1` identity and credential helper locally inside the repo as defense-in-depth if Git commands are invoked via symlinks or alternate working paths.
*   **Proposed Changes:** Configure `user.name = pakhinnn1`, `user.email = 359503387+pakhinnn1@users.noreply.github.com`, the identical empty-reset plus `!f() ...; f` `credential.https://github.com.helper` block from Item 2, and `remote.origin.url = https://github.com/pakhinnn1/context-monitor.git`.

#### 4. `<conversation-scratch>/replay-context-monitor.mjs` (Create — External One-Off Harness, Outside Canonical Repo)

*   **Type / Scope:** Temporary Node.js migration and verification harness (never committed to the canonical repository).
*   **Rationale:** Replay raw transcripts in memory to prove zero drift against scratch, apply deterministic scrubbing and the five-file version overlay, enforce pre-push and post-merge privacy scanning, and emit Era 1 commits and branches.
*   **Proposed Changes:**
    *   **Ordered 14-session table:** Resolve each 8-character prefix to its single matching folder under `~/.gemini/antigravity/brain/<prefix>-*/.system_generated/logs/` (reading `transcript_full.jsonl` when present, falling back to `transcript.jsonl`):
        1. `20103b35` -> `main` initial commit (`2026-11-26T16:36:05Z`, `chore: initial Context Monitor v0.1.0 scaffold`)
        2. `17dbe26e` -> branch `era1/02-bugfix-polish`, PR #1 (`fix: polish v0.1.0 layout and inspector behavior`)
        3. `a1cfe805` -> branch `era1/03-spec1-design`, PR #2 (`docs: add SITEMAP and Spec 1 v2 metrics design`)
        4. `cc8dafd1` -> branch `era1/04-spec1-review`, PR #3 (`docs: address Spec 1 design review findings`)
        5. `0b184f2b` -> branch `era1/05-spec1-resolution`, PR #4 (`docs: finalize Spec 1 design resolution edits`)
        6. `9691f551` -> branch `era1/06-spec1-implementation`, PR #5 (`feat: implement Spec 1 v2 analyzer and MCP contract`)
        7. `b4cf0822` -> **Excluded** (Stage 1 raw replay only; touched only `docs/designs/2026-11-27_DRIFT_REPORT.md`)
        8. `a1f2a1f5` -> branch `era1/08-spec1-reconciliation`, PR #6 (`fix: reconcile Spec 1 drift findings and tests`)
        9. `524c9462` -> branch `era1/09-spec1-verification`, PR #7 (`docs: record Spec 1 verification updates`)
        10. `2718387e` -> branch `era1/10-spec2-design`, PR #8 (`docs: add Spec 2 global workspace UX design`)
        11. `c1b37902` -> branch `era1/11-spec2-implementation`, PR #9 (`feat: implement Spec 2 global workspace UX and fleet explorer`)
        12. `f6c7dda6` -> branch `era1/12-spec2-verification`, PR #10 (`fix: resolve Spec 2 verification findings`)
        13. `7c9c763d` -> branch `era1/13-chart-polish`, PR #11 (`fix: polish Spec 2 UI and trajectory chart`)
        14. `1232e578` -> branch `era1/14-chart-verification`, PR #12 (`fix: verify Spec 2 UI and chart fixes`)
    *   `verifyRawReplay(transcriptDirs, scratchDir)`: reads JSONL events chronologically; correlates each `PLANNER_RESPONSE.tool_calls[]` (`write_file`, `edit_file`) with its execution result and skips any tool call whose paired `GENERIC` step has `status === "ERROR"`; decodes tool arguments (`Path`, `Content`, `Target`, `Replacement`, `Overwrite`, `Append`) by parsing double-quoted JSON strings (`JSON.parse` when starting with `"` and valid JSON, else raw string), expanding leading `~/`, supporting `Append === true || Append === "true"`, and replacing `Target` with `Replacement` in `edit_file`. At Session 14 end, asserts zero byte diff against all 21 authored files in read-only scratch (excluding `dist/`, `node_modules/`, and `package-lock.json`).
    *   `scrubDesignDoc(relPath, content)`: pure deterministic search-and-replace scoped to the three kept design docs (constructed at runtime from host/sibling env/config patterns so the harness never embeds raw sensitive literals in tracked files):
        *   `docs/designs/SITEMAP.md`: line 3 `<SCRATCH_PATH>` -> `this repository`; lines 7–8 author column `<SIBLING_HANDLE>` -> `pakhinnn1`.
        *   `docs/designs/metrics_and_inventory_v2.md`: line 3 `Author: <SIBLING_HANDLE>` -> `Author: pakhinnn1`; line 11 `(<SCRATCH_PATH>)` -> `(this repository)`; line 59 `<SCRATCH_PATH>/docs/designs/` -> `docs/designs/`; line 316 `to <SCRATCH_PATH> and` -> `to the source repository and`; line 442 `in <SCRATCH_PATH> exits` -> `in the repository root exits`; line 446 `between <SCRATCH_PATH> and` -> `between the staged runtime bundle and`.
        *   `docs/designs/global_workspace_ux.md`: line 3 `Author: <SIBLING_HANDLE>` -> `Author: pakhinnn1`; line 11 `(<SCRATCH_PATH>)` -> `(this repository)`; lines 383–384 strip `(<HOST_SKILL_PREFIX>/<name>/SKILL.md — <desc>)` leaving `` 4.  `impeccable` (<desc>) `` and `` 5.  `emil-design-eng` (<desc>) ``; line 453 `between <SCRATCH_PATH> and` -> `between the staged runtime bundle and`.
    *   `applyVersionOverlay(order, relPath, content)`: pure transform scoped to the five Era 1 versioned files (`package.json` `"version"`, `plugin.json` `"version"`, `src/server.mjs` `McpServer` `version: "..."`, `src/ui/main.js` `new App(..., version: "...")`, and all 3 `Client` `version: "..."` calls in `scripts/test-server.mjs`). Keeps `0.1.0` on Order 1, sets `0.1.1` on Orders 2–5, sets `0.1.2` on Orders 6–9, and leaves Orders 10–13 verbatim at `0.2.0`. Never alters design document baseline prose.
    *   `verifyPrePushParity(order13Map, scratchDir)` and `verifyPostMergeParity(repoDir, scratchDir)`: applies `scrubDesignDoc` to the 20 kept files in read-only scratch and asserts zero byte diff first against the in-memory Order 13 (Session 14) snapshot before pushing, and again against `git show HEAD:<path>` after PR #12 merges and `git fetch origin main` completes.
    *   `scanForLeaks(repoDir, prMetaDir)`: inspects every Git object via `git rev-list --all --objects` piped to `git cat-file --batch`, every commit message, author/committer header, branch name, annotated tag message, PR title, and drafted Thai PR body file against blocked patterns (host home prefix, host username, sibling handle, personal names/emails), explicitly permitting `^\d+\+pakhinnn1@users\.noreply\.github\.com$`. Exits non-zero on any match.
    *   Inline Era 1 identity preflight: verifies local `user.name === "pakhinnn1"`, `user.email` matches `^\d+\+pakhinnn1@users\.noreply\.github\.com$`, `origin` equals `https://github.com/pakhinnn1/context-monitor.git`, `gh auth token --user pakhinnn1` succeeds, `gh api user --jq .login === "pakhinnn1"`, and `pakhinnn1` email privacy is enabled. Emits initial `main` commit (`v0.1.0`) and 12 branches (`era1/02-...` through `era1/14-...`) preserving `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE`, merges sequentially with `gh pr merge --merge --delete-branch` using scoped `GH_TOKEN`, and supports idempotent resume if interrupted mid-sequence.

#### 5. 20 Reconstructed Era 1 Authored Files (Create via Initial Commit + 12 Chronological PRs)

*   **Type / Scope:** Reconstructed Context Monitor source, tests, assets, manifests, and scrubbed design docs.
*   **Rationale:** Establish one commit or merge PR per kept historical session across the 20 retained files: `README.md`, `assets/logo.svg`, `mcp_config.json`, `package.json`, `plugin.json`, `scripts/build.mjs`, `scripts/test-analyzer.mjs`, `scripts/test-server.mjs`, `src/analyzer.mjs`, `src/preferences.mjs`, `src/server.mjs`, `src/ui/charts.js`, `src/ui/format.js`, `src/ui/index.html`, `src/ui/main.js`, `src/ui/rail.js`, `src/ui/styles.css`, `docs/designs/SITEMAP.md`, `docs/designs/metrics_and_inventory_v2.md`, and `docs/designs/global_workspace_ux.md`.
*   **Proposed Changes:** Populated exclusively by Stage 2 replay output with zero functional code changes; `docs/designs/2026-11-27_DRIFT_REPORT.md` and Session 7 (`b4cf0822`) are excluded. Each PR #1–#12 body uses the `pr` skill template in natural Thai via `kien-thai`; the five docs-only PRs present document state and section diff evidence.

#### 6. `LICENSE` (Create — Era 2 PR #13: Repo Hygiene and Seeded Lockfile)

*   **Type / Scope:** Open-source license file.
*   **Rationale:** Declare MIT licensing for the public repository after Era 1 20-file parity is locked.
*   **Proposed Changes:** Standard MIT License text with `Copyright (c) 2026 pakhinnn1`.

#### 7. `.gitignore` (Create — Era 2 PR #13: Repo Hygiene and Seeded Lockfile)

*   **Type / Scope:** Git ignore rules.
*   **Rationale:** Enforce source-only `main` by excluding build outputs, dependencies, release archives, logs, and macOS metadata files.
*   **Proposed Changes:** Ignore `dist/`, `node_modules/`, `release/`, `.DS_Store`, `*.tgz`, and `*.log`.

#### 8. `package-lock.json` (Create — Era 2 PR #13: Repo Hygiene and Seeded Lockfile)

*   **Type / Scope:** npm lockfile.
*   **Rationale:** Seed the verified scratch dependency tree and update root lockfile metadata from `0.1.0` to `0.2.0` so `npm ci` reproduces pinned dependencies deterministically while `scripts/build.mjs` enforces the 1 MiB UI bundle limit.
*   **Proposed Changes:** Copy `package-lock.json` from read-only scratch into the canonical repo, run `npm install --package-lock-only` so root `version` and `packages[""].version` equal `0.2.0` without changing resolved package versions, and verify `npm ci && npm run build` exits 0 with `dist/app.html` under 1 MiB.

#### 9. `plugin.json` (Modify — Era 2 PR #13: Repo Hygiene and Seeded Lockfile)

*   **Type / Scope:** Antigravity plugin manifest.
*   **Rationale:** Add public attribution and repository metadata without introducing unsupported top-level fields.
*   **Proposed Changes:** Keep all existing fields unchanged; add `author` (`{"name": "pakhinnn1", "url": "https://github.com/pakhinnn1"}`), `homepage` (`https://github.com/pakhinnn1/context-monitor`), and `repository` (`{"type": "git", "url": "https://github.com/pakhinnn1/context-monitor.git"}`).

#### 10. `scripts/check-identity.mjs` (Create — Era 2 PR #14: Identity, `gh` Wrapper, Privacy Guard, and Build Ceiling)

*   **Type / Scope:** Node.js CLI preflight script (Node built-ins only).
*   **Rationale:** Fail closed before maintainer pushes, PRs, or releases whenever local Git config, remote URL, or scoped `gh` identity drifts, without blocking forks or external contributors.
*   **Proposed Changes:** Reads optional `CM_EXPECTED_GH_USER` (default `"pakhinnn1"`) and `CM_EXPECTED_REMOTE_URL` (default `"https://github.com/pakhinnn1/context-monitor.git"`). Verifies four invariants in order: (1) `git config --local user.name === expectedUser`, (2) `git config --local user.email` matches `new RegExp("^\\d+\\+" + escapeRegex(expectedUser) + "@users\\.noreply\\.github\\.com$")`, (3) `git remote get-url origin === expectedRemoteUrl`, and (4) `gh auth token --user <expectedUser>` exits 0 with non-empty token first (never falling back to global keyring), then `gh api user --jq .login` with that `GH_TOKEN` equals `expectedUser`. Prints concise pass summary and exits 0, or prints specific mismatch and exits 1. Never invoked by `npm test` or `npm run build`.

#### 11. `scripts/gh.mjs` (Create — Era 2 PR #14: Identity, `gh` Wrapper, Privacy Guard, and Build Ceiling)

*   **Type / Scope:** Node.js scoped `gh` CLI wrapper (Node built-ins only).
*   **Rationale:** Guarantee every repository `gh` command executes under `pakhinnn1` and fails closed on identity mismatch, preventing bare `gh` commands from hitting the host default GitHub account.
*   **Proposed Changes:** Runs `check-identity` verification, retrieves `GH_TOKEN` via `gh auth token --user <expectedUser>` (exiting 1 if unavailable), and spawns `gh` with `process.argv.slice(2)`, `env: { ...process.env, GH_TOKEN: token }`, and `stdio: "inherit"`, forwarding the child exit code.

#### 12. `scripts/check-privacy.mjs` (Create — Era 2 PR #14: Identity, `gh` Wrapper, Privacy Guard, and Build Ceiling)

*   **Type / Scope:** Node.js pre-push and PR-body privacy scanner (Node built-ins only).
*   **Rationale:** Retain automated fail-closed leak scanning across Era 2 PRs (#13–#16) and future agent sessions without embedding sensitive host strings in the public repository.
*   **Proposed Changes:** Accepts optional `--file <path>` (repeatable, e.g., drafted PR body files), `--range <git-rev-range>` (default `origin/main..HEAD` when `origin/main` exists, else `HEAD`), and `--strict-local` (exits 1 if no host-local pattern file is present). Scans tracked/unpushed Git blobs, commit messages, headers, and `--file` inputs for structural patterns constructed dynamically at runtime (such as `"/" + "Users/<name>/"`, `"/" + "home/<name>/"`, `"scratch" + "/context-monitor"`, and email addresses not matching `^\d+\+[^@]+@users\.noreply\.github\.com$`) so `scripts/check-privacy.mjs` never self-matches, plus extra exact literal/regex lines loaded from `CM_PRIVACY_PATTERNS_FILE` or `~/.config/context-monitor/privacy-patterns.txt` when present. Prints zero-hit pass summary and exits 0, or prints file/commit location and rule name (without echoing raw secrets unnecessarily) and exits 1.

#### 13. `scripts/build.mjs` (Modify — Era 2 PR #14: Identity, `gh` Wrapper, Privacy Guard, and Build Ceiling)

*   **Type / Scope:** esbuild build script.
*   **Rationale:** Convert the 1 MiB `dist/app.html` ceiling from a passive console log into a hard build invariant.
*   **Proposed Changes:** Compute `Buffer.byteLength(singleFileHtml, "utf8")`; if `>= 1024 * 1024`, write the measured byte count and `1048576` byte limit to `stderr` and exit 1. Preserve all existing esbuild bundling flags for `dist/app.html` and `dist/server.mjs`.

#### 14. `scripts/lib/runtime-stage.mjs` (Create — Era 2 PR #15: Shared Staging, Sync, Packager, and Tooling Tests)

*   **Type / Scope:** Shared Node.js ES module and CLI validator (Node built-ins only).
*   **Rationale:** Maintain a single source of truth for the five-entry runtime allowlist, seven-file Era 2 version parity, temporary staging, and strict validation.
*   **Proposed Changes:**
    *   Exports `RUNTIME_ALLOWLIST = ["plugin.json", "mcp_config.json", "README.md", "assets", "dist"]` and `MAX_APP_HTML_BYTES = 1024 * 1024`.
    *   `assertVersionParity(rootDir)`: reads `package.json.version` and asserts identical semver match across: (1) `package-lock.json` `version` and `packages[""].version`, (2) `plugin.json.version`, (3) `README.md` line 3 matching ``\(`v([0-9]+\.[0-9]+\.[0-9]+)`\)`` (1 match), (4) `src/server.mjs` `McpServer` constructor `version: "([^"]+)"` (1 match), (5) `src/ui/main.js` `new App(\{[^}]*version:\s*"([^"]+)"` (1 match), and (6) `scripts/test-server.mjs` all `Client` `version:\s*"([^"]+)"` matches (expected count: 3 matches; fail if count !== 3 or any value differs).
    *   `stageAndValidateRuntime(rootDir, { skipBuild = false } = {})`: unless `skipBuild`, invokes `scripts/build.mjs` via `execFileSync(process.execPath, [buildPath], { cwd: rootDir, stdio: "inherit" })`; calls `assertVersionParity(rootDir)`; creates a fresh temp directory via `fs.mkdtempSync`; recursively copies only `RUNTIME_ALLOWLIST` entries while excluding `.DS_Store` and `__MACOSX`; asserts `dist/app.html` UTF-8 byte length `< MAX_APP_HTML_BYTES`; checks `agy` availability and exits 1 with `"agy CLI not found in PATH"` if `ENOENT`; runs `agy plugin validate <stagedDir> --strict --json`, parses stdout JSON (`{ dir, manifest, name, findings }`) asserting exit code 0 and `Array.isArray(parsed.findings) && parsed.findings.length === 0`; and returns `{ version, stagedDir, cleanup }`.
    *   Dual library/CLI mode gated by `process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))`: runs `stageAndValidateRuntime`, prints validation summary, and always calls `cleanup()` inside `finally`.

#### 15. `scripts/sync-plugin.mjs` (Create — Era 2 PR #15: Shared Staging, Sync, Packager, and Tooling Tests)

*   **Type / Scope:** Node.js CLI local runtime sync script (Node built-ins only).
*   **Rationale:** Replace manual file copying with validated dry-run diffing, allowlist-only atomic swap, zero-diff post-check, and manual MCP reload instructions.
*   **Proposed Changes:**
    *   Parses `--dry-run` and `--target <dir>` (default `~/.gemini/config/plugins/context-monitor`). Resolves `resolvedTarget = path.resolve(target)` and fails closed unless `path.basename(resolvedTarget) === "context-monitor"` and `resolvedTarget` is not `/`, `os.homedir()`, `~/.gemini`, `~/.gemini/config`, `~/.gemini/config/plugins`, `rootDir`, or an ancestor of `rootDir`.
    *   Calls `stageAndValidateRuntime(rootDir)` inside `try { ... } finally { await cleanup(); }`.
    *   Builds recursive SHA-256 file maps of `stagedDir` and `resolvedTarget` (treating a missing `resolvedTarget` as an empty map `{}`) and prints `added`, `updated`, `unchanged`, and `removed` paths.
    *   On `--dry-run`, exits 0 without modifying disk.
    *   On apply, ensures `parentDir = path.dirname(resolvedTarget)` exists, creates a sibling temp dir under `parentDir` (`fs.mkdtempSync(path.join(parentDir, ".context-monitor-sync-"))`) to avoid cross-volume `EXDEV`, copies `stagedDir` contents into it, atomically swaps `resolvedTarget` (moving existing `resolvedTarget` to a sibling backup dir, renaming sibling temp dir to `resolvedTarget`, restoring backup on error, and deleting backup after success), re-hashes both trees to assert zero diff, and prints manual reload instructions for `context-monitor_context-monitor` in Antigravity Desktop settings without touching `~/.gemini/config/config.json` or host processes.

#### 16. `scripts/package-release.mjs` (Create — Era 2 PR #15: Shared Staging, Sync, Packager, and Tooling Tests)

*   **Type / Scope:** Node.js CLI release zip packager (Node built-ins only).
*   **Rationale:** Build a deterministic, macOS-clean single-folder wrapped `.zip` (`context-monitor/` at archive root), verify its entry table and strict plugin validation, and emit its SHA-256 checksum.
*   **Proposed Changes:**
    *   Parses `--out-dir <dir>` (default `<repoRoot>/release`). Calls `fs.mkdirSync(outDir, { recursive: true })` and resolves `zipPath = path.resolve(outDir, "context-monitor-v" + version + ".zip")`.
    *   Calls `stageAndValidateRuntime(rootDir)` inside `try { ... } finally { await cleanup(); }`.
    *   Copies `stagedDir` under `<tmpParent>/context-monitor/`, clamps all file and directory `mtime` / `atime` recursively to the `HEAD` commit epoch (`git log -1 --format=%ct`) via `fs.utimesSync`, calls `fs.rmSync(zipPath, { force: true })` so pre-existing archives never retain stale entries, and runs `/usr/bin/zip -r -X -q <zipPath> context-monitor` with `cwd: tmpParent` and `COPYFILE_DISABLE=1` (verifying `/usr/bin/zip` exists upfront).
    *   Inspects `unzip -Z1 <zipPath>` and asserts: every entry begins with `context-monitor/`, skipping the bare `"context-monitor/"` root directory entry every second-level segment belongs to `RUNTIME_ALLOWLIST`, and zero entries contain `__MACOSX` or `.DS_Store`.
    *   Runs `agy plugin validate <zipPath> --strict --json` asserting exit code 0 and `findings.length === 0`.
    *   Computes SHA-256 via `node:crypto` and writes `<digest>  context-monitor-v<version>.zip\n` to `<zipPath>.sha256`.

#### 17. `scripts/test-tooling.mjs` (Create — Era 2 PR #15: Shared Staging, Sync, Packager, and Tooling Tests)

*   **Type / Scope:** Node.js built-in `node:test` test suite (zero external dependencies).
*   **Rationale:** Verify happy paths and failure-mode invariants for all Era 2 scripts deterministically.
*   **Proposed Changes:** Tests: (1) `build.mjs` byte-ceiling check failing on oversized HTML, (2) `assertVersionParity` passing on synced fixtures and throwing on mismatched `README.md`, `package-lock.json`, or zero-match JS files, (3) `sync-plugin.mjs` rejecting unsafe `--target` paths, treating missing `--target` as all-added in `--dry-run`, swapping atomically, and removing non-allowlist stale files/dotfiles on apply, (4) `check-privacy.mjs` catching home paths, scratch paths, and personal emails (building test fixture strings dynamically so `scripts/test-tooling.mjs` never self-matches `npm run check:privacy`) while permitting `pakhinnn1` noreply emails, and (5) `package-release.mjs` entry-table validator allowing bare `context-monitor/` while rejecting extra entries or `__MACOSX`/`.DS_Store`.

#### 18. `package.json` (Modify — Era 2 PR #14 & PR #15)

*   **Type / Scope:** npm scripts manifest.
*   **Rationale:** Expose identity, privacy, and `gh` wrapper scripts in PR #14 so PR #14–#16 can invoke `npm run check:privacy` and `npm run gh`, then make `npm test` self-contained and add `validate`, `sync`, and `package` in PR #15.
*   **Proposed Changes:** PR #14 adds `"check:identity"`, `"check:privacy"`, and `"gh"`; PR #15 updates `"test"` and adds `"validate"`, `"sync"`, and `"package"`, producing the final `scripts` block:
    ```json
    "scripts": {
      "build": "node scripts/build.mjs",
      "test": "npm run build && node --test scripts/test-analyzer.mjs scripts/test-tooling.mjs && node scripts/test-server.mjs",
      "check:identity": "node scripts/check-identity.mjs",
      "check:privacy": "node scripts/check-privacy.mjs",
      "gh": "node scripts/gh.mjs",
      "validate": "node scripts/lib/runtime-stage.mjs",
      "sync": "node scripts/sync-plugin.mjs",
      "package": "node scripts/package-release.mjs"
    }
    ```

#### 19. `AGENTS.md` (Create — Era 2 PR #16: Governance and Documentation)

*   **Type / Scope:** Repository agent governance instructions.
*   **Rationale:** Codify repeatable solo PR, versioning, validation, sync, and privacy rules for future agent sessions, referencing skills by name only to prevent host path leaks.
*   **Proposed Changes:** Document: `npm run check:identity`, `npm run gh -- ...`, and `npm run check:privacy -- --strict-local --file <pr-body.md>` requirements; branch-based PR workflow; source-only `main` invariant; seven-file Era 2 version parity list (`package.json`, `package-lock.json`, `plugin.json`, `README.md` line 3, `src/server.mjs`, `src/ui/main.js`, `scripts/test-server.mjs`); required pre-PR verification (`npm test`, `npm run validate`, `npm run sync -- --dry-run`); manual MCP reload of `context-monitor_context-monitor` after `npm run sync`; and PR body format citing `pr` and `kien-thai` by skill name only.

#### 20. `README.md` (Modify — Era 2 PR #16: Governance and Documentation)

*   **Type / Scope:** Repository user and developer documentation.
*   **Rationale:** Replace obsolete root `agy plugin validate . --strict` and manual copy instructions with release zip installation (including upgrade cleanup) and Era 2 npm scripts.
*   **Proposed Changes:** Update `Build and test` (`npm ci`, `npm run build`, `npm test`, `npm run validate`) and `Install into Antigravity` sections documenting release archive installation (`rm -rf ~/.gemini/config/plugins/context-monitor && unzip -q context-monitor-v0.2.0.zip -d ~/.gemini/config/plugins/`), maintainer local sync (`npm run sync -- --dry-run`, `npm run sync`), release packaging (`npm run package`), and manual MCP server reload.

#### 21. `docs/designs/git_reconstruction_and_release_packaging.md` (Create — Era 2 PR #16: Governance and Documentation)

*   **Type / Scope:** Approved architecture and implementation specification copied into canonical repository.
*   **Rationale:** Archive this design specification alongside Spec 1 and Spec 2 inside `docs/designs/` so `docs/designs/SITEMAP.md` resolves without broken links.
*   **Proposed Changes:** Copy this approved design document into `docs/designs/git_reconstruction_and_release_packaging.md`, replace legacy scratch path literals with `<legacy-scratch-dir>` so the archived doc passes the `<legacy-scratch-dir>` structural rule, strip any internal workflow provenance footer (`<!-- Provenance: ... -->` and `*Drafted with EGM*`), and pass `npm run check:privacy -- --strict-local` before committing.

#### 22. `docs/designs/SITEMAP.md` (Modify — Era 2 PR #16: Governance and Documentation)

*   **Type / Scope:** Design specification index.
*   **Rationale:** Register this design document in the repository design index.
*   **Proposed Changes:** Add one table row linking `[Git Reconstruction & Release Packaging](./git_reconstruction_and_release_packaging.md)` with date `2026-11-27`, author `pakhinnn1`, affected components (`scripts/`, `AGENTS.md`, `README.md`, `package.json`, `plugin.json`), and a one-sentence summary.

#### 23. `~/repos/personalities/home/AGENTS.md` (Modify — Workstream D, Single-Line Addition)

*   **Type / Scope:** Home workspace repository directory index (private host workspace file, separate from public `context-monitor`).
*   **Rationale:** Register the canonical repository location for future home-workspace agent sessions.
*   **Proposed Changes:** Add one bullet under `## Other Repos` matching that file's full-path convention (pointing `context-monitor` to the full local path under `Developer/personalities/temporaries/context-monitor` and `https://github.com/pakhinnn1/context-monitor.git`) with a reminder to read `context-monitor/AGENTS.md` first.

#### 24. `~/.gemini/config/plugins/context-monitor/` (Modify via `npm run sync` — Workstream D)

*   **Type / Scope:** Installed Antigravity runtime plugin directory.
*   **Rationale:** Deploy the validated Era 2 `v0.2.0` runtime bundle into Antigravity Desktop and verify live execution.
*   **Proposed Changes:** Apply via `npm run sync` after reviewing `--dry-run` diff, reload `context-monitor_context-monitor` manually from Antigravity Desktop settings, and invoke `open_context_monitor` to verify live UI rendering.

#### 25. `<legacy-scratch-dir>/` (Delete — Workstream D Final Gate)

*   **Type / Scope:** Legacy unversioned scratch directory.
*   **Rationale:** Eliminate duplicate source-of-truth confusion once canonical repo, release archive, and runtime installation are verified.
*   **Proposed Changes:** Keep read-only until all six exit gates pass with recorded raw output and the user explicitly confirms deletion.

### Execution Order and Manual Checkpoints

#### Step 1: Workstream A (Auth and Repository Bootstrap)
1. **Pause for interactive `gh` login:** Authenticate `pakhinnn1` interactively via `gh auth login`, then immediately run `gh auth switch` back to the host default GitHub account.
2. **Verify noreply email and web-commit privacy:** Using scoped `GH_TOKEN="$(gh auth token --user pakhinnn1)"`, query `gh api user` to obtain the `pakhinnn1` numeric ID and verify `Keep my email addresses private` is enabled on `pakhinnn1`.
3. **Configure isolated Git identity:** Write the `gitdir` include in `~/.gitconfig`, create `~/.gitconfig-pakhinnn1` with the shell-function credential helper, initialize `~/Developer/personalities/temporaries/context-monitor`, write mirrored repo `.git/config`, and create the public GitHub repository `pakhinnn1/context-monitor`.

#### Step 2: Workstream B (Era 1 Replay and Privacy Gates)
1. **Run two-stage replay harness:** Execute `<conversation-scratch>/replay-context-monitor.mjs` Stage 1 (0 diff vs 21 raw scratch files) and Stage 2 (0 diff vs 20 scrubbed scratch files at in-memory Order 13 / raw Session 14).
2. **Draft PR bodies and run pre-push privacy scan:** Draft the 12 Thai `pr`-template PR bodies and run `scanForLeaks` across all commits, headers, branches, tags, PR titles, and PR bodies. **Pause for user confirmation of zero privacy leaks.**
3. **Push initial commit and merge PR #1 through PR #12:** Push `main` (`v0.1.0`) and tag `v0.1.0`, then sequentially push branches `era1/02-...` through `era1/14-...`, open PR #1 through PR #12, and merge via `gh pr merge --merge --delete-branch` with scoped `GH_TOKEN`, applying tags `v0.1.1` (after PR #1) and `v0.1.2` (after PR #5).
4. **Verify post-merge parity and privacy:** Fetch `origin/main`, verify 0 diff between `HEAD` and the 20 scrubbed scratch files, and re-run `scanForLeaks` across all `origin/main` commits and headers.

#### Step 3: Workstream C (Era 2 Tooling, Documentation, and Release)
1. **Land PR #13 through PR #16:** Open and merge PR #13 (hygiene and seeded lockfile) using `scanForLeaks` and scoped `GH_TOKEN`; land PR #14 (`check-identity`, `gh` wrapper, `check-privacy`, 1 MiB build ceiling, and `package.json` `check:identity`/`check:privacy`/`gh` scripts) using `node scripts/check-privacy.mjs --strict-local --file <pr-body.md>` and `node scripts/gh.mjs` (or `npm run` once committed); then land PR #15 (shared staging, atomic sync, release packager, tooling tests, remaining `package.json` scripts) and PR #16 (`AGENTS.md`, `README.md`, scrubbed `docs/designs/git_reconstruction_and_release_packaging.md`, `docs/designs/SITEMAP.md`) using `npm run check:privacy -- --strict-local --file <pr-body.md>` and `npm run gh` on each PR.
2. **Build, test, validate, and package `v0.2.0`:** Run `npm ci && npm test && npm run validate && npm run package` on `main`.
3. **Tag and publish `v0.2.0` GitHub Release:** Create and push annotated tag `v0.2.0` on post-PR #16 `main`, then run `npm run gh -- release create v0.2.0 release/context-monitor-v0.2.0.zip release/context-monitor-v0.2.0.zip.sha256 --verify-tag --title "Context Monitor v0.2.0" --notes-file <release-notes.md>` (after running `npm run check:privacy` on the release notes).

#### Step 4: Workstream D (Branch Protection, Live Sync, Pointer, and Retirement)
1. **Configure optional branch protection:** Apply `main` branch protection requiring pull requests with 0 required approving reviews while blocking force-pushes and branch deletion.
2. **Sync locally and verify live MCP UI:** Run `npm run sync -- --dry-run` and `npm run sync`, manually reload `context-monitor_context-monitor` in Antigravity Desktop settings, and invoke `open_context_monitor` in Antigravity Desktop to verify the UI renders.
3. **Register home workspace pointer and retire scratch:** Apply the single-line addition in `~/repos/personalities/home/AGENTS.md`, present raw output for all six exit gates, and **pause for explicit user confirmation** before deleting `<legacy-scratch-dir>/`.

### Verification Plan

*   **Exit Gate 1 — Replay Fidelity:** External harness asserts 0 byte diff across all 21 raw scratch files in Stage 1, 0 byte diff across all 20 scrubbed kept files at Order 13 in-memory pre-push, and 0 byte diff at post-PR #12 `origin/main` `HEAD`.
*   **Exit Gate 2 — Pre-Push and Post-Merge Privacy Scans:** `scanForLeaks` across Era 1 objects, messages, headers, tags, branches, PR titles, PR bodies, and fetched `origin/main` exits 0 with zero matches; `npm run check:privacy -- --strict-local` exits 0 for Era 2 PRs and release notes.
*   **Exit Gate 3 — Account Isolation:** `npm run check:identity` and `npm run gh -- api user --jq .login` exit 0 (`pakhinnn1`, `^\d+\+pakhinnn1@users\.noreply\.github\.com$`, `https://github.com/pakhinnn1/context-monitor.git`), while global `gh auth status` confirms the host default GitHub account remains active.
*   **Exit Gate 4 — Build, Tests, and Strict Validation:** Fresh `npm ci && npm run build && npm test && npm run validate` exits 0 in the canonical repository (running analyzer, server, and `scripts/test-tooling.mjs` negative/happy tests) with `dist/app.html` below `1048576` bytes, `findings: []` from `agy plugin validate --strict --json`, and empty `git status --short`.
*   **Exit Gate 5 — Wrapped Release Zip and GitHub Release:** `npm run package` outputs `release/context-monitor-v0.2.0.zip` and `.sha256`; `unzip -Z1` confirms every entry begins with `context-monitor/`, skipping the bare `context-monitor/` root entry every top-level file or folder inside `context-monitor/` is in `RUNTIME_ALLOWLIST`, and zero entries contain `__MACOSX` or `.DS_Store`; `agy plugin validate release/context-monitor-v0.2.0.zip --strict --json` exits 0 with `findings: []`; and `npm run gh -- release view v0.2.0` confirms both assets are attached to the `v0.2.0` GitHub Release pointing at the `v0.2.0` tag on `main`.
*   **Exit Gate 6 — Local Sync and Live MCP Verification:** `npm run sync -- --dry-run` and `npm run sync` exit 0 with zero allowlist diff and zero non-allowlist files against `~/.gemini/config/plugins/context-monitor`; after manual MCP reload of `context-monitor_context-monitor`, `open_context_monitor` renders live in Antigravity Desktop.

