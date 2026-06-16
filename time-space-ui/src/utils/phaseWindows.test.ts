import { describe, it, expect } from "vitest";
import { greenWindowAt, mergeConsecutivePhases, getMergedPhaseTiming } from "./phaseWindows";

// ─── Test fixtures ────────────────────────────────────────────────────────────

/** Simple 4-phase junction: [25s out, 60s in, 23s out, 50s in], cycle=158s */
function makeJunction(overrides: Partial<{
  phases_s: number[];
  outboundIdx: number[];
  inboundIdx: number[];
  offset_s: number;
}> = {}) {
  return {
    phases_s: [25, 60, 23, 50],
    outboundIdx: [0],
    inboundIdx: [1],
    offset_s: 0,
    ...overrides,
  };
}

// ─── mergeConsecutivePhases ───────────────────────────────────────────────────

describe("mergeConsecutivePhases", () => {
  it("returns empty array for no indices", () => {
    expect(mergeConsecutivePhases([], 4)).toEqual([]);
  });

  it("wraps single index in its own group", () => {
    expect(mergeConsecutivePhases([2], 4)).toEqual([[2]]);
  });

  it("groups consecutive indices together (no wrap-around)", () => {
    // 5 phases: [0,1] are consecutive, [3] is separate (phase 4 is last, not 3)
    expect(mergeConsecutivePhases([0, 1, 3], 5)).toEqual([[0, 1], [3]]);
  });

  it("detects wrap-around: last and first phases are consecutive", () => {
    // [0, 1, 3] with 4 phases — phase 3 is the last, so it wraps into phase 0
    const result = mergeConsecutivePhases([0, 1, 3], 4);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain(0);
    expect(result[0]).toContain(3);
  });
});

// ─── getMergedPhaseTiming ─────────────────────────────────────────────────────

describe("getMergedPhaseTiming", () => {
  const phases = [25, 60, 23, 50]; // cycle = 158

  it("returns start=0 and full duration for first single phase", () => {
    const { start, effectiveDur } = getMergedPhaseTiming([0], phases, 0);
    expect(start).toBe(0);
    expect(effectiveDur).toBe(25);
  });

  it("returns correct start for a middle phase", () => {
    // Phase 2 starts at 25 + 60 = 85
    const { start, effectiveDur } = getMergedPhaseTiming([2], phases, 0);
    expect(start).toBe(85);
    expect(effectiveDur).toBe(23);
  });

  it("subtracts defaultRed_s from effective duration", () => {
    const { effectiveDur } = getMergedPhaseTiming([0], phases, 3);
    expect(effectiveDur).toBe(22); // 25 - 3
  });

  it("clamps effectiveDur to 0 when defaultRed_s >= phase duration", () => {
    const { effectiveDur } = getMergedPhaseTiming([0], phases, 30);
    expect(effectiveDur).toBe(0);
  });

  it("spans multiple consecutive phases", () => {
    // Phases [0,1]: 25 + 60 = 85 total, start = 0
    const { start, effectiveDur } = getMergedPhaseTiming([0, 1], phases, 3);
    expect(start).toBe(0);
    expect(effectiveDur).toBe(82); // 85 - 3
  });
});

// ─── greenWindowAt ────────────────────────────────────────────────────────────

describe("greenWindowAt — basic green/red detection", () => {
  // Junction: phases [25, 60, 23, 50], cycle=158, offset=0
  // Outbound = phase 0: green [0, 25)
  // Inbound  = phase 1: green [25, 85)

  it("is green at time=0 for outbound (start of phase 0)", () => {
    const j = makeJunction();
    const result = greenWindowAt(j, "outbound", 0);
    expect(result.isGreen).toBe(true);
  });

  it("is green at time=10 for outbound (inside phase 0)", () => {
    const j = makeJunction();
    const result = greenWindowAt(j, "outbound", 10);
    expect(result.isGreen).toBe(true);
  });

  it("is red at time=25 for outbound (phase 0 ends at 25)", () => {
    const j = makeJunction();
    const result = greenWindowAt(j, "outbound", 25);
    expect(result.isGreen).toBe(false);
  });

  it("is green at time=25 for inbound (start of phase 1)", () => {
    const j = makeJunction();
    const result = greenWindowAt(j, "inbound", 25);
    expect(result.isGreen).toBe(true);
  });

  it("is green at time=84 for inbound (last second of phase 1)", () => {
    const j = makeJunction();
    const result = greenWindowAt(j, "inbound", 84);
    expect(result.isGreen).toBe(true);
  });

  it("is red at time=85 for inbound (phase 1 ends at 85)", () => {
    const j = makeJunction();
    const result = greenWindowAt(j, "inbound", 85);
    expect(result.isGreen).toBe(false);
  });
});

describe("greenWindowAt — cycle wrap-around", () => {
  // cycle=158, outbound phase 0 = [0,25) each cycle
  it("is green at time=158 (second cycle, same as time=0)", () => {
    const j = makeJunction();
    expect(greenWindowAt(j, "outbound", 158).isGreen).toBe(true);
  });

  it("is green at time=316 (third cycle)", () => {
    const j = makeJunction();
    expect(greenWindowAt(j, "outbound", 316).isGreen).toBe(true);
  });

  it("is red at time=183 (158+25, just after second cycle outbound green)", () => {
    const j = makeJunction();
    expect(greenWindowAt(j, "outbound", 183).isGreen).toBe(false);
  });

  it("handles negative time (before t=0)", () => {
    // time=-100 maps to timeInCycle = ((-100) % 158 + 158) % 158 = 58
    // Phase 0 is [0,25), so timeInCycle=58 is red for outbound
    const j = makeJunction();
    expect(greenWindowAt(j, "outbound", -100).isGreen).toBe(false);
  });
});

describe("greenWindowAt — nextGreenStart and nextGreenEnd", () => {
  // cycle=158, outbound phase 0 = [0,25)
  it("when green, nextGreenStart is the start of the current window", () => {
    const j = makeJunction();
    const result = greenWindowAt(j, "outbound", 10);
    expect(result.isGreen).toBe(true);
    expect(result.nextGreenStart).toBe(0);
    expect(result.nextGreenEnd).toBe(25);
  });

  it("when red, nextGreenStart points to the next cycle's green", () => {
    // time=50: timeInCycle=50, outbound red. Next green starts at 158 (next cycle).
    const j = makeJunction();
    const result = greenWindowAt(j, "outbound", 50);
    expect(result.isGreen).toBe(false);
    expect(result.nextGreenStart).toBe(158);
    expect(result.nextGreenEnd).toBe(183); // 158 + 25
  });

  it("when red with offset, nextGreenStart accounts for offset", () => {
    // offset_s=10: outbound phase 0 green at [10, 35) each cycle
    // time=5: not yet green, next green starts at 10
    const j = makeJunction({ offset_s: 10 });
    const result = greenWindowAt(j, "outbound", 5);
    expect(result.isGreen).toBe(false);
    expect(result.nextGreenStart).toBe(10);
  });

  it("when green with offset, returns correct window boundaries", () => {
    // offset_s=10: outbound green at [10, 35)
    const j = makeJunction({ offset_s: 10 });
    const result = greenWindowAt(j, "outbound", 20);
    expect(result.isGreen).toBe(true);
    expect(result.nextGreenStart).toBe(10);
    expect(result.nextGreenEnd).toBe(35);
  });
});

describe("greenWindowAt — defaultRed_s shrinks the effective green window", () => {
  // outbound phase 0 = 25s. With defaultRed_s=3, effective green = [0, 22)
  it("with defaultRed_s=3: time=22 is red (inside clearance)", () => {
    const j = makeJunction();
    const result = greenWindowAt(j, "outbound", 22, 3);
    expect(result.isGreen).toBe(false);
  });

  it("with defaultRed_s=3: time=10 is still green", () => {
    const j = makeJunction();
    const result = greenWindowAt(j, "outbound", 10, 3);
    expect(result.isGreen).toBe(true);
  });

  it("with defaultRed_s=0 (default): time=24 is green (raw phase boundary)", () => {
    const j = makeJunction();
    expect(greenWindowAt(j, "outbound", 24).isGreen).toBe(true);
  });
});

describe("greenWindowAt — edge cases", () => {
  it("returns isGreen=false for empty outboundIdx", () => {
    const j = makeJunction({ outboundIdx: [] });
    expect(greenWindowAt(j, "outbound", 10).isGreen).toBe(false);
  });

  it("returns isGreen=false for zero-length cycle", () => {
    const j = makeJunction({ phases_s: [0, 0] });
    expect(greenWindowAt(j, "outbound", 0).isGreen).toBe(false);
  });

  it("handles multi-phase outbound (two consecutive phases both green)", () => {
    // phases=[30, 20, 30, 20], outbound=[0,1] (consecutive), cycle=100
    const j = makeJunction({
      phases_s: [30, 20, 30, 20],
      outboundIdx: [0, 1],
      inboundIdx: [2],
      offset_s: 0,
    });
    // Phase 0: [0,30), Phase 1: [30,50) — merged green window [0,50)
    expect(greenWindowAt(j, "outbound", 40).isGreen).toBe(true);
    expect(greenWindowAt(j, "outbound", 55).isGreen).toBe(false);
  });
});
