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
    const segPctSum = snap.current.segments.reduce((a, s) => a + (s.percent || 0), 0);
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
    version: "0.2.0",
  });

  await client.connect(transport);

  try {
    // 1. Verify tools & metadata
    const toolsRes = await client.listTools();
    const openTool = toolsRes.tools.find((t) => t.name === "open_context_monitor");
    const snapTool = toolsRes.tools.find((t) => t.name === "get_context_snapshot");
    const listTool = toolsRes.tools.find((t) => t.name === "list_conversations");
    const prefsTool = toolsRes.tools.find((t) => t.name === "set_context_preferences");

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

    assert.ok(listTool, "list_conversations tool missing");
    assert.deepEqual(
      listTool._meta?.ui?.visibility,
      ["app"],
      "list_conversations must have visibility ['app']",
    );
    assert.ok(prefsTool, "set_context_preferences tool missing");
    assert.deepEqual(
      prefsTool._meta?.ui?.visibility,
      ["app"],
      "set_context_preferences must have visibility ['app']",
    );

    // 2. Verify UI resource
    const resList = await client.listResources();
    const uiRes = resList.resources.find((r) => r.uri === "ui://context-monitor/app.html");
    assert.ok(uiRes, "ui://context-monitor/app.html missing from resources/list");
    assert.equal(uiRes.mimeType, "text/html;profile=mcp-app");

    const readRes = await client.readResource({
      uri: "ui://context-monitor/app.html",
    });
    const item = readRes.contents?.[0];
    assert.ok(item?.text && item.text.length > 500, "HTML resource empty");
    assert.equal(item.mimeType, "text/html;profile=mcp-app");
    assert.ok(
      !item.text.includes("/* __INLINE_JS__ */") && !item.text.includes("/* __INLINE_CSS__ */"),
      "Unreplaced inline bundle placeholder found in app.html",
    );
    assert.ok(Buffer.byteLength(item.text, "utf8") < 10 * 1024 * 1024, "HTML exceeds 10 MiB limit");

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
    assert.ok(
      snap.preferences && typeof snap.preferences.includeSubagents === "boolean",
      "open_context_monitor must echo preferences",
    );

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
      assert.equal(snap.current.trajectory, undefined, "open_context_monitor must omit trajectory");
      assert.equal(snap.current.topTools, undefined, "open_context_monitor must omit topTools");
      assert.equal(snap.current.artifacts, undefined, "open_context_monitor must omit artifacts");
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
      assert.ok(
        cpSnap.preferences && typeof cpSnap.preferences.includeSubagents === "boolean",
        "get_context_snapshot must echo preferences",
      );

      const cpPayloadBytes = Buffer.byteLength(JSON.stringify(cpSnap), "utf8");
      const cpFullBytes = Buffer.byteLength(JSON.stringify(cpRes), "utf8");
      assert.ok(
        cpPayloadBytes < 1024 * 1024,
        "get_context_snapshot structuredContent exceeds 1 MiB",
      );
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

    // 5. Verify list_conversations on live local corpus under < 1 MiB
    const listRes = await client.callTool({
      name: "list_conversations",
      arguments: { limit: 35 },
    });
    assert.ok(!listRes.isError, "list_conversations returned isError");
    const listData = listRes.structuredContent;
    assert.equal(listData.schemaVersion, 2);
    assert.equal(listData.fleet?.fleetScope, "interactive");
    assert.ok(Array.isArray(listData.items), "list_conversations items must be an array");
    const listBytes = Buffer.byteLength(JSON.stringify(listRes), "utf8");
    assert.ok(
      listBytes < 1024 * 1024,
      `list_conversations CallToolResult exceeds 1 MiB (${listBytes} bytes)`,
    );
    console.log(
      `Verified list_conversations: ${listData.fleet.interactiveCount} interactive / ${listData.fleet.totalTracked} tracked (${(listBytes / 1024).toFixed(1)} KiB)`,
    );

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
      version: "0.2.0",
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

    console.log(
      "Verified MCP roots/list resolution, listChanged caching/invalidation, and 250ms timeout fallback!",
    );
  } finally {
    await client.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function runPreferencesAndFleetServerTests() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-mon-prefs-"));
  const geminiHome = path.join(tmpRoot, ".gemini");
  const dataDir = path.join(tmpRoot, "plugin-data");
  const wsDir = path.join(tmpRoot, "sample-workspace");
  const brainDir = path.join(geminiHome, "antigravity", "brain");
  const annDir = path.join(geminiHome, "antigravity", "annotations");
  const projDir = path.join(geminiHome, "config", "projects");

  fs.mkdirSync(brainDir, { recursive: true });
  fs.mkdirSync(annDir, { recursive: true });
  fs.mkdirSync(projDir, { recursive: true });
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, "AGENTS.md"), "# Workspace rules\n", "utf8");
  const realWsDir = fs.realpathSync(wsDir);

  fs.writeFileSync(
    path.join(projDir, "sample-proj.json"),
    JSON.stringify({
      id: "sample-proj",
      name: "Sample Workspace",
      projectResources: { resources: [{ gitFolder: { folderUri: pathToFileURL(wsDir).href } }] },
    }),
  );

  const writeThread = (cid, rows, mtimeMs, title = null) => {
    const logs = path.join(brainDir, cid, ".system_generated", "logs");
    fs.mkdirSync(logs, { recursive: true });
    const tp = path.join(logs, "transcript.jsonl");
    fs.writeFileSync(tp, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
    fs.utimesSync(tp, mtimeMs / 1000, mtimeMs / 1000);
    if (title) {
      fs.writeFileSync(path.join(annDir, `${cid}.pbtxt`), `title: "${title}"\n`, "utf8");
    }
  };

  const now = Date.now();
  writeThread(
    "inter-1",
    [
      { type: "USER_INPUT", content: "High usage" },
      { type: "CHECKPOINT" },
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 400_000,
        cache_read_tokens: 0,
      },
    ],
    now - 2000,
    "Interactive One",
  );
  writeThread(
    "bg-1",
    [
      { type: "USER_INPUT", content: "Bg task" },
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 10_000,
        cache_read_tokens: 0,
      },
    ],
    now - 1000,
    null,
  );

  const connectWithArgs = async (args) => {
    const transport = new StdioClientTransport({
      command: "node",
      args,
      env: {
        ...process.env,
        CONTEXT_MONITOR_GEMINI_HOME: geminiHome,
        ANTIGRAVITY_LS_ADDRESS: "",
        ANTIGRAVITY_CSRF_TOKEN: "",
      },
    });
    const client = new Client({ name: "context-monitor-prefs-test", version: "0.2.0" });
    await client.connect(transport);
    return client;
  };

  try {
    // 1. Persist preferences with --data-dir and test list_conversations
    const c1 = await connectWithArgs([serverEntry, `--data-dir=${dataDir}`]);
    try {
      const setRes = await c1.callTool({
        name: "set_context_preferences",
        arguments: { workspacePath: wsDir, includeSubagents: true },
      });
      assert.ok(!setRes.isError, "set_context_preferences failed");
      assert.deepEqual(setRes.structuredContent, {
        workspacePath: realWsDir,
        includeSubagents: true,
        persisted: true,
      });

      const badRes = await c1.callTool({
        name: "set_context_preferences",
        arguments: { workspacePath: "/" },
      });
      assert.equal(badRes.isError, true, "expected isError on invalid workspacePath '/'");

      const openRes = await c1.callTool({ name: "open_context_monitor", arguments: {} });
      assert.deepEqual(openRes.structuredContent.inventory.workspace, {
        path: realWsDir,
        source: "saved",
      });
      assert.equal(openRes.structuredContent.preferences.includeSubagents, true);
      assert.equal(openRes.structuredContent.conversations.length, 2);
      assert.equal(openRes.structuredContent.inventory.knownWorkspaces.length, 1);

      const listRes = await c1.callTool({
        name: "list_conversations",
        arguments: { kind: "all", filter: "all", sort: "tokens_desc", offset: 0, limit: 1 },
      });
      assert.equal(listRes.structuredContent.totalMatching, 2);
      assert.equal(listRes.structuredContent.hasMore, true);
      assert.equal(listRes.structuredContent.items[0].conversationId, "inter-1");
      assert.equal(listRes.structuredContent.fleet.highUsageInteractiveCount, 1);
      assert.ok(Buffer.byteLength(JSON.stringify(listRes), "utf8") < 1024 * 1024);
    } finally {
      await c1.close();
    }

    // 2. Simulate restart with same --data-dir -> saved prefs survive, then clear to Auto
    const c2 = await connectWithArgs([serverEntry, `--data-dir=${dataDir}`]);
    try {
      const snapRes = await c2.callTool({ name: "get_context_snapshot", arguments: {} });
      assert.deepEqual(snapRes.structuredContent.preferences, {
        workspacePath: realWsDir,
        includeSubagents: true,
        persisted: true,
      });
      assert.deepEqual(snapRes.structuredContent.inventory.workspace, {
        path: realWsDir,
        source: "saved",
      });

      const clearRes = await c2.callTool({
        name: "set_context_preferences",
        arguments: { workspacePath: null, includeSubagents: false },
      });
      assert.deepEqual(clearRes.structuredContent, {
        workspacePath: null,
        includeSubagents: false,
        persisted: true,
      });

      const snapCleared = await c2.callTool({ name: "get_context_snapshot", arguments: {} });
      assert.deepEqual(snapCleared.structuredContent.inventory.workspace, {
        path: null,
        source: "none",
      });
    } finally {
      await c2.close();
    }

    // 3. Unexpanded ${PLUGIN_DATA} falls back to in-memory-only mode
    const c3 = await connectWithArgs([serverEntry, "--data-dir=${PLUGIN_DATA}"]);
    try {
      const memRes = await c3.callTool({
        name: "set_context_preferences",
        arguments: { includeSubagents: true },
      });
      assert.ok(!memRes.isError);
      assert.equal(memRes.structuredContent.persisted, false);
      assert.equal(memRes.structuredContent.includeSubagents, true);
      assert.equal(fs.existsSync(path.join(process.cwd(), "${PLUGIN_DATA}")), false);
    } finally {
      await c3.close();
    }

    console.log(
      "Verified preferences persistence across restart, fleet list_conversations, and unexpanded ${PLUGIN_DATA} fallback!",
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

await runLiveSmokeTests();
await runMcpRootsTests();
await runPreferencesAndFleetServerTests();
console.log("All MCP server checks passed!");
