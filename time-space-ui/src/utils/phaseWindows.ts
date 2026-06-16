// Shared phase-window utilities for green-band rendering and corridor metrics.
// The helpers (phaseWindows, mergeConsecutivePhases, getMergedPhaseTiming) were
// previously exported from TimeSpaceDiagram.tsx; they live here so utility files
// don't need to import from a component.

export type PhaseJunction = {
  phases_s: number[];
  outboundIdx: number[];
  inboundIdx: number[];
  offset_s: number;
};

/**
 * Generate all occurrences of a phase window in [t0, t1].
 * Returns both the clipped segment (t, w) and the original unclipped window (originalT, originalW).
 */
export function phaseWindows(
  t0: number,
  t1: number,
  cycle: number,
  offset: number,
  phaseStart: number,
  phaseDur: number
): { t: number; w: number; originalT: number; originalW: number }[] {
  if (cycle <= 0 || phaseDur <= 0) return [];
  const kStart = Math.floor((t0 - (offset + phaseStart)) / cycle) - 1;
  const kEnd   = Math.ceil( (t1 - (offset + phaseStart)) / cycle) + 1;
  const out: { t: number; w: number; originalT: number; originalW: number }[] = [];
  for (let k = kStart; k <= kEnd; k++) {
    const start = offset + phaseStart + k * cycle;
    const end   = start + phaseDur;
    if (end < t0 || start > t1) continue;
    out.push({
      t: Math.max(start, t0),
      w: Math.min(end, t1) - Math.max(start, t0),
      originalT: start,
      originalW: phaseDur,
    });
  }
  return out;
}

/**
 * Merge consecutive phase indices into groups for green-band drawing.
 * Handles wrap-around: [0, 4] with 5 phases → [[4, 0]] (one group spanning the cycle boundary).
 */
export function mergeConsecutivePhases(phaseIndices: number[], numPhases: number): number[][] {
  if (phaseIndices.length === 0) return [];
  if (phaseIndices.length === 1) return [[phaseIndices[0]]];

  const sorted = [...phaseIndices].sort((a, b) => a - b);
  const groups: number[][] = [];
  let current: number[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      current.push(sorted[i]);
    } else {
      groups.push(current);
      current = [sorted[i]];
    }
  }
  groups.push(current);

  // Wrap-around: last group ends at (numPhases-1) AND first group starts at 0
  if (groups.length > 1) {
    const first = groups[0];
    const last  = groups[groups.length - 1];
    if (first[0] === 0 && last[last.length - 1] === numPhases - 1) {
      const merged = [...last, ...first];
      groups.pop();
      groups.shift();
      groups.unshift(merged);
    }
  }

  return groups;
}

/**
 * Compute the start time and effective duration for a merged group of consecutive phases.
 * Effective duration = total raw duration minus `defaultRed_s` intergreen clearance
 * (subtracted from the END of the group only).
 * Handles wrap-around groups correctly.
 */
export function getMergedPhaseTiming(
  group: number[],
  phases_s: number[],
  defaultRed_s: number
): { start: number; effectiveDur: number } {
  const numPhases = phases_s.length;

  const hasWrapAround =
    group.length > 1 &&
    group.some(idx => idx === numPhases - 1) &&
    group.some(idx => idx === 0) &&
    group[0] > group[group.length - 1];

  const firstPhase  = group[0];
  const start       = phases_s.slice(0, firstPhase).reduce((a, b) => a + b, 0);
  const totalDur    = group.reduce((sum, idx) => sum + phases_s[idx], 0);
  const effectiveDur = Math.max(0, totalDur - defaultRed_s);

  if (hasWrapAround) {
    // wrap-around: start is the high-index phase (already computed above)
    return { start, effectiveDur };
  }
  return { start, effectiveDur };
}

/**
 * Check whether `time` falls inside a green phase for the given direction.
 *
 * Replaces both `isInGreenPhase` (TimeSpaceDiagram.tsx) and `checkGreenAtTime`
 * (corridorMetrics.ts):
 *   - TimeSpaceDiagram calls with defaultRed_s=0 (raw phase windows, no clearance)
 *   - corridorMetrics calls with the actual defaultRed_s (effective green windows)
 *
 * Returns the current (or next) green window as absolute times so callers can
 * derive whatever they need (wait = nextGreenStart - time, draw band, etc.).
 */
export function greenWindowAt(
  junction: PhaseJunction,
  direction: "outbound" | "inbound",
  time: number,
  defaultRed_s = 0
): { isGreen: boolean; nextGreenStart: number; nextGreenEnd: number } {
  const cycle = junction.phases_s.reduce((a, b) => a + b, 0);
  if (cycle <= 0) return { isGreen: false, nextGreenStart: time, nextGreenEnd: time };

  const idx    = direction === "outbound" ? junction.outboundIdx : junction.inboundIdx;
  const groups = mergeConsecutivePhases(idx ?? [], junction.phases_s.length);
  if (groups.length === 0) return { isGreen: false, nextGreenStart: time, nextGreenEnd: time };

  // Scan a range of [time - cycle, time + 2*cycle] to find windows around `time`
  const scanStart = time - cycle;
  const scanEnd   = time + 2 * cycle;

  let bestCurrentStart = -Infinity;
  let bestCurrentEnd   = -Infinity;
  let bestNextStart    = Infinity;
  let bestNextEnd      = Infinity;

  for (const group of groups) {
    const { start, effectiveDur } = getMergedPhaseTiming(group, junction.phases_s, defaultRed_s);
    if (effectiveDur <= 0) continue;

    const wins = phaseWindows(scanStart, scanEnd, cycle, junction.offset_s, start, effectiveDur);
    for (const w of wins) {
      const wStart = w.originalT;
      const wEnd   = w.originalT + w.originalW;

      if (time >= wStart && time < wEnd) {
        // `time` is inside this window — track as "current green"
        if (wStart > bestCurrentStart) {
          bestCurrentStart = wStart;
          bestCurrentEnd   = wEnd;
        }
      } else if (wStart > time && wStart < bestNextStart) {
        // Next green window after `time`
        bestNextStart = wStart;
        bestNextEnd   = wEnd;
      }
    }
  }

  if (bestCurrentStart !== -Infinity) {
    return { isGreen: true, nextGreenStart: bestCurrentStart, nextGreenEnd: bestCurrentEnd };
  }
  return { isGreen: false, nextGreenStart: bestNextStart, nextGreenEnd: bestNextEnd };
}
