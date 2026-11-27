import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import {
  analyzeTranscriptRows,
  fetchConversationServiceTitles,
  getContextSnapshot,
  isSafeSingleSegment,
  resolvePaths,
  scanConversationArtifacts,
  scanLocalInventory,
  validateWorkspaceDir,
} from "../src/analyzer.mjs";

function makeTempDir(prefix = "ctx-mon-unit-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeGeminiFixture() {
  const root = makeTempDir();
  const geminiHome = path.join(root, ".gemini");
  const paths = resolvePaths({ geminiHome });
  fs.mkdirSync(paths.brainDir, { recursive: true });
  fs.mkdirSync(paths.annotationsDir, { recursive: true });
  fs.mkdirSync(paths.mcpSchemasDir, { recursive: true });
  fs.mkdirSync(paths.pluginsDir, { recursive: true });
  fs.mkdirSync(paths.projectsDir, { recursive: true });
  fs.mkdirSync(paths.builtinSkillsDir, { recursive: true });
  return { root, geminiHome, paths };
}

function writeTranscript(paths, cid, rows, { mtimeMs = null, fullRows = null } = {}) {
  const logsDir = path.join(paths.brainDir, cid, ".system_generated", "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const tPath = path.join(logsDir, "transcript.jsonl");
  fs.writeFileSync(tPath, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
  if (mtimeMs !== null) {
    const sec = mtimeMs / 1000;
    fs.utimesSync(tPath, sec, sec);
  }
  if (fullRows) {
    const fullPath = path.join(logsDir, "transcript_full.jsonl");
    fs.writeFileSync(
      fullPath,
      `${fullRows.map((r) => JSON.stringify(r)).join("\n")}\n`,
      "utf8",
    );
  }
  return tPath;
}

function writeAnnotation(paths, cid, title) {
  const p = path.join(paths.annotationsDir, `${cid}.pbtxt`);
  fs.writeFileSync(p, `title: "${title.replace(/"/g, '\\"')}"\n`, "utf8");
  return p;
}

async function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    if (overrides[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = overrides[k];
    }
  }
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = prev[k];
      }
    }
  }
}

async function startMockServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const address = `127.0.0.1:${addr.port}`;
  return {
    address,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

describe("Suite 1: Classification, gating, summaryCache freshness, and path safety", () => {
  it("validates single-segment IDs and rejects path traversal", () => {
    assert.equal(isSafeSingleSegment("conv-123"), true);
    assert.equal(isSafeSingleSegment("a_b.c"), true);
    assert.equal(isSafeSingleSegment(""), false);
    assert.equal(isSafeSingleSegment("."), false);
    assert.equal(isSafeSingleSegment(".."), false);
    assert.equal(isSafeSingleSegment("../escape"), false);
    assert.equal(isSafeSingleSegment("a/b"), false);
    assert.equal(isSafeSingleSegment("a\\b"), false);
    assert.equal(isSafeSingleSegment("bad\0id"), false);
    assert.equal(isSafeSingleSegment(null), false);
  });

  it("filters interactive threads by default, supports includeSubagents, and detects late .pbtxt without mtime change", async () => {
    const { root, geminiHome, paths } = makeGeminiFixture();
    const now = Date.now();
    const srv = await startMockServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          conversations: [
            {
              id: "sub-1",
              annotations: { title: "Worker Subagent" },
              metadata: { parentConversationId: "inter-1" },
              state: { runState: "RUN_STATE_IDLE" },
            },
          ],
        }),
      );
    });

    try {
      const baseRows = [
        { type: "USER_INPUT", content: "Hello world" },
        {
          type: "PLANNER_RESPONSE",
          model: "gemini-4-neon-high",
          input_tokens: 1000,
          cache_read_tokens: 500,
          output_tokens: 100,
          content: "Hi there",
        },
      ];
      writeTranscript(paths, "inter-1", baseRows, { mtimeMs: now - 3000 });
      writeAnnotation(paths, "inter-1", "Interactive Thread");
      writeTranscript(paths, "bg-1", baseRows, { mtimeMs: now - 2000 });
      writeTranscript(paths, "sub-1", baseRows, { mtimeMs: now - 1000 });

      await withEnv(
        {
          ANTIGRAVITY_LS_ADDRESS: srv.address,
          ANTIGRAVITY_CSRF_TOKEN: "tok",
        },
        async () => {
          const snapDefault = await getContextSnapshot({ geminiHome });
          assert.equal(snapDefault.schemaVersion, 2);
          assert.equal(snapDefault.totalTrackedConversations, 3);
          assert.equal(snapDefault.conversations.length, 1);
          assert.equal(snapDefault.conversations[0].conversationId, "inter-1");
          assert.equal(snapDefault.conversations[0].kind, "interactive");
          assert.equal(snapDefault.conversations[0].turnCount, 1);
          assert.equal(snapDefault.selectedConversationId, "inter-1");
          assert.equal(snapDefault.current.kind, "interactive");

          // Explicit inspection of background thread works even when includeSubagents=false
          const snapExplicitBg = await getContextSnapshot({
            geminiHome,
            conversationId: "bg-1",
          });
          assert.equal(snapExplicitBg.requestedConversationFound, true);
          assert.equal(snapExplicitBg.selectedConversationId, "bg-1");
          assert.equal(snapExplicitBg.current.kind, "background");

          // Explicit inspection of subagent thread works even when includeSubagents=false
          const snapExplicitSub = await getContextSnapshot({
            geminiHome,
            conversationId: "sub-1",
          });
          assert.equal(snapExplicitSub.requestedConversationFound, true);
          assert.equal(snapExplicitSub.selectedConversationId, "sub-1");
          assert.equal(snapExplicitSub.current.kind, "subagent");
          assert.equal(snapExplicitSub.conversations.length, 1);

          // Traversal conversationId sets requestedConversationFound=false
          const snapBadId = await getContextSnapshot({
            geminiHome,
            conversationId: "../escape",
          });
          assert.equal(snapBadId.requestedConversationFound, false);
          assert.equal(snapBadId.selectedConversationId, "inter-1");

          // includeSubagents: true exposes background + subagent
          const snapAll = await getContextSnapshot({
            geminiHome,
            includeSubagents: true,
          });
          assert.equal(snapAll.conversations.length, 3);
          const byId = Object.fromEntries(
            snapAll.conversations.map((c) => [c.conversationId, c]),
          );
          assert.equal(byId["sub-1"].kind, "subagent");
          assert.equal(byId["sub-1"].parentConversationId, "inter-1");
          assert.equal(byId["bg-1"].kind, "background");
          assert.equal(byId["inter-1"].kind, "interactive");

          // Flush .pbtxt for bg-1 without modifying transcript.jsonl mtimeMs
          writeAnnotation(paths, "bg-1", "Promoted Interactive");
          const snapPromoted = await getContextSnapshot({ geminiHome });
          assert.equal(snapPromoted.conversations.length, 2);
          assert.equal(snapPromoted.conversations[0].conversationId, "bg-1");
          assert.equal(snapPromoted.conversations[0].title, "Promoted Interactive");
          assert.equal(snapPromoted.conversations[0].kind, "interactive");

          // Evict deleted transcript directory from summaryCache
          fs.rmSync(path.join(paths.brainDir, "bg-1"), { recursive: true, force: true });
          const snapAfterDelete = await getContextSnapshot({ geminiHome });
          assert.equal(snapAfterDelete.totalTrackedConversations, 2);
          assert.equal(snapAfterDelete.conversations.length, 1);
        },
      );
    } finally {
      await srv.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to latest transcript when zero interactive threads exist", async () => {
    const { root, geminiHome, paths } = makeGeminiFixture();
    try {
      const now = Date.now();
      writeTranscript(
        paths,
        "bg-older",
        [
          { type: "USER_INPUT", content: "Old task" },
          { type: "PLANNER_RESPONSE", model: "gemini-4-neon", input_tokens: 400, cache_read_tokens: 100 },
        ],
        { mtimeMs: now - 5000 },
      );
      writeTranscript(
        paths,
        "bg-newer",
        [
          { type: "USER_INPUT", content: "New task" },
          { type: "PLANNER_RESPONSE", model: "gemini-4-neon", input_tokens: 600, cache_read_tokens: 200 },
        ],
        { mtimeMs: now - 1000 },
      );

      await withEnv(
        { ANTIGRAVITY_LS_ADDRESS: undefined, ANTIGRAVITY_CSRF_TOKEN: undefined },
        async () => {
          const snap = await getContextSnapshot({ geminiHome });
          assert.equal(snap.totalTrackedConversations, 2);
          assert.deepEqual(snap.conversations, []);
          assert.equal(snap.selectedConversationId, "bg-newer");
          assert.equal(snap.current.kind, "background");
        },
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Suite 2: CLI-aligned breakdown, anchor math, and cumulative counters", () => {
  it("computes all 6 segments, respects invariants, and handles trailing checkpoints via effectiveCheckpointIdx", () => {
    const rows = [
      { type: "USER_INPUT", content: "A".repeat(400) }, // 100 est tokens
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 500,
        cache_read_tokens: 0,
        output_tokens: 40,
        content: "old reply",
      }, // firstTotal=500, firstUserEst=100, turn1Baseline=400
      { type: "CHECKPOINT" },
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 200,
        cache_read_tokens: 800,
        output_tokens: 60,
        content: "C".repeat(200),
        thinking: "T".repeat(100),
        tool_calls: [{ name: "read_file", args: { path: "a.txt" } }],
      }, // effectiveCheckpointIdx anchor: postCpTotal=1000 -> baseline=400, checkpoint_buffer=600
      { type: "GENERIC", content: "G".repeat(400) },
      { type: "USER_INPUT", content: "U".repeat(200) },
      { type: "SYSTEM_MESSAGE", content: "S".repeat(100) },
      { type: "ERROR_MESSAGE", content: "E".repeat(100) },
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 1000,
        cache_read_tokens: 2000,
        output_tokens: 80,
        content: "Final answer",
        tool_calls: [],
      }, // activeTokens=3000, deltaTokens=2000
      { type: "CHECKPOINT" }, // trailing checkpoint after latestPlannerIdx
    ];

    const res = analyzeTranscriptRows(
      "conv-cp",
      rows,
      "2026-11-27T00:00:00Z",
      "CP Test",
      "RUN_STATE_IDLE",
      false,
      { includeDetails: true, kind: "interactive", annotationTitle: "CP Test" },
    );

    assert.equal(res.exact.activeTokens, 3000);
    assert.equal(res.exact.checkpointCount, 2);
    assert.equal(res.exact.turnCount, 3);
    assert.equal(res.exact.postCheckpointOutputTokens, 0);
    assert.equal(res.exact.totalOutputTokens, 180);
    assert.equal(res.exact.cumulativeInputTokens, 1700);
    assert.equal(res.exact.cumulativeCacheReadTokens, 2800);
    assert.equal(res.exact.cacheInvalidationCount, 0);

    const ids = res.segments.map((s) => s.id);
    assert.deepEqual(ids, [
      "baseline",
      "tool_calls",
      "user_messages",
      "agent_responses",
      "checkpoint_buffer",
      "system_messages",
    ]);

    const segMap = Object.fromEntries(res.segments.map((s) => [s.id, s]));
    assert.equal(segMap.baseline.tokens, 400);
    assert.equal(segMap.checkpoint_buffer.tokens, 600);
    assert.ok(segMap.tool_calls.tokens > 0);
    assert.ok(segMap.user_messages.tokens > 0);
    assert.ok(segMap.agent_responses.tokens > 0);
    assert.ok(segMap.system_messages.tokens > 0);

    const segSum = res.segments.reduce((acc, s) => acc + s.tokens, 0);
    assert.equal(segSum, res.exact.activeTokens);

    const pctSum = res.segments.reduce((acc, s) => acc + s.percent, 0);
    assert.equal(Math.round((pctSum + res.exact.freePercent) * 10), 1000);
  });

  it("applies initialMessagesEst, anchor exclusion on 1-turn, zero-weight fallback, and cacheInvalidationCount", () => {
    // 1-turn: anchorIdx === latestPlannerIdx -> anchor outputs excluded, initialMessagesEst added
    const oneTurnRows = [
      { type: "USER_INPUT", content: "U".repeat(800) }, // 200 est tokens
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 1000,
        cache_read_tokens: 0,
        output_tokens: 50,
        content: "Ignored own output",
        tool_calls: [{ name: "t1", args: {} }],
      },
    ];
    const oneTurn = analyzeTranscriptRows(
      "conv-1",
      oneTurnRows,
      "2026-11-27T00:00:00Z",
      null,
      null,
      false,
      { includeDetails: true, annotationTitle: null },
    );
    const seg1 = Object.fromEntries(oneTurn.segments.map((s) => [s.id, s]));
    assert.equal(seg1.baseline.tokens, 800);
    assert.equal(seg1.user_messages.tokens, 200);
    assert.equal(seg1.tool_calls.tokens, 0);
    assert.equal(seg1.agent_responses.tokens, 0);
    assert.deepEqual(oneTurn.topTools, []);

    // Multi-turn with empty content/tool_calls -> zero-weight fallback assigns deltaTokens to agent_responses
    const fallbackRows = [
      { type: "USER_INPUT", content: "" },
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 100,
        cache_read_tokens: 900,
        content: "",
        tool_calls: [],
      },
      { type: "CHECKPOINT" }, // checkpoint resets prevPlannerCacheRead so drop after checkpoint is not counted
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 100,
        cache_read_tokens: 400, // <= 900*0.5, but after CHECKPOINT -> NOT counted
        content: "",
        tool_calls: [],
      },
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 300,
        cache_read_tokens: 200, // <= 400*0.5 without checkpoint -> counted (1)
        content: "",
        tool_calls: [],
      },
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 1500,
        cache_read_tokens: 0, // dropped to 0 from 200 without checkpoint -> counted (2)
        content: "",
        tool_calls: [],
      },
    ];
    const fb = analyzeTranscriptRows(
      "conv-fb",
      fallbackRows,
      "2026-11-27T00:00:00Z",
      null,
      null,
      false,
      { includeDetails: false, annotationTitle: null },
    );
    assert.equal(fb.trajectory, undefined);
    assert.equal(fb.topTools, undefined);
    assert.equal(fb.exact.cacheInvalidationCount, 2);
    const segFb = Object.fromEntries(fb.segments.map((s) => [s.id, s]));
    assert.equal(segFb.tool_calls.tokens, 0);
    assert.equal(segFb.agent_responses.tokens, 1000); // 1500 - 500 anchorTotal
  });

  it("handles hasUsageData: false defaults and includeDetails: false omission", () => {
    const noUsage = analyzeTranscriptRows(
      "conv-empty",
      [{ type: "USER_INPUT", content: "hello" }, { type: "CHECKPOINT" }],
      "2026-11-27T00:00:00Z",
      null,
      null,
      false,
      { includeDetails: true, annotationTitle: null },
    );
    assert.equal(noUsage.hasUsageData, false);
    assert.equal(noUsage.exact.cumulativeInputTokens, 0);
    assert.equal(noUsage.exact.cumulativeCacheReadTokens, 0);
    assert.equal(noUsage.exact.cacheInvalidationCount, 0);
    assert.deepEqual(noUsage.trajectory, {
      points: [],
      totalTurnCount: 0,
      checkpointCount: 1,
      isBounded: false,
    });
    assert.deepEqual(noUsage.topTools, []);

    const noDetails = analyzeTranscriptRows(
      "conv-empty",
      [{ type: "USER_INPUT", content: "hello" }],
      "2026-11-27T00:00:00Z",
      null,
      null,
      false,
      { includeDetails: false, annotationTitle: null },
    );
    assert.equal("trajectory" in noDetails, false);
    assert.equal("topTools" in noDetails, false);
  });
});

describe("Suite 3: trajectory bounding", () => {
  it("bounds 150-turn, 2-checkpoint transcript preserving Turn 1, milestones, and 120-entry active epoch", () => {
    const rows = [{ type: "USER_INPUT", content: "start" }];
    for (let t = 1; t <= 150; t += 1) {
      if (t === 11) rows.push({ type: "CHECKPOINT" });
      if (t === 21) rows.push({ type: "CHECKPOINT" });
      rows.push({
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 100 + t,
        cache_read_tokens: 500,
        output_tokens: 10,
        step_index: t * 2,
      });
    }
    const res = analyzeTranscriptRows(
      "traj-2cp",
      rows,
      "2026-11-27T00:00:00Z",
      null,
      null,
      false,
      { includeDetails: true, annotationTitle: null },
    );
    const { points, totalTurnCount, checkpointCount, isBounded } = res.trajectory;
    assert.equal(totalTurnCount, 150);
    assert.equal(checkpointCount, 2);
    assert.equal(isBounded, true);
    // Turn 1 + peak 10 + base 11 + peak 20 + 120 active-epoch points (21 + 32..150) = 124
    assert.equal(points.length, 124);
    assert.equal(points[0].turn, 1);
    assert.equal(points[0].kind, "turn");
    assert.equal(points[0].stepIndex, 2);
    assert.equal(points[1].turn, 10);
    assert.equal(points[1].kind, "checkpoint_peak");
    assert.equal(points[2].turn, 11);
    assert.equal(points[2].kind, "checkpoint_baseline");
    assert.equal(points[3].turn, 20);
    assert.equal(points[3].kind, "checkpoint_peak");
    assert.equal(points[4].turn, 21);
    assert.equal(points[4].kind, "checkpoint_baseline");
    assert.equal(points[5].turn, 32);
    assert.equal(points[points.length - 1].turn, 150);
  });

  it("bounds 150-turn, 0-checkpoint transcript to Turn 1 plus last 119 turns", () => {
    const rows = [{ type: "USER_INPUT", content: "start" }];
    for (let t = 1; t <= 150; t += 1) {
      rows.push({
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 100 + t,
        cache_read_tokens: 0,
      });
    }
    const res = analyzeTranscriptRows(
      "traj-0cp",
      rows,
      "2026-11-27T00:00:00Z",
      null,
      null,
      false,
      { includeDetails: true, annotationTitle: null },
    );
    const { points, totalTurnCount, checkpointCount, isBounded } = res.trajectory;
    assert.equal(totalTurnCount, 150);
    assert.equal(checkpointCount, 0);
    assert.equal(isBounded, true);
    assert.equal(points.length, 120);
    assert.equal(points[0].turn, 1);
    assert.equal(points[1].turn, 32);
    assert.equal(points[119].turn, 150);
  });

  it("emits trailing checkpoint peak, prioritizes checkpoint_peak over turn, and falls back stepIndex to rowIndex", () => {
    const rows = [
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 300,
        cache_read_tokens: 0,
      },
      { type: "CHECKPOINT" },
    ];
    const res = analyzeTranscriptRows(
      "traj-trail",
      rows,
      "2026-11-27T00:00:00Z",
      null,
      null,
      false,
      { includeDetails: true, annotationTitle: null },
    );
    assert.equal(res.trajectory.isBounded, false);
    assert.equal(res.trajectory.points.length, 1);
    assert.equal(res.trajectory.points[0].turn, 1);
    assert.equal(res.trajectory.points[0].kind, "checkpoint_peak");
    assert.equal(res.trajectory.points[0].stepIndex, 0);
  });
});

describe("Suite 4: topTools attribution", () => {
  it("handles positional pairing, diverged batches, non-contiguous GENERIC scan, trailing GENERIC exclusion, and top-10 cap", () => {
    const toolCallsBatch2 = Array.from({ length: 12 }, (_, idx) => ({
      name: `tool_${String(idx).padStart(2, "0")}`,
      args: { idx, pad: "x".repeat(20 + idx * 10) },
    }));

    const rows = [
      { type: "USER_INPUT", content: "go" },
      // Anchor turn: 2 tool calls paired positionally with 2 GENERIC rows separated by SYSTEM_MESSAGE
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 1000,
        cache_read_tokens: 0,
        tool_calls: [
          { name: "alpha_tool", args: { a: 1 } },
          { name: "beta_tool", args: { b: 2 } },
        ],
      },
      { type: "GENERIC", content: "A".repeat(400) },
      { type: "SYSTEM_MESSAGE", content: "notice" },
      { type: "ERROR_MESSAGE", content: "warn" },
      { type: "GENERIC", content: "B".repeat(1200) },
      // Turn 2: diverged batch (12 tool calls, only 1 GENERIC output)
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 2000,
        cache_read_tokens: 0,
        tool_calls: toolCallsBatch2,
      },
      { type: "GENERIC", content: "D".repeat(2400) },
      { type: "USER_INPUT", content: "next" },
      // Latest planner turn
      {
        type: "PLANNER_RESPONSE",
        model: "gemini-4-neon",
        input_tokens: 5000,
        cache_read_tokens: 0,
        tool_calls: [{ name: "excluded_trailing", args: { x: "z".repeat(5000) } }],
      },
      // Trailing GENERIC after latestPlannerIdx must NOT be scanned
      { type: "GENERIC", content: "Z".repeat(20000) },
    ];

    const res = analyzeTranscriptRows(
      "conv-tools",
      rows,
      "2026-11-27T00:00:00Z",
      null,
      null,
      false,
      { includeDetails: true, annotationTitle: null },
    );

    const toolCallsSeg = res.segments.find((s) => s.id === "tool_calls");
    assert.equal(res.topTools.length, 10);
    assert.equal(
      res.topTools.some((t) => t.name === "excluded_trailing"),
      false,
    );
    const beta = res.topTools.find((t) => t.name === "beta_tool");
    const alpha = res.topTools.find((t) => t.name === "alpha_tool");
    assert.ok(beta && alpha);
    assert.ok(beta.estTokens > alpha.estTokens);
    // topTools tokens sum should be <= toolCallsSeg.tokens (since 4 out of 14 tools were sliced)
    const topSum = res.topTools.reduce((a, t) => a + t.estTokens, 0);
    assert.ok(topSum <= toolCallsSeg.tokens && topSum > 0);
  });
});

describe("Suite 5: scanConversationArtifacts", () => {
  it("scans top-level .md files, parses camelCase and PascalCase metadata, collapses summaries, and caps at 20", () => {
    const { root, paths } = makeGeminiFixture();
    try {
      const cid = "art-conv";
      const convDir = path.join(paths.brainDir, cid);
      fs.mkdirSync(path.join(convDir, "nested"), { recursive: true });
      fs.writeFileSync(path.join(convDir, "nested", "ignored.md"), "# nested", "utf8");

      const baseTime = Date.now() - 100_000;
      for (let i = 0; i < 22; i += 1) {
        const name = `doc_${String(i).padStart(2, "0")}.md`;
        const filePath = path.join(convDir, name);
        fs.writeFileSync(filePath, "x".repeat(400), "utf8");
        const t = (baseTime + i * 1000) / 1000;
        fs.utimesSync(filePath, t, t);

        if (i === 21) {
          fs.writeFileSync(
            `${filePath}.metadata.json`,
            JSON.stringify({
              userFacing: true,
              summary: `Line 1\n\n  Line 2   ${"a".repeat(200)}`,
            }),
            "utf8",
          );
        } else if (i === 20) {
          fs.writeFileSync(
            `${filePath}.metadata.json`,
            JSON.stringify({
              UserFacing: true,
              Summary: "PascalCase fallback summary",
            }),
            "utf8",
          );
        }
      }

      const artifacts = scanConversationArtifacts(cid, paths);
      assert.equal(artifacts.count, 22);
      assert.equal(artifacts.totalBytes, 22 * 400);
      assert.equal(artifacts.totalEstTokens, 22 * 100);
      assert.equal(artifacts.items.length, 20);
      assert.equal(artifacts.items[0].name, "doc_21.md");
      assert.equal(artifacts.items[0].userFacing, true);
      assert.equal(artifacts.items[0].summary.length, 160);
      assert.ok(artifacts.items[0].summary.startsWith("Line 1 Line 2 "));
      assert.ok(artifacts.items[0].summary.endsWith("…"));
      assert.equal(artifacts.items[1].name, "doc_20.md");
      assert.equal(artifacts.items[1].userFacing, true);
      assert.equal(artifacts.items[1].summary, "PascalCase fallback summary");
      assert.equal(artifacts.items[2].userFacing, false);
      assert.equal(artifacts.items[2].summary, null);

      const bad = scanConversationArtifacts("../escape", paths);
      assert.deepEqual(bad, { count: 0, totalBytes: 0, totalEstTokens: 0, items: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Suite 6: Plugin precedence, workspace resolution, and workspace inventory", () => {
  it("applies config.json plugin enabled precedence and handles malformed config.json", () => {
    const { root, geminiHome, paths } = makeGeminiFixture();
    try {
      // Plugin A: plugin.json disabled: true, config.json enabled: true -> ACTIVE
      const pA = path.join(paths.pluginsDir, "plug-a");
      fs.mkdirSync(path.join(pA, "rules"), { recursive: true });
      fs.mkdirSync(path.join(pA, "skills", "skill-a"), { recursive: true });
      fs.writeFileSync(path.join(pA, "plugin.json"), JSON.stringify({ name: "plug-a", disabled: true }));
      fs.writeFileSync(path.join(pA, "mcp_config.json"), JSON.stringify({ mcpServers: { srvA: {} } }));
      fs.writeFileSync(path.join(pA, "rules", "rule-a.md"), "rule a");
      fs.writeFileSync(path.join(pA, "skills", "skill-a", "SKILL.md"), "---\nname: skill-a\n---\n");

      // Plugin B: plugin.json active, config.json enabled: false -> INACTIVE
      const pB = path.join(paths.pluginsDir, "plug-b");
      fs.mkdirSync(path.join(pB, "rules"), { recursive: true });
      fs.mkdirSync(path.join(pB, "skills", "skill-b"), { recursive: true });
      fs.writeFileSync(path.join(pB, "plugin.json"), JSON.stringify({ name: "plug-b" }));
      fs.writeFileSync(path.join(pB, "mcp_config.json"), JSON.stringify({ mcpServers: { srvB: {} } }));
      fs.writeFileSync(path.join(pB, "rules", "rule-b.md"), "rule b");
      fs.writeFileSync(path.join(pB, "skills", "skill-b", "SKILL.md"), "---\nname: skill-b\n---\n");

      // Cached schemas for both
      fs.mkdirSync(path.join(paths.mcpSchemasDir, "srvA"), { recursive: true });
      fs.writeFileSync(path.join(paths.mcpSchemasDir, "srvA", "t1.json"), "{}");
      fs.mkdirSync(path.join(paths.mcpSchemasDir, "srvB"), { recursive: true });
      fs.writeFileSync(path.join(paths.mcpSchemasDir, "srvB", "t1.json"), "{}");

      fs.writeFileSync(
        path.join(paths.configDir, "config.json"),
        JSON.stringify({
          plugins: {
            "plug-a": { enabled: true },
            "plug-b": { enabled: false },
          },
        }),
      );

      const inv = scanLocalInventory({ geminiHome });
      const srvMap = Object.fromEntries(inv.mcp.servers.map((s) => [s.name, s]));
      assert.equal(srvMap.srvA.active, true);
      assert.equal(srvMap.srvB.active, false);
      assert.deepEqual(inv.rules.items.map((r) => r.name), ["plug-a/rule-a.md"]);
      assert.deepEqual(inv.skills.items.map((s) => s.name), ["skill-a"]);

      // Malformed config.json falls back cleanly to plugin.json disabled flag
      fs.writeFileSync(path.join(paths.configDir, "config.json"), "{broken json");
      const invMalformed = scanLocalInventory({ geminiHome });
      const srvMap2 = Object.fromEntries(invMalformed.mcp.servers.map((s) => [s.name, s]));
      assert.equal(srvMap2.srvA.active, false);
      assert.equal(srvMap2.srvB.active, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves workspace priority order and discovers workspace rules/skills with symlink guards and caps", () => {
    const { root, geminiHome, paths } = makeGeminiFixture();
    const wsArg = makeTempDir("ctx-ws-arg-");
    const wsProj = makeTempDir("ctx-ws-proj-");
    const wsRoot = makeTempDir("ctx-ws-root-");
    const outsideDir = makeTempDir("ctx-outside-");

    try {
      const realWsArg = fs.realpathSync(wsArg);
      const realWsProj = fs.realpathSync(wsProj);
      const realWsRoot = fs.realpathSync(wsRoot);

      // Invalid workspace dirs rejected
      assert.equal(validateWorkspaceDir("/"), null);
      assert.equal(validateWorkspaceDir(os.homedir()), null);
      assert.equal(validateWorkspaceDir(path.join(root, "missing")), null);

      // Project JSON with direct folderUri / localFolder / gitFolder
      fs.writeFileSync(
        path.join(paths.projectsDir, "proj-git.json"),
        JSON.stringify({
          projectResources: {
            resources: [{ gitFolder: { folderUri: pathToFileURL(wsProj).href } }],
          },
        }),
      );
      fs.writeFileSync(
        path.join(paths.projectsDir, "proj-local.json"),
        JSON.stringify({
          projectResources: {
            resources: [{ localFolder: { folderUri: pathToFileURL(wsProj).href } }],
          },
        }),
      );
      fs.writeFileSync(
        path.join(paths.projectsDir, "proj-direct.json"),
        JSON.stringify({
          projectResources: {
            resources: [{ folderUri: pathToFileURL(wsProj).href }],
          },
        }),
      );

      // Priority: arg > projectId > mcpRoots
      assert.deepEqual(
        scanLocalInventory({
          geminiHome,
          workspacePath: wsArg,
          projectId: "proj-git",
          mcpRoots: [pathToFileURL(wsRoot).href],
        }).workspace,
        { path: realWsArg, source: "arg" },
      );

      // Invalid arg falls through to projectId; test all 3 project URI shapes
      for (const pid of ["proj-git", "proj-local", "proj-direct"]) {
        assert.deepEqual(
          scanLocalInventory({
            geminiHome,
            workspacePath: os.homedir(),
            projectId: pid,
            mcpRoots: [pathToFileURL(wsRoot).href],
          }).workspace,
          { path: realWsProj, source: "project_id" },
        );
      }

      // Invalid/missing projectId falls through to mcpRoots; malformed URI doesn't poison valid URI
      assert.deepEqual(
        scanLocalInventory({
          geminiHome,
          projectId: "../bad",
          mcpRoots: ["file://%ZZ-malformed", "https://example.com", pathToFileURL(wsRoot).href],
        }).workspace,
        { path: realWsRoot, source: "mcp_roots" },
      );

      // Workspace rules & skills across GEMINI.md, AGENTS.md, .agents, .agent, _agents, _agent
      fs.writeFileSync(path.join(wsArg, "AGENTS.md"), "a".repeat(25_000)); // overPerFileCap
      fs.writeFileSync(path.join(wsArg, "GEMINI.md"), "g".repeat(100));
      for (const dirName of [".agents", ".agent", "_agents", "_agent"]) {
        fs.mkdirSync(path.join(wsArg, dirName, "rules"), { recursive: true });
        fs.mkdirSync(path.join(wsArg, dirName, "skills", `sk-${dirName}`), { recursive: true });
        fs.writeFileSync(path.join(wsArg, dirName, "rules", "r.md"), "rule body");
        fs.writeFileSync(
          path.join(wsArg, dirName, "skills", `sk-${dirName}`, "SKILL.md"),
          `---\nname: skill-${dirName}\n---\n${"body\n".repeat(2000)}`,
        );
      }

      // Create >80 rules to verify pre-slice sort + 80 cap
      fs.mkdirSync(path.join(wsArg, ".agents", "rules"), { recursive: true });
      for (let i = 0; i < 85; i += 1) {
        fs.writeFileSync(
          path.join(wsArg, ".agents", "rules", `bulk-${String(i).padStart(2, "0")}.md`),
          "x".repeat(200 + i * 8),
        );
      }

      // Symlink escape + broken symlink + duplicate symlink inside workspace
      fs.writeFileSync(path.join(outsideDir, "secret.md"), "escape");
      fs.symlinkSync(
        path.join(outsideDir, "secret.md"),
        path.join(wsArg, ".agents", "rules", "escape.md"),
      );
      fs.symlinkSync(
        path.join(wsArg, ".agents", "rules", "nonexistent.md"),
        path.join(wsArg, ".agents", "rules", "dangling.md"),
      );
      fs.symlinkSync(
        path.join(wsArg, "AGENTS.md"),
        path.join(wsArg, ".agents", "rules", "dup-agents.md"),
      );

      const inv = scanLocalInventory({ geminiHome, workspacePath: wsArg });
      assert.equal(inv.rules.count, 91); // 2 root + 4*1 dir rules + 85 bulk rules
      assert.equal(inv.rules.items.length, 80);
      assert.equal(inv.rules.items[0].name, "AGENTS.md");
      assert.equal(inv.rules.items[0].overPerFileCap, true);
      assert.equal(inv.rules.items[0].scope, "workspace");
      assert.equal(
        inv.rules.items.some((r) => r.name.includes("escape") || r.name.includes("dangling")),
        false,
      );
      assert.equal(inv.skills.byScope.workspace, 4);
      assert.equal(inv.skills.count, 4);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(wsArg, { recursive: true, force: true });
      fs.rmSync(wsProj, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("Suite 7: fetchConversationServiceTitles", () => {
  it("returns missing_env immediately when env vars are absent", async () => {
    await withEnv(
      { ANTIGRAVITY_LS_ADDRESS: undefined, ANTIGRAVITY_CSRF_TOKEN: undefined },
      async () => {
        const res = await fetchConversationServiceTitles();
        assert.equal(res.map.size, 0);
        assert.deepEqual(res.status, {
          reachable: false,
          reason: "missing_env",
          enrichedCount: 0,
        });
      },
    );
  });

  it("handles 2-page ok response, page-2 partial retention, http_error, and 350ms timeout", async () => {
    let mode = "ok";
    const srv = await startMockServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

      if (mode === "http_error") {
        res.writeHead(500);
        res.end("boom");
        return;
      }
      if (mode === "timeout") {
        await new Promise((r) => setTimeout(r, 500));
        if (!res.writableEnded) {
          res.writeHead(200);
          res.end("{}");
        }
        return;
      }
      if (!body.pageToken) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            conversations: [
              {
                id: "c1",
                annotations: { title: "Title 1" },
                state: { runState: "RUN_STATE_IDLE" },
                metadata: { projectId: "p1", rootConversationId: "c1" },
              },
            ],
            nextPageToken: "page-2",
          }),
        );
        return;
      }
      if (mode === "partial") {
        res.writeHead(500);
        res.end("page 2 error");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          conversations: [
            {
              id: "c2",
              state: { summary: "Summary 2", runState: "RUN_STATE_RUNNING" },
              metadata: { parentConversationId: "c1", rootConversationId: "c1" },
            },
          ],
        }),
      );
    });

    try {
      await withEnv(
        { ANTIGRAVITY_LS_ADDRESS: srv.address, ANTIGRAVITY_CSRF_TOKEN: "secret" },
        async () => {
          mode = "ok";
          const okRes = await fetchConversationServiceTitles(200);
          assert.deepEqual(okRes.status, {
            reachable: true,
            reason: "ok",
            enrichedCount: 2,
          });
          assert.equal(okRes.map.get("c1").projectId, "p1");
          assert.equal(okRes.map.get("c2").parentConversationId, "c1");

          mode = "partial";
          const partialRes = await fetchConversationServiceTitles(200);
          assert.deepEqual(partialRes.status, {
            reachable: true,
            reason: "partial",
            enrichedCount: 1,
          });
          assert.equal(partialRes.map.get("c1").title, "Title 1");

          mode = "http_error";
          const errRes = await fetchConversationServiceTitles(200);
          assert.deepEqual(errRes.status, {
            reachable: false,
            reason: "http_error",
            enrichedCount: 0,
          });

          mode = "timeout";
          const toRes = await fetchConversationServiceTitles(200);
          assert.deepEqual(toRes.status, {
            reachable: false,
            reason: "timeout_or_network",
            enrichedCount: 0,
          });
        },
      );
    } finally {
      await srv.close();
    }
  });
});
