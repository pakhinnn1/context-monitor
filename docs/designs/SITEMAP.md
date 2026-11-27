# Context Monitor Design Documents

Index of architecture and feature specifications for this repository. Design documents under `docs/` are excluded when syncing runtime plugin files to `~/.gemini/config/plugins/context-monitor/`.

| Document | Date | Author | Components | Description |
| :--- | :--- | :--- | :--- | :--- |
| [Metrics and Inventory v2](./metrics_and_inventory_v2.md) | 2026-11-27 | pakhinnn1 | [`src/analyzer.mjs`](../../src/analyzer.mjs), [`src/server.mjs`](../../src/server.mjs), [`src/ui/main.js`](../../src/ui/main.js), [`src/ui/styles.css`](../../src/ui/styles.css), [`scripts/test-analyzer.mjs`](../../scripts/test-analyzer.mjs), [`scripts/test-server.mjs`](../../scripts/test-server.mjs), [`package.json`](../../package.json), [`README.md`](../../README.md) | Spec 1: Annotation-gated thread filtering, CLI-aligned prompt breakdown, disk artifacts, bounded trajectory, top tools attribution, workspace/plugin inventory precedence, and v2 MCP contract (`open_context_monitor`, `get_context_snapshot`). |
