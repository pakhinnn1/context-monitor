import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const serverEntry = path.join(rootDir, "dist", "server.mjs");

function assertSnapshotInvariants(snap, label) {
  if (!snap.current?.hasUsageData) return;

  const segSum = snap.current.segments.reduce((a, s) => a + s.tokens, 0);
  assert.equal(
    segSum,
    snap.current.exact.activeTokens,
    `${label} segment sum (${segSum}) must equal exact activeTokens (${snap.current.exact.activeTokens})`,
  );
  if (
    snap.current.model.contextWindow !== null &&
    snap.current.exact.activeTokens <= snap.current.model.contextWindow
  ) {
    assert.equal(
      typeof snap.current.exact.freePercent,
      "number",
      `${label} freePercent must be a number when contextWindow is known`,
    );
    const segPctSum = snap.current.segments.reduce(
      (a, s) => a + (s.percent || 0),
      0,
    );
    assert.equal(
      Math.round((segPctSum + snap.current.exact.freePercent) * 10),
      1000,
      `${label} displayed percentages (${segPctSum} + ${snap.current.exact.freePercent}) must sum to 100.0%`,
    );
  }
}

async function runLiveSmokeTests() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: { ...process.env },
  });

  const client = new Client({
    name: "context-monitor-test",
    version: "0.1.2",
  });

  await client.connect(transport);

  try {
    // 1. Verify tools & metadata
    const toolsRes = await client.listTools();
    const openTool = toolsRes.tools.find((t) => t.name === "open_context_monitor");
    const snapTool = toolsRes.tools.find((t) => t.name === "get_context_snapshot");

    assert.ok(openTool, "open_context_monitor tool missing");
    assert.equal(
      openTool._meta?.ui?.resourceUri,
      "ui://context-monitor/app.html",
      "open_context_monitor resourceUri mismatch",
    );
    const entrypoints = openTool._meta?.["com.google.antigravity/ui"]?.entrypoints;
    assert.ok(Array.isArray(entrypoints), "entrypoints array missing");
    assert.deepEqual(
      entrypoints.map((e) => e.type),
      ["aux_pane", "global"],
      "expected aux_pane and global entrypoints",
    );
    assert.ok(
      openTool.inputSchema?.properties?.workspacePath,
      "open_context_monitor missing workspacePath parameter",
    );
    assert.ok(
      openTool.inputSchema?.properties?.includeSubagents,
      "open_context_monitor missing includeSubagents parameter",
    );

    assert.ok(snapTool, "get_context_snapshot tool missing");
    assert.deepEqual(
      snapTool._meta?.ui?.visibility,
      ["app"],
      "get_context_snapshot must have visibility ['app']",
    );
    assert.ok(
      snapTool.inputSchema?.properties?.workspacePath,
      "get_context_snapshot missing workspacePath parameter",
    );
    assert.ok(
      snapTool.inputSchema?.properties?.includeSubagents,
      "get_context_snapshot missing includeSubagents parameter",
    );

    // 2. Verify UI resource
    const resList = await client.listResources();
    const uiRes = resList.resources.find(
      (r) => r.uri === "ui://context-monitor/app.html",
    );
    assert.ok(uiRes, "ui://context-monitor/app.html missing from resources/list");
    assert.equal(uiRes.mimeType, "text/html;profile=mcp-app");

    const readRes = await client.readResource({
      uri: "ui://context-monitor/app.html",
    });
    const item = readRes.contents?.[0];
    assert.ok(item?.text && item.text.length > 500, "HTML resource empty");
    assert.equal(item.mimeType, "text/html;profile=mcp-app");
    assert.ok(
      !item.text.includes("/* __INLINE_JS__ */") &&
        !item.text.includes("/* __INLINE_CSS__ */"),
      "Unreplaced inline bundle placeholder found in app.html",
    );
    assert.ok(
      Buffer.byteLength(item.text, "utf8") < 10 * 1024 * 1024,
      "HTML exceeds 10 MiB limit",
    );

    // 3. Call open_context_monitor with empty {} (simulating sidebar / aux_pane launch)
    const openRes = await client.callTool({
      name: "open_context_monitor",
      arguments: {},
    });
    assert.ok(!openRes.isError, "open_context_monitor returned isError");
    assert.ok(openRes.content?.[0]?.text, "missing text content");
    const snap = openRes.structuredContent;
    assert.ok(snap, "missing structuredContent");
    assert.equal(snap.schemaVersion, 2, "expected schemaVersion 2");

    const payloadBytes = Buffer.byteLength(JSON.stringify(snap), "utf8");
    const fullResultBytes = Buffer.byteLength(JSON.stringify(openRes), "utf8");
    assert.ok(
      payloadBytes < 1024 * 1024,
      `structuredContent exceeds 1 MiB (${payloadBytes} bytes)`,
    );
    assert.ok(
      fullResultBytes < 1024 * 1024,
      `CallToolResult exceeds 1 MiB (${fullResultBytes} bytes)`,
    );

    if (snap.current?.hasUsageData) {
      assertSnapshotInvariants(snap, "open_context_monitor");
      assert.equal(
        snap.current.trajectory,
        undefined,
        "open_context_monitor must omit trajectory",
      );
      assert.equal(
        snap.current.topTools,
        undefined,
        "open_context_monitor must omit topTools",
      );
      assert.equal(
        snap.current.artifacts,
        undefined,
        "open_context_monitor must omit artifacts",
      );
    }

    // 4. Test get_context_snapshot detail hydration on checkpoint thread (or latest thread)
    const cpConv = snap.conversations.find((c) => c.checkpointCount > 0);
    const targetCid = cpConv?.conversationId || snap.selectedConversationId;
    if (targetCid) {
      const cpRes = await client.callTool({
        name: "get_context_snapshot",
        arguments: { conversationId: targetCid },
      });
      assert.ok(!cpRes.isError, "get_context_snapshot returned isError");
      const cpSnap = cpRes.structuredContent;
      assert.equal(cpSnap.schemaVersion, 2, "expected schemaVersion 2");
      assert.equal(cpSnap.current.conversationId, targetCid);

      const cpPayloadBytes = Buffer.byteLength(JSON.stringify(cpSnap), "utf8");
      const cpFullBytes = Buffer.byteLength(JSON.stringify(cpRes), "utf8");
      assert.ok(cpPayloadBytes < 1024 * 1024, "get_context_snapshot structuredContent exceeds 1 MiB");
      assert.ok(cpFullBytes < 1024 * 1024, "get_context_snapshot CallToolResult exceeds 1 MiB");

      if (cpSnap.current?.hasUsageData) {
        assertSnapshotInvariants(cpSnap, "get_context_snapshot");
        assert.ok(
          cpSnap.current.trajectory && Array.isArray(cpSnap.current.trajectory.points),
          "get_context_snapshot must populate current.trajectory.points",
        );
        assert.ok(
          Array.isArray(cpSnap.current.topTools),
          "get_context_snapshot must populate current.topTools",
        );
        assert.ok(
          cpSnap.current.artifacts && Array.isArray(cpSnap.current.artifacts.items),
          "get_context_snapshot must populate current.artifacts.items",
        );
        console.log(
          `Verified detail thread ${targetCid}: active=${cpSnap.current.exact.activeTokens}, checkpoints=${cpSnap.current.exact.checkpointCount}, trajectory=${cpSnap.current.trajectory.points.length}`,
        );
      }
    }

    console.log("--- Sample tool text output ---");
    console.log(openRes.content[0].text);
    console.log(
      `--- Payload size: ${(payloadBytes / 1024).toFixed(1)} KiB (full CallToolResult: ${(fullResultBytes / 1024).toFixed(1)} KiB) ---`,
    );
  } finally {
    await client.close();
  }
}

async function runMcpRootsTests() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-mon-roots-"));
  const geminiHome = path.join(tmpRoot, ".gemini");
  const ws1 = path.join(tmpRoot, "ws1");
  const ws2 = path.join(tmpRoot, "ws2");
  fs.mkdirSync(path.join(geminiHome, "antigravity", "brain"), { recursive: true });
  fs.mkdirSync(path.join(geminiHome, "antigravity", "annotations"), { recursive: true });
  fs.mkdirSync(ws1, { recursive: true });
  fs.mkdirSync(ws2, { recursive: true });

  const realWs1 = fs.realpathSync(ws1);
  const realWs2 = fs.realpathSync(ws2);

  let mode = "ws1";
  let listRootsCallCount = 0;

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      CONTEXT_MONITOR_GEMINI_HOME: geminiHome,
      ANTIGRAVITY_LS_ADDRESS: "",
      ANTIGRAVITY_CSRF_TOKEN: "",
    },
  });

  const client = new Client(
    {
      name: "context-monitor-roots-test",
      version: "0.1.2",
    },
    {
      capabilities: {
        roots: {
          listChanged: true,
        },
      },
    },
  );

  client.setRequestHandler(ListRootsRequestSchema, async () => {
    listRootsCallCount += 1;
    if (mode === "ws1") {
      return { roots: [{ uri: pathToFileURL(ws1).href, name: "ws1" }] };
    }
    if (mode === "ws2") {
      return { roots: [{ uri: pathToFileURL(ws2).href, name: "ws2" }] };
    }
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 450);
      t.unref?.();
    });
    return { roots: [{ uri: pathToFileURL(ws2).href, name: "ws2" }] };
  });

  await client.connect(transport);

  try {
    // (a) Fast roots/list resolution and caching when listChanged === true
    const r1 = await client.callTool({ name: "get_context_snapshot", arguments: {} });
    assert.deepEqual(r1.structuredContent.inventory.workspace, {
      path: realWs1,
      source: "mcp_roots",
    });
    const r2 = await client.callTool({ name: "get_context_snapshot", arguments: {} });
    assert.deepEqual(r2.structuredContent.inventory.workspace, {
      path: realWs1,
      source: "mcp_roots",
    });
    assert.equal(listRootsCallCount, 1, "expected cached roots/list on second call");

    // (b) notifications/roots/list_changed invalidates cached roots
    mode = "ws2";
    await client.sendRootsListChanged();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const r3 = await client.callTool({ name: "get_context_snapshot", arguments: {} });
    assert.equal(listRootsCallCount, 2, "expected roots/list refetch after list_changed");
    assert.deepEqual(r3.structuredContent.inventory.workspace, {
      path: realWs2,
      source: "mcp_roots",
    });

    // (c) >250ms delayed roots/list falls back to none without caching the timeout
    mode = "delay";
    await client.sendRootsListChanged();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const r4 = await client.callTool({ name: "get_context_snapshot", arguments: {} });
    assert.ok(!r4.isError, "delayed roots/list must not fail the tool call");
    assert.deepEqual(r4.structuredContent.inventory.workspace, {
      path: null,
      source: "none",
    });

    mode = "ws1";
    const r5 = await client.callTool({ name: "get_context_snapshot", arguments: {} });
    assert.deepEqual(
      r5.structuredContent.inventory.workspace,
      { path: realWs1, source: "mcp_roots" },
      "timeout must not be cached",
    );

    console.log("Verified MCP roots/list resolution, listChanged caching/invalidation, and 250ms timeout fallback!");
  } finally {
    await client.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

await runLiveSmokeTests();
await runMcpRootsTests();
console.log("All MCP server checks passed!");
