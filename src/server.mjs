import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  getContextSnapshot,
  listConversations,
  validateWorkspaceDir,
} from "./analyzer.mjs";
import {
  loadPreferences,
  resolveDataDir,
  savePreferences,
} from "./preferences.mjs";

const APP_URI = "ui://context-monitor/app.html";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let cachedMcpRoots = null;
const dataDir = resolveDataDir();
let currentPreferences = loadPreferences(dataDir);

function getPreferencesPayload() {
  return {
    workspacePath: currentPreferences.workspacePath,
    includeSubagents: currentPreferences.includeSubagents,
    persisted: currentPreferences.persisted,
  };
}

function loadAppHtml() {
  const overridePath = process.env.CONTEXT_MONITOR_HTML;
  const candidates = [
    overridePath,
    path.resolve(__dirname, "app.html"),
    path.resolve(__dirname, "..", "dist", "app.html"),
  ].filter(Boolean);

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf8");
      }
    } catch {
      // Try next candidate
    }
  }
  throw new Error(
    `Context Monitor UI HTML not found. Checked: ${candidates.join(", ")}`,
  );
}

async function resolveMcpRoots(mcpServer, { workspacePath } = {}) {
  if (validateWorkspaceDir(workspacePath)) {
    return undefined;
  }

  const rootsCap = mcpServer.server.getClientCapabilities()?.roots;
  if (!rootsCap) {
    return [];
  }

  if (cachedMcpRoots !== null && rootsCap.listChanged === true) {
    return cachedMcpRoots;
  }

  try {
    const result = await mcpServer.server.listRoots(undefined, { timeout: 250 });
    const uris = Array.isArray(result?.roots)
      ? result.roots.map((r) => r?.uri).filter((u) => typeof u === "string")
      : [];
    if (uris.length > 0 && rootsCap.listChanged === true) {
      cachedMcpRoots = uris;
    }
    return uris;
  } catch {
    return [];
  }
}

function formatSummaryText(snapshot) {
  const svc = snapshot.serviceStatus;
  const svcLine =
    svc && !svc.reachable
      ? `\nConversationService: offline (${svc.reason})`
      : svc?.reason === "partial"
        ? `\nConversationService: partial (${svc.enrichedCount} enriched)`
        : "";

  const cur = snapshot.current;
  if (!cur) {
    return `No local Antigravity conversation transcripts were found under ~/.gemini/antigravity/brain.${svcLine}`;
  }
  if (!cur.hasUsageData) {
    return `Conversation "${cur.title}" (${cur.conversationId}) has no recorded planner token usage yet.${svcLine}`;
  }
  const ex = cur.exact;
  const win = cur.model.contextWindow
    ? `${ex.usedPercent}% of ${cur.model.contextWindow.toLocaleString("en-US")} (${cur.model.windowSource})`
    : `unknown context window (${cur.model.windowSource})`;
  return (
    [
      `Context Monitor: ${cur.title}`,
      `Model: ${cur.model.displayName} (${cur.model.id})`,
      `Active prompt (exact): ${ex.activeTokens.toLocaleString("en-US")} tokens — ${win}`,
      `Cache split (exact): ${ex.cacheReadTokens.toLocaleString("en-US")} cached (${ex.cacheHitPercent}%) + ${ex.inputTokens.toLocaleString("en-US")} uncached`,
      `Turns: ${ex.turnCount} | Checkpoints: ${ex.checkpointCount} | Session output: ${ex.totalOutputTokens.toLocaleString("en-US")}`,
      `Tracked conversations: ${snapshot.conversations.length} shown / ${snapshot.totalTrackedConversations} tracked`,
      `Local MCP inventory: ${snapshot.inventory.mcp.activeToolCount} configured tools (${snapshot.inventory.mcp.totalCachedToolCount} cached schemas on disk)`,
    ].join("\n") + svcLine
  );
}

const server = new McpServer({
  name: "context-monitor",
  version: "0.2.0",
});

server.server.setNotificationHandler(RootsListChangedNotificationSchema, () => {
  cachedMcpRoots = null;
});

registerAppResource(
  server,
  "Context Monitor UI",
  APP_URI,
  {
    description: "Interactive Context usage panel for Antigravity Desktop.",
    mimeType: RESOURCE_MIME_TYPE,
    _meta: {
      ui: {
        prefersBorder: false,
      },
    },
  },
  async () => {
    const html = loadAppHtml();
    return {
      contents: [
        {
          uri: APP_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: {
              prefersBorder: false,
            },
          },
        },
      ],
    };
  },
);

registerAppTool(
  server,
  "open_context_monitor",
  {
    title: "Context",
    description:
      "Open the Antigravity Context usage panel showing exact transcript token counters, prompt cache split, compaction checkpoints, local category estimates, and configured MCP/rules inventory.",
    inputSchema: {
      conversationId: z
        .string()
        .optional()
        .describe(
          "Optional conversation ID to inspect. Defaults to the most recently modified interactive transcript.",
        ),
      workspacePath: z
        .string()
        .optional()
        .describe(
          "Optional workspace root path for discovering project rules and skills.",
        ),
      includeSubagents: z
        .boolean()
        .optional()
        .describe(
          "Include subagent and background worker threads in the conversation list.",
        ),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: {
      ui: {
        resourceUri: APP_URI,
      },
      "com.google.antigravity/ui": {
        entrypoints: [
          { type: "aux_pane", title: "Context" },
          { type: "global", title: "Context" },
        ],
      },
    },
  },
  async (args) => {
    const mcpRootsPromise = resolveMcpRoots(server, args);
    const includeSubagents =
      args?.includeSubagents ?? currentPreferences.includeSubagents;
    const snapshot = await getContextSnapshot({
      conversationId: args?.conversationId,
      workspacePath: args?.workspacePath,
      savedWorkspacePath: currentPreferences.workspacePath,
      includeSubagents,
      includeDetails: false,
      mcpRoots: mcpRootsPromise,
    });
    snapshot.preferences = getPreferencesPayload();
    return {
      content: [
        {
          type: "text",
          text: formatSummaryText(snapshot),
        },
      ],
      structuredContent: snapshot,
    };
  },
);

registerAppTool(
  server,
  "get_context_snapshot",
  {
    title: "Refresh Context Snapshot",
    description: "App-only tool to fetch or switch conversation context snapshots.",
    inputSchema: {
      conversationId: z.string().optional(),
      workspacePath: z.string().optional(),
      includeSubagents: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: {
      ui: {
        visibility: ["app"],
      },
    },
  },
  async (args) => {
    const mcpRootsPromise = resolveMcpRoots(server, args);
    const includeSubagents =
      args?.includeSubagents ?? currentPreferences.includeSubagents;
    const snapshot = await getContextSnapshot({
      conversationId: args?.conversationId,
      workspacePath: args?.workspacePath,
      savedWorkspacePath: currentPreferences.workspacePath,
      includeSubagents,
      limit: args?.limit,
      includeDetails: true,
      mcpRoots: mcpRootsPromise,
    });
    snapshot.preferences = getPreferencesPayload();
    return {
      content: [
        {
          type: "text",
          text: formatSummaryText(snapshot),
        },
      ],
      structuredContent: snapshot,
    };
  },
);

registerAppTool(
  server,
  "list_conversations",
  {
    title: "List Tracked Conversations",
    description:
      "App-only paginated fleet explorer returning interactive KPIs and matching conversations.",
    inputSchema: {
      query: z.string().optional(),
      kind: z.enum(["interactive", "all", "subagent", "background"]).optional(),
      filter: z.enum(["all", "high_usage", "checkpointed", "running"]).optional(),
      sort: z
        .enum(["recent", "usage_desc", "tokens_desc", "checkpoints_desc"])
        .optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: {
      ui: {
        visibility: ["app"],
      },
    },
  },
  async (args) => {
    const res = await listConversations({
      query: args?.query,
      kind: args?.kind,
      filter: args?.filter,
      sort: args?.sort,
      offset: args?.offset,
      limit: args?.limit,
    });
    return {
      content: [
        {
          type: "text",
          text: `Fleet: ${res.fleet.interactiveCount} interactive / ${res.fleet.totalTracked} tracked (${res.items.length} of ${res.totalMatching} shown).`,
        },
      ],
      structuredContent: res,
    };
  },
);

registerAppTool(
  server,
  "set_context_preferences",
  {
    title: "Save Context Monitor Preferences",
    description:
      "App-only tool to persist workspace selection and subagent visibility preferences.",
    inputSchema: {
      workspacePath: z.string().nullable().optional(),
      includeSubagents: z.boolean().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: {
      ui: {
        visibility: ["app"],
      },
    },
  },
  async (args) => {
    try {
      currentPreferences = savePreferences(dataDir, args ?? {}, currentPreferences);
      const prefs = getPreferencesPayload();
      return {
        content: [
          {
            type: "text",
            text: `Preferences updated (persisted: ${prefs.persisted}, workspace: ${prefs.workspacePath || "auto"}, includeSubagents: ${prefs.includeSubagents}).`,
          },
        ],
        structuredContent: prefs,
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
