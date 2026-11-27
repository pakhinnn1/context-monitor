import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODEL_CATALOG = [
  {
    prefix: "gemini-4-neon",
    label: "Gemini 4 Neon",
    limit: 512_000,
    source: "Antigravity docs (up to 512k)",
    verified: true,
  },
  {
    prefix: "gemini-4-carbon",
    label: "Gemini 4 Carbon",
    limit: 1_000_000,
    source: "Model native spec (1M)",
    verified: false,
  },
  {
    prefix: "gemini-4-argon",
    label: "Gemini 4 Argon",
    limit: 1_000_000,
    source: "Model native spec (1M)",
    verified: false,
  },
  {
    prefix: "gemini-4-hydrogen",
    label: "Gemini 4 Hydrogen",
    limit: 1_000_000,
    source: "Model native spec (1M)",
    verified: false,
  },
  {
    prefix: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    limit: 1_000_000,
    source: "Model native spec (1M)",
    verified: false,
  },
  {
    prefix: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    limit: 1_000_000,
    source: "Model native spec (1M)",
    verified: false,
  },
  {
    prefix: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    limit: 1_000_000,
    source: "Model native spec (1M)",
    verified: false,
  },
  {
    prefix: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    limit: 1_000_000,
    source: "Model native spec (1M)",
    verified: false,
  },
  {
    prefix: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    limit: 1_000_000,
    source: "Anthropic docs (1M)",
    verified: true,
  },
  {
    prefix: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    limit: 1_000_000,
    source: "Anthropic docs (1M)",
    verified: true,
  },
  {
    prefix: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    limit: 200_000,
    source: "Anthropic standard window (200k)",
    verified: true,
  },
  {
    prefix: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    limit: 200_000,
    source: "Anthropic standard window (200k)",
    verified: true,
  },
  {
    prefix: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    limit: null,
    source: "Window not verified locally",
    verified: false,
  },
];

const WORKSPACE_CUSTOMIZATION_DIRS = [".agents", ".agent", "_agents", "_agent"];
const PER_FILE_RULE_BYTE_CAP = 24_000;
const SKILL_HEAD_READ_BYTES = 4096;
const TRAJECTORY_ACTIVE_EPOCH_CAP = 120;

// Lightweight mtime cache for parsed conversation summaries, keyed by resolved transcriptPath
const summaryCache = new Map();

export function resolvePaths({ geminiHome } = {}) {
  const resolvedGeminiHome =
    geminiHome ||
    process.env.CONTEXT_MONITOR_GEMINI_HOME ||
    path.join(os.homedir(), ".gemini");
  const antigravityDir = path.join(resolvedGeminiHome, "antigravity");
  const configDir = path.join(resolvedGeminiHome, "config");
  return {
    geminiHome: resolvedGeminiHome,
    antigravityDir,
    brainDir: path.join(antigravityDir, "brain"),
    annotationsDir: path.join(antigravityDir, "annotations"),
    mcpSchemasDir: path.join(antigravityDir, "mcp"),
    configDir,
    pluginsDir: path.join(configDir, "plugins"),
    projectsDir: path.join(configDir, "projects"),
    builtinSkillsDir: path.join(antigravityDir, "builtin", "skills"),
  };
}

export function isSafeSingleSegment(id) {
  if (typeof id !== "string" || id.length === 0 || id === ".") return false;
  if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
    return false;
  }
  return true;
}

export function validateWorkspaceDir(candidatePath) {
  if (typeof candidatePath !== "string" || !candidatePath.trim()) return null;
  try {
    const real = fs.realpathSync(candidatePath.trim());
    const st = fs.statSync(real);
    if (!st.isDirectory()) return null;

    let realHome;
    try {
      realHome = fs.realpathSync(os.homedir());
    } catch {
      realHome = path.resolve(os.homedir());
    }

    if (real === path.parse(real).root || real === realHome) return null;
    return real;
  } catch {
    return null;
  }
}

export function resolveModelInfo(modelId) {
  if (!modelId || typeof modelId !== "string") {
    return {
      id: null,
      displayName: "Unknown model",
      contextWindow: null,
      windowSource: "No planner turns recorded yet",
      windowVerified: false,
    };
  }

  const lower = modelId.toLowerCase();
  const match = MODEL_CATALOG.find((entry) => lower.startsWith(entry.prefix));

  let effort = "";
  if (lower.endsWith("-xhigh")) effort = "Extra";
  else if (lower.endsWith("-high")) effort = "High";
  else if (lower.endsWith("-medium")) effort = "Medium";
  else if (lower.endsWith("-low")) effort = "Low";

  if (!match) {
    return {
      id: modelId,
      displayName: modelId,
      contextWindow: null,
      windowSource: "Unknown model window",
      windowVerified: false,
    };
  }

  return {
    id: modelId,
    displayName: effort ? `${match.label} (${effort})` : match.label,
    contextWindow: match.limit,
    windowSource: match.source,
    windowVerified: match.verified,
  };
}

function unescapePbtxtString(raw) {
  return raw
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\\\/g, "\\")
    .trim();
}

function readAnnotationInfo(conversationId, paths = resolvePaths()) {
  if (!isSafeSingleSegment(conversationId)) {
    return { exists: false, title: null };
  }
  const filePath = path.join(paths.annotationsDir, `${conversationId}.pbtxt`);
  try {
    const text = fs.readFileSync(filePath, "utf8");
    const m = text.match(/title:\s*"((?:[^"\\]|\\.)*)"/);
    const cleaned = m && m[1] ? unescapePbtxtString(m[1]) : "";
    return { exists: true, title: cleaned || null };
  } catch {
    return { exists: false, title: null };
  }
}

function classifyConversationKind(hasAnnotation, serviceInfo) {
  if (serviceInfo?.parentConversationId) return "subagent";
  if (hasAnnotation || Boolean(serviceInfo)) return "interactive";
  return "background";
}

function extractRequestSnippet(content) {
  if (!content || typeof content !== "string") return null;
  let body = content;
  const tagMatch = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  if (tagMatch) {
    body = tagMatch[1];
  } else {
    body = body.replace(/^<USER_REQUEST>\s*/i, "").replace(/<\/USER_REQUEST>$/i, "");
  }
  const firstLine = body
    .split(/\r?\n/)
    .map((ln) => ln.trim())
    .find((ln) => ln.length > 0 && !ln.startsWith("<"));
  if (!firstLine) return null;
  const normalized = firstLine.replace(/\s+/g, " ");
  return normalized.length > 240 ? `${normalized.slice(0, 239)}…` : normalized;
}

export async function fetchConversationServiceTitles(maxCount = 200) {
  const lsAddress = process.env.ANTIGRAVITY_LS_ADDRESS;
  const csrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (!lsAddress || !csrfToken) {
    return {
      map: new Map(),
      status: { reachable: false, reason: "missing_env", enrichedCount: 0 },
    };
  }

  const targetCount = Math.max(1, Math.min(200, Number(maxCount) || 200));
  const map = new Map();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 350);
  let page1Succeeded = false;
  let pageToken = "";

  try {
    for (let page = 0; page < 2 && map.size < targetCount; page += 1) {
      const body = {
        pageSize: Math.min(100, targetCount - map.size),
        includeArchived: false,
      };
      if (pageToken) body.pageToken = pageToken;

      const res = await fetch(
        `http://${lsAddress}/product.v1.ConversationService/ListConversations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Connect-Protocol-Version": "1",
            "x-antigravity-csrf-token": csrfToken,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      if (!res.ok) {
        return page1Succeeded
          ? { map, status: { reachable: true, reason: "partial", enrichedCount: map.size } }
          : { map: new Map(), status: { reachable: false, reason: "http_error", enrichedCount: 0 } };
      }

      const data = await res.json();
      for (const conv of data.conversations || []) {
        if (!conv?.id) continue;
        const title =
          conv.annotations?.title?.trim() ||
          conv.state?.summary?.trim() ||
          null;
        map.set(conv.id, {
          title,
          runState: conv.state?.runState || null,
          updateTime: conv.state?.updateTime || null,
          projectId: conv.metadata?.projectId || null,
          parentConversationId: conv.metadata?.parentConversationId || null,
          rootConversationId: conv.metadata?.rootConversationId || null,
        });
      }

      page1Succeeded = true;
      pageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
      if (!pageToken) break;
    }

    return {
      map,
      status: { reachable: true, reason: "ok", enrichedCount: map.size },
    };
  } catch {
    return page1Succeeded
      ? { map, status: { reachable: true, reason: "partial", enrichedCount: map.size } }
      : { map: new Map(), status: { reachable: false, reason: "timeout_or_network", enrichedCount: 0 } };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonlFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // Skip partial trailing line if currently being written
    }
  }
  return rows;
}

function serializedToolCallChars(call) {
  try {
    return JSON.stringify(call).length;
  } catch {
    return 120;
  }
}

function estimateAgentTextChars(row) {
  let chars = 0;
  if (typeof row.content === "string") chars += row.content.length;
  if (typeof row.thinking === "string") chars += row.thinking.length;
  return chars;
}

function estimateToolCallsChars(row) {
  if (!Array.isArray(row.tool_calls) || row.tool_calls.length === 0) return 0;
  let chars = 0;
  for (const call of row.tool_calls) {
    chars += serializedToolCallChars(call);
  }
  return chars;
}

function estimateRowChars(row) {
  return estimateAgentTextChars(row) + estimateToolCallsChars(row);
}

function allocateProportionally(total, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (total <= 0 || entries.length === 0) {
    return Object.fromEntries(Object.keys(weights).map((k) => [k, 0]));
  }
  const weightSum = entries.reduce((acc, [, w]) => acc + w, 0);
  const result = Object.fromEntries(Object.keys(weights).map((k) => [k, 0]));
  const remainders = [];
  let assigned = 0;

  for (const [key, w] of entries) {
    const exact = (total * w) / weightSum;
    const floored = Math.floor(exact);
    result[key] = floored;
    assigned += floored;
    remainders.push({ key, frac: exact - floored });
  }

  const leftover = total - assigned;
  remainders.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < leftover && i < remainders.length; i += 1) {
    result[remainders[i].key] += 1;
  }
  return result;
}

function allocatePercentageTenths(items, totalTenths) {
  const result = Object.fromEntries(items.map((item) => [item.key, 0]));
  const positive = items.filter((item) => item.rawTenths > 0);
  if (totalTenths <= 0 || positive.length === 0) return result;

  const remainders = [];
  let assigned = 0;
  for (let i = 0; i < positive.length; i += 1) {
    const item = positive[i];
    const floored = Math.floor(item.rawTenths);
    result[item.key] = floored;
    assigned += floored;
    remainders.push({
      key: item.key,
      frac: item.rawTenths - floored,
      rawTenths: item.rawTenths,
      idx: i,
    });
  }

  const leftover = Math.max(0, totalTenths - assigned);
  remainders.sort(
    (a, b) => b.frac - a.frac || b.rawTenths - a.rawTenths || a.idx - b.idx,
  );
  for (let i = 0; i < leftover; i += 1) {
    const target = remainders[i % remainders.length];
    result[target.key] += 1;
  }
  return result;
}

function loadBestTranscriptRows(conversationId, compactPath, paths = resolvePaths()) {
  if (isSafeSingleSegment(conversationId)) {
    const fullPath = path.join(
      paths.brainDir,
      conversationId,
      ".system_generated",
      "logs",
      "transcript_full.jsonl",
    );
    try {
      const stat = fs.statSync(fullPath);
      // Use full transcript for better proportional weights when size is modest (<= 4 MiB)
      if (stat.isFile() && stat.size > 0 && stat.size <= 4 * 1024 * 1024) {
        return {
          rows: parseJsonlFile(fullPath),
          usedFullTranscript: true,
        };
      }
    } catch {
      // Fall back to compact transcript.jsonl
    }
  }
  return {
    rows: parseJsonlFile(compactPath),
    usedFullTranscript: false,
  };
}

const TRAJECTORY_KIND_PRIORITY = {
  checkpoint_peak: 3,
  checkpoint_baseline: 2,
  turn: 1,
};

function toTrajectoryPoint(pt, kind) {
  return {
    turn: pt.turn,
    stepIndex: typeof pt.row.step_index === "number" ? pt.row.step_index : pt.rowIndex,
    activeTokens: pt.activeTokens,
    inputTokens: pt.inputTokens,
    cacheReadTokens: pt.cacheReadTokens,
    outputTokens: pt.outputTokens,
    kind,
    createdAt: pt.row.created_at || null,
  };
}

function buildTrajectory(plannerTurns, checkpointIndices) {
  const totalTurnCount = plannerTurns.length;
  const checkpointCount = checkpointIndices.length;

  if (totalTurnCount === 0) {
    return {
      points: [],
      totalTurnCount: 0,
      checkpointCount,
      isBounded: false,
    };
  }

  if (checkpointCount === 0) {
    let isBounded = false;
    let points = plannerTurns.map((pt) => toTrajectoryPoint(pt, "turn"));
    if (points.length > TRAJECTORY_ACTIVE_EPOCH_CAP) {
      isBounded = true;
      points = [points[0], ...points.slice(-(TRAJECTORY_ACTIVE_EPOCH_CAP - 1))];
    }
    return {
      points,
      totalTurnCount,
      checkpointCount: 0,
      isBounded,
    };
  }

  const byTurn = new Map();
  const upsertPoint = (point) => {
    const existing = byTurn.get(point.turn);
    if (
      !existing ||
      TRAJECTORY_KIND_PRIORITY[point.kind] > TRAJECTORY_KIND_PRIORITY[existing.kind]
    ) {
      byTurn.set(point.turn, point);
    }
  };

  upsertPoint(toTrajectoryPoint(plannerTurns[0], "turn"));

  for (const cpIdx of checkpointIndices) {
    let peak = null;
    let baseline = null;
    for (const pt of plannerTurns) {
      if (pt.rowIndex < cpIdx) {
        peak = pt;
      } else if (pt.rowIndex > cpIdx && !baseline) {
        baseline = pt;
        break;
      }
    }
    if (peak) upsertPoint(toTrajectoryPoint(peak, "checkpoint_peak"));
    if (baseline) upsertPoint(toTrajectoryPoint(baseline, "checkpoint_baseline"));
  }

  const lastCpIdx = checkpointIndices[checkpointIndices.length - 1];
  const activeEpochTurns = plannerTurns.filter((pt) => pt.rowIndex > lastCpIdx);
  let isBounded = false;

  if (activeEpochTurns.length > 0) {
    let activePoints = activeEpochTurns.map((pt, idx) =>
      toTrajectoryPoint(pt, idx === 0 ? "checkpoint_baseline" : "turn"),
    );
    if (activePoints.length > TRAJECTORY_ACTIVE_EPOCH_CAP) {
      isBounded = true;
      activePoints = [
        activePoints[0],
        ...activePoints.slice(-(TRAJECTORY_ACTIVE_EPOCH_CAP - 1)),
      ];
    }
    for (const point of activePoints) {
      upsertPoint(point);
    }
  }

  const points = Array.from(byTurn.values()).sort((a, b) => a.turn - b.turn);
  return {
    points,
    totalTurnCount,
    checkpointCount,
    isBounded,
  };
}

function buildTopTools(rows, anchorIdx, latestPlannerIdx, toolCallsTokens) {
  if (toolCallsTokens <= 0 || latestPlannerIdx <= anchorIdx) return [];

  const statsByTool = new Map();
  const ensureTool = (name) => {
    let entry = statsByTool.get(name);
    if (!entry) {
      entry = { calls: 0, weight: 0 };
      statsByTool.set(name, entry);
    }
    return entry;
  };

  for (let i = anchorIdx; i < latestPlannerIdx; i += 1) {
    const row = rows[i];
    if (
      row.type !== "PLANNER_RESPONSE" ||
      !Array.isArray(row.tool_calls) ||
      row.tool_calls.length === 0
    ) {
      continue;
    }

    const genericChars = [];
    for (let j = i + 1; j <= latestPlannerIdx; j += 1) {
      const r = rows[j];
      if (
        r.type === "PLANNER_RESPONSE" ||
        r.type === "USER_INPUT" ||
        r.type === "CHECKPOINT"
      ) {
        break;
      }
      if (r.type === "SYSTEM_MESSAGE" || r.type === "ERROR_MESSAGE") continue;
      if (r.type === "GENERIC") {
        genericChars.push(Math.max(1, estimateRowChars(r)));
      }
    }

    const callSizes = row.tool_calls.map((tc) =>
      Math.max(1, serializedToolCallChars(tc)),
    );

    if (genericChars.length === row.tool_calls.length) {
      for (let k = 0; k < row.tool_calls.length; k += 1) {
        const name = row.tool_calls[k]?.name || "unknown";
        const entry = ensureTool(name);
        entry.calls += 1;
        entry.weight += callSizes[k] + genericChars[k];
      }
    } else {
      const totalGeneric = genericChars.reduce((acc, v) => acc + v, 0);
      const totalCallSize = callSizes.reduce((acc, v) => acc + v, 0);
      for (let k = 0; k < row.tool_calls.length; k += 1) {
        const name = row.tool_calls[k]?.name || "unknown";
        const entry = ensureTool(name);
        const genShare =
          totalCallSize > 0 ? (totalGeneric * callSizes[k]) / totalCallSize : 0;
        entry.calls += 1;
        entry.weight += callSizes[k] + genShare;
      }
    }
  }

  const weightMap = Object.fromEntries(
    Array.from(statsByTool.entries()).map(([name, s]) => [name, s.weight]),
  );
  if (Object.keys(weightMap).length === 0) return [];

  const allocated = allocateProportionally(toolCallsTokens, weightMap);
  return Array.from(statsByTool.entries())
    .map(([name, s]) => {
      const estTokens = allocated[name] || 0;
      const sharePercent =
        toolCallsTokens > 0
          ? Math.round((estTokens / toolCallsTokens) * 1000) / 10
          : 0;
      return {
        name,
        calls: s.calls,
        estTokens,
        sharePercent,
      };
    })
    .sort((a, b) => {
      if (b.estTokens !== a.estTokens) return b.estTokens - a.estTokens;
      if (b.calls !== a.calls) return b.calls - a.calls;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 10);
}

export function scanConversationArtifacts(conversationId, paths = resolvePaths()) {
  if (!isSafeSingleSegment(conversationId)) {
    return { count: 0, totalBytes: 0, totalEstTokens: 0, items: [] };
  }

  const convDir = path.join(paths.brainDir, conversationId);
  const allItems = [];
  let totalBytes = 0;

  try {
    for (const dirent of fs.readdirSync(convDir, { withFileTypes: true })) {
      if (!dirent.name.endsWith(".md")) continue;
      const fullPath = path.join(convDir, dirent.name);
      try {
        const st = fs.statSync(fullPath);
        if (!st.isFile()) continue;
        const fileUri = safeRealFileUri(fullPath, convDir);
        if (!fileUri) continue;

        const meta = readJsonSafe(`${fullPath}.metadata.json`);
        const userFacing = Boolean(meta?.userFacing ?? meta?.UserFacing);
        const rawSummary = meta?.summary ?? meta?.Summary;
        let summary = null;
        if (typeof rawSummary === "string") {
          const collapsed = rawSummary.replace(/\s+/g, " ").trim();
          if (collapsed) {
            summary =
              collapsed.length > 160 ? `${collapsed.slice(0, 159)}…` : collapsed;
          }
        }

        totalBytes += st.size;
        allItems.push({
          name: dirent.name,
          bytes: st.size,
          estTokens: Math.round(st.size / 4),
          mtimeMs: st.mtimeMs,
          userFacing,
          summary,
          fileUri,
        });
      } catch {
        // Skip unreadable entries
      }
    }
  } catch {
    return { count: 0, totalBytes: 0, totalEstTokens: 0, items: [] };
  }

  allItems.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return a.name.localeCompare(b.name);
  });

  return {
    count: allItems.length,
    totalBytes,
    totalEstTokens: Math.round(totalBytes / 4),
    items: allItems.slice(0, 20),
  };
}

export function analyzeTranscriptRows(
  conversationId,
  rows,
  mtimeIso,
  titleOverride,
  runState,
  usedFullTranscript,
  { includeDetails = true, kind = "interactive", annotationTitle = undefined, paths = undefined } = {},
) {
  let firstUserRow = null;
  const checkpointIndices = [];
  const plannerTurns = [];
  let totalOutputTokens = 0;
  let cumulativeInputTokens = 0;
  let cumulativeCacheReadTokens = 0;
  let cacheInvalidationCount = 0;
  let prevPlannerCacheRead = null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.type === "USER_INPUT" && !firstUserRow) {
      firstUserRow = row;
    } else if (row.type === "CHECKPOINT") {
      checkpointIndices.push(i);
      prevPlannerCacheRead = null;
    } else if (row.type === "PLANNER_RESPONSE") {
      const hasTokens =
        typeof row.input_tokens === "number" ||
        typeof row.cache_read_tokens === "number";
      const outputTokens = typeof row.output_tokens === "number" ? row.output_tokens : 0;
      if (typeof row.output_tokens === "number") {
        totalOutputTokens += row.output_tokens;
      }
      if (hasTokens) {
        const turnInput = Number(row.input_tokens || 0);
        const turnCacheRead = Number(row.cache_read_tokens || 0);
        cumulativeInputTokens += turnInput;
        cumulativeCacheReadTokens += turnCacheRead;

        if (
          prevPlannerCacheRead !== null &&
          prevPlannerCacheRead > 0 &&
          (turnCacheRead === 0 || turnCacheRead <= prevPlannerCacheRead * 0.5)
        ) {
          cacheInvalidationCount += 1;
        }
        prevPlannerCacheRead = turnCacheRead;

        plannerTurns.push({
          rowIndex: i,
          turn: plannerTurns.length + 1,
          row,
          inputTokens: turnInput,
          cacheReadTokens: turnCacheRead,
          activeTokens: turnInput + turnCacheRead,
          outputTokens,
        });
      }
    }
  }

  const checkpointCount = checkpointIndices.length;
  const resolvedAnnotationTitle =
    annotationTitle !== undefined
      ? annotationTitle
      : readAnnotationInfo(conversationId, paths || resolvePaths()).title;
  const requestTitle = extractRequestSnippet(firstUserRow?.content);
  const title =
    titleOverride ||
    resolvedAnnotationTitle ||
    requestTitle ||
    `Thread ${conversationId.slice(0, 8)}`;

  if (plannerTurns.length === 0) {
    const model = resolveModelInfo(null);
    const emptyResult = {
      conversationId,
      title,
      kind,
      runState: runState || null,
      model,
      lastUpdated: mtimeIso,
      usedFullTranscript,
      exact: {
        activeTokens: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheHitPercent: 0,
        lastOutputTokens: 0,
        totalOutputTokens: 0,
        postCheckpointOutputTokens: 0,
        turnCount: 0,
        checkpointCount,
        cumulativeInputTokens: 0,
        cumulativeCacheReadTokens: 0,
        cacheInvalidationCount: 0,
        freeTokens: null,
        freePercent: null,
        usedPercent: null,
      },
      segments: [],
      hasUsageData: false,
    };
    if (includeDetails) {
      emptyResult.trajectory = {
        points: [],
        totalTurnCount: 0,
        checkpointCount,
        isBounded: false,
      };
      emptyResult.topTools = [];
    }
    return emptyResult;
  }

  const firstTurn = plannerTurns[0];
  const latestTurn = plannerTurns[plannerTurns.length - 1];
  const firstPlannerIdx = firstTurn.rowIndex;
  const latestPlannerIdx = latestTurn.rowIndex;
  const latestPlanner = latestTurn.row;
  const lastCheckpointIdx =
    checkpointCount > 0 ? checkpointIndices[checkpointCount - 1] : -1;

  let effectiveCheckpointIdx = -1;
  for (let i = checkpointIndices.length - 1; i >= 0; i -= 1) {
    if (checkpointIndices[i] < latestPlannerIdx) {
      effectiveCheckpointIdx = checkpointIndices[i];
      break;
    }
  }

  const inputTokens = latestTurn.inputTokens;
  const cacheReadTokens = latestTurn.cacheReadTokens;
  const activeTokens = latestTurn.activeTokens;
  const lastOutputTokens = latestTurn.outputTokens;
  const cacheHitPercent =
    activeTokens > 0 ? Math.round((cacheReadTokens / activeTokens) * 1000) / 10 : 0;

  let postCheckpointOutputTokens = 0;
  for (let i = Math.max(0, lastCheckpointIdx + 1); i < rows.length; i += 1) {
    if (rows[i].type === "PLANNER_RESPONSE" && typeof rows[i].output_tokens === "number") {
      postCheckpointOutputTokens += rows[i].output_tokens;
    }
  }

  const model = resolveModelInfo(latestPlanner.model);
  const contextWindow = model.contextWindow;
  const freeTokens =
    contextWindow !== null ? Math.max(0, contextWindow - activeTokens) : null;
  const usedPercent =
    contextWindow !== null && contextWindow > 0
      ? Math.round((activeTokens / contextWindow) * 1000) / 10
      : null;

  // Honest local category breakdown summing exactly to activeTokens
  const firstTotal = firstTurn.activeTokens;
  const firstUserRawEst = Math.round(estimateRowChars(firstUserRow || {}) / 4);
  const firstUserEst = Math.min(firstUserRawEst, Math.floor(firstTotal * 0.6));
  const turn1Baseline = Math.max(0, firstTotal - firstUserEst);

  let baselineEst = 0;
  let checkpointBufferEst = 0;
  let initialMessagesEst = 0;
  let anchorIdx = firstPlannerIdx;
  let anchorTotal = 0;

  if (effectiveCheckpointIdx === -1) {
    anchorIdx = firstPlannerIdx;
    baselineEst = Math.min(turn1Baseline, activeTokens);
    initialMessagesEst = Math.min(firstUserEst, Math.max(0, activeTokens - baselineEst));
    checkpointBufferEst = 0;
    anchorTotal = baselineEst + initialMessagesEst;
  } else {
    const postCpTurn = plannerTurns.find((t) => t.rowIndex > effectiveCheckpointIdx);
    anchorIdx = postCpTurn.rowIndex;
    const postCpTotal = postCpTurn.activeTokens;
    baselineEst = Math.min(turn1Baseline, postCpTotal, activeTokens);
    checkpointBufferEst = Math.min(
      Math.max(0, postCpTotal - baselineEst),
      Math.max(0, activeTokens - baselineEst),
    );
    initialMessagesEst = 0;
    anchorTotal = baselineEst + checkpointBufferEst;
  }

  let toolCallChars = 0;
  let userMessageChars = 0;
  let agentResponseChars = 0;
  let systemMessageChars = 0;

  // A planner turn's output enters prompt context only on subsequent turns ([anchorIdx, latestPlannerIdx))
  for (let i = anchorIdx; i < latestPlannerIdx; i += 1) {
    const row = rows[i];
    if (row.type === "PLANNER_RESPONSE") {
      agentResponseChars += estimateAgentTextChars(row);
      toolCallChars += estimateToolCallsChars(row);
    } else if (i > anchorIdx) {
      const chars = Math.max(1, estimateRowChars(row));
      if (row.type === "GENERIC") {
        toolCallChars += chars;
      } else if (row.type === "USER_INPUT") {
        userMessageChars += chars;
      } else if (row.type === "SYSTEM_MESSAGE" || row.type === "ERROR_MESSAGE") {
        systemMessageChars += chars;
      }
    }
  }

  const deltaTokens = Math.max(0, activeTokens - anchorTotal);
  const hasWeights =
    toolCallChars + userMessageChars + agentResponseChars + systemMessageChars > 0;
  const deltaWeights = hasWeights
    ? {
        toolCalls: toolCallChars,
        userMessages: userMessageChars,
        agentResponses: agentResponseChars,
        systemMessages: systemMessageChars,
      }
    : {
        toolCalls: 0,
        userMessages: 0,
        agentResponses: deltaTokens > 0 ? 1 : 0,
        systemMessages: 0,
      };

  const allocated = allocateProportionally(deltaTokens, deltaWeights);
  const toolCallsTokens = allocated.toolCalls;
  const userMessagesTokens = initialMessagesEst + allocated.userMessages;
  const agentResponsesTokens = allocated.agentResponses;
  const systemMessagesTokens = allocated.systemMessages;

  const rawSegments = [
    {
      id: "baseline",
      label: "System and baseline",
      tokens: baselineEst,
      percent: null,
      colorKey: "blue",
      kind: "estimated",
      detail:
        "Local estimate derived from Turn 1 prompt size minus the first user prompt. Covers system prompt, built-in tools, MCP index, rules, and skill headers.",
    },
    {
      id: "tool_calls",
      label: "Tool calls",
      tokens: toolCallsTokens,
      percent: null,
      colorKey: "orange",
      kind: "estimated",
      detail:
        effectiveCheckpointIdx >= 0
          ? "Local estimate allocating post-checkpoint prompt growth by tool call arguments and tool output character share."
          : "Local estimate allocating prompt growth since Turn 1 by tool call arguments and tool output character share.",
    },
    {
      id: "user_messages",
      label: "User messages",
      tokens: userMessagesTokens,
      percent: null,
      colorKey: "green",
      kind: "estimated",
      detail:
        "Local estimate covering user prompt text in the active context window.",
    },
    {
      id: "agent_responses",
      label: "Agent responses",
      tokens: agentResponsesTokens,
      percent: null,
      colorKey: "amber",
      kind: "estimated",
      detail:
        "Local estimate covering assistant replies and thinking content in the active context window.",
    },
  ];

  if (checkpointBufferEst > 0) {
    rawSegments.push({
      id: "checkpoint_buffer",
      label: "Checkpoint buffer",
      tokens: checkpointBufferEst,
      percent: null,
      colorKey: "violet",
      kind: "estimated",
      detail: `Local estimate of compacted conversation history carried forward after ${checkpointCount} checkpoint${checkpointCount === 1 ? "" : "s"}.`,
    });
  }

  if (systemMessagesTokens > 0) {
    rawSegments.push({
      id: "system_messages",
      label: "System messages",
      tokens: systemMessagesTokens,
      percent: null,
      colorKey: "slate",
      kind: "estimated",
      detail:
        "Local estimate allocating transcript system notifications and error messages in the active window.",
    });
  }

  let freePercent = null;
  let adjustedUsedPercent = usedPercent;
  if (contextWindow !== null && contextWindow > 0) {
    if (activeTokens <= contextWindow) {
      const allocItems = [
        ...rawSegments.map((seg) => ({
          key: seg.id,
          rawTenths: (seg.tokens / contextWindow) * 1000,
        })),
        { key: "free", rawTenths: ((freeTokens || 0) / contextWindow) * 1000 },
      ];
      const tenths = allocatePercentageTenths(allocItems, 1000);
      for (const seg of rawSegments) {
        seg.percent = tenths[seg.id] / 10;
      }
      freePercent = tenths.free / 10;
      adjustedUsedPercent = (1000 - tenths.free) / 10;
    } else {
      const usedTenths = Math.round((activeTokens / contextWindow) * 1000);
      const allocItems = rawSegments.map((seg) => ({
        key: seg.id,
        rawTenths: (seg.tokens / contextWindow) * 1000,
      }));
      const tenths = allocatePercentageTenths(allocItems, usedTenths);
      for (const seg of rawSegments) {
        seg.percent = tenths[seg.id] / 10;
      }
      freePercent = 0;
      adjustedUsedPercent = usedTenths / 10;
    }
  }

  const result = {
    conversationId,
    title,
    kind,
    runState: runState || null,
    model,
    lastUpdated: latestPlanner.created_at || mtimeIso,
    usedFullTranscript,
    exact: {
      activeTokens,
      inputTokens,
      cacheReadTokens,
      cacheHitPercent,
      lastOutputTokens,
      totalOutputTokens,
      postCheckpointOutputTokens,
      turnCount: plannerTurns.length,
      checkpointCount,
      cumulativeInputTokens,
      cumulativeCacheReadTokens,
      cacheInvalidationCount,
      freeTokens,
      freePercent,
      usedPercent: adjustedUsedPercent,
    },
    segments: rawSegments,
    hasUsageData: true,
  };

  if (includeDetails) {
    result.trajectory = buildTrajectory(plannerTurns, checkpointIndices);
    result.topTools = buildTopTools(rows, anchorIdx, latestPlannerIdx, toolCallsTokens);
  }

  return result;
}

function summarizeConversationFast(
  conversationId,
  transcriptPath,
  mtimeMs,
  serviceInfo,
  paths = resolvePaths(),
) {
  const cacheKey = path.resolve(transcriptPath);
  const cached = summaryCache.get(cacheKey);
  let base = cached && cached.mtimeMs === mtimeMs ? cached.base : null;

  if (!base) {
    let firstUserRow = null;
    let latestPlanner = null;
    let checkpointCount = 0;
    let turnCount = 0;

    try {
      const text = fs.readFileSync(transcriptPath, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line) continue;
        if (!firstUserRow && line.includes('"USER_INPUT"')) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "USER_INPUT") firstUserRow = obj;
          } catch {}
        } else if (line.includes('"CHECKPOINT"')) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "CHECKPOINT") checkpointCount += 1;
          } catch {}
        } else if (line.includes('"PLANNER_RESPONSE"')) {
          try {
            const obj = JSON.parse(line);
            if (
              obj.type === "PLANNER_RESPONSE" &&
              (typeof obj.input_tokens === "number" ||
                typeof obj.cache_read_tokens === "number")
            ) {
              latestPlanner = obj;
              turnCount += 1;
            }
          } catch {}
        }
      }
    } catch {
      return null;
    }

    const activeTokens = latestPlanner
      ? Number(latestPlanner.input_tokens || 0) +
        Number(latestPlanner.cache_read_tokens || 0)
      : 0;
    const model = resolveModelInfo(latestPlanner?.model || null);
    const usedPercent =
      model.contextWindow && activeTokens > 0
        ? Math.round((activeTokens / model.contextWindow) * 1000) / 10
        : null;

    base = {
      requestTitle: extractRequestSnippet(firstUserRow?.content),
      modelId: model.id,
      modelName: model.displayName,
      activeTokens,
      contextWindow: model.contextWindow,
      usedPercent,
      turnCount,
      checkpointCount,
      lastUpdated: latestPlanner?.created_at || new Date(mtimeMs).toISOString(),
    };
    summaryCache.set(cacheKey, { mtimeMs, base });
  }

  // Evaluate annotation outside transcript mtimeMs cache so newly flushed .pbtxt updates kind/title immediately
  const ann = readAnnotationInfo(conversationId, paths);
  const kind = classifyConversationKind(ann.exists, serviceInfo);
  const title =
    serviceInfo?.title ||
    ann.title ||
    base.requestTitle ||
    `Thread ${conversationId.slice(0, 8)}`;

  return {
    conversationId,
    title,
    kind,
    modelId: base.modelId,
    modelName: base.modelName,
    activeTokens: base.activeTokens,
    contextWindow: base.contextWindow,
    usedPercent: base.usedPercent,
    turnCount: base.turnCount,
    checkpointCount: base.checkpointCount,
    runState: serviceInfo?.runState || null,
    projectId: serviceInfo?.projectId || null,
    parentConversationId: serviceInfo?.parentConversationId || null,
    lastUpdated: base.lastUpdated,
    mtimeMs,
  };
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function resolveFileUriWorkspace(uri) {
  if (typeof uri !== "string" || !uri.startsWith("file://")) return null;
  try {
    const fsPath = fileURLToPath(uri);
    return validateWorkspaceDir(fsPath);
  } catch {
    return null;
  }
}

function safeRealFileUri(filePath, allowedRoot = null) {
  try {
    const real = fs.realpathSync(filePath);
    const st = fs.statSync(real);
    if (!st.isFile()) return null;
    if (allowedRoot) {
      const rootReal = fs.realpathSync(allowedRoot);
      if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
        return null;
      }
    }
    return pathToFileURL(real).href;
  } catch {
    return null;
  }
}

function resolveProjectWorkspacePath(projectJson) {
  const resources = projectJson?.projectResources?.resources;
  if (!Array.isArray(resources)) return null;
  for (const res of resources) {
    const uri =
      res?.gitFolder?.folderUri ||
      res?.localFolder?.folderUri ||
      res?.folderUri ||
      null;
    const resolved = resolveFileUriWorkspace(uri);
    if (resolved) return resolved;
  }
  return null;
}

export function listKnownWorkspaces(paths = resolvePaths()) {
  const byPath = new Map();
  try {
    for (const dirent of fs.readdirSync(paths.projectsDir, { withFileTypes: true })) {
      if (!dirent.isFile() || !dirent.name.endsWith(".json")) continue;
      const projectJson = readJsonSafe(path.join(paths.projectsDir, dirent.name));
      if (!projectJson || typeof projectJson !== "object") continue;
      const resolvedPath = resolveProjectWorkspacePath(projectJson);
      if (!resolvedPath) continue;

      const id =
        typeof projectJson.id === "string" && projectJson.id.trim()
          ? projectJson.id.trim()
          : dirent.name.replace(/\.json$/, "");
      const explicitName =
        typeof projectJson.name === "string" && projectJson.name.trim()
          ? projectJson.name.trim()
          : "";
      const hasExplicitName = Boolean(explicitName);
      const name = explicitName || path.basename(resolvedPath) || resolvedPath;

      const existing = byPath.get(resolvedPath);
      if (!existing || (!existing.hasExplicitName && hasExplicitName)) {
        byPath.set(resolvedPath, { id, name, path: resolvedPath, hasExplicitName });
      }
    }
  } catch {
    // Missing or unreadable projects directory
  }

  return Array.from(byPath.values())
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
    .slice(0, 50)
    .map(({ id, name, path: wsPath }) => ({ id, name, path: wsPath }));
}

function resolveWorkspaceRoot(
  { workspacePath, mcpRoots, projectId, savedWorkspacePath },
  paths,
) {
  const argWorkspace = validateWorkspaceDir(workspacePath);
  if (argWorkspace) {
    return { path: argWorkspace, source: "arg" };
  }

  if (isSafeSingleSegment(projectId)) {
    const projectJson = readJsonSafe(path.join(paths.projectsDir, `${projectId}.json`));
    const resolved = resolveProjectWorkspacePath(projectJson);
    if (resolved) {
      return { path: resolved, source: "project_id" };
    }
  }

  if (Array.isArray(mcpRoots)) {
    for (const uri of mcpRoots) {
      const resolved = resolveFileUriWorkspace(uri);
      if (resolved) {
        return { path: resolved, source: "mcp_roots" };
      }
    }
  }

  const savedWorkspace = validateWorkspaceDir(savedWorkspacePath);
  if (savedWorkspace) {
    return { path: savedWorkspace, source: "saved" };
  }

  return { path: null, source: "none" };
}

function resolveInsideWorkspace(wsRoot, candidatePath) {
  try {
    const real = fs.realpathSync(candidatePath);
    if (real !== wsRoot && !real.startsWith(wsRoot + path.sep)) return null;
    const st = fs.statSync(real);
    if (!st.isFile()) return null;
    return { real, size: st.size };
  } catch {
    return null;
  }
}

function inspectSkillMetadata(skillMdPath, fallbackName, scope) {
  let text = "";
  let fd = null;
  try {
    fd = fs.openSync(skillMdPath, "r");
    const buf = Buffer.allocUnsafe(SKILL_HEAD_READ_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, SKILL_HEAD_READ_BYTES, 0);
    text = buf.toString("utf8", 0, bytesRead);
  } catch {
    text = "";
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }

  let headerBytes = Math.min(text.length, 320);
  let name = fallbackName;
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    headerBytes = fm[1].length + 64;
    const nm = fm[1].match(/^name:\s*(.+)$/m);
    if (nm) name = nm[1].trim().replace(/^["']|["']$/g, "");
  }
  return {
    name,
    scope,
    estIndexTokens: Math.max(12, Math.round(headerBytes / 4)),
  };
}

export function scanLocalInventory({
  workspacePath,
  mcpRoots,
  projectId,
  savedWorkspacePath,
  geminiHome,
} = {}) {
  const paths = resolvePaths({ geminiHome });
  const configJson = readJsonSafe(path.join(paths.configDir, "config.json")) || {};
  const pluginConfigs =
    configJson?.plugins && typeof configJson.plugins === "object"
      ? configJson.plugins
      : {};

  // 1. Discover configured MCP server names from global config + installed plugins
  const configuredServers = new Set();
  const globalMcp = readJsonSafe(path.join(paths.configDir, "mcp_config.json"));
  if (globalMcp?.mcpServers && typeof globalMcp.mcpServers === "object") {
    for (const [name, cfg] of Object.entries(globalMcp.mcpServers)) {
      if (!cfg?.disabled) configuredServers.add(name);
    }
  }

  const pluginRules = [];
  const skills = [];

  try {
    for (const entry of fs.readdirSync(paths.pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(paths.pluginsDir, entry.name);
      const pluginJson = readJsonSafe(path.join(pluginDir, "plugin.json"));

      // config.json plugins[dirName].enabled -> plugins[pluginJson.name].enabled -> !pluginJson.disabled
      let enabled;
      if (typeof pluginConfigs[entry.name]?.enabled === "boolean") {
        enabled = pluginConfigs[entry.name].enabled;
      } else if (
        pluginJson?.name &&
        typeof pluginConfigs[pluginJson.name]?.enabled === "boolean"
      ) {
        enabled = pluginConfigs[pluginJson.name].enabled;
      } else {
        enabled = !pluginJson?.disabled;
      }
      if (!enabled) continue;

      const pluginMcp = readJsonSafe(path.join(pluginDir, "mcp_config.json"));
      if (pluginMcp?.mcpServers && typeof pluginMcp.mcpServers === "object") {
        for (const [srvName, cfg] of Object.entries(pluginMcp.mcpServers)) {
          if (!cfg?.disabled) {
            configuredServers.add(srvName);
            configuredServers.add(`${entry.name}_${srvName}`);
          }
        }
      }

      // Plugin rules
      const rulesDir = path.join(pluginDir, "rules");
      if (fs.existsSync(rulesDir)) {
        for (const rf of fs.readdirSync(rulesDir)) {
          if (!rf.endsWith(".md")) continue;
          const full = path.join(rulesDir, rf);
          try {
            const st = fs.statSync(full);
            if (st.isFile()) {
              const fileUri = safeRealFileUri(full, pluginDir);
              if (!fileUri) continue;
              pluginRules.push({
                name: `${entry.name}/${rf}`,
                scope: "plugin",
                bytes: st.size,
                estTokens: Math.round(st.size / 4),
                overPerFileCap: st.size > PER_FILE_RULE_BYTE_CAP,
                fileUri,
              });
            }
          } catch {}
        }
      }

      // Plugin skills
      const skillsDir = path.join(pluginDir, "skills");
      if (fs.existsSync(skillsDir)) {
        for (const sd of fs.readdirSync(skillsDir, { withFileTypes: true })) {
          if (!sd.isDirectory()) continue;
          const skillMd = path.join(skillsDir, sd.name, "SKILL.md");
          if (fs.existsSync(skillMd)) {
            skills.push(inspectSkillMetadata(skillMd, sd.name, `plugin:${entry.name}`));
          }
        }
      }
    }
  } catch {
    // Ignore missing plugins directory
  }

  // Global user skills
  const globalSkillsDir = path.join(paths.configDir, "skills");
  try {
    for (const sd of fs.readdirSync(globalSkillsDir, { withFileTypes: true })) {
      if (!sd.isDirectory()) continue;
      const skillMd = path.join(globalSkillsDir, sd.name, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        skills.push(inspectSkillMetadata(skillMd, sd.name, "global"));
      }
    }
  } catch {}

  // Builtin skills
  try {
    for (const sd of fs.readdirSync(paths.builtinSkillsDir, { withFileTypes: true })) {
      if (!sd.isDirectory()) continue;
      const skillMd = path.join(paths.builtinSkillsDir, sd.name, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        skills.push(inspectSkillMetadata(skillMd, sd.name, "builtin"));
      }
    }
  } catch {}

  // Global rule files
  const rules = [...pluginRules];
  for (const candidate of [
    { name: "~/.gemini/GEMINI.md", filePath: path.join(paths.geminiHome, "GEMINI.md"), scope: "global" },
    { name: "~/.gemini/config/AGENTS.md", filePath: path.join(paths.configDir, "AGENTS.md"), scope: "global" },
  ]) {
    try {
      const st = fs.statSync(candidate.filePath);
      if (st.isFile()) {
        const fileUri = safeRealFileUri(candidate.filePath, paths.geminiHome);
        if (!fileUri) continue;
        rules.push({
          name: candidate.name,
          scope: candidate.scope,
          bytes: st.size,
          estTokens: Math.round(st.size / 4),
          overPerFileCap: st.size > PER_FILE_RULE_BYTE_CAP,
          fileUri,
        });
      }
    } catch {}
  }

  // Workspace rules and skills
  const workspace = resolveWorkspaceRoot(
    { workspacePath, mcpRoots, projectId, savedWorkspacePath },
    paths,
  );
  if (workspace.path) {
    const seenRuleRealPaths = new Set();
    const seenSkillRealPaths = new Set();

    for (const rootRuleName of ["GEMINI.md", "AGENTS.md"]) {
      const resolved = resolveInsideWorkspace(
        workspace.path,
        path.join(workspace.path, rootRuleName),
      );
      if (resolved && !seenRuleRealPaths.has(resolved.real)) {
        seenRuleRealPaths.add(resolved.real);
        rules.push({
          name: rootRuleName,
          scope: "workspace",
          bytes: resolved.size,
          estTokens: Math.round(resolved.size / 4),
          overPerFileCap: resolved.size > PER_FILE_RULE_BYTE_CAP,
          fileUri: pathToFileURL(resolved.real).href,
        });
      }
    }

    for (const customDir of WORKSPACE_CUSTOMIZATION_DIRS) {
      const wsRulesDir = path.join(workspace.path, customDir, "rules");
      try {
        for (const rf of fs.readdirSync(wsRulesDir)) {
          if (!rf.endsWith(".md")) continue;
          const resolved = resolveInsideWorkspace(
            workspace.path,
            path.join(wsRulesDir, rf),
          );
          if (resolved && !seenRuleRealPaths.has(resolved.real)) {
            seenRuleRealPaths.add(resolved.real);
            rules.push({
              name: `${customDir}/rules/${rf}`,
              scope: "workspace",
              bytes: resolved.size,
              estTokens: Math.round(resolved.size / 4),
              overPerFileCap: resolved.size > PER_FILE_RULE_BYTE_CAP,
              fileUri: pathToFileURL(resolved.real).href,
            });
          }
        }
      } catch {}

      const wsSkillsDir = path.join(workspace.path, customDir, "skills");
      try {
        for (const sd of fs.readdirSync(wsSkillsDir, { withFileTypes: true })) {
          if (!sd.isDirectory() && !sd.isSymbolicLink()) continue;
          const resolved = resolveInsideWorkspace(
            workspace.path,
            path.join(wsSkillsDir, sd.name, "SKILL.md"),
          );
          if (resolved && !seenSkillRealPaths.has(resolved.real)) {
            seenSkillRealPaths.add(resolved.real);
            skills.push(inspectSkillMetadata(resolved.real, sd.name, "workspace"));
          }
        }
      } catch {}
    }
  }

  // 2. Scan cached MCP tool schema files under ~/.gemini/antigravity/mcp/
  const mcpServers = [];
  let totalMcpTools = 0;
  let totalMcpSchemaBytes = 0;
  let totalMcpInstructionBytes = 0;

  try {
    for (const entry of fs.readdirSync(paths.mcpSchemasDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const srvDir = path.join(paths.mcpSchemasDir, entry.name);
      let toolCount = 0;
      let schemaBytes = 0;
      let instructionBytes = 0;

      for (const file of fs.readdirSync(srvDir)) {
        const full = path.join(srvDir, file);
        try {
          const st = fs.statSync(full);
          if (!st.isFile()) continue;
          if (file.endsWith(".json")) {
            toolCount += 1;
            schemaBytes += st.size;
          } else if (file === "instructions.md") {
            instructionBytes += st.size;
          }
        } catch {}
      }

      const active = configuredServers.has(entry.name);
      totalMcpTools += toolCount;
      totalMcpSchemaBytes += schemaBytes;
      totalMcpInstructionBytes += instructionBytes;

      mcpServers.push({
        name: entry.name,
        toolCount,
        hasInstructions: instructionBytes > 0,
        active,
        estSchemaTokens: Math.round(schemaBytes / 4),
        estInstructionTokens: Math.round(instructionBytes / 4),
      });
    }
  } catch {
    // Ignore missing MCP schema directory
  }

  // Sort active servers first, then by tool count descending
  mcpServers.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (b.toolCount !== a.toolCount) return b.toolCount - a.toolCount;
    return a.name.localeCompare(b.name);
  });

  const activeMcpServers = mcpServers.filter((s) => s.active);
  const activeMcpTools = activeMcpServers.reduce((acc, s) => acc + s.toolCount, 0);
  const activeMcpEstTokens = activeMcpServers.reduce(
    (acc, s) => acc + s.estSchemaTokens + s.estInstructionTokens,
    0,
  );

  // Compute aggregate totals before slicing
  const totalRuleCount = rules.length;
  const totalRuleTokens = rules.reduce((acc, r) => acc + r.estTokens, 0);
  rules.sort((a, b) => b.estTokens - a.estTokens || a.name.localeCompare(b.name));

  const totalSkillCount = skills.length;
  const totalSkillIndexTokens = skills.reduce((acc, s) => acc + s.estIndexTokens, 0);
  const byScope = {
    workspace: skills.filter((s) => s.scope === "workspace").length,
    plugin: skills.filter((s) => s.scope.startsWith("plugin:")).length,
    global: skills.filter((s) => s.scope === "global").length,
    builtin: skills.filter((s) => s.scope === "builtin").length,
  };
  skills.sort(
    (a, b) => b.estIndexTokens - a.estIndexTokens || a.name.localeCompare(b.name),
  );

  return {
    workspace,
    knownWorkspaces: listKnownWorkspaces(paths),
    mcp: {
      servers: mcpServers.slice(0, 100),
      activeServerCount: activeMcpServers.length,
      cachedServerCount: mcpServers.length,
      activeToolCount: activeMcpTools,
      totalCachedToolCount: totalMcpTools,
      activeEstTokens: activeMcpEstTokens,
      totalCachedEstTokens: Math.round((totalMcpSchemaBytes + totalMcpInstructionBytes) / 4),
      instructionEstTokens: Math.round(totalMcpInstructionBytes / 4),
    },
    rules: {
      items: rules.slice(0, 80),
      count: totalRuleCount,
      estTokens: totalRuleTokens,
    },
    skills: {
      count: totalSkillCount,
      estIndexTokens: totalSkillIndexTokens,
      byScope,
      items: skills.slice(0, 80),
    },
  };
}

function scanBrainTranscripts(paths) {
  const transcriptEntries = [];
  const seenTranscriptPaths = new Set();
  try {
    for (const dirent of fs.readdirSync(paths.brainDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const cid = dirent.name;
      if (!isSafeSingleSegment(cid)) continue;
      const tPath = path.join(
        paths.brainDir,
        cid,
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      try {
        const st = fs.statSync(tPath);
        if (st.isFile() && st.size > 0) {
          const resolvedTPath = path.resolve(tPath);
          seenTranscriptPaths.add(resolvedTPath);
          transcriptEntries.push({
            conversationId: cid,
            transcriptPath: tPath,
            mtimeMs: st.mtimeMs,
          });
        }
      } catch {
        // Not a conversation with a transcript
      }
    }
  } catch {
    // Brain directory missing
  }

  // Evict deleted brain directories from summaryCache for this brain root
  const brainPrefix = path.resolve(paths.brainDir) + path.sep;
  for (const cachedKey of summaryCache.keys()) {
    if (cachedKey.startsWith(brainPrefix) && !seenTranscriptPaths.has(cachedKey)) {
      summaryCache.delete(cachedKey);
    }
  }

  transcriptEntries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return transcriptEntries;
}

export async function getContextSnapshot({
  conversationId,
  limit = 35,
  includeSubagents = false,
  includeDetails = true,
  workspacePath,
  savedWorkspacePath,
  mcpRoots,
  geminiHome,
} = {}) {
  const paths = resolvePaths({ geminiHome });
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 35));
  const { map: serviceMap, status: serviceStatus } = await fetchConversationServiceTitles(200);
  const transcriptEntries = scanBrainTranscripts(paths);

  const candidateEntries = [];
  if (includeSubagents) {
    for (const entry of transcriptEntries) {
      if (candidateEntries.length >= safeLimit) break;
      candidateEntries.push(entry);
    }
  } else {
    for (const entry of transcriptEntries) {
      const pbtxtPath = path.join(paths.annotationsDir, `${entry.conversationId}.pbtxt`);
      const hasAnnotation = fs.existsSync(pbtxtPath);
      const kind = classifyConversationKind(
        hasAnnotation,
        serviceMap.get(entry.conversationId),
      );
      if (kind !== "interactive") continue;
      candidateEntries.push(entry);
      if (candidateEntries.length >= safeLimit) break;
    }
  }

  const conversations = [];
  for (const entry of candidateEntries) {
    const summary = summarizeConversationFast(
      entry.conversationId,
      entry.transcriptPath,
      entry.mtimeMs,
      serviceMap.get(entry.conversationId),
      paths,
    );
    if (summary) conversations.push(summary);
  }

  const validRequestedId = isSafeSingleSegment(conversationId);
  let selectedEntry = null;
  let requestedConversationFound = true;

  if (conversationId !== undefined && conversationId !== null && conversationId !== "") {
    if (!validRequestedId) {
      requestedConversationFound = false;
    } else {
      selectedEntry =
        transcriptEntries.find((e) => e.conversationId === conversationId) || null;
      if (!selectedEntry) {
        requestedConversationFound = false;
      }
    }
  } else if (conversationId === "") {
    requestedConversationFound = false;
  }

  if (!selectedEntry) {
    selectedEntry = candidateEntries[0] || transcriptEntries[0] || null;
  }

  let current = null;
  let selectedProjectId = null;
  if (selectedEntry) {
    const { rows, usedFullTranscript } = loadBestTranscriptRows(
      selectedEntry.conversationId,
      selectedEntry.transcriptPath,
      paths,
    );
    const svc = serviceMap.get(selectedEntry.conversationId);
    const ann = readAnnotationInfo(selectedEntry.conversationId, paths);
    const selectedKind = classifyConversationKind(ann.exists, svc);
    selectedProjectId = svc?.projectId || null;

    current = analyzeTranscriptRows(
      selectedEntry.conversationId,
      rows,
      new Date(selectedEntry.mtimeMs).toISOString(),
      svc?.title || null,
      svc?.runState || null,
      usedFullTranscript,
      {
        includeDetails,
        kind: selectedKind,
        annotationTitle: ann.title,
        paths,
      },
    );
    if (includeDetails) {
      current.artifacts = scanConversationArtifacts(selectedEntry.conversationId, paths);
    }
  }

  const resolvedMcpRoots = await mcpRoots;
  const inventory = scanLocalInventory({
    workspacePath,
    mcpRoots: resolvedMcpRoots,
    projectId: selectedProjectId,
    savedWorkspacePath,
    geminiHome,
  });

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    serviceStatus,
    totalTrackedConversations: transcriptEntries.length,
    selectedConversationId: current?.conversationId || null,
    requestedConversationFound,
    current,
    conversations,
    inventory,
  };
}

export async function listConversations({
  query = "",
  kind = "interactive",
  filter = "all",
  sort = "recent",
  offset = 0,
  limit = 35,
  geminiHome,
} = {}) {
  const paths = resolvePaths({ geminiHome });
  const { map: serviceMap, status: serviceStatus } = await fetchConversationServiceTitles(200);
  const transcriptEntries = scanBrainTranscripts(paths);

  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  const safeKind = ["interactive", "all", "subagent", "background"].includes(kind)
    ? kind
    : "interactive";
  const safeFilter = ["all", "high_usage", "checkpointed", "running"].includes(filter)
    ? filter
    : "all";
  const safeSort = ["recent", "usage_desc", "tokens_desc", "checkpoints_desc"].includes(sort)
    ? sort
    : "recent";
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 35)));

  const interactiveEntries = [];
  const nonInteractiveEntries = [];
  for (const entry of transcriptEntries) {
    const pbtxtPath = path.join(paths.annotationsDir, `${entry.conversationId}.pbtxt`);
    const hasAnnotation = fs.existsSync(pbtxtPath);
    const svc = serviceMap.get(entry.conversationId);
    const entryKind = classifyConversationKind(hasAnnotation, svc);
    if (entryKind === "interactive") {
      interactiveEntries.push({ ...entry, entryKind, svc });
    } else {
      nonInteractiveEntries.push({ ...entry, entryKind, svc });
    }
  }

  const interactiveSummaries = [];
  let highUsageInteractiveCount = 0;
  let checkpointedInteractiveCount = 0;
  let runningCount = 0;

  for (const entry of interactiveEntries) {
    const summary = summarizeConversationFast(
      entry.conversationId,
      entry.transcriptPath,
      entry.mtimeMs,
      entry.svc,
      paths,
    );
    if (!summary) continue;
    interactiveSummaries.push(summary);
    if (summary.usedPercent !== null && summary.usedPercent >= 70) {
      highUsageInteractiveCount += 1;
    }
    if (summary.checkpointCount > 0) {
      checkpointedInteractiveCount += 1;
    }
    if (summary.runState === "RUN_STATE_RUNNING") {
      runningCount += 1;
    }
  }

  const fleet = {
    totalTracked: transcriptEntries.length,
    interactiveCount: interactiveEntries.length,
    nonInteractiveCount: transcriptEntries.length - interactiveEntries.length,
    highUsageInteractiveCount,
    checkpointedInteractiveCount,
    runningCount,
    fleetScope: "interactive",
  };

  let pool = [];
  if (safeKind === "interactive") {
    pool = interactiveSummaries;
  } else {
    if (safeKind === "all") {
      pool = [...interactiveSummaries];
    }
    for (const entry of nonInteractiveEntries) {
      if (safeKind === "subagent" && entry.entryKind !== "subagent") continue;
      if (safeKind === "background" && entry.entryKind !== "background") continue;
      if (safeFilter === "running" && entry.svc?.runState !== "RUN_STATE_RUNNING") {
        continue;
      }
      const summary = summarizeConversationFast(
        entry.conversationId,
        entry.transcriptPath,
        entry.mtimeMs,
        entry.svc,
        paths,
      );
      if (summary) pool.push(summary);
    }
  }

  if (safeFilter === "high_usage") {
    pool = pool.filter((item) => item.usedPercent !== null && item.usedPercent >= 70);
  } else if (safeFilter === "checkpointed") {
    pool = pool.filter((item) => item.checkpointCount > 0);
  } else if (safeFilter === "running") {
    pool = pool.filter((item) => item.runState === "RUN_STATE_RUNNING");
  }

  if (q) {
    pool = pool.filter((item) => {
      const fields = [item.title, item.conversationId, item.modelName, item.modelId];
      return fields.some((f) => typeof f === "string" && f.toLowerCase().includes(q));
    });
  }

  if (safeSort === "usage_desc") {
    pool.sort((a, b) => {
      const aNull = a.usedPercent === null;
      const bNull = b.usedPercent === null;
      if (aNull !== bNull) return aNull ? 1 : -1;
      if (!aNull && b.usedPercent !== a.usedPercent) {
        return b.usedPercent - a.usedPercent;
      }
      return b.mtimeMs - a.mtimeMs;
    });
  } else if (safeSort === "tokens_desc") {
    pool.sort((a, b) => b.activeTokens - a.activeTokens || b.mtimeMs - a.mtimeMs);
  } else if (safeSort === "checkpoints_desc") {
    pool.sort((a, b) => b.checkpointCount - a.checkpointCount || b.mtimeMs - a.mtimeMs);
  } else {
    pool.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  const items = pool.slice(safeOffset, safeOffset + safeLimit);
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    serviceStatus,
    fleet,
    totalMatching: pool.length,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + items.length < pool.length,
    items,
  };
}
