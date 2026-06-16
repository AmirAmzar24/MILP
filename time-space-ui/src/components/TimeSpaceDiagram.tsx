import React, { useEffect, useMemo, useRef, useState } from "react";
import { calculateTrajectory, type TrajectoryData } from "../utils/trajectory";
import { SpeedLabelItem } from "./SpeedLabelItem";
import { buildDiagramItems } from "./diagram";
import type { Junction, Margins } from "../types";

/**
 * TRAJECTORY HOVER FEATURE
 *
 * This feature allows users to visualize vehicle travel paths through the signal corridor.
 * See TRAJECTORY_FEATURE_DOCS.md for complete documentation.
 *
 * Key Features:
 * - Dynamic trajectory calculation based on mouse position
 * - Stop detection at red signals
 * - Travel time and stop duration display
 * - Support for both outbound and inbound directions
 *
 * Main Components:
 * - isInGreenPhase(): Checks if arrival time falls in green phase
 * - calculateTrajectory(): Computes complete path from start to end
 * - handleMouseMove(): Manages mode detection and trajectory calculation
 * - Rendering: Cyan dotted line, red stop indicators, tooltip
 */

export default function TimeSpaceDiagram({
  junctions,
  timeStart,
  timeEnd,
  pixelsPerSecond,
  pixelsPerMeter,
  travelIn_s,
  travelOut_s,
  plotMargins = { left: 140, top: 40, right: 20, bottom: 88 },
  onOffsetChange,
  onPhaseChange,
  onPhaseLockToggle,
  queueVehiclesIn: _queueVehiclesIn = 0,
  queueVehiclesOut: _queueVehiclesOut = 0,
  setQueueVehiclesIn: _setQueueVehiclesIn,
  setQueueVehiclesOut: _setQueueVehiclesOut,
  trajectoryEnabled = false,
  setTrajectoryEnabled: _setTrajectoryEnabled,
  queueTrajectoriesEnabled = false,
  setQueueTrajectoriesEnabled: _setQueueTrajectoriesEnabled,
  queueTrajDirection = "both",
  showDischargeWidth = false,
  saturationHeadway_s = 2,
  setSaturationHeadway_s: _setSaturationHeadway_s,
  queueOut_s = [],
  queueIn_s = [],
  defaultAmber_s = 3,
  defaultRed_s = 3,
  readOnly = false,
  hideScrollHint = false,
  masterJunctionId,
  highlightBand = null,
  onTravelTimeChange,
  optimizedCycle = null,
}: {
  junctions: Junction[];
  timeStart: number;
  timeEnd: number;
  pixelsPerSecond: number;
  pixelsPerMeter: number;
  travelOut_s: number[];  // J(i)   -> J(i+1)
  travelIn_s: number[];   // J(i+1) -> J(i)
  plotMargins?: Margins;
  onOffsetChange?: (id: string, newOffset_s: number) => void;
  onPhaseChange?: (id: string, phaseIdx: number, newLength_s: number) => void;
  onPhaseLockToggle?: (junctionId: string, phaseIdx: number) => void;
  queueVehiclesIn?: number;
  queueVehiclesOut?: number;
  setQueueVehiclesIn?: (count: number) => void;
  setQueueVehiclesOut?: (count: number) => void;
  trajectoryEnabled?: boolean;
  setTrajectoryEnabled?: (enabled: boolean) => void;
  queueTrajectoriesEnabled?: boolean;
  queueTrajDirection?: "both" | "outbound" | "inbound";
  showDischargeWidth?: boolean;
  setQueueTrajectoriesEnabled?: (enabled: boolean) => void;
  saturationHeadway_s?: number;
  setSaturationHeadway_s?: (headway: number) => void;
  queueOut_s?: number[];
  queueIn_s?: number[];
  defaultAmber_s?: number;
  defaultRed_s?: number;
  readOnly?: boolean;
  hideScrollHint?: boolean;
  masterJunctionId?: string;
  highlightBand?: 'outbound' | 'inbound' | null;
  onTravelTimeChange?: (segIdx: number, newOutTime_s: number | null, newInTime_s: number | null) => void;
  optimizedCycle?: number | null;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; label: string; lines?: string[] } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [trajectory, setTrajectory] = useState<TrajectoryData | null>(null);
  const [trajectoryMode, setTrajectoryMode] = useState<"outbound" | "inbound" | null>(null);
  // trajectoryEnabled is now controlled by parent via props
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // drag state for offset dragging
  const [drag, setDrag] = useState<{
    id: string;
    startOffset_s: number;
    startX: number;
  } | null>(null);

  // Speed segments — computed outside the large useMemo so edits don't retrigger it
  const plotTop = plotMargins.top;
  const activeJForSpeed = useMemo(() => junctions.filter(j => j.enabled !== false), [junctions]);
  const speedSegments = useMemo(() => {
    return activeJForSpeed.slice(0, -1).map((j, i) => {
      const jNext = activeJForSpeed[i + 1];
      const y1 = plotTop + (j.position_m ?? 0) * pixelsPerMeter;
      const y2 = plotTop + (jNext.position_m ?? 0) * pixelsPerMeter;
      const yMid = (y1 + y2) / 2;
      const segDist = Math.abs((jNext.position_m ?? 0) - (j.position_m ?? 0));
      const segIdx = junctions.findIndex(jj => jj.id === j.id);
      const outTime = travelOut_s[segIdx] ?? 0;
      const inTime = travelIn_s[segIdx] ?? 0;
      const outKmh = outTime > 0 && segDist > 0 ? Math.round((segDist / outTime) * 3.6) : null;
      const inKmh = inTime > 0 && segDist > 0 ? Math.round((segDist / inTime) * 3.6) : null;
      const sameSpeed = outKmh !== null && inKmh !== null && outKmh === inKmh;
      return { segIdx, yMid, outKmh, inKmh, sameSpeed, segDist };
    });
  }, [activeJForSpeed, plotTop, pixelsPerMeter, junctions, travelOut_s, travelIn_s]);

  function handleSpeedAdjust(segIdx: number, dir: "out" | "in" | "both", newKmh: number) {
    if (!onTravelTimeChange) return;
    const seg = speedSegments.find(s => s.segIdx === segIdx);
    if (!seg) return;
    const newTime_s = seg.segDist / (newKmh / 3.6);
    const currentOut = travelOut_s[segIdx] ?? 0;
    const currentIn = travelIn_s[segIdx] ?? 0;
    onTravelTimeChange(
      segIdx,
      dir === "in" ? currentOut : newTime_s,
      dir === "out" ? currentIn : newTime_s,
    );
  }

  // Track Shift for cursor + scroll-resize, and Ctrl for phase locking
  const [shiftDown, setShiftDown] = useState(false);
  const [ctrlDown, setCtrlDown] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftDown(true);
      if (e.key === "Control") setCtrlDown(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftDown(false);
      if (e.key === "Control") setCtrlDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const getLocal = (e: React.MouseEvent<SVGElement, MouseEvent>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    // Adjust for viewBox offset - the main SVG's viewBox starts at plotMargins.left
    return { x: e.clientX - rect.left + plotMargins.left, y: e.clientY - rect.top };
  };

  // start drag for a given junction row
  const handleRowMouseDown = (evt: React.MouseEvent<SVGRectElement, MouseEvent>, j: Junction) => {
    if (readOnly) return;
    if (!onOffsetChange) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const startX = evt.clientX - rect.left;
    // start drag and clear any tooltip / hover so they don't ghost
    setTip(null);
    setHover(null);
    setDrag({ id: j.id, startOffset_s: j.offset_s, startX });
    evt.preventDefault();
    evt.stopPropagation();
  };

  // update offset while dragging (snap to 1s)
  const handleMouseMove = (evt: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    // while dragging, always clear tooltip / hover so they don't linger
    if (drag) {
      if (tip) setTip(null);
      if (hover) setHover(null);
      if (trajectory) setTrajectory(null);
    }
    if (drag && onOffsetChange) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const dx = x - drag.startX;
      const dt = dx / pixelsPerSecond; // seconds shift
      const newOffset = drag.startOffset_s + dt;
      const snapped = Math.round(newOffset); // snap to nearest whole second
      onOffsetChange(drag.id, snapped);
      return;
    }

    // Calculate trajectory when hovering over diagram (not dragging)
    if (!drag && trajectoryEnabled) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      // Adjust for viewBox offset - the main SVG's viewBox starts at yAxisWidth
      const mouseX = evt.clientX - rect.left + plotMargins.left;
      const mouseY = evt.clientY - rect.top;

      // Track mouse position for tooltip
      setMousePos({ x: mouseX, y: mouseY });

      const plotLeft = plotMargins.left;
      const plotTop = plotMargins.top;
      const plotWidth = (timeEnd - timeStart) * pixelsPerSecond;
      const plotHeight = maxDist * pixelsPerMeter;

      // Expanded vertical bounds to include trigger zones above/below junctions
      const expandedTop = plotTop - 50; // Allow hovering above first junction
      const expandedBottom = plotTop + plotHeight + 50; // Allow hovering below last junction

      // Check if mouse is within expanded plot area
      if (mouseX >= plotLeft && mouseX <= plotLeft + plotWidth &&
          mouseY >= expandedTop && mouseY <= expandedBottom) {

        // Convert mouse position to time and distance
        const mouseTime = timeStart + (mouseX - plotLeft) / pixelsPerSecond;
        const mouseDistance = (mouseY - plotTop) / pixelsPerMeter;

        // Determine if we should switch mode based on position relative to first/last junction
        const firstJunctionY = plotTop + (activeJ[0]?.position_m ?? 0) * pixelsPerMeter;
        const lastJunctionY = plotTop + (activeJ[activeJ.length - 1]?.position_m ?? 0) * pixelsPerMeter;

        // Track the current mode (may be updated in this call)
        let currentMode = trajectoryMode;

        // Update mode based on position
        if (mouseY < firstJunctionY) {
          // Above first junction - switch to outbound mode
          currentMode = "outbound";
          if (trajectoryMode !== "outbound") {
            setTrajectoryMode("outbound");
          }
        } else if (mouseY > lastJunctionY) {
          // Below last junction - switch to inbound mode
          currentMode = "inbound";
          if (trajectoryMode !== "inbound") {
            setTrajectoryMode("inbound");
          }
        } else if (!currentMode) {
          // Between junctions and no mode set - auto-detect based on position
          const midpointY = (firstJunctionY + lastJunctionY) / 2;
          if (mouseY < midpointY) {
            // Closer to first junction - use outbound
            currentMode = "outbound";
            setTrajectoryMode("outbound");
          } else {
            // Closer to last junction - use inbound
            currentMode = "inbound";
            setTrajectoryMode("inbound");
          }
        }

        // If we have a mode set, calculate trajectory in that direction
        if (currentMode) {
          const traj = calculateTrajectory(
            mouseTime,
            mouseDistance,
            currentMode,
            junctions,
            travelOut_s,
            travelIn_s
          );
          setTrajectory(traj);
        } else {
          setTrajectory(null);
        }
      } else {
        // Mouse outside plot area
        setTrajectory(null);
      }
    } else if (!trajectoryEnabled && trajectory) {
      // Clear trajectory when disabled
      setTrajectory(null);
    }
  };

  const handleMouseUp = () => {
    if (drag) {
      setDrag(null);
      // also ensure tooltip / hover are cleared when drag finishes
      if (tip) setTip(null);
      if (hover) setHover(null);
    }
  };

  const handleMouseLeave = () => {
    handleMouseUp();
    // Clear trajectory and mode when mouse leaves diagram
    setTrajectory(null);
    setTrajectoryMode(null);
    setMousePos(null);
  };

  // Structural signature so inbound/outbound/phase changes always re-render ribbons
  const jSig = useMemo(
    () =>
      junctions
        .map(
          (j) =>
            `${j.id}:${j.offset_s}:${(j.phases_s || []).join(",")}:` +
            `${(j.inboundIdx || []).join(",")}:${(j.outboundIdx || []).join(",")}:` +
            `${(j.sideRoadInboundIdx || []).join(",")}:${(j.sideRoadOutboundIdx || []).join(",")}:${
              j.enabled === false ? 0 : 1
            }`
        )
        .join("|"),
    [junctions]
  );
  const activeJ = junctions.filter((j) => j.enabled !== false);
  const maxDist = Math.max(1, ...activeJ.map((j) => j.position_m ?? 0));
  const height = plotMargins.top + maxDist * pixelsPerMeter + plotMargins.bottom;

  const [highlightBW, setHighlightBW] = useState<"out" | "in" | null>(null);

  // Refs holding current fill-segment data so the RAF loop can read without stale closures
  const outFillSegsRef = useRef<{ points: string; angleDeg: number }[]>([]);
  const inFillSegsRef  = useRef<{ points: string; angleDeg: number }[]>([]);
  // Refs for polygon counts so the RAF loop can drive directional flow line groups
  const outPolygonCountRef = useRef<number>(0);
  const inPolygonCountRef  = useRef<number>(0);

  // Sync external highlight override (e.g. from guided tour) into the existing button state
  useEffect(() => {
    if (highlightBand === 'outbound') setHighlightBW('out');
    else if (highlightBand === 'inbound') setHighlightBW('in');
    else if (highlightBand === null) setHighlightBW(null);
  }, [highlightBand]);

  const { items, yAxisItems, outboundBandwidth, inboundBandwidth, outbandPolygons, outbandFillSegs, outbandLabels, inbandPolygons, inbandFillSegs, inbandLabels } = useMemo(() => buildDiagramItems({
    junctions, timeStart, timeEnd, pixelsPerSecond, pixelsPerMeter,
    travelIn_s, travelOut_s, plotMargins, maxDist, activeJ,
    tip, setTip, hover, setHover, trajectory, mousePos, drag,
    shiftDown, ctrlDown, onPhaseChange, onPhaseLockToggle,
    queueTrajectoriesEnabled, queueTrajDirection, showDischargeWidth,
    queueOut_s, queueIn_s, defaultAmber_s, defaultRed_s, readOnly,
    masterJunctionId, handleRowMouseDown, getLocal,
  }), [
    jSig,
    timeStart,
    timeEnd,
    pixelsPerSecond,
    pixelsPerMeter,
    maxDist,
    travelIn_s,
    travelOut_s,
    plotMargins.left,
    plotMargins.top,
    tip,
    hover,
    junctions,
    activeJ,
    drag,
    shiftDown,
    trajectory,
    mousePos,
    queueTrajectoriesEnabled,
    queueOut_s,
    queueIn_s,
    saturationHeadway_s,
    defaultAmber_s,
    defaultRed_s,
    masterJunctionId,
  ]);

  // Keep fill-segment refs in sync with current memoised data (no stale closures in RAF)
  outFillSegsRef.current = outbandFillSegs;
  inFillSegsRef.current  = inbandFillSegs;
  outPolygonCountRef.current = outbandPolygons.length;
  inPolygonCountRef.current  = inbandPolygons.length;

  // RAF: translate each segment's pattern vertically — ↓ for outbound, ↑ for inbound
  useEffect(() => {
    if (!highlightBW) return;
    const tileH = 18;
    const speed = 0.35; // px/frame in vertical user-space
    let offset  = 0;
    let rafId: number;
    const step = () => {
      const segs   = highlightBW === 'out' ? outFillSegsRef.current : inFillSegsRef.current;
      const prefix = highlightBW === 'out' ? 'bw-seg-out' : 'bw-seg-in';
      const dir    = highlightBW === 'out' ? 1 : -1; // +1 = downward, -1 = upward
      offset = (offset + speed) % 120; // generous modulus, per-segment period applied below
      segs.forEach((seg, i) => {
        const el = document.getElementById(`${prefix}-${i}`);
        if (!el) return;
        const θ    = seg.angleDeg * Math.PI / 180;
        const cosθ = Math.cos(θ);
        // Vertical distance for one seamless tile repeat
        const period = Math.abs(cosθ) < 0.01 ? tileH : tileH / Math.abs(cosθ);
        const Δy = dir * (offset % period);
        // Convert vertical Δy into pre-rotation tile-local translate
        el.setAttribute('patternTransform',
          `rotate(${seg.angleDeg}) translate(${Δy * Math.sin(θ)}, ${Δy * Math.cos(θ)})`);
      });
      // Drive directional border flow lines: translate horizontally-clipped lines vertically
      const lineSpacing = 20;
      const flowDy = dir * (offset % lineSpacing);
      const polygonCount = highlightBW === 'out' ? outPolygonCountRef.current : inPolygonCountRef.current;
      const flowPrefix = highlightBW === 'out' ? 'bw-flow-lines-out' : 'bw-flow-lines-in';
      for (let i = 0; i < polygonCount; i++) {
        const flowEl = document.getElementById(`${flowPrefix}-${i}`);
        if (flowEl) flowEl.setAttribute('transform', `translate(0, ${flowDy})`);
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [highlightBW]);

  // Calculate dimensions for split layout
  const yAxisWidth = plotMargins.left;
  const plotWidth = (timeEnd - timeStart) * pixelsPerSecond + plotMargins.right;

  return (
    <div style={{ position: "relative" }}>
      {/* Control buttons moved to unified toolbar in App.tsx */}

      {/* Split layout: Fixed Y-axis + Scrollable content */}
      <div style={{ display: "flex", width: "100%" }}>
        {/* Fixed Y-axis panel */}
        <div
          style={{
            position: "relative",
            flexShrink: 0,
            width: yAxisWidth,
            height: height,
            backgroundColor: "inherit",
            borderRight: "1px solid #e5e7eb",
          }}
          className="dark:border-neutral-700"
        >
          <svg
            width={yAxisWidth}
            height={height}
            viewBox={`0 0 ${yAxisWidth} ${height}`}
            style={{ display: "block" }}
          >
            {/* Y-axis background */}
            <rect
              x={0}
              y={0}
              width={yAxisWidth}
              height={height}
              className="fill-neutral-800"
            />
            {yAxisItems}
          </svg>

          {/* Speed label overlays — HTML so they're editable without re-running the large useMemo */}
          {speedSegments.map(seg => {
            const canEdit = !readOnly && !!onTravelTimeChange;
            if (!canEdit) {
              // Read-only display
              return (
                <div key={`spd-${seg.segIdx}`} style={{ position: "absolute", top: seg.yMid - 10, left: 0, width: yAxisWidth, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, pointerEvents: "none" }}>
                  {seg.sameSpeed
                    ? <span style={{ fontSize: 12, color: "#9ca3af" }}>{seg.outKmh} km/h</span>
                    : <>
                        {seg.outKmh !== null && <span style={{ fontSize: 12, color: "#60a5fa" }}>↓ {seg.outKmh} km/h</span>}
                        {seg.inKmh !== null && <span style={{ fontSize: 12, color: "#4ade80" }}>↑ {seg.inKmh} km/h</span>}
                      </>
                  }
                </div>
              );
            }

            return (
              <div key={`spd-${seg.segIdx}`} style={{ position: "absolute", top: seg.yMid - 14, left: 0, width: yAxisWidth, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, pointerEvents: "none" }}>
                {seg.outKmh !== null && (
                  <SpeedLabelItem
                    prefix="↓ "
                    color="#60a5fa"
                    kmh={seg.outKmh}
                    segDist={seg.segDist}
                    segIdx={seg.segIdx}
                    dir="out"
                    onAdjust={handleSpeedAdjust}
                  />
                )}
                {seg.inKmh !== null && (
                  <SpeedLabelItem
                    prefix="↑ "
                    color="#4ade80"
                    kmh={seg.inKmh}
                    segDist={seg.segDist}
                    segIdx={seg.segIdx}
                    dir="in"
                    onAdjust={handleSpeedAdjust}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Horizontally scrollable main content */}
        <div
          style={{
            flex: 1,
            overflowX: "auto",
            overflowY: "hidden",
            scrollbarWidth: "thin",
            scrollbarColor: "#6b7280 transparent",
          }}
          className="diagram-scroll-container"
        >
          <svg
            ref={svgRef}
            key={jSig}
            width={plotWidth}
            height={height}
            viewBox={`${yAxisWidth} 0 ${plotWidth} ${height}`}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            style={{ minWidth: plotWidth, display: "block" }}
          >
            {/* Defs for bandwidth highlight patterns + animation */}
            <defs>
              <style>{`
                @keyframes bw-march { to { stroke-dashoffset: -24; } }
                .bw-march { animation: bw-march 0.7s linear infinite; }
              `}</style>
              {/* Per-segment hatch patterns — slope matches each corridor section exactly.
                  RAF loop updates patternTransform to translate vertically (↓ out, ↑ in). */}
              {outbandFillSegs.map((seg, i) => (
                <pattern key={`def-out-${i}`} id={`bw-seg-out-${i}`}
                  patternUnits="userSpaceOnUse" width="20" height="18"
                  patternTransform={`rotate(${seg.angleDeg})`}>
                  <rect width="20" height="18" fill="rgba(59,130,246,0.12)"/>
                  <line x1="0" y1="9" x2="20" y2="9" stroke="#3b82f6" strokeWidth="2.5" strokeOpacity="0.55"/>
                </pattern>
              ))}
              {inbandFillSegs.map((seg, i) => (
                <pattern key={`def-in-${i}`} id={`bw-seg-in-${i}`}
                  patternUnits="userSpaceOnUse" width="20" height="18"
                  patternTransform={`rotate(${seg.angleDeg})`}>
                  <rect width="20" height="18" fill="rgba(34,197,94,0.12)"/>
                  <line x1="0" y1="9" x2="20" y2="9" stroke="#22c55e" strokeWidth="2.5" strokeOpacity="0.55"/>
                </pattern>
              ))}
              {/* Clip to the plot area so pre-t0 elements don't bleed into margins */}
              <clipPath id="plot-area-clip">
                <rect
                  x={plotMargins.left}
                  y={0}
                  width={(timeEnd - timeStart) * pixelsPerSecond}
                  height={height}
                />
              </clipPath>
              {/* Stricter clip for queue trajectories: also clips y so paths
                  from older cycles that have exited the corridor become invisible */}
              <clipPath id="queue-traj-clip">
                <rect
                  x={plotMargins.left}
                  y={plotMargins.top}
                  width={(timeEnd - timeStart) * pixelsPerSecond}
                  height={maxDist * pixelsPerMeter}
                />
              </clipPath>
              {/* Clip paths for directional flow lines inside bandwidth corridors */}
              {highlightBW === "out" && outbandPolygons.map((pts, i) => (
                <clipPath key={`cp-out-${i}`} id={`bw-flow-cp-out-${i}`}>
                  <polygon points={pts} />
                </clipPath>
              ))}
              {highlightBW === "in" && inbandPolygons.map((pts, i) => (
                <clipPath key={`cp-in-${i}`} id={`bw-flow-cp-in-${i}`}>
                  <polygon points={pts} />
                </clipPath>
              ))}
            </defs>

            <g clipPath="url(#plot-area-clip)">
              {items}

              {/* Bandwidth highlight: static border + downward flow lines (outbound) */}
              {highlightBW === "out" && outbandPolygons.map((pts, i) => {
                const lineSpacing = 20;
                const numLines = Math.ceil((height + lineSpacing * 2) / lineSpacing) + 2;
                return (
                  <g key={`hl-out-border-${i}`} pointerEvents="none">
                    <polygon points={pts} fill="none" stroke="#60a5fa" strokeWidth={1.5} strokeOpacity={0.5} />
                    <g clipPath={`url(#bw-flow-cp-out-${i})`}>
                      <g id={`bw-flow-lines-out-${i}`}>
                        {Array.from({ length: numLines }, (_, j) => (
                          <line key={j}
                            x1={0} y1={(j - 1) * lineSpacing}
                            x2={99999} y2={(j - 1) * lineSpacing}
                            stroke="#3b82f6" strokeWidth={1.5} strokeOpacity={0.4}
                          />
                        ))}
                      </g>
                    </g>
                  </g>
                );
              })}
              {/* Bandwidth highlight: static border + upward flow lines (inbound) */}
              {highlightBW === "in" && inbandPolygons.map((pts, i) => {
                const lineSpacing = 20;
                const numLines = Math.ceil((height + lineSpacing * 2) / lineSpacing) + 2;
                return (
                  <g key={`hl-in-border-${i}`} pointerEvents="none">
                    <polygon points={pts} fill="none" stroke="#4ade80" strokeWidth={1.5} strokeOpacity={0.5} />
                    <g clipPath={`url(#bw-flow-cp-in-${i})`}>
                      <g id={`bw-flow-lines-in-${i}`}>
                        {Array.from({ length: numLines }, (_, j) => (
                          <line key={j}
                            x1={0} y1={(j - 1) * lineSpacing}
                            x2={99999} y2={(j - 1) * lineSpacing}
                            stroke="#22c55e" strokeWidth={1.5} strokeOpacity={0.4}
                          />
                        ))}
                      </g>
                    </g>
                  </g>
                );
              })}

              {/* Bandwidth value labels — rendered on top of fill and border */}
              {highlightBW === "out" && outbandLabels.map((lbl, i) => {
                const text = `${Math.round(lbl.bw)}s`;
                const tw = text.length * 8 + 16;
                return (
                  <g key={`bw-lbl-out-${i}`} pointerEvents="none">
                    <rect x={lbl.cx - tw / 2} y={lbl.cy - 11} width={tw} height={22}
                      rx={5} ry={5} fill="rgba(15,23,42,0.45)" />
                    <text x={lbl.cx} y={lbl.cy} textAnchor="middle" dominantBaseline="middle"
                      fontSize={12} fontWeight={700} fill="#93c5fd">
                      {text}
                    </text>
                  </g>
                );
              })}
              {highlightBW === "in" && inbandLabels.map((lbl, i) => {
                const text = `${Math.round(lbl.bw)}s`;
                const tw = text.length * 8 + 16;
                return (
                  <g key={`bw-lbl-in-${i}`} pointerEvents="none">
                    <rect x={lbl.cx - tw / 2} y={lbl.cy - 11} width={tw} height={22}
                      rx={5} ry={5} fill="rgba(15,23,42,0.45)" />
                    <text x={lbl.cx} y={lbl.cy} textAnchor="middle" dominantBaseline="middle"
                      fontSize={12} fontWeight={700} fill="#86efac">
                      {text}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>

      {/* Time axis label — outside the scrollable SVG so it's always centered */}
      <div
        style={{
          textAlign: "center",
          fontSize: "13px",
          color: "#e5e7eb",
          marginTop: "2px",
          marginBottom: "1px",
        }}
      >
        Time (s)
      </div>

      {/* Dynamic Bandwidth Display — click to highlight corridor on diagram */}
      <div
        data-tour="bandwidth-legend"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "16px",
          marginTop: "6px",
          fontSize: "14px",
        }}
      >
        {/* Outbound */}
        <button
          onClick={() => setHighlightBW(h => h === "out" ? null : "out")}
          title="Click to highlight outbound bandwidth corridor"
          style={{
            display: "flex", alignItems: "center", gap: "7px",
            background: highlightBW === "out" ? "#1a2236" : "#2d3a4a",
            borderRadius: "20px", padding: "5px 14px", cursor: "pointer",
            border: highlightBW === "out"
              ? "1.5px solid #3b82f6"
              : "none",
            borderTop: highlightBW === "out" ? undefined : "1.5px solid rgba(255,255,255,0.12)",
            borderBottom: highlightBW === "out" ? undefined : "1.5px solid rgba(0,0,0,0.5)",
            borderLeft: highlightBW === "out" ? undefined : "1.5px solid rgba(255,255,255,0.08)",
            borderRight: highlightBW === "out" ? undefined : "1.5px solid rgba(0,0,0,0.4)",
            boxShadow: highlightBW === "out"
              ? "inset 0 2px 5px rgba(0,0,0,0.6)"
              : "none",
            transition: "background 0.15s, box-shadow 0.15s",
          }}
        >
          <div style={{ width: 18, height: 3, backgroundColor: "#3b82f6", borderRadius: 1, flexShrink: 0 }} />
          <span style={{ color: highlightBW === "out" ? "#e2e8f0" : "#cbd5e1" }}>Outbound Bandwidth:</span>
          <span style={{ fontWeight: 700, color: "#3b82f6" }}>
            {outboundBandwidth !== null ? `${Math.round(outboundBandwidth)}s` : "—"}
          </span>
        </button>

        {/* Inbound */}
        <button
          onClick={() => setHighlightBW(h => h === "in" ? null : "in")}
          title="Click to highlight inbound bandwidth corridor"
          style={{
            display: "flex", alignItems: "center", gap: "7px",
            background: highlightBW === "in" ? "#1a2e22" : "#2d3a4a",
            borderRadius: "20px", padding: "5px 14px", cursor: "pointer",
            border: highlightBW === "in"
              ? "1.5px solid #22c55e"
              : "none",
            borderTop: highlightBW === "in" ? undefined : "1.5px solid rgba(255,255,255,0.12)",
            borderBottom: highlightBW === "in" ? undefined : "1.5px solid rgba(0,0,0,0.5)",
            borderLeft: highlightBW === "in" ? undefined : "1.5px solid rgba(255,255,255,0.08)",
            borderRight: highlightBW === "in" ? undefined : "1.5px solid rgba(0,0,0,0.4)",
            boxShadow: highlightBW === "in"
              ? "inset 0 2px 5px rgba(0,0,0,0.6)"
              : "none",
            transition: "background 0.15s, box-shadow 0.15s",
          }}
        >
          <div style={{ width: 18, height: 3, backgroundColor: "#22c55e", borderRadius: 1, flexShrink: 0 }} />
          <span style={{ color: highlightBW === "in" ? "#e2e8f0" : "#cbd5e1" }}>Inbound Bandwidth:</span>
          <span style={{ fontWeight: 700, color: "#22c55e" }}>
            {inboundBandwidth !== null ? `${Math.round(inboundBandwidth)}s` : "—"}
          </span>
        </button>

        {/* Cycle pill — only shown after optimization */}
        {optimizedCycle !== null && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: "7px",
              background: "#1e2433",
              border: "1.5px solid rgba(251,191,36,0.75)",
              borderRadius: "20px", padding: "5px 14px",
            }}
          >
            <div style={{ width: 18, height: 3, backgroundColor: "#fbbf24", borderRadius: 1, flexShrink: 0 }} />
            <span style={{ color: "#cbd5e1" }}>Cycle:</span>
            <span style={{ fontWeight: 700, color: "#fbbf24" }}>{optimizedCycle}s</span>
          </div>
        )}
      </div>

      {/* Scroll hint - only show if scrollable content is wider than typical viewport and not hidden */}
      {plotWidth > 1000 && !hideScrollHint && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            marginTop: "2px",
            fontSize: "12px",
            color: "#a1a1aa",
          }}
        >
          <span>�</span>
          <span>Scroll horizontally to see more cycles</span>
          <span>→</span>
        </div>
      )}
    </div>
  );
}
