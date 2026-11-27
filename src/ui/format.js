export function formatTokens(n) {
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

export function formatExactNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US");
}

export function formatPercent(pct, digits = 1) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "—";
  return `${Number(pct).toFixed(digits)}%`;
}

export function formatRelativeTime(iso) {
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

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatSkillsScope(byScope) {
  if (!byScope) return "";
  const base = `${byScope.plugin} plugin, ${byScope.global} global, ${byScope.builtin} builtin`;
  return byScope.workspace > 0 ? `${base}, ${byScope.workspace} workspace` : base;
}

export function shortenPath(fullPath) {
  if (!fullPath || typeof fullPath !== "string") return "";
  const parts = fullPath.split("/").filter(Boolean);
  if (parts.length <= 2) return fullPath;
  return `…/${parts.slice(-2).join("/")}`;
}

export function formatWorkspaceLabel(wsPath, knownWorkspaces = []) {
  if (!wsPath) return "Auto";
  const match = Array.isArray(knownWorkspaces)
    ? knownWorkspaces.find((w) => w.path === wsPath)
    : null;
  if (match?.name) return match.name;
  const parts = wsPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || wsPath;
}

export function formatServiceStatus(serviceStatus) {
  if (!serviceStatus) return "—";
  if (serviceStatus.reachable) {
    return serviceStatus.reason === "partial"
      ? `Partial (${serviceStatus.enrichedCount} enriched)`
      : `Online (${serviceStatus.enrichedCount} enriched)`;
  }
  return `Offline (${serviceStatus.reason || "unavailable"})`;
}

export function formatAttachedContextSummary(snapshot) {
  const cur = snapshot?.current;
  if (!cur || !cur.hasUsageData) return "";

  const ex = cur.exact;
  const modelName = cur.model?.displayName || cur.model?.id || "Unknown";
  const winStr = cur.model?.contextWindow
    ? `${formatTokens(ex.activeTokens)} / ${formatTokens(cur.model.contextWindow)} (${formatPercent(ex.usedPercent)})`
    : `${formatTokens(ex.activeTokens)} active`;

  const topSegs = [...(cur.segments || [])]
    .filter((s) => s.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 3)
    .map(
      (s) =>
        `${s.label}: ${formatTokens(s.tokens)}${s.percent !== null ? ` (${formatPercent(s.percent)})` : ""}`,
    )
    .join(", ");

  const wsPath = snapshot?.inventory?.workspace?.path;
  const lines = [
    `[Context Monitor] ${cur.title} (${cur.conversationId})`,
    `Model: ${modelName} | Prompt: ${winStr} | Cache: ${formatPercent(ex.cacheHitPercent)} | Checkpoints: ${ex.checkpointCount}`,
  ];
  if (topSegs) lines.push(`Top segments: ${topSegs}`);
  if (wsPath) lines.push(`Workspace: ${wsPath}`);

  const text = lines.join("\n");
  return text.length > 590 ? `${text.slice(0, 587)}...` : text;
}
