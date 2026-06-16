import { describe, it, expect } from "vitest";
import { buildContext, type DiagramItemsParams } from "./context";
import { buildBandwidthCorridors } from "./bandwidth";
import type { Junction } from "../../types";

// 3-junction corridor mirroring the app's DEFAULT_JUNCTIONS shape: phases [25,60,23,50]
// (cycle 158), outbound = phase 0, inbound = phase 1, positions 0/400/900. Default travel at
// 40 km/h ≈ 36 s (400 m link) and 45 s (500 m link).
//
// Offsets are the lever that aligns green windows into a through-band:
//   • outbound aligns at the cumulative *outbound* travel: 0, 36, 81
//   • inbound  aligns at the cumulative *inbound*  travel (J3→J1): 81, 45, 0
// The app's real default offsets (0/12/24) align neither — they form only per-pair ribbons.
function corridorJunctions(offsets: [number, number, number]): Junction[] {
  const base = {
    phases_s: [25, 60, 23, 50],
    outboundIdx: [0],
    inboundIdx: [1],
    sideRoadOutboundIdx: [],
    sideRoadInboundIdx: [],
    enabled: true,
    phaseNames: ["A1", "A2", "A3", "A4"],
  };
  return [
    { id: "j1", name: "J1", position_m: 0, offset_s: offsets[0], ...base },
    { id: "j2", name: "J2", position_m: 400, offset_s: offsets[1], ...base },
    { id: "j3", name: "J3", position_m: 900, offset_s: offsets[2], ...base },
  ];
}

const OUTBOUND_ALIGNED: [number, number, number] = [0, 36, 81];
const INBOUND_ALIGNED: [number, number, number] = [81, 45, 0];

const noop = () => {};

function makeParams(overrides: Partial<DiagramItemsParams> = {}): DiagramItemsParams {
  const junctions = overrides.junctions ?? corridorJunctions(OUTBOUND_ALIGNED);
  const activeJ = junctions.filter((j) => j.enabled !== false);
  return {
    junctions,
    timeStart: -10,
    timeEnd: 300,
    pixelsPerSecond: 4,
    pixelsPerMeter: 0.2,
    travelIn_s: [36, 45],
    travelOut_s: [36, 45],
    plotMargins: { left: 80, top: 80, right: 20, bottom: 64 },
    maxDist: 900,
    activeJ,
    tip: null,
    setTip: noop,
    hover: null,
    setHover: noop,
    trajectory: null,
    mousePos: null,
    drag: null,
    shiftDown: false,
    ctrlDown: false,
    onPhaseChange: noop,
    onPhaseLockToggle: noop,
    queueTrajectoriesEnabled: false,
    queueTrajDirection: "both",
    showDischargeWidth: false,
    queueOut_s: [],
    queueIn_s: [],
    defaultAmber_s: 3,
    defaultRed_s: 2,
    readOnly: false,
    masterJunctionId: undefined,
    handleRowMouseDown: noop,
    getLocal: () => ({ x: 0, y: 0 }),
    ...overrides,
  };
}

const KEYS = [
  "outboundBandwidth", "inboundBandwidth",
  "outbandPolygons", "outbandFillSegs", "outbandLabels",
  "inbandPolygons", "inbandFillSegs", "inbandLabels",
  "bwItems",
];

describe("buildBandwidthCorridors", () => {
  it("returns all nine output fields", () => {
    const res = buildBandwidthCorridors(buildContext(makeParams()));
    for (const k of KEYS) expect(res).toHaveProperty(k);
  });

  it("produces an outbound through-band when outbound greens align", () => {
    const res = buildBandwidthCorridors(buildContext(makeParams({ junctions: corridorJunctions(OUTBOUND_ALIGNED) })));
    // Characterization: locks the current outbound bandwidth for this corridor.
    expect(res.outboundBandwidth).toBe(23);
    // A band <= the outbound green time (phase 0 = 25 s), with populated geometry.
    expect(res.outboundBandwidth!).toBeGreaterThan(0);
    expect(res.outboundBandwidth!).toBeLessThanOrEqual(25);
    expect(res.outbandPolygons.length).toBeGreaterThan(0);
    expect(res.bwItems.length).toBeGreaterThan(0);
    // These offsets align only the outbound direction.
    expect(res.inboundBandwidth).toBeNull();
    expect(res.inbandPolygons).toEqual([]);
  });

  it("produces an inbound through-band when inbound greens align", () => {
    const res = buildBandwidthCorridors(buildContext(makeParams({ junctions: corridorJunctions(INBOUND_ALIGNED) })));
    expect(typeof res.inboundBandwidth).toBe("number");
    expect(res.inboundBandwidth!).toBeGreaterThan(0);
    // Inbound green is phase 1 (60 s wide) → band capped by it.
    expect(res.inboundBandwidth!).toBeLessThanOrEqual(60);
    expect(res.inbandPolygons.length).toBeGreaterThan(0);
    expect(res.bwItems.length).toBeGreaterThan(0);
  });

  it("is deterministic (same inputs → same bandwidth + geometry)", () => {
    const a = buildBandwidthCorridors(buildContext(makeParams()));
    const b = buildBandwidthCorridors(buildContext(makeParams()));
    expect(a.outboundBandwidth).toBe(b.outboundBandwidth);
    expect(a.inboundBandwidth).toBe(b.inboundBandwidth);
    expect(a.outbandPolygons).toEqual(b.outbandPolygons);
    expect(a.inbandPolygons).toEqual(b.inbandPolygons);
  });

  it("yields no band when fewer than 2 junctions are active", () => {
    const single = corridorJunctions(OUTBOUND_ALIGNED).slice(0, 1);
    const res = buildBandwidthCorridors(buildContext(makeParams({ junctions: single, activeJ: single })));
    expect(res.outboundBandwidth).toBeNull();
    expect(res.inboundBandwidth).toBeNull();
    expect(res.outbandPolygons).toEqual([]);
    expect(res.inbandPolygons).toEqual([]);
    expect(res.bwItems).toEqual([]);
  });
});
