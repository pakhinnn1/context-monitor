import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const serverEntry = path.join(rootDir, "dist", "server.mjs");

const transport = new StdioClientTransport({
  command: "node",
  args: [serverEntry],
  env: { ...process.env },
});

const client = new Client({
  name: "context-monitor-test",
  version: "0.1.1",
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

  assert.ok(snapTool, "get_context_snapshot tool missing");
  assert.deepEqual(
    snapTool._meta?.ui?.visibility,
    ["app"],
    "get_context_snapshot must have visibility ['app']",
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
  const payloadBytes = Buffer.byteLength(JSON.stringify(snap), "utf8");
  assert.ok(
    payloadBytes < 1024 * 1024,
    `structuredContent exceeds 1 MiB (${payloadBytes} bytes)`,
  );

  if (snap.current?.hasUsageData) {
    const segSum = snap.current.segments.reduce((a, s) => a + s.tokens, 0);
    assert.equal(
      segSum,
      snap.current.exact.activeTokens,
      `Segment sum (${segSum}) must equal exact activeTokens (${snap.current.exact.activeTokens})`,
    );
    if (
      snap.current.model.contextWindow !== null &&
      snap.current.exact.activeTokens <= snap.current.model.contextWindow
    ) {
      assert.equal(
        typeof snap.current.exact.freePercent,
        "number",
        "freePercent must be a number when contextWindow is known",
      );
      const segPctSum = snap.current.segments.reduce(
        (a, s) => a + (s.percent || 0),
        0,
      );
      assert.equal(
        Math.round((segPctSum + snap.current.exact.freePercent) * 10),
        1000,
        `Displayed percentages (${segPctSum} + ${snap.current.exact.freePercent}) must sum to 100.0%`,
      );
    }
  }

  // 4. Test get_context_snapshot on a conversation with checkpoints if one exists
  const cpConv = snap.conversations.find((c) => c.checkpointCount > 0);
  if (cpConv) {
    const cpRes = await client.callTool({
      name: "get_context_snapshot",
      arguments: { conversationId: cpConv.conversationId },
    });
    const cpSnap = cpRes.structuredContent;
    assert.equal(cpSnap.current.conversationId, cpConv.conversationId);
    const cpSegSum = cpSnap.current.segments.reduce((a, s) => a + s.tokens, 0);
    assert.equal(
      cpSegSum,
      cpSnap.current.exact.activeTokens,
      `Checkpoint thread segment sum (${cpSegSum}) must equal activeTokens (${cpSnap.current.exact.activeTokens})`,
    );
    if (
      cpSnap.current.model.contextWindow !== null &&
      cpSnap.current.exact.activeTokens <= cpSnap.current.model.contextWindow
    ) {
      assert.equal(typeof cpSnap.current.exact.freePercent, "number");
      const cpPctSum = cpSnap.current.segments.reduce(
        (a, s) => a + (s.percent || 0),
        0,
      );
      assert.equal(
        Math.round((cpPctSum + cpSnap.current.exact.freePercent) * 10),
        1000,
        `Checkpoint thread percentages (${cpPctSum} + ${cpSnap.current.exact.freePercent}) must sum to 100.0%`,
      );
    }
    console.log(
      `Verified checkpoint thread ${cpConv.conversationId}: active=${cpSnap.current.exact.activeTokens}, checkpoints=${cpSnap.current.exact.checkpointCount}`,
    );
  }

  console.log("All MCP server checks passed!");
  console.log("--- Sample tool text output ---");
  console.log(openRes.content[0].text);
  console.log(`--- Payload size: ${(payloadBytes / 1024).toFixed(1)} KiB ---`);
} finally {
  await client.close();
}
