import type React from "react";
import { buildContext, type DiagramItemsParams } from "./context";
import { buildTrajectoryOverlay } from "./trajectoryOverlay";
import { buildQueueBands } from "./queueBands";
import { buildBandwidthCorridors } from "./bandwidth";
import { buildSignalRows } from "./signalRows";
import { buildGreenBands } from "./greenBands";

export function buildDiagramItems(p: DiagramItemsParams) {
  const ctx = buildContext(p);
  const {
    pixelsPerSecond, pixelsPerMeter, maxDist, activeJ,
    tip, hover, trajectory, mousePos,
    plotLeft, plotTop, t0, t1, W, H, majorEvery, minorEvery,
  } = ctx;

    const items: React.ReactNode[] = [];
    const labelItems: React.ReactNode[] = []; // Junction name labels – rendered above bandwidth
    const yAxisItems: React.ReactNode[] = []; // Separate Y-axis items for fixed panel
    // bwItems, the outband*/inband* corridor arrays, and outboundBandwidth/inboundBandwidth
    // now come from buildBandwidthCorridors(ctx) (see the BANDWIDTH LINES call below).

    // Background
    items.push(
      <rect
        key="bg"
        x={plotLeft}
        y={plotTop}
        width={W}
        height={H}
        className="fill-neutral-800"
      />
    );

    // Grid: horizontal (distance) – fixed 100 m step
    const distStep = 100;
    for (let d = 0; d <= maxDist; d += distStep) {
      const y = plotTop + d * pixelsPerMeter;
      const isMajor = Math.round(d) % 500 === 0; // thicker line every 500 m

      // Tick marks only at major (500m) intervals — labels are shown per-junction below
      if (isMajor) {
        yAxisItems.push(
          <line
            key={`ht-${d}`}
            x1={plotLeft - 4}
            x2={plotLeft}
            y1={y}
            y2={y}
            className="stroke-neutral-400 dark:stroke-neutral-500"
            strokeWidth={0.5}
          />
        );
      }
    }

    // Gradients
    items.push(
      <defs key="defs">
        {activeJ.map((j) => (
          <linearGradient
            id={`io-${j.id}`}
            key={`io-${j.id}`}
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            {/* Top half = green (inbound) */}
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.95} />
            <stop offset="50%" stopColor="#22c55e" stopOpacity={0.95} />
            {/* Bottom half = blue (outbound) */}
            <stop offset="50%" stopColor="#3b82f6" stopOpacity={0.95} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.95} />
          </linearGradient>
        ))}
        <linearGradient id="inboundGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
        <linearGradient id="outboundGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
        {/* Side road gradients */}
        <linearGradient id="sideInboundGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
        <linearGradient id="sideOutboundGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#9333ea" />
          <stop offset="100%" stopColor="#9333ea" />
        </linearGradient>
      </defs>
    );

    // Pairwise green-band travel ribbons between consecutive enabled junctions.
    items.push(...buildGreenBands(ctx));

    // ========== BANDWIDTH LINES ==========
    // Built separately so the corridor geometry + bandwidth seconds have a unit-test
    // surface (see diagramBandwidth.test.ts).
    const {
      outboundBandwidth, inboundBandwidth,
      outbandPolygons, outbandFillSegs, outbandLabels,
      inbandPolygons, inbandFillSegs, inbandLabels,
      bwItems,
    } = buildBandwidthCorridors(ctx);

    // Per-junction signal rows (badges, names, phase strips, side-road bands, offset
    // indicators) — built separately and spread into the accumulators in render order.
    const signalRows = buildSignalRows(ctx);
    items.push(...signalRows.items);
    labelItems.push(...signalRows.labelItems);
    yAxisItems.push(...signalRows.yAxisItems);

    // Speed labels are rendered as HTML overlays (no SVG lines needed)

    // Axes labels — ylabel goes into the fixed y-axis panel
    yAxisItems.push(
      <text
        key="ylabel"
        x={16}
        y={plotTop + H / 2}
        transform={`rotate(-90 16 ${plotTop + H / 2})`}
        textAnchor="middle"
        fill="#e5e7eb"
        fontSize="13"
      >
        Distance (m)
      </text>
    );

    // Trajectory visualization
    const trajectoryOverlay = buildTrajectoryOverlay(ctx);
    if (trajectoryOverlay) items.push(trajectoryOverlay);

    // Queue vehicle trajectories: per-junction discharge bands, rendered after
    // bandwidth lines so queue borders appear on top (see flush section below).
    const queueTrajGroup = buildQueueBands(ctx);

    // Hover highlight overlay
    if (hover) {
      items.push(
        <rect
          key="hover-outline"
          x={hover.x}
          y={hover.y}
          width={hover.w}
          height={hover.h}
          className="fill-none stroke-white dark:stroke-neutral-200"
          strokeWidth={1}
          opacity={0.9}
          pointerEvents="none"
        />
      );
    }

    // Universal ruler — single shared time axis below the entire diagram
    const rulerY = plotTop + H + 50;
    // Baseline
    items.push(
      <line key="ruler-baseline" x1={plotLeft} y1={rulerY} x2={plotLeft + W} y2={rulerY}
        className="stroke-neutral-500 dark:stroke-neutral-400" strokeWidth={1} />
    );
    // Minor ticks — no labels
    for (let tt = Math.ceil(t0 / minorEvery) * minorEvery; tt <= t1 + 0.001; tt += minorEvery) {
      const x = plotLeft + (tt - t0) * pixelsPerSecond;
      items.push(
        <line key={`ruler-minor-${tt}`}
          x1={x} y1={rulerY} x2={x} y2={rulerY + 5}
          className="stroke-neutral-500 dark:stroke-neutral-400"
          strokeWidth={0.8} />
      );
    }
    // Major ticks — at every cycle boundary, labelled with cycle length
    for (let tt = Math.ceil(t0 / majorEvery) * majorEvery; tt <= t1 + 0.001; tt += majorEvery) {
      const x = plotLeft + (tt - t0) * pixelsPerSecond;
      items.push(
        <line key={`ruler-major-${tt}`}
          x1={x} y1={rulerY} x2={x} y2={rulerY + 10}
          className="stroke-neutral-500 dark:stroke-neutral-400"
          strokeWidth={1.5} />
      );
      items.push(
        <text key={`ruler-label-${tt}`}
          x={x} y={rulerY + 23}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          className="fill-neutral-600 dark:fill-neutral-300"
        >
          {`${majorEvery}s`}
        </text>
      );
    }

    // Flush bandwidth lines, then queue trajectory on top, then junction labels on top of everything
    items.push(...bwItems);
    if (queueTrajGroup) items.push(queueTrajGroup);
    items.push(...labelItems);

    // Tooltips last — must render above bandwidth lines and all other SVG content
    if (trajectory && mousePos) {
      const padX = 10;
      const padY = 6;
      const lineHeight = 16;
      const lines = [
        `Travel Time: ${Math.round(trajectory.totalTravelTime)}s`,
        `Stops: ${trajectory.stops.length}`,
      ];
      const tw = Math.max(...lines.map(l => l.length * 7)) + padX * 2;
      const th = lines.length * lineHeight + padY * 2;

      const offsetX = 15;
      const offsetY = 15;
      let tooltipX = mousePos.x + offsetX;
      let tooltipY = mousePos.y + offsetY;

      const maxX = plotLeft + W - tw - 10;
      const maxY = plotTop + H - th - 10;
      if (tooltipX > maxX) tooltipX = mousePos.x - tw - offsetX;
      if (tooltipY > maxY) tooltipY = mousePos.y - th - offsetY;

      items.push(
        <g key="trajectory-tooltip" pointerEvents="none">
          <rect
            x={tooltipX}
            y={tooltipY}
            width={tw}
            height={th}
            rx={6}
            ry={6}
            className="fill-neutral-900/95"
            style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
          />
          {lines.map((line, i) => (
            <text
              key={`traj-tip-${i}`}
              x={tooltipX + padX}
              y={tooltipY + padY + 12 + i * lineHeight}
              className="fill-white text-[12px] font-semibold"
            >
              {line}
            </text>
          ))}
        </g>
      );
    } else if (tip) {
      const padX = 14;
      const padY = 10;
      const lineHeight = 16;
      const lines = tip.lines ?? [tip.label];
      const th = padY * 2 + lines.length * lineHeight;
      const tw = Math.max(40, Math.max(...lines.map(l => l.length)) * 7.5);
      // Clamp so tooltip never goes above the plot area (first junction clip issue)
      const clampedY = Math.max(tip.y, plotTop + th + 4);
      items.push(
        <g key="tooltip" pointerEvents="none">
          <rect
            x={tip.x}
            y={clampedY - th}
            width={tw + padX * 2}
            height={th}
            rx={8}
            ry={8}
            className="fill-neutral-900/95"
          />
          {lines.map((line, li) => (
            <text
              key={li}
              x={tip.x + padX}
              y={clampedY - th + padY + (li + 1) * lineHeight - 2}
              className={li === 0 ? "fill-white text-[12px] font-semibold" : "fill-neutral-300 text-[11px]"}
              fontSize={li === 0 ? 12 : 11}
              fontWeight={li === 0 ? 600 : 400}
              fill={li === 0 ? "white" : (
                line.startsWith("Green") ? "#4ade80" :
                line.startsWith("Amber") ? "#fbbf24" :
                line.startsWith("All Red") ? "#f87171" :
                "#d4d4d4"
              )}
            >
              {line}
            </text>
          ))}
        </g>
      );
    }

    return { items, yAxisItems, outboundBandwidth, inboundBandwidth, outbandPolygons, outbandFillSegs, outbandLabels, inbandPolygons, inbandFillSegs, inbandLabels };
}
