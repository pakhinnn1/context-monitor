import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GEMINI_HOME = path.join(os.homedir(), ".gemini");
const ANTIGRAVITY_DIR = path.join(GEMINI_HOME, "antigravity");
const BRAIN_DIR = path.join(ANTIGRAVITY_DIR, "brain");
const ANNOTATIONS_DIR = path.join(ANTIGRAVITY_DIR, "annotations");
const MCP_SCHEMAS_DIR = path.join(ANTIGRAVITY_DIR, "mcp");
const CONFIG_DIR = path.join(GEMINI_HOME, "config");
const PLUGINS_DIR = path.join(CONFIG_DIR, "plugins");
const BUILTIN_SKILLS_DIR = path.join(ANTIGRAVITY_DIR, "builtin", "skills");

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

// Lightweight mtime cache for parsed conversation summaries
const summaryCache = new Map();

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

function readAnnotationTitle(conversationId) {
  const filePath = path.join(ANNOTATIONS_DIR, `${conversationId}.pbtxt`);
  try {
    const text = fs.readFileSync(filePath, "utf8");
    const m = text.match(/title:\s*"((?:[^"\\]|\\.)*)"/);
    if (m && m[1]) {
      const cleaned = unescapePbtxtString(m[1]);
      if (cleaned) return cleaned;
    }
  } catch {
    // Missing annotation file is normal for subagents or untitled threads
  }
  return null;
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

async function fetchConversationServiceTitles(limit = 50) {
  const lsAddress = process.env.ANTIGRAVITY_LS_ADDRESS;
  const csrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (!lsAddress || !csrfToken) return new Map();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 350);
  try {
    const res = await fetch(
      `http://${lsAddress}/product.v1.ConversationService/ListConversations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
          "x-antigravity-csrf-token": csrfToken,
        },
        body: JSON.stringify({ pageSize: limit, includeArchived: false }),
        signal: controller.signal,
      },
    );
    if (!res.ok) return new Map();
    const data = await res.json();
    const map = new Map();
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
      });
    }
    return map;
  } catch {
    return new Map();
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

function estimateRowChars(row) {
  let chars = 0;
  if (typeof row.content === "string") chars += row.content.length;
  if (typeof row.thinking === "string") chars += row.thinking.length;
  if (Array.isArray(row.tool_calls)) {
    for (const call of row.tool_calls) {
      try {
        chars += JSON.stringify(call).length;
      } catch {
        chars += 120;
      }
    }
  }
  return chars;
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

  let leftover = total - assigned;
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

function loadBestTranscriptRows(conversationId, compactPath) {
  const fullPath = path.join(
    BRAIN_DIR,
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
  return {
    rows: parseJsonlFile(compactPath),
    usedFullTranscript: false,
  };
}

function analyzeTranscriptRows(conversationId, rows, mtimeIso, titleOverride, runState, usedFullTranscript) {
  let firstUserRow = null;
  let firstPlannerIdx = -1;
  let latestPlannerIdx = -1;
  let lastCheckpointIdx = -1;
  let checkpointCount = 0;
  let turnCount = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.type === "USER_INPUT" && !firstUserRow) {
      firstUserRow = row;
    } else if (row.type === "CHECKPOINT") {
      checkpointCount += 1;
      lastCheckpointIdx = i;
    } else if (row.type === "PLANNER_RESPONSE") {
      const hasTokens =
        typeof row.input_tokens === "number" ||
        typeof row.cache_read_tokens === "number";
      if (hasTokens) {
        if (firstPlannerIdx === -1) firstPlannerIdx = i;
        latestPlannerIdx = i;
        turnCount += 1;
      }
      if (typeof row.output_tokens === "number") {
        totalOutputTokens += row.output_tokens;
      }
    }
  }

  const annotationTitle = readAnnotationTitle(conversationId);
  const requestTitle = extractRequestSnippet(firstUserRow?.content);
  const title =
    titleOverride ||
    annotationTitle ||
    requestTitle ||
    `Thread ${conversationId.slice(0, 8)}`;

  if (latestPlannerIdx === -1) {
    const model = resolveModelInfo(null);
    return {
      conversationId,
      title,
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
        freeTokens: null,
        freePercent: null,
        usedPercent: null,
      },
      segments: [],
      hasUsageData: false,
    };
  }

  const firstPlanner = rows[firstPlannerIdx];
  const latestPlanner = rows[latestPlannerIdx];

  const inputTokens = Number(latestPlanner.input_tokens || 0);
  const cacheReadTokens = Number(latestPlanner.cache_read_tokens || 0);
  const activeTokens = inputTokens + cacheReadTokens;
  const lastOutputTokens = Number(latestPlanner.output_tokens || 0);
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
  const firstTotal =
    Number(firstPlanner.input_tokens || 0) +
    Number(firstPlanner.cache_read_tokens || 0);
  const firstUserRawEst = Math.round(estimateRowChars(firstUserRow || {}) / 4);
  const firstUserEst = Math.min(firstUserRawEst, Math.floor(firstTotal * 0.6));
  const turn1Baseline = Math.max(0, firstTotal - firstUserEst);

  let baselineEst = 0;
  let checkpointSummaryEst = 0;
  let initialMessagesEst = 0;
  let anchorIdx = firstPlannerIdx;
  let anchorTotal = firstTotal;

  if (lastCheckpointIdx >= 0) {
    let postCpPlannerIdx = -1;
    for (let i = lastCheckpointIdx + 1; i < rows.length; i += 1) {
      if (
        rows[i].type === "PLANNER_RESPONSE" &&
        (typeof rows[i].input_tokens === "number" ||
          typeof rows[i].cache_read_tokens === "number")
      ) {
        postCpPlannerIdx = i;
        break;
      }
    }

    if (postCpPlannerIdx !== -1) {
      const postCp = rows[postCpPlannerIdx];
      const postCpTotal =
        Number(postCp.input_tokens || 0) +
        Number(postCp.cache_read_tokens || 0);
      baselineEst = Math.min(turn1Baseline, postCpTotal, activeTokens);
      checkpointSummaryEst = Math.min(
        Math.max(0, postCpTotal - baselineEst),
        Math.max(0, activeTokens - baselineEst),
      );
      anchorIdx = postCpPlannerIdx;
      anchorTotal = baselineEst + checkpointSummaryEst;
    } else {
      baselineEst = Math.min(turn1Baseline, activeTokens);
      checkpointSummaryEst = 0;
      anchorIdx = lastCheckpointIdx;
      anchorTotal = baselineEst;
    }
  } else {
    baselineEst = Math.min(turn1Baseline, activeTokens);
    initialMessagesEst = Math.min(firstUserEst, Math.max(0, activeTokens - baselineEst));
    anchorIdx = firstPlannerIdx;
    anchorTotal = baselineEst + initialMessagesEst;
  }

  let toolChars = 0;
  let messageChars = 0;
  let systemChars = 0;

  for (let i = anchorIdx + 1; i <= latestPlannerIdx; i += 1) {
    const row = rows[i];
    const chars = Math.max(1, estimateRowChars(row));
    if (row.type === "GENERIC") {
      toolChars += chars;
    } else if (row.type === "USER_INPUT" || row.type === "PLANNER_RESPONSE") {
      messageChars += chars;
    } else if (row.type === "SYSTEM_MESSAGE" || row.type === "ERROR_MESSAGE") {
      systemChars += chars;
    }
  }

  // Include anchor turn's own output/tool calls in subsequent growth weight
  if (latestPlannerIdx > anchorIdx) {
    const anchorRow = rows[anchorIdx];
    if (anchorRow && anchorRow.type === "PLANNER_RESPONSE") {
      messageChars += estimateRowChars(anchorRow);
    }
  }

  const deltaTokens = Math.max(0, activeTokens - anchorTotal);
  const deltaWeights =
    toolChars + messageChars + systemChars > 0
      ? { toolOutputs: toolChars, messages: messageChars, systemMessages: systemChars }
      : { toolOutputs: 0, messages: deltaTokens > 0 ? 1 : 0, systemMessages: 0 };

  const allocated = allocateProportionally(deltaTokens, deltaWeights);
  const messagesTokens = initialMessagesEst + allocated.messages;
  const toolOutputsTokens = allocated.toolOutputs;
  const systemMessagesTokens = allocated.systemMessages;

  const rawSegments = [
    {
      id: "baseline",
      label: "System & baseline",
      tokens: baselineEst,
      percent: null,
      colorKey: "blue",
      kind: "estimated",
      detail:
        "Local estimate derived from Turn 1 prompt size minus the first user prompt. Covers system prompt, built-in tools, MCP index, rules, and skill headers.",
    },
    {
      id: "tool_outputs",
      label: "Tool outputs",
      tokens: toolOutputsTokens,
      percent: null,
      colorKey: "orange",
      kind: "estimated",
      detail:
        lastCheckpointIdx >= 0
          ? "Local estimate allocating post-checkpoint prompt growth by tool output character share."
          : "Local estimate allocating prompt growth since Turn 1 by tool output character share.",
    },
    {
      id: "messages",
      label: "Messages",
      tokens: messagesTokens,
      percent: null,
      colorKey: "green",
      kind: "estimated",
      detail:
        "Local estimate covering user prompts, assistant replies, thinking summaries, and tool call payloads.",
    },
  ];

  if (checkpointSummaryEst > 0) {
    rawSegments.push({
      id: "checkpoint_summary",
      label: "Checkpoint summary",
      tokens: checkpointSummaryEst,
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

  const segments = rawSegments;

  return {
    conversationId,
    title,
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
      turnCount,
      checkpointCount,
      freeTokens,
      freePercent,
      usedPercent: adjustedUsedPercent,
    },
    segments,
    hasUsageData: true,
  };
}

function summarizeConversationFast(conversationId, transcriptPath, mtimeMs, serviceInfo) {
  const cached = summaryCache.get(conversationId);
  if (cached && cached.mtimeMs === mtimeMs) {
    return {
      ...cached.summary,
      title: serviceInfo?.title || cached.summary.title,
      runState: serviceInfo?.runState || cached.summary.runState,
    };
  }

  let firstUserRow = null;
  let latestPlanner = null;
  let checkpointCount = 0;

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
          }
        } catch {}
      }
    }
  } catch {
    return null;
  }

  const annotationTitle = readAnnotationTitle(conversationId);
  const requestTitle = extractRequestSnippet(firstUserRow?.content);
  const title =
    serviceInfo?.title ||
    annotationTitle ||
    requestTitle ||
    `Thread ${conversationId.slice(0, 8)}`;

  const activeTokens = latestPlanner
    ? Number(latestPlanner.input_tokens || 0) +
      Number(latestPlanner.cache_read_tokens || 0)
    : 0;
  const model = resolveModelInfo(latestPlanner?.model || null);
  const usedPercent =
    model.contextWindow && activeTokens > 0
      ? Math.round((activeTokens / model.contextWindow) * 1000) / 10
      : null;

  const summary = {
    conversationId,
    title,
    modelId: model.id,
    modelName: model.displayName,
    activeTokens,
    contextWindow: model.contextWindow,
    usedPercent,
    checkpointCount,
    runState: serviceInfo?.runState || null,
    lastUpdated: latestPlanner?.created_at || new Date(mtimeMs).toISOString(),
    mtimeMs,
  };

  summaryCache.set(conversationId, { mtimeMs, summary });
  return summary;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function scanLocalInventory() {
  // 1. Discover configured MCP server names from global config + installed plugins
  const configuredServers = new Set();
  const globalMcp = readJsonSafe(path.join(CONFIG_DIR, "mcp_config.json"));
  if (globalMcp?.mcpServers && typeof globalMcp.mcpServers === "object") {
    for (const [name, cfg] of Object.entries(globalMcp.mcpServers)) {
      if (!cfg?.disabled) configuredServers.add(name);
    }
  }

  const pluginRules = [];
  const skills = [];

  try {
    for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(PLUGINS_DIR, entry.name);
      const pluginJson = readJsonSafe(path.join(pluginDir, "plugin.json"));
      if (pluginJson?.disabled) continue;

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
              pluginRules.push({
                name: `${entry.name}/${rf}`,
                scope: "plugin",
                bytes: st.size,
                estTokens: Math.round(st.size / 4),
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
  const globalSkillsDir = path.join(CONFIG_DIR, "skills");
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
    for (const sd of fs.readdirSync(BUILTIN_SKILLS_DIR, { withFileTypes: true })) {
      if (!sd.isDirectory()) continue;
      const skillMd = path.join(BUILTIN_SKILLS_DIR, sd.name, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        skills.push(inspectSkillMetadata(skillMd, sd.name, "builtin"));
      }
    }
  } catch {}

  // Global rule files
  const rules = [...pluginRules];
  for (const candidate of [
    { name: "~/.gemini/GEMINI.md", filePath: path.join(GEMINI_HOME, "GEMINI.md"), scope: "global" },
    { name: "~/.gemini/config/AGENTS.md", filePath: path.join(CONFIG_DIR, "AGENTS.md"), scope: "global" },
  ]) {
    try {
      const st = fs.statSync(candidate.filePath);
      if (st.isFile()) {
        rules.push({
          name: candidate.name,
          scope: candidate.scope,
          bytes: st.size,
          estTokens: Math.round(st.size / 4),
        });
      }
    } catch {}
  }

  // 2. Scan cached MCP tool schema files under ~/.gemini/antigravity/mcp/
  const mcpServers = [];
  let totalMcpTools = 0;
  let totalMcpSchemaBytes = 0;
  let totalMcpInstructionBytes = 0;

  try {
    for (const entry of fs.readdirSync(MCP_SCHEMAS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const srvDir = path.join(MCP_SCHEMAS_DIR, entry.name);
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

  const totalRuleTokens = rules.reduce((acc, r) => acc + r.estTokens, 0);
  const totalSkillIndexTokens = skills.reduce((acc, s) => acc + s.estIndexTokens, 0);

  return {
    mcp: {
      servers: mcpServers,
      activeServerCount: activeMcpServers.length,
      cachedServerCount: mcpServers.length,
      activeToolCount: activeMcpTools,
      totalCachedToolCount: totalMcpTools,
      activeEstTokens: activeMcpEstTokens,
      totalCachedEstTokens: Math.round((totalMcpSchemaBytes + totalMcpInstructionBytes) / 4),
      instructionEstTokens: Math.round(totalMcpInstructionBytes / 4),
    },
    rules: {
      items: rules,
      count: rules.length,
      estTokens: totalRuleTokens,
    },
    skills: {
      count: skills.length,
      estIndexTokens: totalSkillIndexTokens,
      byScope: {
        global: skills.filter((s) => s.scope === "global").length,
        plugin: skills.filter((s) => s.scope.startsWith("plugin:")).length,
        builtin: skills.filter((s) => s.scope === "builtin").length,
      },
      items: skills
        .sort((a, b) => b.estIndexTokens - a.estIndexTokens)
        .slice(0, 60),
    },
  };
}

function inspectSkillMetadata(skillMdPath, fallbackName, scope) {
  let text = "";
  try {
    text = fs.readFileSync(skillMdPath, "utf8");
  } catch {}
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

export async function getContextSnapshot({ conversationId, limit = 35 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 35));
  const serviceMap = await fetchConversationServiceTitles(Math.max(safeLimit, 50));

  const transcriptEntries = [];
  try {
    for (const dirent of fs.readdirSync(BRAIN_DIR, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const cid = dirent.name;
      const tPath = path.join(
        BRAIN_DIR,
        cid,
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      try {
        const st = fs.statSync(tPath);
        if (st.isFile() && st.size > 0) {
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

  transcriptEntries.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const recentEntries = transcriptEntries.slice(0, safeLimit);
  const conversations = [];
  for (const entry of recentEntries) {
    const summary = summarizeConversationFast(
      entry.conversationId,
      entry.transcriptPath,
      entry.mtimeMs,
      serviceMap.get(entry.conversationId),
    );
    if (summary) conversations.push(summary);
  }

  let selectedEntry = null;
  if (conversationId) {
    selectedEntry =
      transcriptEntries.find((e) => e.conversationId === conversationId) || null;
  }
  if (!selectedEntry && transcriptEntries.length > 0) {
    selectedEntry = transcriptEntries[0];
  }

  let current = null;
  if (selectedEntry) {
    const { rows, usedFullTranscript } = loadBestTranscriptRows(
      selectedEntry.conversationId,
      selectedEntry.transcriptPath,
    );
    const svc = serviceMap.get(selectedEntry.conversationId);
    current = analyzeTranscriptRows(
      selectedEntry.conversationId,
      rows,
      new Date(selectedEntry.mtimeMs).toISOString(),
      svc?.title || null,
      svc?.runState || null,
      usedFullTranscript,
    );
  }

  const inventory = scanLocalInventory();

  return {
    generatedAt: new Date().toISOString(),
    totalTrackedConversations: transcriptEntries.length,
    selectedConversationId: current?.conversationId || null,
    requestedConversationFound: conversationId ? Boolean(selectedEntry && selectedEntry.conversationId === conversationId) : true,
    current,
    conversations,
    inventory,
  };
}
