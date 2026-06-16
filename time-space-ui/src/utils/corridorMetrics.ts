// Pure utility functions for computing corridor-level traffic signal metrics.
// Used by the Optimization Comparison Report to compare before/after timing plans.

import type { J } from "./junctionHelpers";
import {
  phaseWindows,
  mergeConsecutivePhases,
  getMergedPhaseTiming,
  greenWindowAt,
} from "./phaseWindows";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CorridorSnapshot = {
  junctions: J[];
  travelOut_s: number[];
  travelIn_s: number[];
};

export type JunctionMetric = {
  name: string;
  effectiveGreen_s: number;
  greenRatio: number; // 0–1
  stopped: boolean;
  delay_s: number;
};

export type DirectionMetrics = {
  bandwidth_s: number;
  progressionEfficiency: number; // 0–1, bandwidth / effective green at first junction
  numStops: number;
  totalDelay_s: number;
  bottleneckJunction: string;
  bottleneckReason: string;
  perJunction: JunctionMetric[];
};

export type DeltaMetrics = {
  bandwidth_s: number;
  progressionEfficiency: number;
  numStops: number;
  totalDelay_s: number;
};

export type ComparisonReport = {
  before: { outbound: DirectionMetrics; inbound: DirectionMetrics; cycle_s: number };
  after: { outbound: DirectionMetrics; inbound: DirectionMetrics; cycle_s: number };
  delta: { outbound: DeltaMetrics; inbound: DeltaMetrics; cycle_s: number };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get active (enabled) junctions and their original indices. */
function getActiveJunctions(junctions: J[]): { j: J; origIdx: number }[] {
  return junctions
    .map((j, i) => ({ j, origIdx: i }))
    .filter(({ j }) => j.enabled !== false);
}

/** Compute total effective green time for a direction at one junction. */
function junctionEffectiveGreen(
  junction: J,
  direction: "outbound" | "inbound",
  defaultRed_s: number
): number {
  const idx = direction === "outbound" ? junction.outboundIdx : junction.inboundIdx;
  const groups = mergeConsecutivePhases(idx ?? [], junction.phases_s.length);
  let total = 0;
  for (const group of groups) {
    const { effectiveDur } = getMergedPhaseTiming(group, junction.phases_s, defaultRed_s);
    total += effectiveDur;
  }
  return total;
}

// ─── Core Metric Functions ───────────────────────────────────────────────────

/**
 * Compute corridor bandwidth for one direction.
 *
 * Bandwidth = the maximum time window in which a vehicle can depart the
 * first junction and pass through ALL subsequent junctions on green.
 *
 * This works by propagating "band intervals" through each junction
 * sequentially.  At each junction the arriving band is intersected with
 * the local green windows; only the surviving overlap is forwarded to the
 * next junction.  The final surviving width is the corridor bandwidth.
 *
 * This matches the diagram's own bandwidth rendering logic (which chains
 * overlaps through triplets of junctions and takes the minimum).
 */
export function computeCorridorBandwidth(
  snapshot: CorridorSnapshot,
  direction: "outbound" | "inbound",
  defaultRed_s: number
): number {
  const active = getActiveJunctions(snapshot.junctions);
  if (active.length < 2) {
    if (active.length === 1) {
      return junctionEffectiveGreen(active[0].j, direction, defaultRed_s);
    }
    return 0;
  }

  // Order junctions by travel direction
  const ordered = direction === "outbound" ? [...active] : [...active].reverse();
  const travelArr = direction === "outbound" ? snapshot.travelOut_s : snapshot.travelIn_s;

  // Determine a scan range based on the max cycle
  const maxCycle = Math.max(...ordered.map(({ j }) => j.phases_s.reduce((a, b) => a + b, 0)));
  const scanEnd = 3 * maxCycle;

  // Seed: green windows at the first junction (as departure intervals)
  const firstJ = ordered[0].j;
  const firstCycle = firstJ.phases_s.reduce((a, b) => a + b, 0);
  const firstIdx = direction === "outbound" ? firstJ.outboundIdx : firstJ.inboundIdx;
  const firstGroups = mergeConsecutivePhases(firstIdx ?? [], firstJ.phases_s.length);

  // Each band is an interval { start, end } in absolute time at the current junction
  type Band = { start: number; end: number };
  let bands: Band[] = [];

  for (const group of firstGroups) {
    const { start, effectiveDur } = getMergedPhaseTiming(group, firstJ.phases_s, defaultRed_s);
    if (effectiveDur <= 0) continue;
    const wins = phaseWindows(0, scanEnd, firstCycle, firstJ.offset_s, start, effectiveDur);
    for (const w of wins) {
      bands.push({ start: w.originalT, end: w.originalT + w.originalW });
    }
  }

  if (bands.length === 0) return 0;

  // Propagate through each subsequent junction
  for (let k = 1; k < ordered.length; k++) {
    const prevOrigIdx = ordered[k - 1].origIdx;
    const currOrigIdx = ordered[k].origIdx;
    const currJ = ordered[k].j;
    const currCycle = currJ.phases_s.reduce((a, b) => a + b, 0);
    if (currCycle <= 0) return 0;

    // Travel time between previous and current junction
    const segStart = Math.min(prevOrigIdx, currOrigIdx);
    const segEnd = Math.max(prevOrigIdx, currOrigIdx);
    let tt = 0;
    for (let i = segStart; i < segEnd; i++) tt += travelArr[i] ?? 0;
    if (tt <= 0) return 0;

    // Green windows at current junction
    const currIdxArr = direction === "outbound" ? currJ.outboundIdx : currJ.inboundIdx;
    const currGroups = mergeConsecutivePhases(currIdxArr ?? [], currJ.phases_s.length);
    const greenWins: Band[] = [];
    for (const group of currGroups) {
      const { start, effectiveDur } = getMergedPhaseTiming(group, currJ.phases_s, defaultRed_s);
      if (effectiveDur <= 0) continue;
      const wins = phaseWindows(0, scanEnd + tt * ordered.length, currCycle, currJ.offset_s, start, effectiveDur);
      for (const w of wins) {
        greenWins.push({ start: w.originalT, end: w.originalT + w.originalW });
      }
    }

    if (greenWins.length === 0) return 0;

    // Intersect each arriving band with each green window at this junction.
    // The arriving band [s, e] shifts by +tt to become arrival window [s+tt, e+tt].
    // Intersection with green [gs, ge] gives the surviving band *at this junction*.
    const nextBands: Band[] = [];
    for (const band of bands) {
      const arrStart = band.start + tt;
      const arrEnd = band.end + tt;

      for (const gw of greenWins) {
        const overlapStart = Math.max(arrStart, gw.start);
        const overlapEnd = Math.min(arrEnd, gw.end);
        if (overlapEnd > overlapStart) {
          nextBands.push({ start: overlapStart, end: overlapEnd });
        }
      }
    }

    if (nextBands.length === 0) return 0;
    bands = nextBands;
  }

  // Corridor bandwidth = maximum surviving band width
  let maxBW = 0;
  for (const band of bands) {
    maxBW = Math.max(maxBW, band.end - band.start);
  }
  return maxBW;
}

/**
 * Simulate a probe vehicle traversing the corridor and compute stops/delay.
 * The vehicle departs the first junction (in travel direction) at the
 * earliest green window start.
 */
export function computeStopsAndDelay(
  snapshot: CorridorSnapshot,
  direction: "outbound" | "inbound",
  defaultRed_s: number
): { numStops: number; totalDelay_s: number; perJunction: JunctionMetric[] } {
  const active = getActiveJunctions(snapshot.junctions);
  if (active.length === 0) {
    return { numStops: 0, totalDelay_s: 0, perJunction: [] };
  }

  // Determine travel order
  const ordered = direction === "outbound" ? [...active] : [...active].reverse();

  const perJunction: JunctionMetric[] = [];
  let numStops = 0;
  let totalDelay = 0;

  // Departure time: start of first green at the first junction in travel direction
  const firstJ = ordered[0].j;
  const firstIdx = direction === "outbound" ? firstJ.outboundIdx : firstJ.inboundIdx;
  const firstGroups = mergeConsecutivePhases(firstIdx ?? [], firstJ.phases_s.length);
  const firstCycle = firstJ.phases_s.reduce((a, b) => a + b, 0);

  let departureTime = 0;
  if (firstGroups.length > 0 && firstCycle > 0) {
    const { start } = getMergedPhaseTiming(firstGroups[0], firstJ.phases_s, defaultRed_s);
    departureTime = firstJ.offset_s + start;
  }

  // First junction: always green (we depart at green start)
  const firstEffGreen = junctionEffectiveGreen(firstJ, direction, defaultRed_s);
  perJunction.push({
    name: firstJ.name,
    effectiveGreen_s: Math.round(firstEffGreen * 10) / 10,
    greenRatio: firstCycle > 0 ? firstEffGreen / firstCycle : 0,
    stopped: false,
    delay_s: 0,
  });

  let currentTime = departureTime;

  // Traverse subsequent junctions
  for (let k = 1; k < ordered.length; k++) {
    const prevOrigIdx = ordered[k - 1].origIdx;
    const currOrigIdx = ordered[k].origIdx;
    const currJ = ordered[k].j;
    const currCycle = currJ.phases_s.reduce((a, b) => a + b, 0);
    const effGreen = junctionEffectiveGreen(currJ, direction, defaultRed_s);

    // Compute travel time for this segment
    const travelArr = direction === "outbound" ? snapshot.travelOut_s : snapshot.travelIn_s;
    const segStart = Math.min(prevOrigIdx, currOrigIdx);
    const segEnd = Math.max(prevOrigIdx, currOrigIdx);
    let tt = 0;
    for (let i = segStart; i < segEnd; i++) tt += travelArr[i] ?? 0;

    const arrivalTime = currentTime + tt;

    // Check if vehicle arrives during green
    const { isGreen: inGreen, nextGreenStart } = greenWindowAt(currJ, direction, arrivalTime, defaultRed_s);
    const wait = inGreen ? 0 : nextGreenStart - arrivalTime;

    const stopped = !inGreen && wait > 0;
    const delay = stopped ? wait : 0;

    perJunction.push({
      name: currJ.name,
      effectiveGreen_s: Math.round(effGreen * 10) / 10,
      greenRatio: currCycle > 0 ? effGreen / currCycle : 0,
      stopped,
      delay_s: Math.round(delay * 10) / 10,
    });

    if (stopped) {
      numStops++;
      totalDelay += delay;
    }

    currentTime = arrivalTime + delay;
  }

  return {
    numStops,
    totalDelay_s: Math.round(totalDelay * 10) / 10,
    perJunction,
  };
}

/**
 * Identify the bottleneck junction from per-junction metrics.
 */
export function identifyBottleneck(
  perJunction: JunctionMetric[]
): { name: string; reason: string } {
  if (perJunction.length === 0) {
    return { name: "N/A", reason: "No junctions" };
  }

  // Among stopped junctions, pick the one with the longest delay
  const stopped = perJunction.filter((j) => j.stopped);
  if (stopped.length > 0) {
    const worst = stopped.reduce((a, b) => (a.delay_s >= b.delay_s ? a : b));
    return {
      name: worst.name,
      reason: `Longest red wait (${worst.delay_s.toFixed(1)}s)`,
    };
  }

  // No stops: pick junction with the smallest green ratio
  const minGR = perJunction.reduce((a, b) => (a.greenRatio <= b.greenRatio ? a : b));
  return {
    name: minGR.name,
    reason: `Smallest green ratio (${(minGR.greenRatio * 100).toFixed(1)}%)`,
  };
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

function computeDirectionMetrics(
  snapshot: CorridorSnapshot,
  direction: "outbound" | "inbound",
  defaultRed_s: number
): DirectionMetrics {
  const bandwidth_s = computeCorridorBandwidth(snapshot, direction, defaultRed_s);
  const { numStops, totalDelay_s, perJunction } = computeStopsAndDelay(snapshot, direction, defaultRed_s);
  const { name, reason } = identifyBottleneck(perJunction);

  // Progression efficiency = bandwidth / effective green at first junction
  // This shows what fraction of vehicles departing during green can pass through without stopping
  const active = getActiveJunctions(snapshot.junctions);
  const ordered = direction === "outbound" ? active : [...active].reverse();
  let progressionEfficiency = 0;
  if (ordered.length > 0) {
    const firstEffGreen = junctionEffectiveGreen(ordered[0].j, direction, defaultRed_s);
    if (firstEffGreen > 0) {
      progressionEfficiency = Math.min(1, bandwidth_s / firstEffGreen); // Cap at 100%
    }
  }

  return {
    bandwidth_s: Math.round(bandwidth_s * 10) / 10,
    progressionEfficiency: Math.round(progressionEfficiency * 1000) / 1000, // 3 decimal places
    numStops,
    totalDelay_s,
    bottleneckJunction: name,
    bottleneckReason: reason,
    perJunction,
  };
}

/**
 * Build the full before/after comparison report.
 */
export function buildComparisonReport(
  before: CorridorSnapshot,
  after: CorridorSnapshot,
  defaultRed_s: number
): ComparisonReport {
  const activeB = before.junctions.filter((j) => j.enabled !== false);
  const activeA = after.junctions.filter((j) => j.enabled !== false);
  const beforeCycle = activeB.length > 0 ? activeB[0].phases_s.reduce((a, b) => a + b, 0) : 0;
  const afterCycle = activeA.length > 0 ? activeA[0].phases_s.reduce((a, b) => a + b, 0) : 0;

  const bOut = computeDirectionMetrics(before, "outbound", defaultRed_s);
  const bIn = computeDirectionMetrics(before, "inbound", defaultRed_s);
  const aOut = computeDirectionMetrics(after, "outbound", defaultRed_s);
  const aIn = computeDirectionMetrics(after, "inbound", defaultRed_s);

  return {
    before: { outbound: bOut, inbound: bIn, cycle_s: beforeCycle },
    after: { outbound: aOut, inbound: aIn, cycle_s: afterCycle },
    delta: {
      outbound: {
        bandwidth_s: Math.round((aOut.bandwidth_s - bOut.bandwidth_s) * 10) / 10,
        progressionEfficiency: Math.round((aOut.progressionEfficiency - bOut.progressionEfficiency) * 1000) / 1000,
        numStops: aOut.numStops - bOut.numStops,
        totalDelay_s: Math.round((aOut.totalDelay_s - bOut.totalDelay_s) * 10) / 10,
      },
      inbound: {
        bandwidth_s: Math.round((aIn.bandwidth_s - bIn.bandwidth_s) * 10) / 10,
        progressionEfficiency: Math.round((aIn.progressionEfficiency - bIn.progressionEfficiency) * 1000) / 1000,
        numStops: aIn.numStops - bIn.numStops,
        totalDelay_s: Math.round((aIn.totalDelay_s - bIn.totalDelay_s) * 10) / 10,
      },
      cycle_s: Math.round((afterCycle - beforeCycle) * 10) / 10,
    },
  };
}
