import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

const rootEl = document.getElementById("app");
const app = new App({ name: "Context Monitor", version: "0.1.0" }, {});

let currentSnapshot = null;
let selectedConversationId = null;
let isRefreshing = false;
let lastError = null;
let openDrawers = new Set();
let pollTimer = null;

// Track toggletip triggers whose aria-expanded we manage
const managedTriggers = new WeakSet();

function setupHintFallbackAndAria() {
  // Fallback where popover="hint" is unsupported (falls back to "manual" natively)
  if (Object.hasOwn(HTMLElement.prototype, "popover")) {
    const probe = document.createElement("div");
    probe.popover = "hint";
    if (probe.popover !== "hint") {
      document.addEventListener(
        "beforetoggle",
        (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const isToggletip =
            target.getAttribute("popover") === "hint" &&
            target.id &&
            document.querySelector(`[popovertarget="${CSS.escape(target.id)}"]`);
          if (event.newState === "open" && isToggletip) {
            target.setAttribute("popover", "auto");
          }
        },
        true,
      );
    }
  }

  // Sync aria-expanded from popover toggle events (toggle does not bubble -> capture)
  document.addEventListener(
    "toggle",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.id) return;
      if (!target.hasAttribute("popover")) return;
      const isOpen = event.newState === "open";
      const triggers = document.querySelectorAll(
        `[interestfor="${CSS.escape(target.id)}"]`,
      );
      for (const trigger of triggers) {
        if (managedTriggers.has(trigger)) {
          trigger.setAttribute("aria-expanded", String(isOpen));
        }
      }
    },
    true,
  );
}

function wireInterestHints(container) {
  const triggers = container.querySelectorAll("[interestfor]");
  for (const trigger of triggers) {
    const targetId = trigger.getAttribute("interestfor");
    if (!targetId) continue;
    const hint = document.getElementById(targetId);
    if (!hint || !hint.hasAttribute("popover")) continue;

    if (!hint.hasAttribute("role")) {
      hint.setAttribute("role", "tooltip");
    }

    const opensOnActivation =
      trigger.getAttribute("popovertarget") === targetId ||
      trigger.getAttribute("commandfor") === targetId;

    if (opensOnActivation) {
      if (!trigger.hasAttribute("aria-expanded")) {
        const isOpen =
          hint.matches?.(":popover-open") ||
          hint.classList.contains(":popover-open");
        trigger.setAttribute("aria-expanded", String(Boolean(isOpen)));
      }
      managedTriggers.add(trigger);
    } else if (!trigger.hasAttribute("aria-describedby")) {
      trigger.setAttribute("aria-describedby", targetId);
    }
  }
}

async function ensureInterestPolyfill() {
  if (!("interestForElement" in HTMLButtonElement.prototype)) {
    try {
      await import("interestfor");
    } catch {
      // Popover click activation still works natively if polyfill fails
    }
  }
}

function formatTokens(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const val = Number(n);
  if (val >= 1_000_000) {
    const m = val / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (val >= 1_000) {
    const k = val / 1_000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(Math.round(val));
}

function formatExactNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US");
}

function formatPercent(pct, digits = 1) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "—";
  return `${Number(pct).toFixed(digits)}%`;
}

function formatRelativeTime(iso) {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyThemeFromHost(ctx) {
  if (!ctx) return;
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    document.documentElement.dataset.theme = ctx.theme;
    document.documentElement.style.colorScheme = ctx.theme;
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
}

function captureDrawerStates() {
  const next = new Set();
  for (const el of rootEl.querySelectorAll("details[data-drawer-id]")) {
    if (el.open) next.add(el.dataset.drawerId);
  }
  if (rootEl.querySelector("details[data-drawer-id]")) {
    openDrawers = next;
  }
}

function renderRow({ swatchClass, label, tipId, tipText, tokensText, pctText, pctMuted = false }) {
  const labelMarkup = tipId
    ? `<button type="button" class="tip-trigger" interestfor="${escapeHtml(tipId)}" popovertarget="${escapeHtml(tipId)}" popovertargetaction="show">${escapeHtml(label)}</button><div id="${escapeHtml(tipId)}" popover="hint" role="tooltip" class="tip-popover">${escapeHtml(tipText)}</div>`
    : `<span class="row-label">${escapeHtml(label)}</span>`;

  return `
    <div class="row">
      <span class="swatch ${escapeHtml(swatchClass)}" aria-hidden="true"></span>
      <div class="row-label-wrap">${labelMarkup}</div>
      <span class="row-tokens">${escapeHtml(tokensText)}</span>
      <span class="row-pct${pctMuted ? " muted" : ""}">${escapeHtml(pctText)}</span>
    </div>
  `;
}

function render() {
  captureDrawerStates();

  if (!currentSnapshot) {
    rootEl.innerHTML = `<div class="empty-state">${lastError ? escapeHtml(lastError) : "Loading context usage…"}</div>`;
    return;
  }

  const { current, conversations = [], inventory } = currentSnapshot;
  const exact = current?.exact;
  const model = current?.model;
  const hasWindow = model?.contextWindow !== null && model?.contextWindow !== undefined;
  const usedHeadline =
    exact && exact.usedPercent !== null
      ? `${Math.round(exact.usedPercent)}% used`
      : current?.hasUsageData
        ? `${formatTokens(exact.activeTokens)} active`
        : "No turns yet";

  const fractionText = current?.hasUsageData
    ? `${formatTokens(exact.activeTokens)} / ${hasWindow ? formatTokens(model.contextWindow) : "?"}`
    : "0 / —";

  // Stacked horizontal bar segments
  const barSegments = [];
  if (current?.hasUsageData && exact.activeTokens > 0) {
    const denom = hasWindow
      ? Math.max(model.contextWindow, exact.activeTokens)
      : exact.activeTokens;
    for (const seg of current.segments || []) {
      if (seg.tokens <= 0) continue;
      const widthPct = Math.max(0.6, (seg.tokens / denom) * 100);
      barSegments.push(
        `<span class="bar-segment bar-${escapeHtml(seg.colorKey)}" style="width:${widthPct.toFixed(2)}%" title="${escapeHtml(seg.label)}: ${escapeHtml(formatTokens(seg.tokens))}"></span>`,
      );
    }
  }

  // Thread selector options
  const threadOptions = conversations
    .map((conv) => {
      const selected = conv.conversationId === current?.conversationId ? " selected" : "";
      const pctSuffix =
        conv.usedPercent !== null ? ` (${Math.round(conv.usedPercent)}%)` : "";
      const rel = formatRelativeTime(conv.lastUpdated);
      const label = `${conv.title}${pctSuffix}${rel ? ` · ${rel}` : ""}`;
      return `<option value="${escapeHtml(conv.conversationId)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");

  // Primary category rows
  const primaryRows = [];
  if (current?.hasUsageData) {
    for (const seg of current.segments || []) {
      primaryRows.push(
        renderRow({
          swatchClass: `swatch-${seg.colorKey}`,
          label: seg.label,
          tipId: `tip-seg-${seg.id}`,
          tipText: `${seg.detail} Exact total active prompt is ${formatExactNumber(exact.activeTokens)} tokens.`,
          tokensText: formatTokens(seg.tokens),
          pctText: seg.percent !== null ? formatPercent(seg.percent) : "—",
          pctMuted: seg.percent === null,
        }),
      );
    }

    if (hasWindow) {
      const freePct =
        model.contextWindow > 0
          ? Math.max(0, ((exact.freeTokens || 0) / model.contextWindow) * 100)
          : null;
      primaryRows.push(
        renderRow({
          swatchClass: "swatch-free",
          label: "Free space",
          tipId: "tip-free-space",
          tipText: `Remaining capacity before ${formatExactNumber(model.contextWindow)} tokens (${model.windowSource}). Antigravity may compact earlier automatically.`,
          tokensText: formatTokens(exact.freeTokens),
          pctText: formatPercent(freePct),
        }),
      );
    }
  }

  // Secondary non-additive reference rows (mirroring deferred rows with "—")
  const secondaryRows = [];
  if (current?.hasUsageData) {
    secondaryRows.push(
      renderRow({
        swatchClass: "swatch-muted",
        label: "Prompt cache hit",
        tipId: "tip-cache-hit",
        tipText: `Exact transcript counter: ${formatExactNumber(exact.cacheReadTokens)} cached + ${formatExactNumber(exact.inputTokens)} uncached input = ${formatExactNumber(exact.activeTokens)} active tokens (${exact.cacheHitPercent}% cached).`,
        tokensText: formatTokens(exact.cacheReadTokens),
        pctText: "—",
        pctMuted: true,
      }),
    );
  }

  const mcpInfo = inventory?.mcp;
  if (mcpInfo) {
    const mcpEst = mcpInfo.activeToolCount > 0 ? mcpInfo.activeEstTokens : mcpInfo.totalCachedEstTokens;
    const mcpScopeLabel =
      mcpInfo.activeToolCount > 0
        ? `Local estimate (~bytes/4) across ${mcpInfo.activeServerCount} configured MCP servers (${mcpInfo.activeToolCount} tools; ${mcpInfo.totalCachedToolCount} total cached on disk). Antigravity loads lazy schemas on demand.`
        : `Local estimate (~bytes/4) across ${mcpInfo.cachedServerCount} cached MCP schema directories (${mcpInfo.totalCachedToolCount} tools) under ~/.gemini/antigravity/mcp.`;
    secondaryRows.push(
      renderRow({
        swatchClass: "swatch-muted",
        label: "MCP tools (deferred est.)",
        tipId: "tip-mcp-deferred",
        tipText: mcpScopeLabel,
        tokensText: formatTokens(mcpEst),
        pctText: "—",
        pctMuted: true,
      }),
    );
  }

  const rulesInfo = inventory?.rules;
  const skillsInfo = inventory?.skills;
  if (rulesInfo && skillsInfo) {
    secondaryRows.push(
      renderRow({
        swatchClass: "swatch-muted",
        label: "Rules & skill index (est.)",
        tipId: "tip-rules-skills",
        tipText: `Local estimate (~bytes/4) for ${rulesInfo.count} rule files (${formatTokens(rulesInfo.estTokens)}) plus progressive-disclosure headers of ${skillsInfo.count} discovered skills (${formatTokens(skillsInfo.estIndexTokens)}).`,
        tokensText: formatTokens(rulesInfo.estTokens + skillsInfo.estIndexTokens),
        pctText: "—",
        pctMuted: true,
      }),
    );
  }

  // Collapsible drawers
  const mcpServerRows = (mcpInfo?.servers || [])
    .map(
      (srv) => `
      <div class="sub-row">
        <span class="sub-row-name">${escapeHtml(srv.name)}${srv.active ? '<span class="tag tag-active">configured</span>' : '<span class="tag">cached</span>'}${srv.hasInstructions ? '<span class="tag">instructions</span>' : ""}</span>
        <span class="sub-row-meta">${srv.toolCount} tools · ~${escapeHtml(formatTokens(srv.estSchemaTokens + srv.estInstructionTokens))}</span>
      </div>`,
    )
    .join("");

  const ruleRows = (rulesInfo?.items || [])
    .map(
      (r) => `
      <div class="sub-row">
        <span class="sub-row-name">${escapeHtml(r.name)}<span class="tag">${escapeHtml(r.scope)}</span></span>
        <span class="sub-row-meta">~${escapeHtml(formatTokens(r.estTokens))}</span>
      </div>`,
    )
    .join("");

  const mcpHeaderCount =
    mcpInfo && mcpInfo.activeToolCount > 0
      ? `${mcpInfo.activeToolCount} / ${mcpInfo.totalCachedToolCount}`
      : String(mcpInfo?.totalCachedToolCount ?? 0);

  const errorBanner = lastError
    ? `<div class="error-banner" role="alert">${escapeHtml(lastError)}</div>`
    : "";

  const metaParts = [];
  if (model?.displayName) metaParts.push(`<span>${escapeHtml(model.displayName)}</span>`);
  if (model?.windowSource) {
    metaParts.push(`<span class="meta-dot">${escapeHtml(model.windowSource)}</span>`);
  }
  if (exact && exact.checkpointCount > 0) {
    metaParts.push(
      `<span class="meta-dot">${exact.checkpointCount} compaction${exact.checkpointCount === 1 ? "" : "s"}</span>`,
    );
  }

  rootEl.innerHTML = `
    <header class="header">
      <div class="header-left">
        <h1 class="title">Context</h1>
      </div>
      <div class="header-actions">
        <button type="button" class="badge-tip" interestfor="tip-methodology" popovertarget="tip-methodology" popovertargetaction="show">Exact + Est.</button>
        <div id="tip-methodology" popover="hint" role="tooltip" class="tip-popover">Total active tokens, cache split, output tokens, and checkpoints are exact from local transcript.jsonl. Category splits and MCP/rule footprints are local estimates because server-side prompt categories are not stored in transcripts.</div>
        <button type="button" id="refresh-btn" class="icon-btn${isRefreshing ? " spinning" : ""}" aria-label="Refresh context metrics" title="Refresh"${isRefreshing ? " disabled" : ""}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.67"/>
            <path d="M13.5 2.5v2.75h-2.75"/>
          </svg>
        </button>
      </div>
    </header>

    ${errorBanner}

    <div class="thread-bar">
      <label for="thread-select" class="sr-only">Conversation</label>
      <select id="thread-select" class="thread-select" ${conversations.length === 0 ? "disabled" : ""}>
        ${threadOptions || '<option value="">No local transcripts found</option>'}
      </select>
      <div class="thread-meta">${metaParts.join("")}</div>
    </div>

    <section aria-label="Active context usage">
      <div class="usage-summary">
        <span class="usage-percent">${escapeHtml(usedHeadline)}</span>
        <span class="usage-fraction">${escapeHtml(fractionText)}</span>
      </div>
      <div class="bar-track" role="img" aria-label="Context usage bar: ${escapeHtml(usedHeadline)}, ${escapeHtml(fractionText)}">
        ${barSegments.join("")}
      </div>
    </section>

    ${
      primaryRows.length > 0
        ? `<section class="rows" aria-label="Context breakdown">${primaryRows.join("")}</section>`
        : `<div class="empty-state">No planner token usage recorded in this conversation yet.</div>`
    }

    ${
      secondaryRows.length > 0
        ? `<section class="rows rows-secondary" aria-label="Cache and deferred local estimates">${secondaryRows.join("")}</section>`
        : ""
    }

    <div class="drawers">
      <details class="drawer" data-drawer-id="mcp"${openDrawers.has("mcp") ? " open" : ""}>
        <summary>
          <span>MCP tools</span>
          <span class="drawer-count">${escapeHtml(mcpHeaderCount)}</span>
        </summary>
        <div class="drawer-body">
          ${mcpServerRows || '<div class="sub-row"><span>No local MCP schemas found.</span></div>'}
        </div>
      </details>

      <details class="drawer" data-drawer-id="rules"${openDrawers.has("rules") ? " open" : ""}>
        <summary>
          <span>Rules &amp; skills</span>
          <span class="drawer-count">${escapeHtml(String((rulesInfo?.count ?? 0) + (skillsInfo?.count ?? 0)))}</span>
        </summary>
        <div class="drawer-body">
          ${ruleRows || '<div class="sub-row"><span>No global or plugin rules found.</span></div>'}
          ${
            skillsInfo
              ? `<div class="sub-row">
                   <span class="sub-row-name">Discovered skills (headers only)</span>
                   <span class="sub-row-meta">${skillsInfo.count} (${skillsInfo.byScope.plugin} plugin, ${skillsInfo.byScope.global} global, ${skillsInfo.byScope.builtin} builtin)</span>
                 </div>`
              : ""
          }
        </div>
      </details>

      ${
        current?.hasUsageData
          ? `<details class="drawer" data-drawer-id="exact"${openDrawers.has("exact") ? " open" : ""}>
              <summary>
                <span>Exact transcript counters</span>
                <span class="drawer-count">${escapeHtml(String(exact.turnCount))} turns</span>
              </summary>
              <div class="drawer-body">
                <div class="kv-grid">
                  <span class="kv-key">Active prompt (in + cache)</span>
                  <span class="kv-val">${escapeHtml(formatExactNumber(exact.activeTokens))}</span>
                  <span class="kv-key">Cache read tokens</span>
                  <span class="kv-val">${escapeHtml(formatExactNumber(exact.cacheReadTokens))} (${escapeHtml(String(exact.cacheHitPercent))}%)</span>
                  <span class="kv-key">Uncached input tokens</span>
                  <span class="kv-val">${escapeHtml(formatExactNumber(exact.inputTokens))}</span>
                  <span class="kv-key">Last turn output</span>
                  <span class="kv-val">${escapeHtml(formatExactNumber(exact.lastOutputTokens))}</span>
                  <span class="kv-key">Session total output</span>
                  <span class="kv-val">${escapeHtml(formatExactNumber(exact.totalOutputTokens))}</span>
                  <span class="kv-key">Compaction checkpoints</span>
                  <span class="kv-val">${escapeHtml(String(exact.checkpointCount))}</span>
                  <span class="kv-key">Model ID</span>
                  <span class="kv-val">${escapeHtml(model?.id || "—")}</span>
                  <span class="kv-key">Updated</span>
                  <span class="kv-val">${escapeHtml(formatRelativeTime(current.lastUpdated) || current.lastUpdated)}</span>
                </div>
              </div>
            </details>`
          : ""
      }
    </div>
  `;

  wireInterestHints(rootEl);

  const selectEl = document.getElementById("thread-select");
  if (selectEl) {
    selectEl.addEventListener("change", (event) => {
      const nextId = event.target.value;
      if (nextId) {
        selectedConversationId = nextId;
        void refreshSnapshot(nextId);
      }
    });
  }

  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      void refreshSnapshot(selectedConversationId);
    });
  }
}

async function refreshSnapshot(conversationId, { silent = false } = {}) {
  if (isRefreshing) return;
  const caps = app.getHostCapabilities();
  if (!caps?.serverTools) return;

  isRefreshing = true;
  if (!silent) {
    lastError = null;
    render();
  }

  try {
    const args = conversationId ? { conversationId } : {};
    const result = await app.callServerTool({
      name: "get_context_snapshot",
      arguments: args,
    });
    if (result?.structuredContent) {
      currentSnapshot = result.structuredContent;
      selectedConversationId =
        currentSnapshot.selectedConversationId || selectedConversationId;
      lastError = null;
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Failed to refresh context snapshot";
  } finally {
    isRefreshing = false;
    render();
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible" && !isRefreshing) {
      void refreshSnapshot(selectedConversationId, { silent: true });
    }
  }, 15_000);
}

// Register SDK handlers BEFORE connect() so no initial notification is missed
app.ontoolinput = ({ arguments: args }) => {
  if (args && typeof args.conversationId === "string" && args.conversationId) {
    selectedConversationId = args.conversationId;
  }
};

app.ontoolresult = (result) => {
  if (result?.structuredContent) {
    currentSnapshot = result.structuredContent;
    selectedConversationId =
      currentSnapshot.selectedConversationId || selectedConversationId;
    lastError = null;
    render();
  }
};

app.ontoolcancelled = () => {
  isRefreshing = false;
  render();
};

app.onhostcontextchanged = (ctx) => {
  applyThemeFromHost(ctx);
};

async function init() {
  setupHintFallbackAndAria();
  await ensureInterestPolyfill();
  await app.connect();
  applyThemeFromHost(app.getHostContext());
  startPolling();

  // If opened without an initial tool result yet, fetch snapshot once
  if (!currentSnapshot) {
    void refreshSnapshot(selectedConversationId, { silent: true });
  }
}

void init();
