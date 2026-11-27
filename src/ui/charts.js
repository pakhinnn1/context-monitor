import { escapeHtml, formatPercent, formatTokens } from "./format.js";

const SVG_W = 600;
const SVG_H = 150;
const PLOT_W = SVG_W;
const PLOT_H = SVG_H;

export function formatTrajectoryReadout(pt) {
  if (!pt) return "—";
  const cachePct = pt.activeTokens > 0 ? (pt.cacheReadTokens / pt.activeTokens) * 100 : 0;
  const kindTag =
    pt.kind === "checkpoint_peak"
      ? " · Checkpoint peak"
      : pt.kind === "checkpoint_baseline"
        ? " · Post-compaction"
        : "";
  return `Turn ${pt.turn} · ${formatTokens(pt.activeTokens)} active (${formatTokens(pt.cacheReadTokens)} cached, ${formatPercent(cachePct)}) · ${formatTokens(pt.outputTokens)} out${kindTag}`;
}

export function computeTrajectoryGeometry(trajectory, contextWindow) {
  const points = trajectory?.points || [];
  if (points.length < 2) return null;

  let maxActive = 0;
  for (const pt of points) {
    if (pt.activeTokens > maxActive) maxActive = pt.activeTokens;
  }
  const maxY = Math.max(contextWindow || 0, maxActive, 1);
  const n = points.length;

  const coords = points.map((pt, i) => {
    const x = (i / (n - 1)) * PLOT_W;
    const clampedActive = Math.max(0, Math.min(pt.activeTokens, maxY));
    const clampedCache = Math.max(0, Math.min(pt.cacheReadTokens, maxY));
    const yActive = PLOT_H - (clampedActive / maxY) * PLOT_H;
    const yCache = PLOT_H - (clampedCache / maxY) * PLOT_H;
    const xPct = (x / PLOT_W) * 100;
    const yActivePct = (yActive / PLOT_H) * 100;
    const yCachePct = (yCache / PLOT_H) * 100;
    return { x, yActive, yCache, xPct, yActivePct, yCachePct, pt, idx: i };
  });

  return { coords, maxY };
}

export function findNearestTrajectoryIndex(coords, clientX, rect) {
  if (!Array.isArray(coords) || coords.length === 0) return -1;
  if (coords.length === 1) return 0;
  if (!rect || !(rect.width > 0)) return coords.length - 1;

  const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const minX = coords[0].x;
  const maxX = coords[coords.length - 1].x;
  const span = maxX - minX;
  const targetX = span > 0 ? minX + frac * span : minX;

  let bestIdx = 0;
  let bestDist = Math.abs(coords[0].x - targetX);
  for (let i = 1; i < coords.length; i += 1) {
    const dist = Math.abs(coords[i].x - targetX);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function renderTrajectoryChart(trajectory, contextWindow, activeIdx = null) {
  const points = trajectory?.points;
  if (!points || points.length === 0) {
    return `<div class="traj-empty">No turn trajectory data recorded yet.</div>`;
  }

  if (points.length < 2) {
    return `
      <div class="traj-single">
        <span class="traj-single-text">${escapeHtml(formatTrajectoryReadout(points[0]))}</span>
      </div>
    `;
  }

  const geom = computeTrajectoryGeometry(trajectory, contextWindow);
  const { coords, maxY } = geom;
  const isScrubbing = activeIdx !== null && activeIdx >= 0 && activeIdx < coords.length;
  const focusIdx = isScrubbing ? activeIdx : coords.length - 1;
  const focusCoord = coords[focusIdx];
  const readoutText = formatTrajectoryReadout(focusCoord.pt);

  const activePoly = coords.map((c) => `${c.x.toFixed(1)},${c.yActive.toFixed(1)}`).join(" ");

  const firstX = coords[0].x.toFixed(1);
  const lastX = coords[coords.length - 1].x.toFixed(1);
  const baseLineY = PLOT_H.toFixed(1);
  const cacheAreaPath = [
    `M ${firstX} ${baseLineY}`,
    ...coords.map((c) => `L ${c.x.toFixed(1)} ${c.yCache.toFixed(1)}`),
    `L ${lastX} ${baseLineY}`,
    "Z",
  ].join(" ");

  // Horizontal gridlines (0%, 50%, 100%)
  const gridLevels = [
    { frac: 1, val: maxY },
    { frac: 0.5, val: Math.round(maxY / 2) },
    { frac: 0, val: 0 },
  ];
  const gridLinesHtml = gridLevels
    .map(({ frac }) => {
      const y = (PLOT_H * (1 - frac)).toFixed(1);
      return `<line class="traj-grid" x1="0" y1="${y}" x2="${PLOT_W}" y2="${y}" />`;
    })
    .join("");
  const yLabelsHtml = gridLevels
    .map(({ val }) => `<span class="traj-y-label">${escapeHtml(formatTokens(val))}</span>`)
    .join("");

  // Optional 75% compaction-watch threshold when contextWindow is known
  let thresholdHtml = "";
  let thresholdLabelHtml = "";
  if (contextWindow && contextWindow > 0 && contextWindow * 0.75 <= maxY) {
    const thresholdFrac = (contextWindow * 0.75) / maxY;
    const y75 = (PLOT_H - thresholdFrac * PLOT_H).toFixed(1);
    const topPct = ((1 - thresholdFrac) * 100).toFixed(2);
    thresholdHtml = `<line class="traj-threshold" x1="0" y1="${y75}" x2="${PLOT_W}" y2="${y75}" />`;
    thresholdLabelHtml = `<span class="traj-threshold-lbl" aria-hidden="true" style="top:${topPct}%">75%</span>`;
  }

  // Compaction vertical lines and markers
  const cpLines = [];
  const milestoneMarkers = [];
  for (let i = 0; i < coords.length; i += 1) {
    const c = coords[i];
    if (c.pt.kind === "checkpoint_peak") {
      const next = coords[i + 1];
      const lineX =
        next && next.pt.kind === "checkpoint_baseline"
          ? ((c.x + next.x) / 2).toFixed(1)
          : Math.min(PLOT_W, c.x + 4).toFixed(1);
      cpLines.push(
        `<line class="traj-cp-line" x1="${lineX}" y1="0" x2="${lineX}" y2="${baseLineY}" />`,
      );
      milestoneMarkers.push(
        `<span class="traj-cp-peak" aria-hidden="true" style="left:${c.xPct.toFixed(2)}%;top:${c.yActivePct.toFixed(2)}%"></span>`,
      );
    } else if (c.pt.kind === "checkpoint_baseline") {
      milestoneMarkers.push(
        `<span class="traj-cp-base" aria-hidden="true" style="left:${c.xPct.toFixed(2)}%;top:${c.yActivePct.toFixed(2)}%"></span>`,
      );
    }
  }

  const legendCp =
    trajectory.checkpointCount > 0
      ? `<span class="traj-legend-item"><span class="traj-legend-dot traj-legend-cp"></span>Compaction</span>`
      : "";

  const boundedCaption = trajectory.isBounded
    ? `<p class="traj-caption">Showing Turn 1, checkpoint milestones, and last 120 active-epoch turns of ${escapeHtml(String(trajectory.totalTurnCount))}</p>`
    : "";

  return `
    <div class="traj-wrap">
      <div class="traj-readout" data-slot="traj-readout" data-scrubbing="${isScrubbing ? "true" : "false"}">${escapeHtml(readoutText)}</div>
      <div class="traj-chart">
        <div class="traj-y-axis" aria-hidden="true">${yLabelsHtml}</div>
        <div
          class="traj-plot"
          id="traj-scrubber"
          data-slot="traj-scrubber"
          tabindex="0"
          role="slider"
          aria-label="Context growth trajectory"
          aria-describedby="traj-desc"
          aria-valuemin="1"
          aria-valuemax="${points.length}"
          aria-valuenow="${focusIdx + 1}"
          aria-valuetext="${escapeHtml(readoutText)}"
        >
          <svg class="traj-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            ${gridLinesHtml}
            ${thresholdHtml}
            <path class="traj-cache-area" d="${cacheAreaPath}" />
            ${cpLines.join("")}
            <polyline class="traj-active-line" points="${activePoly}" />
            <line class="traj-crosshair" data-slot="traj-crosshair" data-active="${isScrubbing ? "true" : "false"}" x1="${focusCoord.x.toFixed(1)}" y1="0" x2="${focusCoord.x.toFixed(1)}" y2="${PLOT_H}" />
          </svg>
          ${milestoneMarkers.join("")}
          <span class="traj-cache-dot" data-slot="traj-cache-dot" data-active="${isScrubbing ? "true" : "false"}" aria-hidden="true" style="left:${focusCoord.xPct.toFixed(2)}%;top:${focusCoord.yCachePct.toFixed(2)}%"></span>
          <span class="traj-active-dot" data-slot="traj-active-dot" data-active="${isScrubbing ? "true" : "false"}" aria-hidden="true" style="left:${focusCoord.xPct.toFixed(2)}%;top:${focusCoord.yActivePct.toFixed(2)}%"></span>
          ${thresholdLabelHtml}
        </div>
        <div class="traj-x-axis" aria-hidden="true">
          <span class="traj-x-label">Turn ${escapeHtml(String(points[0].turn))}</span>
          <span class="traj-x-label">Turn ${escapeHtml(String(points[points.length - 1].turn))}</span>
        </div>
        <span class="sr-only" id="traj-desc">Active prompt tokens and cached input tokens across ${points.length} sampled turns. Use Left and Right arrow keys to inspect turns.</span>
      </div>
      <div class="traj-legend">
        <span class="traj-legend-item"><span class="traj-legend-dot traj-legend-active"></span>Active prompt</span>
        <span class="traj-legend-item"><span class="traj-legend-dot traj-legend-cache"></span>Cache read</span>
        ${legendCp}
      </div>
      ${boundedCaption}
    </div>
  `;
}
