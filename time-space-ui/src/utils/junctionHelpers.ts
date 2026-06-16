// Shared helpers and types for junction configuration

export type J = {
  id: string;
  name: string;
  position_m: number; // cumulative downstream distance
  offset_s: number; // cycle reference offset (phase 0 start)
  lost_s: number; // per-phase lost time (intergreen / driver reaction)
  phases_s: number[]; // full phase vector (seconds)
  outboundIdx: number[]; // indices used for outbound progression (multi)
  inboundIdx: number[]; // indices used for inbound progression (multi)
  sideRoadOutboundIdx?: number[]; // side road outbound phases (visualization only, not in MILP)
  sideRoadInboundIdx?: number[]; // side road inbound phases (visualization only, not in MILP)
  enabled?: boolean; // when false, treat as deleted (omit from diagram & outputs)
  direction?: "bidirectional" | "outbound" | "inbound"; // one-way mode: suppress the other direction
  phaseNames?: string[]; // label per phase (e.g. "A1", "A2", ...")
  cycleLocked?: boolean; // when true, cycle length is preserved during phase adjustments
  lockedPhases?: number[]; // phase indices that don't change when cycle is locked
  initialPhaseRatios?: number[]; // phase ratios captured when cycle lock is enabled (for proportional scaling)
  ovlPhaseIndices?: number[];  // indices of overlap phases (simultaneously out+in, always amber)
  // Asymmetric barrier: encoded via outboundIdx/inboundIdx bridge pattern —
  // if one phase in a barrier is exclusive to one direction and the other is in both,
  // the exclusive phase absorbs the full barrier total in its ring.
  // PRO mode per-junction overrides (null = use global default)
  proAmber_s?: number | null;
  proRed_s?: number | null;
  proLinkSpeedMin_kmh?: number | null;
  proLinkSpeedMax_kmh?: number | null;
  proLinkDeltaSpeedMin_kmh?: number | null;
  proLinkDeltaSpeedMax_kmh?: number | null;
};

// Optimization settings for MILP API integration
export type OptimizationSettings = {
  cycleRange: [number, number]; // [min, max] cycle time range
  defaultAmber_s: number; // default amber time in seconds
  defaultRed_s: number; // default red time in seconds
  flag: number; // 0=fixed phase sequence, 1=allow phase rearrangement
  k: number; // optimization parameter
  masterJunctionId: string; // ID of the master junction
  speedChangeRange_kmh: [number, number]; // [min, max] speed change range in km/h
  speedRange_kmh: [number, number]; // [min, max] speed range in km/h
};

// Clamp helper reused across App
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

// Redistribute phase durations when cycle lock is active.
// Changing one phase must be compensated by distributing the inverse delta
// across all other unlocked phases so the total cycle stays constant.
export function redistributeWithCycleLock(j: J, phaseIdx: number, rawNewVal: number): number[] {
  const next = [...j.phases_s];

  if (!j.cycleLocked) {
    next[phaseIdx] = Math.max(1, rawNewVal);
    return next;
  }

  const oldVal = j.phases_s[phaseIdx];
  const lockedSet = new Set(j.lockedPhases ?? []);
  const freeIndices = j.phases_s
    .map((_, idx) => idx)
    .filter(idx => idx !== phaseIdx && !lockedSet.has(idx));

  if (freeIndices.length === 0) return next;

  const freeSum = freeIndices.reduce((s, fi) => s + j.phases_s[fi], 0);
  const maxAbsorb = freeSum - freeIndices.length;
  const newVal = Math.min(Math.max(1, rawNewVal), oldVal + maxAbsorb);
  const delta = newVal - oldVal;
  if (delta === 0) return next;

  const shareEach = -delta / freeIndices.length;
  let distributed = 0;
  for (const fi of freeIndices) {
    const adjusted = Math.max(1, j.phases_s[fi] + shareEach);
    distributed += adjusted - j.phases_s[fi];
    next[fi] = adjusted;
  }
  next[phaseIdx] = oldVal - distributed;
  return next;
}

// Ensure we always have a phaseNames array in sync with phases_s
export function ensurePhaseNames(j: J, len: number): string[] {
  const base =
    Array.isArray(j.phaseNames) && j.phaseNames.length
      ? [...j.phaseNames]
      : j.phases_s.map((_, idx) => `A${idx + 1}`);

  let names = base.slice(0, len);
  while (names.length < len) {
    names.push(`A${names.length + 1}`);
  }
  return names;
}

// Small helper to move an item inside an array
function moveArray<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

// Toggle helpers for clickable chips (inbound/outbound indices)
export function toggleIdx(list: number[], idx: number): number[] {
  const has = list.includes(idx);
  return has ? list.filter((i) => i !== idx) : [...list, idx].sort((a, b) => a - b);
}

export type JunctionReorderPatch = Pick<
  J,
  "phases_s" | "phaseNames" | "outboundIdx" | "inboundIdx" | "sideRoadOutboundIdx" | "sideRoadInboundIdx" | "ovlPhaseIndices"
>;

// Reorder helper that moves time + in/out flags + name together.
// Pure: computes and returns a patch, but does not touch React state.
export function reorderPhase(
  j: J,
  from: number,
  to: number,
  nameSource?: string[]
): JunctionReorderPatch {
  const n = j.phases_s.length;
  if (from === to) return {
    phases_s: j.phases_s,
    phaseNames: ensurePhaseNames(j, n),
    outboundIdx: [...j.outboundIdx],
    inboundIdx: [...j.inboundIdx],
    sideRoadOutboundIdx: [...(j.sideRoadOutboundIdx ?? [])],
    sideRoadInboundIdx: [...(j.sideRoadInboundIdx ?? [])],
    ovlPhaseIndices: [...(j.ovlPhaseIndices ?? [])],
  };
  if (from < 0 || from >= n || to < 0 || to >= n) {
    return {
      phases_s: j.phases_s,
      phaseNames: ensurePhaseNames(j, n),
      inboundIdx: [...j.inboundIdx],
      outboundIdx: [...j.outboundIdx],
      sideRoadOutboundIdx: [...(j.sideRoadOutboundIdx ?? [])],
      sideRoadInboundIdx: [...(j.sideRoadInboundIdx ?? [])],
      ovlPhaseIndices: [...(j.ovlPhaseIndices ?? [])],
    };
  }

  // phases
  const phases = moveArray(j.phases_s, from, to);

  // names: prefer an explicit source (e.g. localNames) if provided
  const baseNames = nameSource ?? ensurePhaseNames(j, n);
  const names = moveArray(baseNames, from, to);

  // outbound/inbound flags as boolean arrays
  const outFlags = Array(n).fill(false);
  j.outboundIdx.forEach((ii) => {
    if (ii >= 0 && ii < n) outFlags[ii] = true;
  });
  const inFlags = Array(n).fill(false);
  j.inboundIdx.forEach((ii) => {
    if (ii >= 0 && ii < n) inFlags[ii] = true;
  });

  // side road flags
  const sideOutFlags = Array(n).fill(false);
  (j.sideRoadOutboundIdx ?? []).forEach((ii) => {
    if (ii >= 0 && ii < n) sideOutFlags[ii] = true;
  });
  const sideInFlags = Array(n).fill(false);
  (j.sideRoadInboundIdx ?? []).forEach((ii) => {
    if (ii >= 0 && ii < n) sideInFlags[ii] = true;
  });

  const outFlags2 = moveArray(outFlags, from, to);
  const inFlags2 = moveArray(inFlags, from, to);
  const sideOutFlags2 = moveArray(sideOutFlags, from, to);
  const sideInFlags2 = moveArray(sideInFlags, from, to);

  const outboundIdx = outFlags2
    .map((f, i) => (f ? i : -1))
    .filter((i) => i >= 0);
  const inboundIdx = inFlags2
    .map((f, i) => (f ? i : -1))
    .filter((i) => i >= 0);
  const sideRoadOutboundIdx = sideOutFlags2
    .map((f, i) => (f ? i : -1))
    .filter((i) => i >= 0);
  const sideRoadInboundIdx = sideInFlags2
    .map((f, i) => (f ? i : -1))
    .filter((i) => i >= 0);

  // ovl flags
  const ovlFlags = Array(n).fill(false);
  (j.ovlPhaseIndices ?? []).forEach((ii) => { if (ii >= 0 && ii < n) ovlFlags[ii] = true; });
  const ovlFlags2 = moveArray(ovlFlags, from, to);
  const ovlPhaseIndices = ovlFlags2.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);

  return { phases_s: phases, phaseNames: names, outboundIdx, inboundIdx, sideRoadOutboundIdx, sideRoadInboundIdx, ovlPhaseIndices };
}
