import { escapeHtml, formatRelativeTime } from "./format.js";

const FILTER_OPTIONS = [
  { id: "all", label: "All" },
  { id: "high_usage", label: "≥ 70%" },
  { id: "checkpointed", label: "Checkpointed" },
  { id: "running", label: "Running" },
];

export function renderFleetKpis(fleet) {
  if (!fleet) {
    return `<div class="rail-kpis-empty">Loading fleet…</div>`;
  }
  const runningCell =
    fleet.runningCount > 0
      ? `<div class="kpi-cell kpi-cell-running"><span class="kpi-val">${fleet.runningCount}</span><span class="kpi-lbl">Running</span></div>`
      : "";
  return `
    <div class="kpi-grid">
      <div class="kpi-cell">
        <span class="kpi-val">${fleet.interactiveCount} <span class="kpi-sub">/ ${fleet.totalTracked}</span></span>
        <span class="kpi-lbl">Interactive</span>
      </div>
      <div class="kpi-cell">
        <span class="kpi-val">${fleet.highUsageInteractiveCount}</span>
        <span class="kpi-lbl">&ge; 70% used</span>
      </div>
      <div class="kpi-cell">
        <span class="kpi-val">${fleet.checkpointedInteractiveCount}</span>
        <span class="kpi-lbl">Checkpointed</span>
      </div>
      ${runningCell}
    </div>
  `;
}

export function renderRailList(
  items,
  selectedConversationId,
  { loading = false, error = null } = {},
) {
  if (error) {
    return `<div class="rail-empty" role="alert">${escapeHtml(error)}</div>`;
  }
  if (loading && (!items || items.length === 0)) {
    return `
      <div class="rail-skel-list" aria-hidden="true">
        <div class="skel rail-skel-item"></div>
        <div class="skel rail-skel-item"></div>
        <div class="skel rail-skel-item"></div>
        <div class="skel rail-skel-item"></div>
      </div>
    `;
  }
  if (!items || items.length === 0) {
    return `<div class="rail-empty">No matching conversations.</div>`;
  }

  return items
    .map((conv) => {
      const isSelected = conv.conversationId === selectedConversationId;
      const pct =
        conv.usedPercent !== null && conv.usedPercent !== undefined
          ? Math.round(conv.usedPercent)
          : null;
      const barWidth = pct !== null ? Math.max(2, Math.min(100, conv.usedPercent)) : 0;
      const isHigh = pct !== null && conv.usedPercent >= 70;
      const isRunning = conv.runState === "RUN_STATE_RUNNING";
      const rel = formatRelativeTime(conv.lastUpdated);

      const badges = [];
      if (conv.kind && conv.kind !== "interactive") {
        badges.push(`<span class="badge badge-muted">${escapeHtml(conv.kind)}</span>`);
      }
      if (conv.checkpointCount > 0) {
        badges.push(`<span class="badge">${conv.checkpointCount} cp</span>`);
      }

      return `
        <button type="button" class="rail-item" data-conv-id="${escapeHtml(conv.conversationId)}" aria-current="${isSelected ? "true" : "false"}">
          <div class="rail-item-top">
            ${isRunning ? '<span class="running-dot" title="Running" aria-label="Running"></span>' : ""}
            <span class="rail-item-title">${escapeHtml(conv.title)}</span>
            <span class="rail-item-pct${isHigh ? " is-high" : ""}">${pct !== null ? `${pct}%` : "—"}</span>
          </div>
          <div class="rail-item-meta">
            <span class="rail-item-model">${escapeHtml(conv.modelName || "Unknown")}</span>
            ${rel ? `<span class="rail-item-time">${escapeHtml(rel)}</span>` : ""}
            ${badges.join("")}
          </div>
          ${
            pct !== null
              ? `<span class="rail-mini-track" aria-hidden="true"><span class="rail-mini-fill${isHigh ? " is-high" : ""}" style="width:${barWidth.toFixed(1)}%"></span></span>`
              : ""
          }
        </button>
      `;
    })
    .join("");
}

export function renderRailFooter({ shown, totalMatching, hasMore, loadingMore }) {
  const countText = totalMatching > 0 ? `Showing ${shown} of ${totalMatching}` : "0 matching";
  const moreBtn = hasMore
    ? `<button type="button" id="rail-load-more" class="pill-btn" ${loadingMore ? "disabled" : ""}>${loadingMore ? "Loading…" : "Load more"}</button>`
    : "";
  return `
    <span class="rail-footer-count">${escapeHtml(countText)}</span>
    ${moreBtn}
  `;
}

export function renderRailShell(railState, selectedConversationId) {
  const filterButtons = FILTER_OPTIONS.map((opt) => {
    const active = railState.filter === opt.id;
    return `<button type="button" class="chip-btn" data-rail-filter="${escapeHtml(opt.id)}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(opt.label)}</button>`;
  }).join("");

  return `
    <aside class="thread-rail" id="thread-rail" aria-label="Tracked conversations">
      <div class="rail-sticky">
        <div class="rail-kpis" id="rail-kpis">${renderFleetKpis(railState.fleet)}</div>
        <div class="rail-toolbar" id="rail-toolbar">
          <div class="rail-search-wrap">
            <label for="rail-search" class="sr-only">Search conversations</label>
            <input id="rail-search" class="rail-search" type="search" placeholder="Search threads, models, IDs…" value="${escapeHtml(railState.query)}" autocomplete="off" spellcheck="false" />
          </div>
          <div class="rail-select-row">
            <label for="rail-kind" class="sr-only">Thread kind</label>
            <select id="rail-kind" class="rail-select">
              <option value="interactive"${railState.kind === "interactive" ? " selected" : ""}>Interactive</option>
              <option value="all"${railState.kind === "all" ? " selected" : ""}>Show all</option>
              <option value="subagent"${railState.kind === "subagent" ? " selected" : ""}>Subagents</option>
              <option value="background"${railState.kind === "background" ? " selected" : ""}>Background</option>
            </select>
            <label for="rail-sort" class="sr-only">Sort order</label>
            <select id="rail-sort" class="rail-select">
              <option value="recent"${railState.sort === "recent" ? " selected" : ""}>Recent</option>
              <option value="usage_desc"${railState.sort === "usage_desc" ? " selected" : ""}>Highest usage</option>
              <option value="tokens_desc"${railState.sort === "tokens_desc" ? " selected" : ""}>Most tokens</option>
              <option value="checkpoints_desc"${railState.sort === "checkpoints_desc" ? " selected" : ""}>Checkpoints</option>
            </select>
          </div>
          <div class="rail-chips" role="group" aria-label="Filter conversations">
            ${filterButtons}
          </div>
        </div>
      </div>
      <div class="rail-list" id="rail-list" role="region" aria-label="Conversation results">
        ${renderRailList(railState.items, selectedConversationId, { loading: railState.loading, error: railState.error })}
      </div>
      <div class="rail-footer" id="rail-footer">
        ${renderRailFooter({ shown: railState.items.length, totalMatching: railState.totalMatching, hasMore: railState.hasMore, loadingMore: railState.loadingMore })}
      </div>
    </aside>
  `;
}
