import type React from "react";
import type { DiagramBuildContext } from "./context";

/**
 * Trajectory overlay: the dashed travel-path polyline plus per-stop segment
 * highlights and labels. Returns a single <g> group, or null when no trajectory
 * is active. The orchestrator pushes it into the main items array.
 */
export function buildTrajectoryOverlay(ctx: DiagramBuildContext): React.ReactNode | null {
  const { trajectory, plotLeft, plotTop, t0, pixelsPerSecond, pixelsPerMeter } = ctx;
  if (trajectory) {
    const trajItems: React.ReactNode[] = [];

    // Draw trajectory path as cyan dotted line
    if (trajectory.path.length > 1) {
      const pathPoints = trajectory.path
        .map((pt) => {
          const x = plotLeft + (pt.time - t0) * pixelsPerSecond;
          const y = plotTop + pt.distance * pixelsPerMeter;
          return `${x},${y}`;
        })
        .join(" ");

      trajItems.push(
        <polyline
          key="traj-path"
          points={pathPoints}
          fill="none"
          stroke="#ffffff"
          strokeWidth={4}
          strokeDasharray="8 4"
          opacity={1}
          pointerEvents="none"
        />
      );
    }

    // Draw stop indicators and labels
    trajectory.stops.forEach((stop, idx) => {
      const x = plotLeft + (stop.time - t0) * pixelsPerSecond;
      const y = plotTop + stop.distance * pixelsPerMeter;
      const stopEndX = plotLeft + (stop.time + stop.duration - t0) * pixelsPerSecond;

      // Highlight the stop segment (horizontal line)
      trajItems.push(
        <line
          key={`stop-segment-${idx}`}
          x1={x}
          y1={y}
          x2={stopEndX}
          y2={y}
          stroke="#ef4444"
          strokeWidth={3}
          opacity={0.8}
          pointerEvents="none"
        />
      );

      // Stop label
      const stopLabel = `Stop: ${Math.round(stop.duration)}s`;
      trajItems.push(
        <g key={`stop-label-${idx}`} pointerEvents="none">
          <rect
            x={x - 2}
            y={y - 20}
            width={stopLabel.length * 6 + 8}
            height={16}
            rx={3}
            fill="#ef4444"
            opacity={0.9}
          />
          <text
            x={x + 2}
            y={y - 8}
            className="fill-white text-[10px] font-medium"
          >
            {stopLabel}
          </text>
        </g>
      );
    });

    return <g key="trajectory-group">{trajItems}</g>;
  }
  return null;
}
