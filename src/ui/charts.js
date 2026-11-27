import { escapeHtml, formatPercent, formatTokens } from "./format.js";

const SVG_W = 600;
const SVG_H = 180;
const PAD = { top: 16, right: 16, bottom: 26, left: 48 };
const PLOT_W = SVG_W - PAD.left - PAD.right;
const PLOT_H = SVG_H - PAD.top - PAD.bottom;

export function formatTrajectoryReadout(pt) {
  if (!pt) return "—";
  const cachePct =
    pt.activeTokens > 0 ? (pt.cacheReadTokens / pt.activeTokens) * 100 : 0;
  const kindTag =
    pt.kind === "checkpoint_peak"
      ? " · Checkpoint peak"
      : pt.kind === "checkpoint_baseline"
        ? " · Post-compaction"
        : "";
  return `Turn ${pt.turn} · ${formatTokens(pt.activeTokens)} active (${formatTokens(pt.cacheReadTokens)} cached, ${formatPercent(cachePct)}) · ${formatTokens(pt.outputTokens)} out${kindTag}`;
}

function pickInteractiveIndices(points, maxNodes = 40) {
  const n = points.length;
  if (n <= maxNodes) return points.map((_, idx) => idx);

  const chosen = new Set([0, n - 1]);
  for (let i = 0; i < n; i += 1) {
    if (points[i].kind !== "turn") chosen.add(i);
  }
  const remainingSlots = Math.max(2, maxNodes - chosen.size);
  const step = (n - 1) / remainingSlots;
  for (let s = 1; s < remainingSlots; s += 1) {
    chosen.add(Math.min(n - 1, Math.round(s * step)));
  }
  return Array.from(chosen).sort((a, b) => a - b);
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
    const x = PAD.left + (i / (n - 1)) * PLOT_W;
    const clampedActive = Math.max(0, Math.min(pt.activeTokens, maxY));
    const clampedCache = Math.max(0, Math.min(pt.cacheReadTokens, maxY));
    const yActive = PAD.top + PLOT_H - (clampedActive / maxY) * PLOT_H;
    const yCache = PAD.top + PLOT_H - (clampedCache / maxY) * PLOT_H;
    return { x, yActive, yCache, pt, idx: i };
  });

  return { coords, maxY };
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
  const focusIdx =
    activeIdx !== null && activeIdx >= 0 && activeIdx < coords.length
      ? activeIdx
      : coords.length - 1;
  const focusCoord = coords[focusIdx];

  const activePoly = coords
    .map((c) => `${c.x.toFixed(1)},${c.yActive.toFixed(1)}`)
    .join(" ");

  const firstX = coords[0].x.toFixed(1);
  const lastX = coords[coords.length - 1].x.toFixed(1);
  const baseLineY = (PAD.top + PLOT_H).toFixed(1);
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
    .map(({ frac, val }) => {
      const y = (PAD.top + PLOT_H * (1 - frac)).toFixed(1);
      return `
        <line class="traj-grid" x1="${PAD.left}" y1="${y}" x2="${SVG_W - PAD.right}" y2="${y}" />
        <text class="traj-axis" x="${PAD.left - 6}" y="${Number(y) + 3}" text-anchor="end">${escapeHtml(formatTokens(val))}</text>
      `;
    })
    .join("");

  // Optional 75% compaction-watch threshold when contextWindow is known
  let thresholdHtml = "";
  if (contextWindow && contextWindow > 0 && contextWindow * 0.75 <= maxY) {
    const y75 = (PAD.top + PLOT_H - ((contextWindow * 0.75) / maxY) * PLOT_H).toFixed(1);
    thresholdHtml = `
      <line class="traj-threshold" x1="${PAD.left}" y1="${y75}" x2="${SVG_W - PAD.right}" y2="${y75}" />
      <text class="traj-threshold-lbl" x="${SVG_W - PAD.right - 2}" y="${Number(y75) - 4}" text-anchor="end">75%</text>
    `;
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
          : Math.min(SVG_W - PAD.right, c.x + 4).toFixed(1);
      cpLines.push(
        `<line class="traj-cp-line" x1="${lineX}" y1="${PAD.top}" x2="${lineX}" y2="${baseLineY}" />`,
      );
      const r = 4;
      const cx = c.x.toFixed(1);
      const cy = c.yActive.toFixed(1);
      milestoneMarkers.push(
        `<polygon class="traj-cp-peak" points="${cx},${Number(cy) - r} ${Number(cx) + r},${cy} ${cx},${Number(cy) + r} ${Number(cx) - r},${cy}" />`,
      );
    } else if (c.pt.kind === "checkpoint_baseline") {
      milestoneMarkers.push(
        `<circle class="traj-cp-base" cx="${c.x.toFixed(1)}" cy="${c.yActive.toFixed(1)}" r="3.5" />`,
      );
    }
  }

  const interactiveIndices = pickInteractiveIndices(points, 40);
  const hitTargets = interactiveIndices
    .map((idx) => {
      const c = coords[idx];
      return `<circle class="traj-hit" cx="${c.x.toFixed(1)}" cy="${c.yActive.toFixed(1)}" r="10" tabindex="0" role="button" data-traj-idx="${idx}" aria-label="${escapeHtml(formatTrajectoryReadout(c.pt))}" />`;
    })
    .join("");

  const xLabelsHtml = `
    <text class="traj-axis" x="${PAD.left}" y="${SVG_H - 6}" text-anchor="start">Turn ${points[0].turn}</text>
    <text class="traj-axis" x="${SVG_W - PAD.right}" y="${SVG_H - 6}" text-anchor="end">Turn ${points[points.length - 1].turn}</text>
  `;

  const legendCp =
    trajectory.checkpointCount > 0
      ? `<span class="traj-legend-item"><span class="traj-legend-dot traj-legend-cp"></span>Compaction</span>`
      : "";

  const boundedCaption = trajectory.isBounded
    ? `<p class="traj-caption">Showing Turn 1, checkpoint milestones, and last 120 active-epoch turns of ${escapeHtml(String(trajectory.totalTurnCount))}</p>`
    : "";

  return `
    <div class="traj-wrap">
      <div class="traj-readout" data-slot="traj-readout">${escapeHtml(formatTrajectoryReadout(focusCoord.pt))}</div>
      <svg class="traj-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-labelledby="traj-title traj-desc">
        <title id="traj-title">Context growth trajectory</title>
        <desc id="traj-desc">Active prompt tokens and cached input tokens across ${points.length} sampled turns.</desc>
        ${gridLinesHtml}
        ${thresholdHtml}
        <path class="traj-cache-area" d="${cacheAreaPath}" />
        ${cpLines.join("")}
        <polyline class="traj-active-line" points="${activePoly}" />
        ${milestoneMarkers.join("")}
        <circle class="traj-active-dot" data-slot="traj-active-dot" cx="${focusCoord.x.toFixed(1)}" cy="${focusCoord.yActive.toFixed(1)}" r="4" />
        ${xLabelsHtml}
        ${hitTargets}
      </svg>
      <div class="traj-legend">
        <span class="traj-legend-item"><span class="traj-legend-dot traj-legend-active"></span>Active prompt</span>
        <span class="traj-legend-item"><span class="traj-legend-dot traj-legend-cache"></span>Cache read</span>
        ${legendCp}
      </div>
      ${boundedCaption}
    </div>
  `;
}
