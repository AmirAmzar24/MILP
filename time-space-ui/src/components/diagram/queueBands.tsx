import type React from "react";
import { calculatePerJunctionQueueBand, interpLastAtDist, QUEUE_TRAJECTORY_CONFIG, type QueueVehicleTrajectory } from "../../utils/trajectory";
import type { DiagramBuildContext } from "./context";

/**
 * Queue-band overlay: per-junction discharge bands (a filled polygon between the
 * first and last queued-vehicle trajectory in each cycle, plus border/intermediate
 * lines) and optional discharge-width brackets. Returns a clipped <g> group, or
 * null when queue trajectories are disabled or produce nothing. The orchestrator
 * pushes it after the bandwidth lines so queue borders render on top.
 */
export function buildQueueBands(ctx: DiagramBuildContext): React.ReactNode | null {
  const {
    queueTrajectoriesEnabled, t0, t1, plotLeft, plotTop, pixelsPerSecond, pixelsPerMeter,
    queueTrajDirection, showDischargeWidth, activeJ, junctions, queueOut_s, queueIn_s,
    travelOut_s, travelIn_s,
  } = ctx;
  let queueTrajGroup: React.ReactNode = null;
  if (queueTrajectoriesEnabled) {
    const queueTrajItems: React.ReactNode[] = [];

    // Helper to convert path points to pixel coordinates
    // Clip path to [t0, t1], inserting interpolated entry/exit points so polygons
    // start exactly at the left boundary instead of extending off-screen.
    const pathToPixels = (path: Array<{ time: number; distance: number }>) => {
      const clipped: Array<{ time: number; distance: number }> = [];
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const next = path[i + 1];
        if (p.time < t0) {
          // Before visible range — interpolate entry point if next point is in range
          if (next && next.time >= t0) {
            const frac = (t0 - p.time) / (next.time - p.time);
            clipped.push({
              time: t0,
              distance: p.distance + frac * (next.distance - p.distance),
            });
          }
          continue;
        }
        if (p.time > t1) break;
        clipped.push(p);
      }
      return clipped.map((pt) => ({
        x: plotLeft + (pt.time - t0) * pixelsPerSecond,
        y: plotTop + pt.distance * pixelsPerMeter,
      }));
    };

    // Helper to render a trajectory band (filled polygon between first and last trajectory)
    const renderTrajectoryBand = (
      trajs: QueueVehicleTrajectory[],
      direction: "outbound" | "inbound",
      keyPrefix: string
    ) => {
      if (trajs.length === 0) return;

      // Group trajectories by cycle - trajectories are created in order:
      // Cycle 1: vehicle 0, 1, 2, ..., N-1
      // Cycle 2: vehicle 0, 1, 2, ..., N-1
      // So we detect a new cycle when vehicleIndex resets to 0
      const cycleGroups: QueueVehicleTrajectory[][] = [];
      let currentGroup: QueueVehicleTrajectory[] = [];

      trajs.forEach((traj) => {
        if (traj.path.length < 2) return;

        // New cycle starts when vehicleIndex is 0 and we already have trajectories
        if (traj.vehicleIndex === 0 && currentGroup.length > 0) {
          cycleGroups.push(currentGroup);
          currentGroup = [];
        }
        currentGroup.push(traj);
      });

      // Don't forget the last group
      if (currentGroup.length > 0) {
        cycleGroups.push(currentGroup);
      }

      const strokeColor = direction === "outbound"
        ? QUEUE_TRAJECTORY_CONFIG.LINE_COLOR_OUTBOUND
        : QUEUE_TRAJECTORY_CONFIG.LINE_COLOR_INBOUND;

      // For each cycle, create a band from first to last trajectory
      cycleGroups.forEach((group, bandIdx) => {
        if (group.length < 2) {
          // Only one trajectory - just render it as a line
          const pixels = pathToPixels(group[0].path);
          const pathStr = pixels.map((p) => `${p.x},${p.y}`).join(" ");
          queueTrajItems.push(
            <polyline
              key={`${keyPrefix}-single-${bandIdx}`}
              points={pathStr}
              fill="none"
              stroke={strokeColor}
              strokeWidth={QUEUE_TRAJECTORY_CONFIG.LINE_WIDTH}
              opacity={QUEUE_TRAJECTORY_CONFIG.LINE_OPACITY}
              pointerEvents="none"
            />
          );
          return;
        }

        // Sort by vehicle index to find first (0) and last
        group.sort((a, b) => a.vehicleIndex - b.vehicleIndex);
        const firstTraj = group[0];
        const lastTraj = group[group.length - 1];

        const firstPixels = pathToPixels(firstTraj.path);
        const lastPixels = pathToPixels(lastTraj.path);

        // Create polygon: first path forward, then last path reversed
        // Need to copy arrays to avoid mutation issues
        const firstPoints = firstPixels.map((p) => `${p.x},${p.y}`);
        const lastPointsReversed = [...lastPixels].reverse().map((p) => `${p.x},${p.y}`);
        const polygonPoints = [...firstPoints, ...lastPointsReversed].join(" ");

        // Render filled band
        queueTrajItems.push(
          <polygon
            key={`${keyPrefix}-band-${bandIdx}`}
            points={polygonPoints}
            fill={strokeColor}
            fillOpacity={QUEUE_TRAJECTORY_CONFIG.BAND_FILL_OPACITY}
            stroke="none"
            pointerEvents="none"
          />
        );

        // Render all vehicle lines (border + intermediate)
        const firstPathStr = firstPixels.map((p) => `${p.x},${p.y}`).join(" ");
        const lastPathStr = lastPixels.map((p) => `${p.x},${p.y}`).join(" ");
        queueTrajItems.push(
          <polyline
            key={`${keyPrefix}-border-first-${bandIdx}`}
            points={firstPathStr}
            fill="none"
            stroke={strokeColor}
            strokeWidth={QUEUE_TRAJECTORY_CONFIG.LINE_WIDTH}
            opacity={QUEUE_TRAJECTORY_CONFIG.LINE_OPACITY}
            pointerEvents="none"
          />,
          <polyline
            key={`${keyPrefix}-border-last-${bandIdx}`}
            points={lastPathStr}
            fill="none"
            stroke={strokeColor}
            strokeWidth={QUEUE_TRAJECTORY_CONFIG.LINE_WIDTH}
            opacity={QUEUE_TRAJECTORY_CONFIG.LINE_OPACITY}
            pointerEvents="none"
          />
        );

        // Render intermediate vehicle lines.
        // Key by the slice position (vi), not traj.vehicleIndex, which can repeat
        // within a band's intermediate set and caused duplicate-key warnings.
        group.slice(1, -1).forEach((traj, vi) => {
          const pixels = pathToPixels(traj.path);
          const pathStr = pixels.map((p) => `${p.x},${p.y}`).join(" ");
          queueTrajItems.push(
            <polyline
              key={`${keyPrefix}-vehicle-${bandIdx}-${vi}`}
              points={pathStr}
              fill="none"
              stroke={strokeColor}
              strokeWidth={0.8}
              opacity={0.5}
              strokeDasharray="3 2"
              pointerEvents="none"
            />
          );
        });

        // Discharge width indicators: first-to-last vehicle departure span at each junction
        if (!showDischargeWidth) return;
        const startDist = direction === "outbound"
          ? Math.min(...activeJ.map((jj) => jj.position_m ?? 0))
          : Math.max(...activeJ.map((jj) => jj.position_m ?? 0));

        activeJ.forEach((j) => {
          const jDist = j.position_m ?? 0;
          if (jDist === startDist) return; // skip origin junction

          const firstDeparture = interpLastAtDist(firstTraj.path, jDist);
          const lastCrossing = interpLastAtDist(lastTraj.path, jDist);
          if (firstDeparture === null || lastCrossing === null) return;
          if (lastCrossing <= firstDeparture + 0.1) return;

          const widthSec = Math.round((lastCrossing - firstDeparture) * 10) / 10;
          const x1 = plotLeft + (firstDeparture - t0) * pixelsPerSecond;
          const x2 = plotLeft + (lastCrossing - t0) * pixelsPerSecond;
          const yJ = plotTop + jDist * pixelsPerMeter;
          const tickH = 5;
          // Draw bracket exactly at y=jDist so ticks align with where x-positions were computed
          const lineY = yJ;

          queueTrajItems.push(
            <g key={`${keyPrefix}-width-${bandIdx}-${j.id}`} pointerEvents="none">
              <line x1={x1} y1={lineY} x2={x2} y2={lineY}
                stroke="#f97316" strokeWidth={1.5} opacity={0.95} />
              <line x1={x1} y1={lineY - tickH} x2={x1} y2={lineY + tickH}
                stroke="#f97316" strokeWidth={1.5} opacity={0.95} />
              <line x1={x2} y1={lineY - tickH} x2={x2} y2={lineY + tickH}
                stroke="#f97316" strokeWidth={1.5} opacity={0.95} />
              <text
                x={(x1 + x2) / 2}
                y={lineY - tickH - 3}
                textAnchor="middle"
                fontSize={9}
                fill="#f97316"
                fontWeight={600}
              >{widthSec}s</text>
            </g>
          );
        });

      });
    };

    // Per-junction outbound bands: every junction (including origin J1) draws a band if it has queue > 0
    if (queueTrajDirection === "both" || queueTrajDirection === "outbound") {
      activeJ.forEach((junction, idx) => {
        const jIdxInAll = junctions.findIndex((j) => j.id === junction.id);
        const clearance = queueOut_s[jIdxInAll] ?? 0;
        if (clearance < 2) return;
        const nextJ = idx < activeJ.length - 1 ? activeJ[idx + 1] : null;
        const trajs = calculatePerJunctionQueueBand(
          junction, "outbound", nextJ, junctions, travelOut_s, clearance, t0, t1, QUEUE_TRAJECTORY_CONFIG
        );
        renderTrajectoryBand(trajs, "outbound", `queue-out-j${junction.id}`);
      });
    }

    // Per-junction inbound bands: every junction (including inbound origin J3) draws a band if it has queue > 0
    if (queueTrajDirection === "both" || queueTrajDirection === "inbound") {
      const reversedJ = [...activeJ].reverse();
      reversedJ.forEach((junction, idx) => {
        const jIdxInAll = junctions.findIndex((j) => j.id === junction.id);
        const clearance = queueIn_s[jIdxInAll] ?? 0;
        if (clearance < 2) return;
        const nextJ = idx < reversedJ.length - 1 ? reversedJ[idx + 1] : null;
        const trajs = calculatePerJunctionQueueBand(
          junction, "inbound", nextJ, junctions, travelIn_s, clearance, t0, t1, QUEUE_TRAJECTORY_CONFIG
        );
        renderTrajectoryBand(trajs, "inbound", `queue-in-j${junction.id}`);
      });
    }

    if (queueTrajItems.length > 0) {
      queueTrajGroup = <g key="queue-trajectory-group" clipPath="url(#queue-traj-clip)">{queueTrajItems}</g>;
    }
  }
  return queueTrajGroup;
}
