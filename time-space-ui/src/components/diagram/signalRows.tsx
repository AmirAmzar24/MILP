import type React from "react";
import { phaseWindows } from "../../utils/phaseWindows";
import type { DiagramBuildContext } from "./context";

/**
 * Per-junction signal rows: the badge, name, position label, phase strips (green/
 * amber/red, draggable + wheel-resizable with lock affordances), side-road axis
 * bands, and the per-cycle offset indicators. Writes into its own items/labelItems/
 * yAxisItems and returns them; the orchestrator spreads each into its accumulators at
 * the same point, preserving render order.
 */
export function buildSignalRows(ctx: DiagramBuildContext): { items: React.ReactNode[]; labelItems: React.ReactNode[]; yAxisItems: React.ReactNode[] } {
  const {
    activeJ, pixelsPerSecond, pixelsPerMeter, setTip, setHover, drag,
    shiftDown, ctrlDown, onPhaseChange, onPhaseLockToggle, defaultAmber_s, defaultRed_s,
    readOnly, masterJunctionId, handleRowMouseDown, getLocal, plotLeft, plotTop, t0, t1, W,
  } = ctx;

  const items: React.ReactNode[] = [];
  const labelItems: React.ReactNode[] = [];
  const yAxisItems: React.ReactNode[] = [];

  // Per-junction rows & axis bands
  activeJ.forEach((j, jIdx) => {
    const y = plotTop + (j.position_m ?? 0) * pixelsPerMeter;
    const cycle = j.phases_s.reduce((a, b) => a + b, 0);

    items.push(
      <line
        key={`jl-${j.id}`}
        x1={plotLeft}
        x2={plotLeft + W}
        y1={y}
        y2={y}
        className="stroke-neutral-500 dark:stroke-neutral-400"
        strokeDasharray="2 3"
        strokeWidth={0.8}
      />
    );

    const isMaster = masterJunctionId ? j.id === masterJunctionId : false;
    const badgeFill = isMaster ? "#f59e0b" : "#3f3f46";
    const badgeTextFill = isMaster ? "#000" : "#fff";

    // Number badge — badge zone left, label zone right, 10px buffer before dashes
    const badgeCx = plotLeft - 65;
    yAxisItems.push(
      <g key={`jbadge-${j.id}`} pointerEvents="none">
        <circle cx={badgeCx} cy={y} r={11} fill={badgeFill} />
        <text
          x={badgeCx}
          y={y + 5}
          textAnchor="middle"
          fill={badgeTextFill}
          fontSize="12"
          fontWeight="700"
        >
          {jIdx + 1}
        </text>
        {isMaster && (
          <g>
            <rect x={badgeCx - 30} y={y + 15} width={60} height={18} rx={9} ry={9} fill="#92400e" opacity={0.95} />
            <text x={badgeCx} y={y + 25} textAnchor="middle" dominantBaseline="middle" fill="#fde68a" fontSize="11" fontWeight="700">
              �� Master
            </text>
          </g>
        )}
      </g>
    );

    // Junction name — fixed at top-left of the plot area for every junction
    labelItems.push(
      <text
        key={`jname-overlay-${j.id}`}
        x={plotLeft + 4}
        y={y - 16}
        textAnchor="start"
        fill="white"
        fontSize="11"
        fontWeight="600"
        opacity={0.9}
        pointerEvents="none"
      >
        {j.name}
      </text>
    );
    // Position label — left-aligned 8px from badge right edge, 10px font (secondary info)
    yAxisItems.push(
      <text
        key={`jp-${j.id}`}
        x={badgeCx + 19}
        y={y + 4}
        textAnchor="start"
        fontSize="10"
        className="fill-neutral-600 dark:fill-neutral-300"
      >
        {Math.round(j.position_m ?? 0)} m
      </text>
    );
    // Junction position indicator line in Y-axis panel
    yAxisItems.push(
      <line
        key={`jy-${j.id}`}
        x1={plotLeft - 8}
        x2={plotLeft}
        y1={y}
        y2={y}
        className="stroke-neutral-500 dark:stroke-neutral-400"
        strokeWidth={1}
      />
    );

    // phases (light grey) – this rect is draggable and wheel-resizable
    const starts: number[] = [];
    let acc = 0;
    for (const p of j.phases_s) {
      starts.push(acc);
      acc += p;
    }
    j.phases_s.forEach((dur, i) => {
      const isLocked = j.cycleLocked && (j.lockedPhases ?? []).includes(i);
      const canLock = j.cycleLocked === true;
      const windows = phaseWindows(t0, t1, cycle, j.offset_s, starts[i], dur);

      // Check if this phase is active (used for inbound or outbound)
      const isInbound = j.inboundIdx.includes(i);
      const isOutbound = j.outboundIdx.includes(i);
      const isActivePhase = isInbound || isOutbound;

      // Check if next phase continues in the same direction (overlap phase logic)
      // If so, don't draw Y+R at the end of this phase - it continues into the next
      // BUT: if this phase is the LAST phase for ANY direction, we must show Y+R
      const nextPhaseIdx = (i + 1) % j.phases_s.length;
      const nextContinuesInbound = isInbound && j.inboundIdx.includes(nextPhaseIdx);
      const nextContinuesOutbound = isOutbound && j.outboundIdx.includes(nextPhaseIdx);

      // Check if this phase is the last phase for any direction it belongs to
      const isLastForInbound = isInbound && !nextContinuesInbound;
      const isLastForOutbound = isOutbound && !nextContinuesOutbound;

      // Only skip Y+R if the phase is NOT the last in ANY of its directions
      // i.e., it must continue in ALL directions it belongs to
      const isOverlapPhase = !isLastForInbound && !isLastForOutbound;

      // Pre-overlap case: only ONE direction is active & continues, but the OTHER
      // direction is STARTING in the very next phase (the overlap phase).
      // Example: A1 (inbound only) → A2 (overlap: both) → A3 (outbound only)
      // At the end of A1, show Y+R on the bottom half (outbound about to start).
      const nextPhaseStartsOutbound = isInbound && !isOutbound &&
        nextContinuesInbound && j.outboundIdx.includes(nextPhaseIdx);
      const nextPhaseStartsInbound = isOutbound && !isInbound &&
        nextContinuesOutbound && j.inboundIdx.includes(nextPhaseIdx);
      const isPreOverlapCase = nextPhaseStartsOutbound || nextPhaseStartsInbound;

      // Calculate G+Y+R breakdown for this phase (only for active phases)
      // For overlap phases, the full duration is green (no Y+R at the end)
      const greenTime = isOverlapPhase ? dur : Math.max(0, dur - defaultAmber_s - defaultRed_s);
      const yellowTime = isOverlapPhase ? 0 : defaultAmber_s;
      const redTime = isOverlapPhase ? 0 : defaultRed_s;

      windows.forEach((w, wi) => {
        const x = plotLeft + (w.t - t0) * pixelsPerSecond;
        const wpx = Math.max(1, w.w * pixelsPerSecond);

        // Calculate pixel widths for G+Y+R strips (proportional to the visible window)
        const visibleRatio = w.w / dur;
        const greenPx = greenTime * visibleRatio * pixelsPerSecond;
        const yellowPx = yellowTime * visibleRatio * pixelsPerSecond;
        const redPx = redTime * visibleRatio * pixelsPerSecond;

        if (isActivePhase) {
          // Split case: phase is active for BOTH directions but only one ends here.
          // Top half (y-10, h=10) = inbound; Bottom half (y, h=10) = outbound.
          const isSplitCase = isInbound && isOutbound &&
            (isLastForOutbound !== isLastForInbound);

          if (isPreOverlapCase) {
            // Pre-overlap: one direction continues, the opposite starts in the next phase.
            // Show full green on the continuing direction's half, Y+R on the incoming half.
            // inbound (top, y-10) continues → Y+R on bottom (outbound starting)
            // outbound (bottom, y) continues → Y+R on top (inbound starting)
            const continuingHalfY = nextPhaseStartsOutbound ? y - 10 : y;
            const incomingHalfY   = nextPhaseStartsOutbound ? y       : y - 10;

            // Use defaultAmber/Red directly (isOverlapPhase=true so yellowTime/redTime are 0)
            const preGreenPx  = Math.max(0, dur - defaultAmber_s - defaultRed_s) * visibleRatio * pixelsPerSecond;
            const preYellowPx = defaultAmber_s * visibleRatio * pixelsPerSecond;
            const preRedPx    = defaultRed_s   * visibleRatio * pixelsPerSecond;

            // Continuing direction: full-width green on its half (color by direction)
            items.push(
              <rect
                key={`green-${j.id}-${i}-${wi}`}
                x={x}
                y={continuingHalfY}
                width={wpx}
                height={10}
                fill={nextPhaseStartsOutbound ? "#22c55e" : "#3b82f6"}
                fillOpacity={0.5}
                pointerEvents="none"
              />
            );

            // Incoming direction: green portion before clearance (same color as continuing — single-direction phase)
            if (preGreenPx > 0) {
              items.push(
                <rect
                  key={`red-pre-${j.id}-${i}-${wi}`}
                  x={x}
                  y={incomingHalfY}
                  width={Math.max(1, preGreenPx)}
                  height={10}
                  fill={nextPhaseStartsOutbound ? "#22c55e" : "#3b82f6"}
                  fillOpacity={0.5}
                  pointerEvents="none"
                />
              );
            }
            if (preYellowPx > 0) {
              items.push(
                <rect
                  key={`yellow-${j.id}-${i}-${wi}`}
                  x={x + preGreenPx}
                  y={incomingHalfY}
                  width={Math.max(1, preYellowPx)}
                  height={10}
                  fill="#eab308"
                  fillOpacity={0.6}
                  pointerEvents="none"
                />
              );
            }
            if (preRedPx > 0) {
              items.push(
                <rect
                  key={`red-${j.id}-${i}-${wi}`}
                  x={x + preGreenPx + preYellowPx}
                  y={incomingHalfY}
                  width={Math.max(1, preRedPx)}
                  height={10}
                  fill="#ef4444"
                  fillOpacity={0.5}
                  pointerEvents="none"
                />
              );
            }
          } else if (isSplitCase) {
            const outboundEnds = isLastForOutbound;
            // Visual layout: inbound (green) = top half (y-10), outbound (blue) = bottom half (y)
            const endingHalfY = outboundEnds ? y : y - 10;     // half where Y+R goes
            const continuingHalfY = outboundEnds ? y - 10 : y; // half that stays green

            // Shared green portion: top half = inbound (green), bottom half = outbound (blue)
            if (greenPx > 0) {
              items.push(
                <rect
                  key={`green-in-${j.id}-${i}-${wi}`}
                  x={x}
                  y={y - 10}
                  width={Math.max(1, greenPx)}
                  height={10}
                  fill="#22c55e"
                  fillOpacity={0.5}
                  pointerEvents="none"
                />
              );
              items.push(
                <rect
                  key={`green-out-${j.id}-${i}-${wi}`}
                  x={x}
                  y={y}
                  width={Math.max(1, greenPx)}
                  height={10}
                  fill="#3b82f6"
                  fillOpacity={0.5}
                  pointerEvents="none"
                />
              );
            }

            // Continuing direction fills the tail with its color (no Y+R)
            const tailPx = yellowPx + redPx;
            if (tailPx > 0) {
              items.push(
                <rect
                  key={`green-tail-${j.id}-${i}-${wi}`}
                  x={x + greenPx}
                  y={continuingHalfY}
                  width={Math.max(1, tailPx)}
                  height={10}
                  fill={outboundEnds ? "#22c55e" : "#3b82f6"}
                  fillOpacity={0.5}
                  pointerEvents="none"
                />
              );
            }

            // Ending direction: amber then red on its half only
            if (yellowPx > 0) {
              items.push(
                <rect
                  key={`yellow-${j.id}-${i}-${wi}`}
                  x={x + greenPx}
                  y={endingHalfY}
                  width={Math.max(1, yellowPx)}
                  height={10}
                  fill="#eab308"
                  fillOpacity={0.6}
                  pointerEvents="none"
                />
              );
            }
            if (redPx > 0) {
              items.push(
                <rect
                  key={`red-${j.id}-${i}-${wi}`}
                  x={x + greenPx + yellowPx}
                  y={endingHalfY}
                  width={Math.max(1, redPx)}
                  height={10}
                  fill="#ef4444"
                  fillOpacity={0.5}
                  pointerEvents="none"
                />
              );
            }
          } else {
            // Normal case: full-height green then full-height Y+R (or none if overlap)
            if (greenPx > 0) {
              if (isInbound && isOutbound) {
                // Both directions: top half = inbound (green), bottom half = outbound (blue)
                items.push(
                  <rect
                    key={`green-in-${j.id}-${i}-${wi}`}
                    x={x}
                    y={y - 10}
                    width={Math.max(1, greenPx)}
                    height={10}
                    fill="#22c55e"
                    fillOpacity={0.5}
                    pointerEvents="none"
                  />
                );
                items.push(
                  <rect
                    key={`green-out-${j.id}-${i}-${wi}`}
                    x={x}
                    y={y}
                    width={Math.max(1, greenPx)}
                    height={10}
                    fill="#3b82f6"
                    fillOpacity={0.5}
                    pointerEvents="none"
                  />
                );
              } else {
                items.push(
                  <rect
                    key={`green-${j.id}-${i}-${wi}`}
                    x={x}
                    y={y - 10}
                    width={Math.max(1, greenPx)}
                    height={20}
                    fill={isOutbound ? "#3b82f6" : "#22c55e"}
                    fillOpacity={0.5}
                    pointerEvents="none"
                  />
                );
              }
            }

            if (yellowPx > 0) {
              items.push(
                <rect
                  key={`yellow-${j.id}-${i}-${wi}`}
                  x={x + greenPx}
                  y={y - 10}
                  width={Math.max(1, yellowPx)}
                  height={20}
                  fill="#eab308"
                  fillOpacity={0.6}
                  pointerEvents="none"
                />
              );
            }

            if (redPx > 0) {
              items.push(
                <rect
                  key={`red-${j.id}-${i}-${wi}`}
                  x={x + greenPx + yellowPx}
                  y={y - 10}
                  width={Math.max(1, redPx)}
                  height={20}
                  fill="#ef4444"
                  fillOpacity={0.5}
                  pointerEvents="none"
                />
              );
            }
          }
        } else {
          // Inactive phase: Draw full red strip
          items.push(
            <rect
              key={`inactive-${j.id}-${i}-${wi}`}
              x={x}
              y={y - 10}
              width={wpx}
              height={20}
              fill="#ef4444"
              fillOpacity={0.5}
              pointerEvents="none"
            />
          );
        }

        // Interactive overlay (transparent, for dragging and wheel-resize)
        items.push(
          <rect
            key={`bg-${j.id}-${i}-${wi}`}
            x={x}
            y={y - 10}
            width={wpx}
            height={20}
            fill="transparent"
            className={`
              ${isLocked
                ? 'hover:fill-amber-400/30 dark:hover:fill-amber-500/30'
                : 'hover:fill-neutral-300/30 dark:hover:fill-neutral-500/30'
              }
              ${readOnly ? "cursor-default" : (shiftDown ? "cursor-ns-resize" : (canLock && ctrlDown ? "cursor-pointer" : "cursor-ew-resize"))}
            `}
            style={isLocked ? {
              strokeWidth: 2,
              stroke: '#f59e0b',
              strokeDasharray: '3 2',
            } : undefined}
            onMouseEnter={(e) => {
              if (drag) return;
              const { x: mx, y: my } = getLocal(e);
              const phaseName = j.phaseNames?.[i] || `A${i + 1}`;
              const phaseDuration = Math.round(j.phases_s[i]);
              const greenTime = Math.max(0, phaseDuration - defaultAmber_s - defaultRed_s);
              const lockStatus = isLocked ? ' [LOCKED]' : (canLock ? ' (Ctrl+Click to lock)' : '');
              setTip({
                x: mx + 8,
                y: my - 12,
                label: `${phaseName} (${phaseDuration}s)${lockStatus}`,
                lines: [
                  `${phaseName}  —  ${phaseDuration}s${lockStatus}`,
                  `Green:    ${greenTime}s`,
                  `Amber:   ${defaultAmber_s}s`,
                  `All Red:  ${defaultRed_s}s`,
                ],
              });
              setHover({ x, y: y - 10, w: wpx, h: 20 });
            }}
            onMouseMove={(e) => {
              if (drag) return;
              const { x: mx, y: my } = getLocal(e);
              const phaseName = j.phaseNames?.[i] || `A${i + 1}`;
              const phaseDuration = Math.round(j.phases_s[i]);
              const greenTime = Math.max(0, phaseDuration - defaultAmber_s - defaultRed_s);
              const lockStatus = isLocked ? ' [LOCKED]' : (canLock ? ' (Ctrl+Click to lock)' : '');
              setTip({
                x: mx + 8,
                y: my - 12,
                label: `${phaseName} (${phaseDuration}s)${lockStatus}`,
                lines: [
                  `${phaseName}  —  ${phaseDuration}s${lockStatus}`,
                  `Green:    ${greenTime}s`,
                  `Amber:   ${defaultAmber_s}s`,
                  `All Red:  ${defaultRed_s}s`,
                ],
              });
              setHover({ x, y: y - 10, w: wpx, h: 20 });
            }}
            onMouseLeave={() => {
              setTip(null);
              setHover(null);
            }}
            onMouseDown={(e) => {
              if (readOnly) return;
              // Ctrl+Click to toggle lock
              if (e.ctrlKey && canLock && onPhaseLockToggle) {
                e.preventDefault();
                e.stopPropagation();
                onPhaseLockToggle(j.id, i);
                setTip(null);
                setHover(null);
                return;
              }
              handleRowMouseDown(e, j);
            }}
            onWheel={(e) => {
              if (readOnly) return;
              if (!onPhaseChange) return;
              if (!e.shiftKey) return; // only when Shift is held
              // Block adjustment if this phase is locked
              if (isLocked) {
                e.preventDefault();
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              setTip(null);
              setHover(null);
              const delta = e.deltaY > 0 ? -0.5 : 0.5; // wheel down = shorter, up = longer
              const current = j.phases_s[i] ?? 0;
              let next = current + delta;
              next = Math.round(next * 2) / 2; // Round to nearest 0.5s
              if (next < 1) next = 1; // minimum 1s
              onPhaseChange(j.id, i, next);
            }}
          />
        );

        // Add phase boundary lines (start and end)
        // Determine border color based on phase type
        let borderColor = '#64748b'; // Default grey for unselected
        if (isLocked) {
          borderColor = '#f59e0b'; // Amber for locked
        } else {
          const isOutbound = j.outboundIdx.includes(i);
          const isInbound = j.inboundIdx.includes(i);
          const isSideOutbound = (j.sideRoadOutboundIdx ?? []).includes(i);
          const isSideInbound = (j.sideRoadInboundIdx ?? []).includes(i);

          if (isOutbound && isInbound) {
            borderColor = '#8b5cf6'; // Purple for both (bi-directional)
          } else if (isOutbound) {
            borderColor = '#3b82f6'; // Blue for main outbound
          } else if (isInbound) {
            borderColor = '#22c55e'; // Green for main inbound
          } else if (isSideOutbound) {
            borderColor = '#9333ea'; // Purple for side road outbound
          } else if (isSideInbound) {
            borderColor = '#f97316'; // Orange for side road inbound
          }
        }

        items.push(
          <line
            key={`boundary-start-${j.id}-${i}-${wi}`}
            x1={x}
            x2={x}
            y1={y - 10}
            y2={y + 10}
            stroke={borderColor}
            strokeWidth={1}
            opacity={0.2}
            pointerEvents="none"
          />
        );
        items.push(
          <line
            key={`boundary-end-${j.id}-${i}-${wi}`}
            x1={x + wpx}
            x2={x + wpx}
            y1={y - 10}
            y2={y + 10}
            stroke={borderColor}
            strokeWidth={1}
            opacity={0.2}
            pointerEvents="none"
          />
        );
      });
    });

    // axis bands for selected phases
    const drawAxisBand = (phaseIdx: number, fill: string) => {
      if (phaseIdx == null || phaseIdx < 0 || phaseIdx >= j.phases_s.length) return;
      const pStart = starts[phaseIdx];
      const pDur = j.phases_s[phaseIdx];
      const windows = phaseWindows(t0, t1, cycle, j.offset_s, pStart, pDur);
      windows.forEach((w, wi) => {
        const x = plotLeft + (w.t - t0) * pixelsPerSecond;
        const wpx = Math.max(1, w.w * pixelsPerSecond);
        items.push(
          <rect
            key={`ax-${j.id}-${phaseIdx}-${wi}`}
            x={x}
            y={y - 4}
            width={wpx}
            height={8}
            style={{ fill }}
            className={readOnly ? "cursor-default" : (shiftDown ? "cursor-ns-resize" : "cursor-ew-resize")}
            // Axis band hover - commented out to avoid duplicate tooltips
            // onMouseEnter={(e) => {
            //   if (drag) return;
            //   const { x: mx, y: my } = getLocal(e);
            //   setTip({
            //     x: mx + 8,
            //     y: my - 12,
            //     label: `P${phaseIdx + 1} 0.0s | ${w.w.toFixed(1)}s`,
            //   });
            //   setHover({ x, y: y - 2, w: wpx, h: 4 });
            // }}
            // onMouseMove={(e) => {
            //   if (drag) return;
            //   const { x: mx, y: my } = getLocal(e);
            //   const elapsed = Math.max(
            //     0,
            //     Math.min((mx - x) / pixelsPerSecond, w.w)
            //   );
            //   setTip({
            //     x: mx + 8,
            //     y: my - 12,
            //     label: `P${phaseIdx + 1} ${elapsed.toFixed(1)}s | ${Math.max(
            //       0,
            //       w.w - elapsed
            //     ).toFixed(1)}s`,
            //   });
            //   setHover({ x, y: y - 2, w: wpx, h: 4 });
            // }}
            // onMouseLeave={() => {
            //   setTip(null);
            //   setHover(null);
            // }}
            onMouseDown={(e) => handleRowMouseDown(e, j)}
            onWheel={(e) => {
              if (!onPhaseChange) return;
              if (!e.shiftKey) return;
              // Block adjustment if this phase is locked
              const isPhaseLocked = j.cycleLocked && (j.lockedPhases ?? []).includes(phaseIdx);
              if (isPhaseLocked) {
                e.preventDefault();
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              setTip(null);
              setHover(null);
              const delta = e.deltaY > 0 ? -1 : 1;
              const current = j.phases_s[phaseIdx] ?? 0;
              let next = Math.round(current + delta);
              if (next < 1) next = 1;
              onPhaseChange(j.id, phaseIdx, next);
            }}
          />
        );
      });
    };

    const inboundSet = new Set(j.inboundIdx ?? []);
    const outboundSet = new Set(j.outboundIdx ?? []);
    const sideInboundSet = new Set(j.sideRoadInboundIdx ?? []);
    const sideOutboundSet = new Set(j.sideRoadOutboundIdx ?? []);
    const both: number[] = [],
      inboundOnly: number[] = [],
      outboundOnly: number[] = [],
      sideInboundOnly: number[] = [],
      sideOutboundOnly: number[] = [];
    j.phases_s.forEach((_, i) => {
      const inB = inboundSet.has(i);
      const outB = outboundSet.has(i);
      const sideInB = sideInboundSet.has(i);
      const sideOutB = sideOutboundSet.has(i);

      // Main road phases (mutually exclusive with side road)
      if (inB && outB) both.push(i);
      else if (inB) inboundOnly.push(i);
      else if (outB) outboundOnly.push(i);

      // Side road phases
      if (sideInB) sideInboundOnly.push(i);
      if (sideOutB) sideOutboundOnly.push(i);
    });

    sideInboundOnly.forEach((idx) => drawAxisBand(idx, `#f97316`));
    sideOutboundOnly.forEach((idx) => drawAxisBand(idx, `#9333ea`));
  });

  // Offset indicators: drawn after all phase strips so they appear on top
  activeJ.forEach((j) => {
    const y = plotTop + (j.position_m ?? 0) * pixelsPerMeter;
    const cycle = j.phases_s.reduce((a, b) => a + b, 0);
    if (cycle <= 0) return;
    const kMin = Math.floor((t0 - j.offset_s) / cycle) - 1;
    const kMax = Math.ceil((t1 - j.offset_s) / cycle) + 1;
    for (let k = kMin; k <= kMax; k++) {
      const cycleStartTime = j.offset_s + k * cycle;
      if (cycleStartTime < t0 || cycleStartTime > t1) continue;
      const ox = plotLeft + (cycleStartTime - t0) * pixelsPerSecond;
      labelItems.push(
        <line
          key={`offset-${j.id}-${k}`}
          x1={ox}
          x2={ox}
          y1={y - 10}
          y2={y + 22}
          stroke="white"
          strokeWidth={1.5}
          strokeOpacity={0.85}
          strokeLinecap="round"
          pointerEvents="none"
        />
      );
      labelItems.push(
        <text
          key={`offset-label-${j.id}-${k}`}
          x={ox + 3}
          y={y + 21}
          fill="white"
          fontSize={11}
          fontWeight={600}
          opacity={0.85}
          pointerEvents="none"
        >
          {j.offset_s === 0 ? `${k * cycle}s` : `${k * cycle}+${j.offset_s}s`}
        </text>
      );
    }
  });

  return { items, labelItems, yAxisItems };
}
