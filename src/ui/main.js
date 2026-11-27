import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

const rootEl = document.getElementById("app");
const statusLiveEl = document.getElementById("status-live");
const app = new App({ name: "Context Monitor", version: "0.1.2" }, {});

const hoverFineQuery = window.matchMedia?.("(hover: hover) and (pointer: fine)");

let currentSnapshot = null;
let selectedConversationId = null;
let isRefreshing = false;
let lastError = null;
let openDrawers = new Set();
let pollTimer = null;
let refreshDoneTimer = null;
let mountedStructureKey = null;
let lastRenderedFingerprint = null;
let pendingStructuralRender = false;
let highlightedSegId = null;

let openTipCount = 0;
let lastTipClosedAt = 0;

// Track toggletip triggers whose aria-expanded we manage
const managedTriggers = new WeakSet();

function announceStatus(message) {
  if (!statusLiveEl || !message) return;
  statusLiveEl.textContent = "";
  requestAnimationFrame(() => {
    statusLiveEl.textContent = message;
  });
}

function setupHintFallbackAndAria() {
  // Fallback where popover="hint" is unsupported (falls back to "manual" natively)
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

  // Sync aria-expanded + instant-swap counters from popover toggle events (capture)
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
  const drawers = rootEl.querySelectorAll("details[data-drawer-id]");
  if (drawers.length === 0) return;
  for (const el of drawers) {
    if (el.open) next.add(el.dataset.drawerId);
  }
  openDrawers = next;
}

function formatSkillsScope(byScope) {
  if (!byScope) return "";
  const base = `${byScope.plugin} plugin, ${byScope.global} global, ${byScope.builtin} builtin`;
  return byScope.workspace > 0 ? `${base}, ${byScope.workspace} workspace` : base;
}

function computeSnapshotFingerprint(snapshot) {
  if (!snapshot) return "";
  const { current, conversations = [], inventory } = snapshot;
  return JSON.stringify({
    selectedConversationId: snapshot.selectedConversationId || null,
    current: current
      ? {
          conversationId: current.conversationId,
          title: current.title,
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
          mcp: inventory.mcp?.servers?.map((s) => [
            s.name,
            s.active,
            s.toolCount,
            s.estSchemaTokens,
            s.estInstructionTokens,
          ]),
          rules: inventory.rules?.items?.map((r) => [r.name, r.scope, r.estTokens]),
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
  return JSON.stringify({
    hasError: Boolean(error),
    conversationId: current?.conversationId || null,
    hasUsageData: Boolean(current?.hasUsageData),
    hasWindow:
      current?.model?.contextWindow !== null &&
      current?.model?.contextWindow !== undefined,
    compactions: (current?.exact?.checkpointCount || 0) > 0,
    segments: (current?.segments || [])
      .filter((s) => s.tokens > 0)
      .map((s) => s.id),
    allSegments: (current?.segments || []).map((s) => s.id),
    convIds: conversations.map((c) => c.conversationId),
    mcpServers: (inventory?.mcp?.servers || []).map((s) => [s.name, s.active]),
    ruleNames: (inventory?.rules?.items || []).map((r) => r.name),
    hasSkills: Boolean(inventory?.skills),
  });
}

function isUserInteracting() {
  const active = document.activeElement;
  if (active && active.id === "thread-select") return true;
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

function renderChevronSvg() {
  return `<svg class="drawer-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>`;
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

function patchInPlace(snapshot) {
  const { current, conversations = [], inventory } = snapshot;
  const m = computeMetrics(snapshot);
  const { exact, model, hasWindow, usedHeadline, fractionText, denom, freePct, mcpInfo, mcpEst, mcpHeaderCount } = m;

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
    const barEl = rootEl.querySelector(`.bar-segment[data-seg-id="${CSS.escape(seg.id)}"]`);
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
    setSlot("kv-compactions", String(exact.checkpointCount));
    setSlot("kv-model", model?.id || "—");
    setSlot(
      "updated-rel",
      formatRelativeTime(current.lastUpdated) || current.lastUpdated || "—",
    );
    setSlot("exact-turns", `${exact.turnCount} turns`);
  }

  if (mcpInfo) {
    setSlot("mcp-tok", formatTokens(mcpEst));
    setSlot("mcp-count", mcpHeaderCount);
    for (const srv of mcpInfo.servers || []) {
      const totalEst = formatTokens(srv.estSchemaTokens + srv.estInstructionTokens);
      const instrNote = srv.hasInstructions ? " · instructions" : "";
      setSlot(`mcp-srv-${srv.name}`, `${srv.toolCount} tools · ~${totalEst}${instrNote}`);
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

function render() {
  captureDrawerStates();

  if (!currentSnapshot) {
    rootEl.removeAttribute("aria-busy");
    if (lastError) {
      mountedStructureKey = "error";
      rootEl.innerHTML = `<div class="error-banner" role="alert">${escapeHtml(lastError)}</div>`;
    }
    return;
  }

  rootEl.removeAttribute("aria-busy");
  const { current, conversations = [], inventory } = currentSnapshot;
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

  // Save focused control ID inside rootEl before rebuild
  const activeEl = document.activeElement;
  const restoreFocusId =
    activeEl && activeEl instanceof HTMLElement && rootEl.contains(activeEl) && activeEl.id
      ? activeEl.id
      : null;

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
      const label = `${conv.title}${pctSuffix}${rel ? ` · ${rel}` : ""}`;
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

  // Grouped MCP drawer (Configured vs Cached on disk)
  const allMcpServers = mcpInfo?.servers || [];
  const configuredServers = allMcpServers.filter((s) => s.active);
  const cachedServers = allMcpServers.filter((s) => !s.active);
  const mcpDrawerHtml =
    allMcpServers.length > 0
      ? `${renderMcpGroup("Configured", configuredServers, { active: true })}${renderMcpGroup("Cached on disk", cachedServers)}`
      : '<div class="sub-row"><span>No local MCP schemas found.</span></div>';

  const ruleListHtml =
    rulesInfo?.items?.length > 0
      ? `<ul class="sub-list" role="list">${rulesInfo.items
          .map(
            (r) => `
          <li class="sub-row">
            <span class="sub-row-name">${escapeHtml(r.name)}</span>
            <span class="sub-row-meta" data-slot="rule-${escapeHtml(r.name)}">${escapeHtml(r.scope)} · ~${escapeHtml(formatTokens(r.estTokens))}</span>
          </li>`,
          )
          .join("")}</ul>`
      : '<div class="sub-row"><span>No global or plugin rules found.</span></div>';

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

  rootEl.innerHTML = `
    <header class="header">
      <div class="header-left">
        <h1 class="title">Context</h1>
      </div>
      <div class="header-actions">
        <button type="button" id="info-btn" class="icon-btn icon-btn-quiet" aria-label="About exact and estimated metrics" interestfor="tip-methodology" popovertarget="tip-methodology" popovertargetaction="show">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="8" cy="8" r="6"/>
            <path d="M8 7.5v3.5"/>
            <circle cx="8" cy="5.25" r="0.6" fill="currentColor" stroke="none"/>
          </svg>
        </button>
        <div id="tip-methodology" popover="hint" role="tooltip" class="tip-popover tip-popover-end">Total active tokens, cache split, output tokens, and checkpoints are exact from local transcript.jsonl. Category splits and MCP/rule footprints are local estimates because server-side prompt categories are not stored in transcripts.</div>
        <button type="button" id="refresh-btn" class="icon-btn${isRefreshing ? " spinning" : ""}" aria-label="Refresh context metrics" title="Refresh"${isRefreshing ? ' aria-disabled="true"' : ""}>
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
      <details class="drawer" data-drawer-id="mcp"${openDrawers.has("mcp") ? " open" : ""}>
        <summary>
          ${renderChevronSvg()}
          <span>MCP tools</span>
          <span class="drawer-count" data-slot="mcp-count">${escapeHtml(mcpHeaderCount)}</span>
        </summary>
        <div class="drawer-body">
          ${mcpDrawerHtml}
        </div>
      </details>

      <details class="drawer" data-drawer-id="rules"${openDrawers.has("rules") ? " open" : ""}>
        <summary>
          ${renderChevronSvg()}
          <span>Rules &amp; skills</span>
          <span class="drawer-count" data-slot="rules-count">${escapeHtml(String((rulesInfo?.count ?? 0) + (skillsInfo?.count ?? 0)))}</span>
        </summary>
        <div class="drawer-body">
          ${ruleListHtml}
          ${skillsRowHtml}
        </div>
      </details>

      ${
        current?.hasUsageData
          ? `<details class="drawer" data-drawer-id="exact"${openDrawers.has("exact") ? " open" : ""}>
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
                  <dt class="kv-key">Compactions</dt>
                  <dd class="kv-val" data-slot="kv-compactions">${escapeHtml(String(exact.checkpointCount))}</dd>
                  <dt class="kv-key">Model ID</dt>
                  <dd class="kv-val" data-slot="kv-model">${escapeHtml(model?.id || "—")}</dd>
                  <dt class="kv-key">Updated</dt>
                  <dd class="kv-val" data-slot="updated-rel">${escapeHtml(formatRelativeTime(current.lastUpdated) || current.lastUpdated)}</dd>
                </dl>
              </div>
            </details>`
          : ""
      }
    </div>
  `;

  wireInterestHints(rootEl);
  mountedStructureKey = computeStructureKey(currentSnapshot, lastError);
  lastRenderedFingerprint = computeSnapshotFingerprint(currentSnapshot);
  highlightedSegId = null;

  if (restoreFocusId) {
    document.getElementById(restoreFocusId)?.focus({ preventScroll: true });
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

function bindDelegatedEvents() {
  rootEl.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.id === "thread-select") {
      const nextId = target.value;
      if (nextId) {
        selectedConversationId = nextId;
        void refreshSnapshot(nextId, { silent: false, reason: "thread" });
      }
    }
  });

  rootEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest("#refresh-btn");
    if (btn) {
      void refreshSnapshot(selectedConversationId, { silent: false, reason: "manual" });
    }
  });

  rootEl.addEventListener("focusout", (event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.id === "thread-select" &&
      pendingStructuralRender &&
      !isUserInteracting()
    ) {
      pendingStructuralRender = false;
      render();
    }
  });

  // Cross-highlight matching bar segment & breakdown row
  rootEl.addEventListener("pointerover", (event) => {
    if (hoverFineQuery && !hoverFineQuery.matches) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const item = target.closest("[data-seg-id]");
    if (item instanceof HTMLElement) {
      setHighlight(item.dataset.segId);
    }
  });

  rootEl.addEventListener("pointerout", (event) => {
    if (hoverFineQuery && !hoverFineQuery.matches) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const item = target.closest("[data-seg-id]");
    if (!item) return;
    const related = event.relatedTarget;
    if (related instanceof Element && related.closest("[data-seg-id]")?.dataset.segId === item.dataset.segId) {
      return;
    }
    setHighlight(null);
  });

  rootEl.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const item = target.closest("[data-seg-id]");
    if (item instanceof HTMLElement) {
      setHighlight(item.dataset.segId);
    }
  });

  rootEl.addEventListener("focusout", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const item = target.closest("[data-seg-id]");
    if (!item) return;
    const related = event.relatedTarget;
    if (related instanceof Element && related.closest("[data-seg-id]")?.dataset.segId === item.dataset.segId) {
      return;
    }
    setHighlight(null);
  });
}

async function refreshSnapshot(conversationId, { silent = false, reason = "manual" } = {}) {
  if (isRefreshing) return;
  const caps = app.getHostCapabilities();
  if (!caps?.serverTools) return;

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
    const args = conversationId ? { conversationId } : {};
    const result = await app.callServerTool({
      name: "get_context_snapshot",
      arguments: args,
    });
    if (result?.structuredContent) {
      selectedConversationId =
        result.structuredContent.selectedConversationId || selectedConversationId;
      lastError = null;
      applySnapshotUpdate(result.structuredContent, { userInitiated: !silent });
      succeeded = true;
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Failed to refresh context snapshot";
    if (!silent || !currentSnapshot) {
      render();
    }
  } finally {
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
      } else {
        announceStatus("Context metrics refreshed");
      }
    } else if (!silent && lastError) {
      announceStatus(`Refresh failed: ${lastError}`);
    }
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
    selectedConversationId =
      result.structuredContent.selectedConversationId || selectedConversationId;
    lastError = null;
    applySnapshotUpdate(result.structuredContent, { userInitiated: true });
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
