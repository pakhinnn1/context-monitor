import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { z } from "zod";
import {
  computeTrajectoryGeometry,
  findNearestTrajectoryIndex,
  formatTrajectoryReadout,
  renderTrajectoryChart,
} from "./charts.js";
import {
  escapeHtml,
  formatAttachedContextSummary,
  formatExactNumber,
  formatPercent,
  formatRelativeTime,
  formatServiceStatus,
  formatSkillsScope,
  formatTokens,
  formatWorkspaceLabel,
  shortenPath,
} from "./format.js";
import {
  renderFleetKpis,
  renderRailFooter,
  renderRailList,
  renderRailShell,
} from "./rail.js";

const ToggleAuxPaneResultSchema = z
  .object({ isError: z.boolean().optional() })
  .passthrough();

const rootEl = document.getElementById("app");
const statusLiveEl = document.getElementById("status-live");
const app = new App({ name: "Context Monitor", version: "0.2.0" }, {});

const hoverFineQuery = window.matchMedia?.("(hover: hover) and (pointer: fine)");

let currentSnapshot = null;
let selectedConversationId = null;
let selectedWorkspacePath = null;
let includeSubagents = false;
let attachedConversationId = null;
let auxPaneOpenUnsupported = false;
let isConnected = false;
let isWideMode = false;
let railLoaded = false;
let hasExplicitConversationSelection = false;
let hasSyncedPreferences = false;
let hasHydratedDetails = false;
let hydrateInFlightKey = null;

let isRefreshing = false;
let lastError = null;
const userToggledDrawers = new Map();
let pollTimer = null;
let refreshDoneTimer = null;
let searchDebounceTimer = null;
let mountedStructureKey = null;
let lastRenderedFingerprint = null;
let pendingStructuralRender = false;
let highlightedSegId = null;

let snapshotSeq = 0;
let railSeq = 0;
let inFlightCalls = 0;
const callQueue = [];

let activeTrajectoryCoords = null;
let activeTrajectoryIndex = null;
let isTrajectoryPointerScrubbing = false;
let isTrajectoryKeyScrubbing = false;
let openTipCount = 0;
let lastTipClosedAt = 0;
const managedTriggers = new WeakSet();

const railState = {
  query: "",
  kind: "interactive",
  filter: "all",
  sort: "recent",
  offset: 0,
  limit: 35,
  items: [],
  fleet: null,
  totalMatching: 0,
  hasMore: false,
  loading: false,
  loadingMore: false,
  error: null,
};

function enqueueToolCall(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      inFlightCalls += 1;
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        inFlightCalls -= 1;
        const next = callQueue.shift();
        if (next) next();
      }
    };

    if (inFlightCalls < 2) {
      void run();
    } else {
      callQueue.push(() => void run());
    }
  });
}

function announceStatus(message) {
  if (!statusLiveEl || !message) return;
  statusLiveEl.textContent = "";
  requestAnimationFrame(() => {
    statusLiveEl.textContent = message;
  });
}

function getHostCaps() {
  return isConnected ? app.getHostCapabilities() : null;
}

function canAttachModelContext() {
  return Boolean(getHostCaps()?.updateModelContext);
}

function canOpenAuxFile() {
  const caps = getHostCaps();
  return (
    Boolean(caps?.updateModelContext || caps?.message) && !auxPaneOpenUnsupported
  );
}

function isDrawerOpen(drawerId) {
  if (userToggledDrawers.has(drawerId)) {
    return userToggledDrawers.get(drawerId);
  }
  if (
    isWideMode &&
    (drawerId === "trajectory" || drawerId === "top-tools" || drawerId === "artifacts")
  ) {
    return true;
  }
  return false;
}

function renderDrawerAttrs(drawerId, extraClass = "") {
  const open = isDrawerOpen(drawerId);
  const cls = extraClass ? `drawer ${extraClass}` : "drawer";
  return `class="${cls}" data-drawer-id="${drawerId}" data-rendered-open="${open ? "true" : "false"}"${open ? " open" : ""}`;
}

function setupHintFallbackAndAria() {
  let needsHintFallback = false;
  if (Object.hasOwn(HTMLElement.prototype, "popover")) {
    const probe = document.createElement("div");
    probe.popover = "hint";
    needsHintFallback = probe.popover !== "hint";
  }

  document.addEventListener(
    "beforetoggle",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (needsHintFallback) {
        const isToggletip =
          target.getAttribute("popover") === "hint" &&
          target.id &&
          document.querySelector(`[popovertarget="${CSS.escape(target.id)}"]`);
        if (event.newState === "open" && isToggletip) {
          target.setAttribute("popover", "auto");
        }
      }

      if (target.classList.contains("tip-popover") && event.newState === "open") {
        const recentlyClosed = performance.now() - lastTipClosedAt < 250;
        if (openTipCount > 0 || recentlyClosed) {
          target.dataset.instant = "";
        } else {
          delete target.dataset.instant;
        }
      }
    },
    true,
  );

  document.addEventListener(
    "toggle",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target instanceof HTMLDetailsElement && target.dataset.drawerId) {
        const renderedOpen = target.dataset.renderedOpen === "true";
        if (target.open === renderedOpen) {
          return;
        }
        target.dataset.renderedOpen = String(target.open);
        userToggledDrawers.set(target.dataset.drawerId, target.open);
        return;
      }

      if (!target.id || !target.hasAttribute("popover")) return;

      const isOpen = event.newState === "open";
      const triggers = document.querySelectorAll(
        `[interestfor="${CSS.escape(target.id)}"]`,
      );
      for (const trigger of triggers) {
        if (managedTriggers.has(trigger)) {
          trigger.setAttribute("aria-expanded", String(isOpen));
        }
      }

      if (target.classList.contains("tip-popover")) {
        if (isOpen) {
          openTipCount += 1;
        } else {
          openTipCount = Math.max(0, openTipCount - 1);
          lastTipClosedAt = performance.now();
          delete target.dataset.instant;
        }
      }

      if (!isOpen && pendingStructuralRender && !isUserInteracting()) {
        pendingStructuralRender = false;
        render();
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

function computeSnapshotFingerprint(snapshot) {
  if (!snapshot) return "";
  const { current, conversations = [], inventory, serviceStatus, preferences } = snapshot;
  const trajPoints = current?.trajectory?.points || [];
  const lastTraj = trajPoints[trajPoints.length - 1];
  return JSON.stringify({
    selectedConversationId: snapshot.selectedConversationId || null,
    canAttach: canAttachModelContext(),
    canOpenFile: canOpenAuxFile(),
    attachedConversationId,
    isWideMode,
    includeSubagents,
    selectedWorkspacePath,
    serviceStatus,
    preferences,
    current: current
      ? {
          conversationId: current.conversationId,
          title: current.title,
          kind: current.kind,
          runState: current.runState,
          lastUpdated: current.lastUpdated,
          hasUsageData: current.hasUsageData,
          modelId: current.model?.id,
          contextWindow: current.model?.contextWindow,
          exact: current.exact,
          segments: (current.segments || []).map((s) => ({
            id: s.id,
            tokens: s.tokens,
            percent: s.percent,
            colorKey: s.colorKey,
          })),
          trajSummary: current.trajectory
            ? [
                trajPoints.length,
                current.trajectory.totalTurnCount,
                lastTraj?.turn,
                lastTraj?.activeTokens,
              ]
            : null,
          topTools: (current.topTools || []).map((t) => [t.name, t.calls, t.estTokens]),
          artifacts: current.artifacts
            ? [
                current.artifacts.count,
                current.artifacts.totalEstTokens,
                current.artifacts.items.map((a) => [a.name, a.mtimeMs, a.userFacing]),
              ]
            : null,
        }
      : null,
    conversations: conversations.map((c) => ({
      id: c.conversationId,
      title: c.title,
      usedPercent: c.usedPercent,
      lastUpdated: c.lastUpdated,
    })),
    inventory: inventory
      ? {
          workspace: inventory.workspace,
          knownWorkspaces: (inventory.knownWorkspaces || []).map((w) => w.path),
          mcp: inventory.mcp?.servers?.map((s) => [
            s.name,
            s.active,
            s.toolCount,
            s.estSchemaTokens,
            s.estInstructionTokens,
          ]),
          rules: inventory.rules?.items?.map((r) => [
            r.name,
            r.scope,
            r.estTokens,
            r.overPerFileCap,
          ]),
          skills: [
            inventory.skills?.count,
            inventory.skills?.estIndexTokens,
            inventory.skills?.byScope,
          ],
        }
      : null,
  });
}

function computeStructureKey(snapshot, error) {
  if (!snapshot) return "empty";
  const { current, conversations = [], inventory } = snapshot;
  const trajPoints = current?.trajectory?.points || [];
  const lastTraj = trajPoints[trajPoints.length - 1];
  return JSON.stringify({
    hasError: Boolean(error),
    canAttach: canAttachModelContext(),
    canOpenFile: canOpenAuxFile(),
    isAttached: Boolean(
      attachedConversationId && attachedConversationId === current?.conversationId,
    ),
    isWideMode,
    conversationId: current?.conversationId || null,
    kind: current?.kind || null,
    hasUsageData: Boolean(current?.hasUsageData),
    hasWindow:
      current?.model?.contextWindow !== null &&
      current?.model?.contextWindow !== undefined,
    compactions: (current?.exact?.checkpointCount || 0) > 0,
    segments: (current?.segments || [])
      .filter((s) => s.tokens > 0)
      .map((s) => s.id),
    trajKey: current?.trajectory
      ? [trajPoints.length, lastTraj?.turn, lastTraj?.activeTokens]
      : "none",
    topToolNames: (current?.topTools || []).map((t) => t.name),
    artifactNames: (current?.artifacts?.items || []).map((a) => a.name),
    convIds: conversations.map((c) => c.conversationId),
    workspacePath: inventory?.workspace?.path || null,
    workspaceSource: inventory?.workspace?.source || "none",
    knownWsPaths: (inventory?.knownWorkspaces || []).map((w) => w.path),
    mcpServers: (inventory?.mcp?.servers || []).map((s) => [s.name, s.active]),
    ruleNames: (inventory?.rules?.items || []).map((r) => [r.name, r.overPerFileCap]),
    hasSkills: Boolean(inventory?.skills),
  });
}

function isUserInteracting(nextActiveEl = document.activeElement) {
  if (isTrajectoryPointerScrubbing || isTrajectoryKeyScrubbing) {
    return true;
  }
  const active = nextActiveEl;
  if (
    active &&
    (active.id === "thread-select" ||
      active.id === "workspace-select" ||
      active.id === "rail-search" ||
      active.id === "rail-sort" ||
      active.id === "rail-kind" ||
      active.id === "traj-scrubber")
  ) {
    return true;
  }
  if (
    rootEl.querySelector("[popover]:is(:popover-open, .\\:popover-open)") ||
    document.querySelector("[popover]:is(:popover-open, .\\:popover-open)")
  ) {
    return true;
  }
  const sel = window.getSelection?.();
  if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
    const anchorNode = sel.anchorNode;
    if (anchorNode && rootEl.contains(anchorNode)) return true;
  }
  return false;
}

function computeMetrics(snapshot) {
  const { current, inventory } = snapshot;
  const exact = current?.exact;
  const model = current?.model;
  const hasWindow =
    model?.contextWindow !== null && model?.contextWindow !== undefined;

  const usedHeadline =
    exact && exact.usedPercent !== null
      ? `${Math.round(exact.usedPercent)}% used`
      : current?.hasUsageData
        ? `${formatTokens(exact.activeTokens)} active`
        : "No turns yet";

  const fractionText = current?.hasUsageData
    ? `${formatTokens(exact.activeTokens)} / ${hasWindow ? formatTokens(model.contextWindow) : "?"}`
    : "0 / —";

  const denom = current?.hasUsageData
    ? hasWindow
      ? Math.max(model.contextWindow, exact.activeTokens)
      : exact.activeTokens
    : 1;

  const freePct =
    hasWindow && current?.hasUsageData
      ? exact.freePercent ??
        (model.contextWindow > 0
          ? Math.max(0, ((exact.freeTokens || 0) / model.contextWindow) * 100)
          : null)
      : null;

  const mcpInfo = inventory?.mcp;
  const mcpEst = mcpInfo
    ? mcpInfo.activeToolCount > 0
      ? mcpInfo.activeEstTokens
      : mcpInfo.totalCachedEstTokens
    : 0;
  const mcpHeaderCount =
    mcpInfo && mcpInfo.activeToolCount > 0
      ? `${mcpInfo.activeToolCount} / ${mcpInfo.totalCachedToolCount}`
      : String(mcpInfo?.totalCachedToolCount ?? 0);

  return {
    exact,
    model,
    hasWindow,
    usedHeadline,
    fractionText,
    denom,
    freePct,
    mcpInfo,
    mcpEst,
    mcpHeaderCount,
  };
}

function setHighlight(segId) {
  const next = segId || null;
  if (highlightedSegId === next) return;
  highlightedSegId = next;

  const track = rootEl.querySelector(".bar-track");
  if (track) {
    track.classList.toggle("has-highlight", Boolean(next));
  }
  for (const el of rootEl.querySelectorAll("[data-seg-id]")) {
    el.classList.toggle("is-highlighted", Boolean(next && el.dataset.segId === next));
  }
}

function updateTrajectoryScrub(idx, { scrubbing = false } = {}) {
  if (!activeTrajectoryCoords || activeTrajectoryCoords.length === 0) return;
  const clamped = Math.max(0, Math.min(activeTrajectoryCoords.length - 1, idx));
  activeTrajectoryIndex = clamped;
  const target = activeTrajectoryCoords[clamped];
  const readoutText = formatTrajectoryReadout(target.pt);
  const readoutEl = rootEl.querySelector('[data-slot="traj-readout"]');
  const dotEl = rootEl.querySelector('[data-slot="traj-active-dot"]');
  const crosshairEl = rootEl.querySelector('[data-slot="traj-crosshair"]');
  const scrubberEl = rootEl.querySelector('[data-slot="traj-scrubber"]');
  if (readoutEl) readoutEl.textContent = readoutText;
  if (dotEl) {
    dotEl.setAttribute("cx", target.x.toFixed(1));
    dotEl.setAttribute("cy", target.yActive.toFixed(1));
  }
  if (crosshairEl) {
    const xStr = target.x.toFixed(1);
    crosshairEl.setAttribute("x1", xStr);
    crosshairEl.setAttribute("x2", xStr);
    crosshairEl.setAttribute("data-active", scrubbing ? "true" : "false");
  }
  if (scrubberEl) {
    scrubberEl.setAttribute("aria-valuenow", String(clamped + 1));
    scrubberEl.setAttribute("aria-valuetext", readoutText);
  }
}

function renderChevronSvg() {
  return `<svg class="drawer-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>`;
}

function renderOpenFileIcon() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4"/><path d="M13.5 2.5L7 9"/><path d="M6.5 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3"/></svg>`;
}

function renderRow({
  segId = null,
  swatchClass,
  label,
  tipId = null,
  tipText = null,
  tokensSlot,
  tokensText,
  pctSlot = null,
  pctText,
  pctMuted = false,
}) {
  const labelMarkup = tipId
    ? `<button type="button" class="tip-trigger" interestfor="${escapeHtml(tipId)}" popovertarget="${escapeHtml(tipId)}" popovertargetaction="show"><span class="tip-trigger-text">${escapeHtml(label)}</span></button><div id="${escapeHtml(tipId)}" popover="hint" role="tooltip" class="tip-popover" data-tip-slot="${escapeHtml(tipId)}">${escapeHtml(tipText)}</div>`
    : `<span class="row-label">${escapeHtml(label)}</span>`;

  const segAttr = segId ? ` data-seg-id="${escapeHtml(segId)}"` : "";
  const tokAttr = tokensSlot ? ` data-slot="${escapeHtml(tokensSlot)}"` : "";
  const pctAttr = pctSlot ? ` data-slot="${escapeHtml(pctSlot)}"` : "";

  return `
    <li class="row"${segAttr}>
      <span class="swatch ${escapeHtml(swatchClass)}" aria-hidden="true"></span>
      <div class="row-label-wrap">${labelMarkup}</div>
      <span class="row-tokens"${tokAttr}>${escapeHtml(tokensText)}</span>
      <span class="row-pct${pctMuted ? " muted" : ""}"${pctAttr}>${escapeHtml(pctText)}</span>
    </li>
  `;
}

function renderMcpGroup(heading, servers, { active = false } = {}) {
  if (!servers || servers.length === 0) return "";
  const items = servers
    .map((srv) => {
      const totalEst = formatTokens(srv.estSchemaTokens + srv.estInstructionTokens);
      const instrNote = srv.hasInstructions ? " · instructions" : "";
      return `
        <li class="sub-row">
          <span class="sub-row-name">${escapeHtml(srv.name)}</span>
          <span class="sub-row-meta" data-slot="mcp-srv-${escapeHtml(srv.name)}">${srv.toolCount} tools · ~${escapeHtml(totalEst)}${instrNote}</span>
        </li>`;
    })
    .join("");
  return `
    <div class="drawer-group">
      <h2 class="drawer-subhead${active ? " drawer-subhead-active" : ""}">${escapeHtml(heading)} (${servers.length})</h2>
      <ul class="sub-list" role="list">${items}</ul>
    </div>
  `;
}

function renderTopToolsContent(topTools) {
  if (!topTools || topTools.length === 0) {
    return `<div class="sub-empty">No post-anchor tool calls attributed in this window.</div>`;
  }
  const maxShare = Math.max(...topTools.map((t) => t.sharePercent || 0), 1);
  return `
    <ul class="tool-list" role="list">
      ${topTools
        .map((t) => {
          const width = Math.max(4, Math.min(100, ((t.sharePercent || 0) / maxShare) * 100));
          return `
            <li class="tool-row">
              <div class="tool-row-top">
                <span class="tool-name">${escapeHtml(t.name)}</span>
                <span class="tool-meta" data-slot="tool-${escapeHtml(t.name)}">${t.calls}x · ~${escapeHtml(formatTokens(t.estTokens))} (${escapeHtml(formatPercent(t.sharePercent))})</span>
              </div>
              <span class="tool-bar-track" aria-hidden="true">
                <span class="tool-bar-fill" style="width:${width.toFixed(1)}%"></span>
              </span>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function renderArtifactsContent(artifacts) {
  if (!artifacts || !artifacts.items || artifacts.items.length === 0) {
    return `<div class="sub-empty">No markdown artifacts found for this thread.</div>`;
  }
  const allowOpen = canOpenAuxFile();
  return `
    <ul class="sub-list" role="list">
      ${artifacts.items
        .map((a) => {
          const badge = a.userFacing
            ? `<span class="badge badge-accent">user-facing</span>`
            : "";
          const openBtn =
            allowOpen && a.fileUri
              ? `<button type="button" class="open-file-btn" data-open-file-uri="${escapeHtml(a.fileUri)}" title="Open ${escapeHtml(a.name)} in side pane" aria-label="Open ${escapeHtml(a.name)} in side pane">${renderOpenFileIcon()}</button>`
              : "";
          const summary = a.summary
            ? `<span class="sub-row-note">${escapeHtml(a.summary)}</span>`
            : "";
          return `
            <li class="sub-row">
              <span class="sub-row-name">${escapeHtml(a.name)}</span>
              ${badge}
              <span class="sub-row-meta">~${escapeHtml(formatTokens(a.estTokens))}</span>
              ${openBtn}
              ${summary}
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function patchRelativeTimeOnly(snapshot) {
  const updatedEl = rootEl.querySelector('[data-slot="updated-rel"]');
  if (updatedEl && snapshot?.current) {
    updatedEl.textContent =
      formatRelativeTime(snapshot.current.lastUpdated) ||
      snapshot.current.lastUpdated ||
      "—";
  }
  const selectEl = document.getElementById("thread-select");
  if (selectEl && snapshot?.conversations && document.activeElement !== selectEl) {
    for (const conv of snapshot.conversations) {
      const opt = Array.from(selectEl.options).find(
        (o) => o.value === conv.conversationId,
      );
      if (opt) {
        const pctSuffix =
          conv.usedPercent !== null ? ` (${Math.round(conv.usedPercent)}%)` : "";
        const rel = formatRelativeTime(conv.lastUpdated);
        opt.textContent = `${conv.title}${pctSuffix}${rel ? ` · ${rel}` : ""}`;
      }
    }
  }
}

function syncRailSelectionHighlight() {
  const railList = document.getElementById("rail-list");
  if (!railList) return;
  for (const btn of railList.querySelectorAll(".rail-item[data-conv-id]")) {
    btn.setAttribute(
      "aria-current",
      btn.dataset.convId === selectedConversationId ? "true" : "false",
    );
  }
}

function patchInPlace(snapshot) {
  const { current, conversations = [], inventory, serviceStatus } = snapshot;
  const m = computeMetrics(snapshot);
  const {
    exact,
    model,
    hasWindow,
    usedHeadline,
    fractionText,
    denom,
    freePct,
    mcpInfo,
    mcpEst,
    mcpHeaderCount,
  } = m;

  const setSlot = (name, value) => {
    const el = rootEl.querySelector(`[data-slot="${CSS.escape(name)}"]`);
    if (el && el.textContent !== value) el.textContent = value;
  };
  const setTip = (id, text) => {
    const el = rootEl.querySelector(`[data-tip-slot="${CSS.escape(id)}"]`);
    if (el && el.textContent !== text) el.textContent = text;
  };

  setSlot("used-headline", usedHeadline);
  setSlot("fraction-text", fractionText);

  const trackEl = rootEl.querySelector(".bar-track");
  if (trackEl) {
    trackEl.setAttribute(
      "aria-label",
      `Context usage bar: ${usedHeadline}, ${fractionText}`,
    );
  }

  for (const seg of current?.segments || []) {
    const barEl = rootEl.querySelector(
      `.bar-segment[data-seg-id="${CSS.escape(seg.id)}"]`,
    );
    if (barEl && seg.tokens > 0 && denom > 0) {
      const widthPct = Math.max(0.6, (seg.tokens / denom) * 100);
      barEl.style.width = `${widthPct.toFixed(2)}%`;
      barEl.title = `${seg.label}: ${formatTokens(seg.tokens)}`;
    }
    setSlot(`seg-tok-${seg.id}`, formatTokens(seg.tokens));
    setSlot(
      `seg-pct-${seg.id}`,
      seg.percent !== null ? formatPercent(seg.percent) : "—",
    );
    if (Boolean(seg.detail)) {
      setTip(
        `tip-seg-${seg.id}`,
        `${seg.detail} Exact total active prompt is ${formatExactNumber(exact.activeTokens)} tokens.`,
      );
    }
  }

  if (hasWindow && current?.hasUsageData) {
    setSlot("free-tok", formatTokens(exact.freeTokens));
    setSlot("free-pct", formatPercent(freePct));
    setTip(
      "tip-free-space",
      `Remaining capacity before ${formatExactNumber(model.contextWindow)} tokens (${model.windowSource}). Antigravity may compact earlier automatically.`,
    );
  }

  if (current?.hasUsageData) {
    setSlot("cache-tok", formatTokens(exact.cacheReadTokens));
    setTip(
      "tip-cache-hit",
      `Exact transcript counter: ${formatExactNumber(exact.cacheReadTokens)} cached + ${formatExactNumber(exact.inputTokens)} uncached input = ${formatExactNumber(exact.activeTokens)} active tokens (${exact.cacheHitPercent}% cached).`,
    );
    setSlot("kv-active", formatExactNumber(exact.activeTokens));
    setSlot(
      "kv-cache",
      `${formatExactNumber(exact.cacheReadTokens)} (${exact.cacheHitPercent}%)`,
    );
    setSlot("kv-uncached", formatExactNumber(exact.inputTokens));
    setSlot("kv-last-out", formatExactNumber(exact.lastOutputTokens));
    setSlot("kv-total-out", formatExactNumber(exact.totalOutputTokens));
    setSlot("kv-cum-input", formatExactNumber(exact.cumulativeInputTokens));
    setSlot("kv-cum-cache", formatExactNumber(exact.cumulativeCacheReadTokens));
    setSlot("kv-cache-inv", String(exact.cacheInvalidationCount ?? 0));
    setSlot("kv-compactions", String(exact.checkpointCount));
    setSlot("kv-model", model?.id || "—");
    setSlot("kv-service", formatServiceStatus(serviceStatus));
    setSlot(
      "updated-rel",
      formatRelativeTime(current.lastUpdated) || current.lastUpdated || "—",
    );
    setSlot("exact-turns", `${exact.turnCount} turns`);
  }

  for (const t of current?.topTools || []) {
    setSlot(
      `tool-${t.name}`,
      `${t.calls}x · ~${formatTokens(t.estTokens)} (${formatPercent(t.sharePercent)})`,
    );
  }

  if (mcpInfo) {
    setSlot("mcp-tok", formatTokens(mcpEst));
    setSlot("mcp-count", mcpHeaderCount);
    for (const srv of mcpInfo.servers || []) {
      const totalEst = formatTokens(srv.estSchemaTokens + srv.estInstructionTokens);
      const instrNote = srv.hasInstructions ? " · instructions" : "";
      setSlot(
        `mcp-srv-${srv.name}`,
        `${srv.toolCount} tools · ~${totalEst}${instrNote}`,
      );
    }
  }

  const rulesInfo = inventory?.rules;
  const skillsInfo = inventory?.skills;
  if (rulesInfo && skillsInfo) {
    setSlot(
      "rules-skills-tok",
      formatTokens(rulesInfo.estTokens + skillsInfo.estIndexTokens),
    );
    setSlot("rules-count", String(rulesInfo.count + skillsInfo.count));
    for (const r of rulesInfo.items || []) {
      setSlot(`rule-${r.name}`, `${r.scope} · ~${formatTokens(r.estTokens)}`);
    }
    setSlot(
      "skills-meta",
      `${skillsInfo.count} (~${formatTokens(skillsInfo.estIndexTokens)})`,
    );
    setSlot("skills-scope", formatSkillsScope(skillsInfo.byScope));
  }

  setSlot("meta-model", model?.displayName || "");
  setSlot("meta-source", model?.windowSource || "");
  if (exact && exact.checkpointCount > 0) {
    setSlot(
      "meta-compactions",
      `${exact.checkpointCount} compaction${exact.checkpointCount === 1 ? "" : "s"}`,
    );
  }

  const selectEl = document.getElementById("thread-select");
  if (selectEl && document.activeElement !== selectEl) {
    for (const conv of conversations) {
      const opt = Array.from(selectEl.options).find(
        (o) => o.value === conv.conversationId,
      );
      if (opt) {
        const pctSuffix =
          conv.usedPercent !== null ? ` (${Math.round(conv.usedPercent)}%)` : "";
        const rel = formatRelativeTime(conv.lastUpdated);
        opt.textContent = `${conv.title}${pctSuffix}${rel ? ` · ${rel}` : ""}`;
      }
    }
    if (current?.conversationId && selectEl.value !== current.conversationId) {
      selectEl.value = current.conversationId;
    }
  }

  syncRailSelectionHighlight();
  lastRenderedFingerprint = computeSnapshotFingerprint(snapshot);
}

function updateRefreshButtonState({ spinning = false, refreshed = false } = {}) {
  const btn = document.getElementById("refresh-btn");
  if (!btn) return;
  btn.classList.toggle("spinning", spinning);
  btn.classList.toggle("refreshed", refreshed);
  if (spinning) {
    btn.setAttribute("aria-disabled", "true");
  } else {
    btn.removeAttribute("aria-disabled");
  }
}

function renderWorkspacePicker(inventory) {
  const known = inventory?.knownWorkspaces || [];
  const ws = inventory?.workspace || { path: null, source: "none" };
  const activeSelection = selectedWorkspacePath || (ws.source === "saved" || ws.source === "arg" ? ws.path : "");

  const knownPaths = new Set(known.map((k) => k.path));
  const options = [
    `<option value=""${!activeSelection ? " selected" : ""}>Workspace: Auto</option>`,
    ...known.map((w) => {
      const sel = activeSelection === w.path ? " selected" : "";
      const label = `${w.name} (${shortenPath(w.path)})`;
      return `<option value="${escapeHtml(w.path)}"${sel}>${escapeHtml(label)}</option>`;
    }),
  ];
  if (activeSelection && !knownPaths.has(activeSelection)) {
    options.push(
      `<option value="${escapeHtml(activeSelection)}" selected>${escapeHtml(formatWorkspaceLabel(activeSelection, known))} (${escapeHtml(shortenPath(activeSelection))})</option>`,
    );
  }

  const sourceBadge =
    ws.path && ws.source && ws.source !== "none"
      ? `<span class="ws-source" title="${escapeHtml(ws.path)}">${escapeHtml(ws.source)}</span>`
      : "";

  return `
    <div class="ws-picker">
      <label for="workspace-select" class="sr-only">Active workspace</label>
      <select id="workspace-select" class="ws-select" title="${escapeHtml(ws.path || "Automatic workspace resolution")}">
        ${options.join("")}
      </select>
      ${sourceBadge}
    </div>
  `;
}

function buildInspectorHtml() {
  const { current, conversations = [], inventory, serviceStatus } = currentSnapshot;
  const m = computeMetrics(currentSnapshot);
  const {
    exact,
    model,
    hasWindow,
    usedHeadline,
    fractionText,
    denom,
    freePct,
    mcpInfo,
    mcpEst,
    mcpHeaderCount,
  } = m;

  const barSegments = [];
  if (current?.hasUsageData && exact.activeTokens > 0) {
    for (const seg of current.segments || []) {
      if (seg.tokens <= 0) continue;
      const widthPct = Math.max(0.6, (seg.tokens / denom) * 100);
      barSegments.push(
        `<span class="bar-segment bar-${escapeHtml(seg.colorKey)}" data-seg-id="${escapeHtml(seg.id)}" style="width:${widthPct.toFixed(2)}%" title="${escapeHtml(seg.label)}: ${escapeHtml(formatTokens(seg.tokens))}"></span>`,
      );
    }
  }

  const threadOptions = conversations
    .map((conv) => {
      const selected = conv.conversationId === current?.conversationId ? " selected" : "";
      const pctSuffix =
        conv.usedPercent !== null ? ` (${Math.round(conv.usedPercent)}%)` : "";
      const rel = formatRelativeTime(conv.lastUpdated);
      const kindPrefix =
        conv.kind && conv.kind !== "interactive" ? `[${conv.kind}] ` : "";
      const label = `${kindPrefix}${conv.title}${pctSuffix}${rel ? ` · ${rel}` : ""}`;
      return `<option value="${escapeHtml(conv.conversationId)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");

  const primaryRows = [];
  if (current?.hasUsageData) {
    for (const seg of current.segments || []) {
      const showTip = Boolean(seg.detail);
      primaryRows.push(
        renderRow({
          segId: seg.id,
          swatchClass: `swatch-${seg.colorKey}`,
          label: seg.label,
          tipId: showTip ? `tip-seg-${seg.id}` : null,
          tipText: showTip
            ? `${seg.detail} Exact total active prompt is ${formatExactNumber(exact.activeTokens)} tokens.`
            : null,
          tokensSlot: `seg-tok-${seg.id}`,
          tokensText: formatTokens(seg.tokens),
          pctSlot: `seg-pct-${seg.id}`,
          pctText: seg.percent !== null ? formatPercent(seg.percent) : "—",
          pctMuted: seg.percent === null,
        }),
      );
    }

    if (hasWindow) {
      primaryRows.push(
        renderRow({
          swatchClass: "swatch-free",
          label: "Free space",
          tipId: "tip-free-space",
          tipText: `Remaining capacity before ${formatExactNumber(model.contextWindow)} tokens (${model.windowSource}). Antigravity may compact earlier automatically.`,
          tokensSlot: "free-tok",
          tokensText: formatTokens(exact.freeTokens),
          pctSlot: "free-pct",
          pctText: formatPercent(freePct),
        }),
      );
    }
  }

  const secondaryRows = [];
  if (current?.hasUsageData) {
    secondaryRows.push(
      renderRow({
        swatchClass: "swatch-muted",
        label: "Prompt cache hit",
        tipId: "tip-cache-hit",
        tipText: `Exact transcript counter: ${formatExactNumber(exact.cacheReadTokens)} cached + ${formatExactNumber(exact.inputTokens)} uncached input = ${formatExactNumber(exact.activeTokens)} active tokens (${exact.cacheHitPercent}% cached).`,
        tokensSlot: "cache-tok",
        tokensText: formatTokens(exact.cacheReadTokens),
        pctText: "—",
        pctMuted: true,
      }),
    );
  }

  if (mcpInfo) {
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
        tokensSlot: "mcp-tok",
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
        tokensSlot: "rules-skills-tok",
        tokensText: formatTokens(rulesInfo.estTokens + skillsInfo.estIndexTokens),
        pctText: "—",
        pctMuted: true,
      }),
    );
  }

  const allMcpServers = mcpInfo?.servers || [];
  const configuredServers = allMcpServers.filter((s) => s.active);
  const cachedServers = allMcpServers.filter((s) => !s.active);
  const mcpDrawerHtml =
    allMcpServers.length > 0
      ? `${renderMcpGroup("Configured", configuredServers, { active: true })}${renderMcpGroup("Cached on disk", cachedServers)}`
      : '<div class="sub-row"><span>No local MCP schemas found.</span></div>';

  const allowOpen = canOpenAuxFile();
  const wsSummaryLine = inventory?.workspace?.path
    ? `<div class="ws-active-note">Workspace: <span class="ws-active-path">${escapeHtml(inventory.workspace.path)}</span> (${escapeHtml(inventory.workspace.source)})</div>`
    : `<div class="ws-active-note">Workspace: Auto (none detected — pick a workspace above to scan project rules)</div>`;

  const ruleListHtml =
    rulesInfo?.items?.length > 0
      ? `<ul class="sub-list" role="list">${rulesInfo.items
          .map((r) => {
            const capBadge = r.overPerFileCap
              ? `<span class="badge badge-warn" title="Exceeds 24 KB per-file cap">&gt; 24 KB</span>`
              : "";
            const openBtn =
              allowOpen && r.fileUri
                ? `<button type="button" class="open-file-btn" data-open-file-uri="${escapeHtml(r.fileUri)}" title="Open ${escapeHtml(r.name)} in side pane" aria-label="Open ${escapeHtml(r.name)} in side pane">${renderOpenFileIcon()}</button>`
                : "";
            return `
              <li class="sub-row">
                <span class="sub-row-name">${escapeHtml(r.name)}</span>
                ${capBadge}
                <span class="sub-row-meta" data-slot="rule-${escapeHtml(r.name)}">${escapeHtml(r.scope)} · ~${escapeHtml(formatTokens(r.estTokens))}</span>
                ${openBtn}
              </li>`;
          })
          .join("")}</ul>`
      : '<div class="sub-row"><span>No global, plugin, or workspace rules found.</span></div>';

  const skillsRowHtml = skillsInfo
    ? `<div class="drawer-group">
         <div class="sub-row">
           <span class="sub-row-name">Skill headers</span>
           <span class="sub-row-meta" data-slot="skills-meta">${skillsInfo.count} (~${escapeHtml(formatTokens(skillsInfo.estIndexTokens))})</span>
           <span class="sub-row-note" data-slot="skills-scope">${escapeHtml(formatSkillsScope(skillsInfo.byScope))}</span>
         </div>
       </div>`
    : "";

  const errorBanner = lastError
    ? `<div class="error-banner" role="alert">${escapeHtml(lastError)}</div>`
    : "";

  const metaParts = [];
  if (current?.kind && current.kind !== "interactive") {
    metaParts.push(`<span class="badge badge-muted">${escapeHtml(current.kind)}</span>`);
  }
  if (model?.displayName) {
    metaParts.push(
      `<span class="meta-model" data-slot="meta-model">${escapeHtml(model.displayName)}</span>`,
    );
  }
  if (model?.windowSource) {
    metaParts.push(
      `<span class="meta-source" data-slot="meta-source">${escapeHtml(model.windowSource)}</span>`,
    );
  }
  if (exact && exact.checkpointCount > 0) {
    metaParts.push(
      `<span class="meta-compactions" data-slot="meta-compactions">${exact.checkpointCount} compaction${exact.checkpointCount === 1 ? "" : "s"}</span>`,
    );
  }

  const isAttached =
    Boolean(attachedConversationId) &&
    attachedConversationId === current?.conversationId;
  const attachControls =
    canAttachModelContext() && current?.hasUsageData
      ? `<button type="button" id="attach-context-btn" class="pill-btn${isAttached ? " is-attached" : ""}">${isAttached ? "Attached" : "Attach context"}</button>${isAttached ? '<button type="button" id="clear-context-btn" class="pill-btn pill-btn-quiet">Clear</button>' : ""}`
      : "";

  // Trajectory drawer
  const trajPoints = current?.trajectory?.points || [];
  const trajCountLabel = current?.trajectory
    ? `${current.trajectory.totalTurnCount} turns`
    : "Loading…";
  activeTrajectoryCoords =
    current?.trajectory && trajPoints.length >= 2
      ? computeTrajectoryGeometry(current.trajectory, model?.contextWindow)?.coords || null
      : null;

  const trajectoryDrawer = current?.hasUsageData
    ? `<details ${renderDrawerAttrs("trajectory", "drawer-card")}>
         <summary>
           ${renderChevronSvg()}
           <span>Trajectory</span>
           <span class="drawer-count">${escapeHtml(trajCountLabel)}</span>
         </summary>
         <div class="drawer-body drawer-body-flush">
           ${
             current.trajectory
               ? renderTrajectoryChart(current.trajectory, model?.contextWindow)
               : `<div class="traj-empty">Loading trajectory…</div>`
           }
         </div>
       </details>`
    : "";

  const topTools = current?.topTools || [];
  const topToolsDrawer = current?.hasUsageData
    ? `<details ${renderDrawerAttrs("top-tools", "drawer-card")}>
         <summary>
           ${renderChevronSvg()}
           <span>Top tools</span>
           <span class="drawer-count">${current.topTools ? String(topTools.length) : "…"}</span>
         </summary>
         <div class="drawer-body">
           ${
             current.topTools
               ? renderTopToolsContent(topTools)
               : `<div class="sub-empty">Loading tool attribution…</div>`
           }
         </div>
       </details>`
    : "";

  const artifacts = current?.artifacts;
  const artifactsDrawer = current
    ? `<details ${renderDrawerAttrs("artifacts", "drawer-card")}>
         <summary>
           ${renderChevronSvg()}
           <span>Artifacts</span>
           <span class="drawer-count">${artifacts ? `${artifacts.count}${artifacts.count > 0 ? ` · ~${formatTokens(artifacts.totalEstTokens)}` : ""}` : "…"}</span>
         </summary>
         <div class="drawer-body">
           ${
             artifacts
               ? renderArtifactsContent(artifacts)
               : `<div class="sub-empty">Loading artifacts…</div>`
           }
         </div>
       </details>`
    : "";

  const detailPairHtml =
    topToolsDrawer || artifactsDrawer
      ? `<div class="detail-pair">${topToolsDrawer}${artifactsDrawer}</div>`
      : "";

  return `
    <div class="inspector-inner">
      <header class="header">
        <div class="header-left">
          <h1 class="title">Context</h1>
          ${current?.title ? `<span class="header-thread-title" title="${escapeHtml(current.title)}">${escapeHtml(current.title)}</span>` : ""}
        </div>
        <div class="header-actions">
          ${renderWorkspacePicker(inventory)}
          ${attachControls}
          <button type="button" id="info-btn" class="icon-btn icon-btn-quiet" aria-label="About exact and estimated metrics" interestfor="tip-methodology" popovertarget="tip-methodology" popovertargetaction="show">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="8" cy="8" r="6"/>
              <path d="M8 7.5v3.5"/>
              <circle cx="8" cy="5.25" r="0.6" fill="currentColor" stroke="none"/>
            </svg>
          </button>
          <div id="tip-methodology" popover="hint" role="tooltip" class="tip-popover tip-popover-end">Total active tokens, cache split, output tokens, and checkpoints are exact from local transcript.jsonl. Category splits, tool attribution, and MCP/rule/artifact footprints are local estimates.</div>
          <button type="button" id="refresh-btn" class="icon-btn${isRefreshing ? " spinning" : ""}" aria-label="Refresh context metrics" title="Refresh (r)"${isRefreshing ? ' aria-disabled="true"' : ""}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.67"/>
              <path d="M13.5 2.5v2.75h-2.75"/>
            </svg>
          </button>
        </div>
      </header>

      ${errorBanner}

      <div class="thread-bar">
        <div class="thread-select-row">
          <label for="thread-select" class="sr-only">Conversation</label>
          <select id="thread-select" class="thread-select" ${conversations.length === 0 ? "disabled" : ""}>
            ${threadOptions || '<option value="">No interactive transcripts found</option>'}
          </select>
          <label class="toggle-chip" for="compact-subagents-toggle" title="Include subagent and background worker transcripts">
            <input id="compact-subagents-toggle" type="checkbox"${includeSubagents ? " checked" : ""} />
            <span>Show all</span>
          </label>
        </div>
        <div class="thread-meta">${metaParts.join("")}</div>
      </div>

      <div class="usage-block">
        <div class="usage-summary">
          <span class="usage-percent" data-slot="used-headline">${escapeHtml(usedHeadline)}</span>
          <span class="usage-fraction" data-slot="fraction-text">${escapeHtml(fractionText)}</span>
        </div>
        <div class="bar-track" role="img" aria-label="Context usage bar: ${escapeHtml(usedHeadline)}, ${escapeHtml(fractionText)}">
          ${barSegments.join("")}
        </div>
      </div>

      ${
        primaryRows.length > 0
          ? `<ul class="rows" role="list">${primaryRows.join("")}</ul>`
          : `<div class="empty-state">No planner token usage recorded in this conversation yet.</div>`
      }

      ${
        secondaryRows.length > 0
          ? `<ul class="rows rows-secondary" role="list">${secondaryRows.join("")}</ul>`
          : ""
      }

      <div class="drawers">
        ${trajectoryDrawer}
        ${detailPairHtml}

        <details ${renderDrawerAttrs("mcp")}>
          <summary>
            ${renderChevronSvg()}
            <span>MCP tools</span>
            <span class="drawer-count" data-slot="mcp-count">${escapeHtml(mcpHeaderCount)}</span>
          </summary>
          <div class="drawer-body">
            ${mcpDrawerHtml}
          </div>
        </details>

        <details ${renderDrawerAttrs("rules")}>
          <summary>
            ${renderChevronSvg()}
            <span>Rules &amp; skills</span>
            <span class="drawer-count" data-slot="rules-count">${escapeHtml(String((rulesInfo?.count ?? 0) + (skillsInfo?.count ?? 0)))}</span>
          </summary>
          <div class="drawer-body">
            ${wsSummaryLine}
            ${ruleListHtml}
            ${skillsRowHtml}
          </div>
        </details>

        ${
          current?.hasUsageData
            ? `<details ${renderDrawerAttrs("exact")}>
                <summary>
                  ${renderChevronSvg()}
                  <span>Exact transcript counters</span>
                  <span class="drawer-count" data-slot="exact-turns">${escapeHtml(String(exact.turnCount))} turns</span>
                </summary>
                <div class="drawer-body">
                  <dl class="kv-grid">
                    <dt class="kv-key">Active prompt</dt>
                    <dd class="kv-val" data-slot="kv-active">${escapeHtml(formatExactNumber(exact.activeTokens))}</dd>
                    <dt class="kv-key">Cache read</dt>
                    <dd class="kv-val" data-slot="kv-cache">${escapeHtml(formatExactNumber(exact.cacheReadTokens))} (${escapeHtml(String(exact.cacheHitPercent))}%)</dd>
                    <dt class="kv-key">Uncached input</dt>
                    <dd class="kv-val" data-slot="kv-uncached">${escapeHtml(formatExactNumber(exact.inputTokens))}</dd>
                    <dt class="kv-key">Last output</dt>
                    <dd class="kv-val" data-slot="kv-last-out">${escapeHtml(formatExactNumber(exact.lastOutputTokens))}</dd>
                    <dt class="kv-key">Session output</dt>
                    <dd class="kv-val" data-slot="kv-total-out">${escapeHtml(formatExactNumber(exact.totalOutputTokens))}</dd>
                    <dt class="kv-key">Cumulative input</dt>
                    <dd class="kv-val" data-slot="kv-cum-input">${escapeHtml(formatExactNumber(exact.cumulativeInputTokens))}</dd>
                    <dt class="kv-key">Cumulative cache read</dt>
                    <dd class="kv-val" data-slot="kv-cum-cache">${escapeHtml(formatExactNumber(exact.cumulativeCacheReadTokens))}</dd>
                    <dt class="kv-key">Cache invalidations</dt>
                    <dd class="kv-val" data-slot="kv-cache-inv">${escapeHtml(String(exact.cacheInvalidationCount ?? 0))}</dd>
                    <dt class="kv-key">Compactions</dt>
                    <dd class="kv-val" data-slot="kv-compactions">${escapeHtml(String(exact.checkpointCount))}</dd>
                    <dt class="kv-key">Model ID</dt>
                    <dd class="kv-val" data-slot="kv-model">${escapeHtml(model?.id || "—")}</dd>
                    <dt class="kv-key">Service</dt>
                    <dd class="kv-val" data-slot="kv-service">${escapeHtml(formatServiceStatus(serviceStatus))}</dd>
                    <dt class="kv-key">Updated</dt>
                    <dd class="kv-val" data-slot="updated-rel">${escapeHtml(formatRelativeTime(current.lastUpdated) || current.lastUpdated)}</dd>
                  </dl>
                </div>
              </details>`
            : ""
        }
      </div>
    </div>
  `;
}

function render() {
  if (!currentSnapshot) {
    rootEl.removeAttribute("aria-busy");
    if (lastError) {
      mountedStructureKey = "error";
      rootEl.innerHTML = `<div class="error-banner" role="alert">${escapeHtml(lastError)}</div>`;
    }
    return;
  }

  rootEl.removeAttribute("aria-busy");

  const activeEl = document.activeElement;
  const inspectorEl = document.getElementById("inspector");
  const restoreFocusId =
    activeEl &&
    activeEl instanceof HTMLElement &&
    (inspectorEl ? inspectorEl.contains(activeEl) : rootEl.contains(activeEl)) &&
    activeEl.id
      ? activeEl.id
      : null;

  const nextInspectorHtml = buildInspectorHtml();

  if (inspectorEl && document.getElementById("thread-rail")) {
    inspectorEl.innerHTML = nextInspectorHtml;
    wireInterestHints(inspectorEl);
  } else {
    rootEl.innerHTML = `
      <div class="shell">
        ${renderRailShell(railState, selectedConversationId)}
        <section class="inspector" id="inspector">
          ${nextInspectorHtml}
        </section>
      </div>
    `;
    wireInterestHints(rootEl);
  }

  syncRailSelectionHighlight();
  mountedStructureKey = computeStructureKey(currentSnapshot, lastError);
  lastRenderedFingerprint = computeSnapshotFingerprint(currentSnapshot);
  highlightedSegId = null;
  activeTrajectoryIndex = null;
  isTrajectoryPointerScrubbing = false;
  isTrajectoryKeyScrubbing = false;

  if (restoreFocusId) {
    document.getElementById(restoreFocusId)?.focus({ preventScroll: true });
  }
}

function updateRailBodyDom() {
  const kpisEl = document.getElementById("rail-kpis");
  const listEl = document.getElementById("rail-list");
  const footerEl = document.getElementById("rail-footer");
  if (kpisEl) kpisEl.innerHTML = renderFleetKpis(railState.fleet);
  if (listEl) {
    listEl.innerHTML = renderRailList(railState.items, selectedConversationId, {
      loading: railState.loading,
      error: railState.error,
    });
  }
  if (footerEl) {
    footerEl.innerHTML = renderRailFooter({
      shown: railState.items.length,
      totalMatching: railState.totalMatching,
      hasMore: railState.hasMore,
      loadingMore: railState.loadingMore,
    });
  }
}

function applySnapshotUpdate(snapshot, { userInitiated = false } = {}) {
  const nextFingerprint = computeSnapshotFingerprint(snapshot);
  const nextStructure = computeStructureKey(snapshot, lastError);

  if (
    currentSnapshot &&
    nextFingerprint === lastRenderedFingerprint &&
    !lastError &&
    mountedStructureKey === nextStructure
  ) {
    currentSnapshot = snapshot;
    patchRelativeTimeOnly(snapshot);
    return;
  }

  currentSnapshot = snapshot;

  if (mountedStructureKey && mountedStructureKey === nextStructure) {
    patchInPlace(snapshot);
    return;
  }

  if (!userInitiated && mountedStructureKey && isUserInteracting()) {
    pendingStructuralRender = true;
    return;
  }

  pendingStructuralRender = false;
  render();
}

async function savePrefsAndRefresh(patch, { refreshSnap = true, refreshList = false } = {}) {
  const caps = getHostCaps();
  if (!caps?.serverTools) return;
  try {
    await enqueueToolCall(() =>
      app.callServerTool({
        name: "set_context_preferences",
        arguments: patch,
      }),
    );
  } catch (err) {
    announceStatus(err instanceof Error ? err.message : "Failed to save preference");
  }
  if (refreshSnap) {
    void refreshSnapshot(selectedConversationId, { silent: false, reason: "prefs" });
  }
  if (refreshList && isWideMode) {
    void refreshRail({ silent: false, resetOffset: true });
  }
}

async function handleAttachContext() {
  if (!canAttachModelContext() || !currentSnapshot?.current?.hasUsageData) return;
  const text = formatAttachedContextSummary(currentSnapshot);
  if (!text) return;
  try {
    await app.updateModelContext({ content: [{ type: "text", text }] });
    attachedConversationId = currentSnapshot.current.conversationId;
    render();
    announceStatus("Context summary attached to next prompt");
  } catch (err) {
    announceStatus(err instanceof Error ? err.message : "Failed to attach context");
  }
}

async function handleClearAttachedContext() {
  if (!canAttachModelContext()) return;
  try {
    await app.updateModelContext({ content: [] });
    attachedConversationId = null;
    render();
    announceStatus("Attached context cleared");
  } catch (err) {
    announceStatus(err instanceof Error ? err.message : "Failed to clear attached context");
  }
}

async function handleOpenFile(uri) {
  if (!uri || !canOpenAuxFile()) return;
  try {
    const res = await app.request(
      {
        method: "com.google.antigravity/toggle-aux-pane",
        params: { tabType: "fileView", uri },
      },
      ToggleAuxPaneResultSchema,
    );
    if (res?.isError === true) {
      announceStatus("Could not open file in side pane");
    }
  } catch (err) {
    const code = err?.code;
    const msg = String(err?.message || "");
    if (code === -32601 || msg.includes("-32601") || msg.toLowerCase().includes("method not found")) {
      auxPaneOpenUnsupported = true;
      render();
    } else {
      announceStatus("Could not open file in side pane");
    }
  }
}

function bindDelegatedEvents() {
  rootEl.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.id === "thread-select") {
      const nextId = target.value;
      if (nextId) {
        selectedConversationId = nextId;
        hasExplicitConversationSelection = true;
        if (attachedConversationId && attachedConversationId !== nextId) {
          attachedConversationId = null;
        }
        void refreshSnapshot(nextId, { silent: false, reason: "thread" });
      }
      return;
    }

    if (target instanceof HTMLSelectElement && target.id === "workspace-select") {
      const nextWs = target.value ? target.value : null;
      selectedWorkspacePath = nextWs;
      void savePrefsAndRefresh({ workspacePath: nextWs }, { refreshSnap: true });
      announceStatus(nextWs ? `Workspace set to ${nextWs}` : "Workspace set to Auto");
      return;
    }

    if (target instanceof HTMLInputElement && target.id === "compact-subagents-toggle") {
      includeSubagents = target.checked;
      hasSyncedPreferences = true;
      railState.kind = includeSubagents ? "all" : "interactive";
      const railKindEl = document.getElementById("rail-kind");
      if (railKindEl instanceof HTMLSelectElement) {
        railKindEl.value = railState.kind;
      }
      void savePrefsAndRefresh(
        { includeSubagents },
        { refreshSnap: true, refreshList: true },
      );
      return;
    }

    if (target instanceof HTMLSelectElement && target.id === "rail-kind") {
      const nextKind = target.value;
      railState.kind = nextKind;
      if (nextKind === "interactive" || nextKind === "all") {
        const nextInclude = nextKind === "all";
        if (includeSubagents !== nextInclude) {
          includeSubagents = nextInclude;
          hasSyncedPreferences = true;
          const compactToggle = document.getElementById("compact-subagents-toggle");
          if (compactToggle instanceof HTMLInputElement) {
            compactToggle.checked = includeSubagents;
          }
          void savePrefsAndRefresh(
            { includeSubagents },
            { refreshSnap: true, refreshList: false },
          );
        }
      }
      void refreshRail({ silent: false, resetOffset: true });
      return;
    }

    if (target instanceof HTMLSelectElement && target.id === "rail-sort") {
      railState.sort = target.value;
      void refreshRail({ silent: false, resetOffset: true });
    }
  });

  rootEl.addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.id === "rail-search") {
      railState.query = target.value;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        void refreshRail({ silent: false, resetOffset: true });
      }, 180);
    }
  });

  rootEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest("#refresh-btn")) {
      void refreshSnapshot(selectedConversationId, { silent: false, reason: "manual" });
      if (isWideMode) void refreshRail({ silent: false, resetOffset: true });
      return;
    }

    if (target.closest("#attach-context-btn")) {
      void handleAttachContext();
      return;
    }

    if (target.closest("#clear-context-btn")) {
      void handleClearAttachedContext();
      return;
    }

    const openBtn = target.closest("[data-open-file-uri]");
    if (openBtn instanceof HTMLElement && openBtn.dataset.openFileUri) {
      void handleOpenFile(openBtn.dataset.openFileUri);
      return;
    }

    const filterChip = target.closest("[data-rail-filter]");
    if (filterChip instanceof HTMLElement && filterChip.dataset.railFilter) {
      const nextFilter = filterChip.dataset.railFilter;
      railState.filter = nextFilter;
      for (const chip of rootEl.querySelectorAll("[data-rail-filter]")) {
        chip.setAttribute(
          "aria-pressed",
          chip.dataset.railFilter === nextFilter ? "true" : "false",
        );
      }
      void refreshRail({ silent: false, resetOffset: true });
      return;
    }

    if (target.closest("#rail-load-more")) {
      void refreshRail({ silent: false, resetOffset: false });
      return;
    }

    const railItem = target.closest(".rail-item[data-conv-id]");
    if (railItem instanceof HTMLElement && railItem.dataset.convId) {
      const nextId = railItem.dataset.convId;
      selectedConversationId = nextId;
      hasExplicitConversationSelection = true;
      if (attachedConversationId && attachedConversationId !== nextId) {
        attachedConversationId = null;
      }
      syncRailSelectionHighlight();
      void refreshSnapshot(nextId, { silent: false, reason: "thread" });
    }
  });

  // Segment cross-highlight & full-plot trajectory scrubbing
  const scrubFromPointerEvent = (event, scrubber) => {
    if (!activeTrajectoryCoords || activeTrajectoryCoords.length === 0) return;
    const idx = findNearestTrajectoryIndex(
      activeTrajectoryCoords,
      event.clientX,
      scrubber.getBoundingClientRect(),
    );
    if (idx >= 0) {
      isTrajectoryPointerScrubbing = true;
      updateTrajectoryScrub(idx, { scrubbing: true });
    }
  };

  rootEl.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const scrubber = target.closest('[data-slot="traj-scrubber"]');
    if (scrubber instanceof Element) {
      scrubFromPointerEvent(event, scrubber);
    }
  });

  rootEl.addEventListener("pointermove", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const scrubber = target.closest('[data-slot="traj-scrubber"]');
    if (scrubber instanceof Element) {
      scrubFromPointerEvent(event, scrubber);
    }
  });

  rootEl.addEventListener("pointerover", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (hoverFineQuery && !hoverFineQuery.matches) return;
    const item = target.closest("[data-seg-id]");
    if (item instanceof HTMLElement) {
      setHighlight(item.dataset.segId);
    }
  });

  rootEl.addEventListener("pointerout", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const scrubber = target.closest('[data-slot="traj-scrubber"]');
    if (scrubber) {
      const related = event.relatedTarget;
      if (!(related instanceof Element) || !related.closest('[data-slot="traj-scrubber"]')) {
        isTrajectoryPointerScrubbing = false;
        if (!isTrajectoryKeyScrubbing && activeTrajectoryCoords) {
          updateTrajectoryScrub(activeTrajectoryCoords.length - 1, { scrubbing: false });
        }
        if (pendingStructuralRender && !isUserInteracting()) {
          pendingStructuralRender = false;
          render();
        }
      }
      return;
    }

    if (hoverFineQuery && !hoverFineQuery.matches) return;
    const item = target.closest("[data-seg-id]");
    if (!item) return;
    const related = event.relatedTarget;
    if (
      related instanceof Element &&
      related.closest("[data-seg-id]")?.dataset.segId === item.dataset.segId
    ) {
      return;
    }
    setHighlight(null);
  });

  rootEl.addEventListener("pointercancel", () => {
    if (!isTrajectoryPointerScrubbing) return;
    isTrajectoryPointerScrubbing = false;
    if (!isTrajectoryKeyScrubbing && activeTrajectoryCoords) {
      updateTrajectoryScrub(activeTrajectoryCoords.length - 1, { scrubbing: false });
    }
    if (pendingStructuralRender && !isUserInteracting()) {
      pendingStructuralRender = false;
      render();
    }
  });

  rootEl.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const scrubber = target.closest('[data-slot="traj-scrubber"]');
    if (scrubber && activeTrajectoryCoords && activeTrajectoryCoords.length > 0) {
      const idx =
        activeTrajectoryIndex !== null
          ? activeTrajectoryIndex
          : activeTrajectoryCoords.length - 1;
      updateTrajectoryScrub(idx, { scrubbing: true });
      return;
    }
    const item = target.closest("[data-seg-id]");
    if (item instanceof HTMLElement) {
      setHighlight(item.dataset.segId);
    }
  });

  rootEl.addEventListener("focusout", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-slot="traj-scrubber"]')) {
      isTrajectoryKeyScrubbing = false;
      if (!isTrajectoryPointerScrubbing && activeTrajectoryCoords) {
        updateTrajectoryScrub(activeTrajectoryCoords.length - 1, { scrubbing: false });
      }
      if (pendingStructuralRender && !isUserInteracting(event.relatedTarget)) {
        pendingStructuralRender = false;
        render();
      }
      return;
    }

    if (
      target instanceof HTMLElement &&
      (target.id === "thread-select" ||
        target.id === "workspace-select" ||
        target.id === "rail-search" ||
        target.id === "rail-sort" ||
        target.id === "rail-kind") &&
      pendingStructuralRender &&
      !isUserInteracting(event.relatedTarget)
    ) {
      pendingStructuralRender = false;
      render();
      return;
    }

    const item = target.closest("[data-seg-id]");
    if (!item) return;
    const related = event.relatedTarget;
    if (
      related instanceof Element &&
      related.closest("[data-seg-id]")?.dataset.segId === item.dataset.segId
    ) {
      return;
    }
    setHighlight(null);
  });

  // Keyboard shortcuts (IME-safe)
  document.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const active = document.activeElement;
    const inTextControl =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement;

    if (
      active instanceof HTMLElement &&
      active.dataset.slot === "traj-scrubber" &&
      activeTrajectoryCoords &&
      activeTrajectoryCoords.length > 0
    ) {
      const len = activeTrajectoryCoords.length;
      const cur = activeTrajectoryIndex !== null ? activeTrajectoryIndex : len - 1;
      let nextIdx = null;
      if (event.key === "ArrowLeft") {
        nextIdx = Math.max(0, cur - 1);
      } else if (event.key === "ArrowRight") {
        nextIdx = Math.min(len - 1, cur + 1);
      } else if (event.key === "Home") {
        nextIdx = 0;
      } else if (event.key === "End") {
        nextIdx = len - 1;
      }
      if (nextIdx !== null) {
        event.preventDefault();
        isTrajectoryKeyScrubbing = true;
        updateTrajectoryScrub(nextIdx, { scrubbing: true });
        return;
      }
      if (event.key === "Escape") {
        isTrajectoryKeyScrubbing = false;
        updateTrajectoryScrub(len - 1, { scrubbing: false });
      }
    }

    if (event.key === "Escape") {
      if (active instanceof HTMLInputElement && active.id === "rail-search" && active.value) {
        event.preventDefault();
        active.value = "";
        railState.query = "";
        void refreshRail({ silent: false, resetOffset: true });
        return;
      }
      for (const pop of document.querySelectorAll("[popover]:is(:popover-open, .\\:popover-open)")) {
        try {
          pop.hidePopover?.();
        } catch {}
      }
      return;
    }

    if (event.key === "/" && !inTextControl && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (isWideMode) {
        const searchEl = document.getElementById("rail-search");
        if (searchEl instanceof HTMLInputElement) {
          event.preventDefault();
          searchEl.focus();
          searchEl.select();
        }
      }
      return;
    }

    if (
      (event.key === "r" || event.key === "R") &&
      !inTextControl &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      void refreshSnapshot(selectedConversationId, { silent: false, reason: "manual" });
      if (isWideMode) void refreshRail({ silent: false, resetOffset: true });
      return;
    }

    const railList = document.getElementById("rail-list");
    if (
      railList &&
      active instanceof HTMLElement &&
      railList.contains(active) &&
      (event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "j" ||
        event.key === "k")
    ) {
      const items = Array.from(railList.querySelectorAll(".rail-item"));
      const curIdx = items.indexOf(active);
      if (curIdx !== -1 && items.length > 0) {
        event.preventDefault();
        const delta = event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
        const nextIdx = Math.max(0, Math.min(items.length - 1, curIdx + delta));
        items[nextIdx]?.focus();
      }
    }
  });
}

function syncPreferencesFromSnapshot(prefs) {
  if (!prefs) return;
  hasSyncedPreferences = true;
  if (selectedWorkspacePath === null && prefs.workspacePath) {
    selectedWorkspacePath = prefs.workspacePath;
  }
  includeSubagents = Boolean(prefs.includeSubagents);
  if (!railLoaded) {
    railState.kind = includeSubagents ? "all" : "interactive";
  } else if (includeSubagents && railState.kind === "interactive") {
    railState.kind = "all";
  }
}

async function refreshSnapshot(conversationId, { silent = false, reason = "manual" } = {}) {
  const caps = getHostCaps();
  if (!caps?.serverTools) return;

  const isHydrate = reason === "hydrate";
  const myHydrateKey = isHydrate ? (conversationId || "__default__") : null;
  if (isHydrate) {
    hydrateInFlightKey = myHydrateKey;
  }

  const mySeq = ++snapshotSeq;
  isRefreshing = true;
  const startedAt = performance.now();
  if (!silent) {
    lastError = null;
    if (refreshDoneTimer) {
      clearTimeout(refreshDoneTimer);
      refreshDoneTimer = null;
    }
    updateRefreshButtonState({ spinning: true, refreshed: false });
  }

  let succeeded = false;
  try {
    const args = {};
    if (conversationId) args.conversationId = conversationId;
    if (selectedWorkspacePath) args.workspacePath = selectedWorkspacePath;
    if (hasSyncedPreferences) {
      args.includeSubagents = includeSubagents;
    }

    const result = await enqueueToolCall(() =>
      app.callServerTool({
        name: "get_context_snapshot",
        arguments: args,
      }),
    );

    if (mySeq !== snapshotSeq) return;

    if (result?.structuredContent) {
      const snap = result.structuredContent;
      selectedConversationId = snap.selectedConversationId || selectedConversationId;
      hasHydratedDetails = true;
      syncPreferencesFromSnapshot(snap.preferences);
      lastError = null;
      applySnapshotUpdate(snap, { userInitiated: !silent });
      succeeded = true;
    }
  } catch (err) {
    if (mySeq !== snapshotSeq) return;
    lastError = err instanceof Error ? err.message : "Failed to refresh context snapshot";
    if (!silent || !currentSnapshot) {
      render();
    }
  } finally {
    if (mySeq === snapshotSeq) {
      if (isHydrate && hydrateInFlightKey === myHydrateKey) {
        hydrateInFlightKey = null;
      }
      if (!silent) {
        const elapsed = performance.now() - startedAt;
        if (elapsed < 350) {
          await new Promise((r) => setTimeout(r, 350 - elapsed));
        }
      }
      isRefreshing = false;
      updateRefreshButtonState({
        spinning: false,
        refreshed: !silent && succeeded,
      });
      if (!silent && succeeded) {
        refreshDoneTimer = setTimeout(() => {
          updateRefreshButtonState({ spinning: false, refreshed: false });
        }, 900);
        if (reason === "thread") {
          const title = currentSnapshot?.current?.title;
          announceStatus(title ? `Switched to ${title}` : "Conversation updated");
        } else if (reason !== "hydrate" && reason !== "prefs") {
          announceStatus("Context metrics refreshed");
        }
      } else if (!silent && lastError) {
        announceStatus(`Refresh failed: ${lastError}`);
      }
    }
  }
}

async function refreshRail({ silent = false, resetOffset = true } = {}) {
  const caps = getHostCaps();
  if (!caps?.serverTools) return;

  const wasRailLoaded = railLoaded;
  const mySeq = ++railSeq;
  const nextOffset = resetOffset ? 0 : railState.items.length;
  if (resetOffset) {
    railState.loading = !silent || railState.items.length === 0;
  } else {
    railState.loadingMore = true;
  }
  railState.error = null;
  updateRailBodyDom();

  try {
    const result = await enqueueToolCall(() =>
      app.callServerTool({
        name: "list_conversations",
        arguments: {
          query: railState.query,
          kind: railState.kind,
          filter: railState.filter,
          sort: railState.sort,
          offset: nextOffset,
          limit: railState.limit,
        },
      }),
    );

    if (mySeq !== railSeq) return;

    const data = result?.structuredContent;
    if (data) {
      railState.fleet = data.fleet || null;
      railState.totalMatching = data.totalMatching ?? 0;
      railState.hasMore = Boolean(data.hasMore);
      railState.offset = nextOffset;
      railState.items = resetOffset
        ? data.items || []
        : [...railState.items, ...(data.items || [])];
      railLoaded = true;
    }
  } catch (err) {
    if (mySeq !== railSeq) return;
    railState.error = err instanceof Error ? err.message : "Failed to load conversations";
  } finally {
    if (mySeq === railSeq) {
      railState.loading = false;
      railState.loadingMore = false;
      updateRailBodyDom();
      syncRailSelectionHighlight();
      if (
        !wasRailLoaded &&
        railLoaded &&
        !hasExplicitConversationSelection &&
        !hydrateInFlightKey &&
        !isRefreshing &&
        !railState.query &&
        railState.filter === "all" &&
        railState.sort === "recent" &&
        railState.items.length > 0 &&
        selectedConversationId !== railState.items[0].conversationId
      ) {
        void refreshSnapshot(railState.items[0].conversationId, {
          silent: true,
          reason: "hydrate",
        });
      }
    }
  }
}

function maybeHydrateMount() {
  if (!isConnected) return;
  const cur = currentSnapshot?.current;
  if (cur && cur.trajectory === undefined) {
    const hydrateCid = hasExplicitConversationSelection
      ? selectedConversationId
      : null;
    const nextKey = hydrateCid || "__default__";
    if (hydrateInFlightKey !== nextKey) {
      void refreshSnapshot(hydrateCid, { silent: true, reason: "hydrate" });
    }
  }
  if (isWideMode && !railLoaded) {
    void refreshRail({ silent: true, resetOffset: true });
  }
}

function measureContainerWidth() {
  const rectWidth = rootEl.getBoundingClientRect?.().width || 0;
  if (rectWidth > 0) return rectWidth;
  return document.documentElement?.clientWidth || window.innerWidth || 0;
}

function setupResizeObserver() {
  const updateWidth = (width) => {
    if (!width || width <= 0) return;
    const nextWide = width >= 760;
    if (nextWide !== isWideMode) {
      isWideMode = nextWide;
      if (isWideMode && !railLoaded && isConnected) {
        void refreshRail({ silent: true, resetOffset: true });
      }
      if (currentSnapshot) {
        if (!isUserInteracting()) {
          render();
        } else {
          pendingStructuralRender = true;
        }
      }
    }
  };

  isWideMode = measureContainerWidth() >= 760;

  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateWidth(entry.contentRect.width);
      }
    });
    ro.observe(rootEl);
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      !isRefreshing &&
      !isUserInteracting()
    ) {
      void refreshSnapshot(selectedConversationId, { silent: true });
      if (isWideMode) {
        void refreshRail({ silent: true, resetOffset: true });
      }
    }
  }, 15_000);
}

// Register SDK handlers BEFORE connect() so no initial notification is missed
app.ontoolinput = ({ arguments: args } = {}) => {
  if (args && typeof args.conversationId === "string" && args.conversationId) {
    selectedConversationId = args.conversationId;
    hasExplicitConversationSelection = true;
  } else {
    hasExplicitConversationSelection = false;
  }
  if (args && typeof args.workspacePath === "string" && args.workspacePath.trim()) {
    selectedWorkspacePath = args.workspacePath.trim();
  }
};

app.ontoolresult = (result) => {
  if (result?.structuredContent) {
    const snap = result.structuredContent;
    if (
      !hasExplicitConversationSelection &&
      hasHydratedDetails &&
      currentSnapshot?.generatedAt &&
      snap.generatedAt &&
      snap.generatedAt <= currentSnapshot.generatedAt
    ) {
      return;
    }

    const prevId = selectedConversationId;
    selectedConversationId = snap.selectedConversationId || selectedConversationId;
    if (prevId && selectedConversationId !== prevId && attachedConversationId) {
      attachedConversationId = null;
    }

    syncPreferencesFromSnapshot(snap.preferences);
    lastError = null;
    applySnapshotUpdate(snap, { userInitiated: true });
    maybeHydrateMount();
  }
};

app.ontoolcancelled = () => {
  isRefreshing = false;
  updateRefreshButtonState({ spinning: false, refreshed: false });
};

app.onhostcontextchanged = (ctx) => {
  applyThemeFromHost(ctx);
};

async function init() {
  setupHintFallbackAndAria();
  bindDelegatedEvents();
  setupResizeObserver();
  await ensureInterestPolyfill();
  await app.connect();
  isConnected = true;
  applyThemeFromHost(app.getHostContext());
  const measured = measureContainerWidth();
  if (measured > 0) {
    isWideMode = measured >= 760;
  }
  startPolling();

  if (!currentSnapshot) {
    void refreshSnapshot(
      hasExplicitConversationSelection ? selectedConversationId : null,
      { silent: true, reason: "hydrate" },
    );
    if (isWideMode && !railLoaded) {
      void refreshRail({ silent: true, resetOffset: true });
    }
  } else {
    render();
    maybeHydrateMount();
  }
}

void init();
