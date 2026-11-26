import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { getContextSnapshot } from "./analyzer.mjs";

const APP_URI = "ui://context-monitor/app.html";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function formatSummaryText(snapshot) {
  const cur = snapshot.current;
  if (!cur) {
    return "No local Antigravity conversation transcripts were found under ~/.gemini/antigravity/brain.";
  }
  if (!cur.hasUsageData) {
    return `Conversation "${cur.title}" (${cur.conversationId}) has no recorded planner token usage yet.`;
  }
  const ex = cur.exact;
  const win = cur.model.contextWindow
    ? `${ex.usedPercent}% of ${cur.model.contextWindow.toLocaleString("en-US")} (${cur.model.windowSource})`
    : `unknown context window (${cur.model.windowSource})`;
  return [
    `Context Monitor: ${cur.title}`,
    `Model: ${cur.model.displayName} (${cur.model.id})`,
    `Active prompt (exact): ${ex.activeTokens.toLocaleString("en-US")} tokens — ${win}`,
    `Cache split (exact): ${ex.cacheReadTokens.toLocaleString("en-US")} cached (${ex.cacheHitPercent}%) + ${ex.inputTokens.toLocaleString("en-US")} uncached`,
    `Turns: ${ex.turnCount} | Checkpoints: ${ex.checkpointCount} | Session output: ${ex.totalOutputTokens.toLocaleString("en-US")}`,
    `Local MCP inventory: ${snapshot.inventory.mcp.activeToolCount} configured tools (${snapshot.inventory.mcp.totalCachedToolCount} cached schemas on disk)`,
  ].join("\n");
}

const server = new McpServer({
  name: "context-monitor",
  version: "0.1.0",
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
          "Optional conversation ID to inspect. Defaults to the most recently modified local transcript.",
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
    const snapshot = await getContextSnapshot({
      conversationId: args?.conversationId,
    });
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
    const snapshot = await getContextSnapshot({
      conversationId: args?.conversationId,
      limit: args?.limit,
    });
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

const transport = new StdioServerTransport();
await server.connect(transport);
