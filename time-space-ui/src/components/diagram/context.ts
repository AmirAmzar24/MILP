import type React from "react";
import type { Junction, Margins } from "../../types";
import type { TrajectoryData } from "../../utils/trajectory";

type TipState = { x: number; y: number; label: string; lines?: string[] } | null;
type HoverState = { x: number; y: number; w: number; h: number } | null;
type DragState = { id: string; startOffset_s: number; startX: number } | null;

export interface DiagramItemsParams {
  junctions: Junction[];
  timeStart: number;
  timeEnd: number;
  pixelsPerSecond: number;
  pixelsPerMeter: number;
  travelIn_s: number[];
  travelOut_s: number[];
  plotMargins: Margins;
  maxDist: number;
  activeJ: Junction[];
  tip: TipState;
  setTip: React.Dispatch<React.SetStateAction<TipState>>;
  hover: HoverState;
  setHover: React.Dispatch<React.SetStateAction<HoverState>>;
  trajectory: TrajectoryData | null;
  mousePos: { x: number; y: number } | null;
  drag: DragState;
  shiftDown: boolean;
  ctrlDown: boolean;
  onPhaseChange?: (id: string, phaseIdx: number, newLength_s: number) => void;
  onPhaseLockToggle?: (junctionId: string, phaseIdx: number) => void;
  queueTrajectoriesEnabled: boolean;
  queueTrajDirection: "both" | "outbound" | "inbound";
  showDischargeWidth: boolean;
  queueOut_s: number[];
  queueIn_s: number[];
  defaultAmber_s: number;
  defaultRed_s: number;
  readOnly: boolean;
  masterJunctionId?: string;
  handleRowMouseDown: (evt: React.MouseEvent<SVGRectElement, MouseEvent>, j: Junction) => void;
  getLocal: (e: React.MouseEvent<SVGElement, MouseEvent>) => { x: number; y: number };
}

/**
 * Geometry scalars shared by every diagram-item builder, derived once from the
 * raw params and threaded through `buildContext` so each per-concern builder
 * can be called (and unit-tested) with a single, explicit input object.
 */
export interface DiagramBuildContext extends DiagramItemsParams {
  plotLeft: number;   // plot origin x (px)
  plotTop: number;    // plot origin y (px)
  t0: number;         // visible time window start (s)
  t1: number;         // visible time window end (s)
  W: number;          // plot width (px)
  H: number;          // plot height (px)
  activeIndices: number[]; // indices of enabled junctions, in order
  majorEvery: number; // vertical grid major spacing (s) = master cycle length
  minorEvery: number; // vertical grid minor spacing (s)
}

/** Derive the shared geometry scalars from the raw diagram params. */
export function buildContext(p: DiagramItemsParams): DiagramBuildContext {
  const plotLeft = p.plotMargins.left;
  const plotTop = p.plotMargins.top;
  const t0 = p.timeStart;
  const t1 = p.timeEnd;
  const W = (t1 - t0) * p.pixelsPerSecond;
  const H = p.maxDist * p.pixelsPerMeter;

  // Indices of enabled junctions (disabled ones are omitted from the diagram).
  const activeIndices = p.junctions
    .map((j, idx) => (j.enabled === false ? -1 : idx))
    .filter((idx) => idx >= 0);

  // Vertical grid: major lines at every cycle boundary of the master junction
  // (fallback: first active junction).
  const masterJ = p.masterJunctionId
    ? p.activeJ.find((j) => j.id === p.masterJunctionId)
    : undefined;
  const refJunction = masterJ ?? p.activeJ[0];
  const majorEvery = refJunction
    ? Math.max(1, refJunction.phases_s.reduce((a, b) => a + b, 0))
    : 60;
  const minorEvery = Math.max(1, Math.round(majorEvery / 6));

  return { ...p, plotLeft, plotTop, t0, t1, W, H, activeIndices, majorEvery, minorEvery };
}
