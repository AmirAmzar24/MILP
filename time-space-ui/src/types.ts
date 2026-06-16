// Shared TypeScript types for the time-space diagram.
//
// `Junction`/`Margins` previously lived in the leaf component
// `components/TimeSpaceDiagram.tsx` and were imported *upward* by
// `utils/trajectory.ts` and `components/diagramItems.tsx` (an inverted
// dependency). They live here so domain math and item builders can depend
// on a shared type module rather than on the component that renders them.

// Diagram-facing junction shape used by the time-space diagram, trajectory
// math, and item builders. (Distinct from the richer app-wide `J` in
// `utils/junctionHelpers.ts`.)
export type Junction = {
  id: string;
  name: string;
  position_m: number; // cumulative downstream distance
  offset_s: number; // cycle reference offset (phase 0 start)
  phases_s: number[]; // full phase vector (seconds)
  outboundIdx: number[]; // indices used for outbound progression (multi)
  inboundIdx: number[]; // indices used for inbound progression (multi)
  sideRoadOutboundIdx?: number[]; // side road outbound phases (visualization only)
  sideRoadInboundIdx?: number[]; // side road inbound phases (visualization only)
  enabled?: boolean; // when false, treat as deleted (omit from diagram & outputs)
  phaseNames?: string[]; // label per phase (e.g. "A1", "A2", ...)
  cycleLocked?: boolean; // when true, cycle length is preserved during phase adjustments
  lockedPhases?: number[]; // phase indices that don't change when cycle is locked
};

export type Margins = { left: number; top: number; right: number; bottom: number };
