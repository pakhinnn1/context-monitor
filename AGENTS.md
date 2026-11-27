# Context Monitor Agent Governance

This repository hosts Context Monitor, a local MCP App plugin for Antigravity Desktop (`context-monitor_context-monitor`, tool `open_context_monitor`).

## Identity and GitHub CLI Rules

- Local Git config and `origin` must remain bound to `pakhinnn1` and its GitHub noreply commit email (`359503387+pakhinnn1@users.noreply.github.com`).
- Run `npm run check:identity` before pushing branches or interacting with GitHub.
- Never run bare `gh` commands in this repository, because global `gh` authentication may point to a different account. Always invoke GitHub CLI commands through `npm run gh -- <args>`.
- Never commit personal emails, host home directory paths, sibling account handles, or legacy scratch paths.

## Source-Only `main` and Branch Workflow

- Keep `main` source-only. Never commit `dist/`, `node_modules/`, `release/`, `.DS_Store`, `*.tgz`, or `*.log`.
- Develop all changes on a feature branch off `main` and merge via pull request.
- Never alter `~/.gemini/config/config.json` or kill/restart Antigravity host processes from scripts.

## Seven-File Version Parity

When bumping the plugin version, update all seven locations identically before running `npm run validate`:

1. `package.json` (`"version"`)
2. `package-lock.json` (`"version"` and `packages[""].version`)
3. `plugin.json` (`"version"`)
4. `README.md` line 3 (`(`vX.Y.Z`)`)
5. `src/server.mjs` (`McpServer` constructor `version`)
6. `src/ui/main.js` (`new App({ ... version })`)
7. `scripts/test-server.mjs` (all 3 `Client` `version` literals)

## Pre-PR Verification Checklist

Run these checks on your feature branch before opening a pull request:

```bash
npm test
npm run validate
npm run sync -- --dry-run
npm run check:privacy -- --strict-local --file <pr-body.md>
```

- `npm test` runs `npm run build` (enforcing the `< 1 MiB` `dist/app.html` ceiling), `scripts/test-analyzer.mjs`, `scripts/test-tooling.mjs`, and `scripts/test-server.mjs`.
- `npm run validate` stages the five runtime allowlist entries (`plugin.json`, `mcp_config.json`, `README.md`, `assets`, `dist`) and runs `agy plugin validate --strict --json`.
- `npm run check:privacy -- --strict-local --file <pr-body.md>` scans tracked files, unpushed commits/objects, and the drafted PR body file.

## Pull Request Body Standard

- Write pull request bodies using the `pr` skill template (`## Summary`, `## Evidence` with Before/After output, and `## Merge Danger` with `Door` and `Blast Radius`).
- Author pull request prose in natural Thai following the `kien-thai` skill.
- Reference skills by name only (`pr`, `kien-thai`, `plugin`, `mcp-app-development`) and never embed local skill paths.

## Local Sync and Release Packaging

- Preview local installation changes with `npm run sync -- --dry-run`, then apply atomically with `npm run sync`.
- After `npm run sync`, manually reload `context-monitor_context-monitor` from Antigravity Desktop settings before live verification.
- Build a release archive with `npm run package` (emits `release/context-monitor-v<version>.zip` wrapped under `context-monitor/` and its `.sha256` checksum, validated with `agy plugin validate --strict --json`).

<!--VITE PLUS START-->

## Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at <https://viteplus.dev/guide/>.

### Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

### Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

### Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

### Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
