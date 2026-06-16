import type React from "react";
import { phaseWindows, mergeConsecutivePhases, getMergedPhaseTiming } from "../../utils/phaseWindows";
import type { DiagramBuildContext } from "./context";

/**
 * Green-band travel ribbons: the filled outbound/inbound parallelograms drawn
 * between each consecutive pair of enabled junctions, showing the green progression
 * for that link. Returns the item nodes; the orchestrator spreads them into items.
 */
export function buildGreenBands(ctx: DiagramBuildContext): React.ReactNode[] {
  const {
    junctions, activeIndices, pixelsPerSecond, pixelsPerMeter, travelIn_s, travelOut_s,
    plotLeft, plotTop, t0, t1, defaultRed_s,
  } = ctx;

  const items: React.ReactNode[] = [];

  // Pairwise travel ribbons between consecutive *enabled* junctions
  for (let k = 0; k < activeIndices.length - 1; k++) {
    const i0 = activeIndices[k];
    const i1 = activeIndices[k + 1];
    const ja = junctions[i0];
    const jb = junctions[i1];
    const yA = plotTop + (ja.position_m ?? 0) * pixelsPerMeter;
    const yB = plotTop + (jb.position_m ?? 0) * pixelsPerMeter;

    // Sum outbound travel time from i0 -> i1 across any intermediate gaps.
    const ttOut = (() => {
      let sum = 0;
      for (let i = i0; i < i1; i++) sum += travelOut_s[i] ?? 0;
      return sum;
    })();

    // Outbound: ja -> jb (filled parallelogram for bandwidth)
    // Merge consecutive phases into single polygons to avoid overlap lines
    if (ttOut > 0) {
      const cycleA = ja.phases_s.reduce((a, b) => a + b, 0);
      const cycleB = jb.phases_s.reduce((a, b) => a + b, 0);
      if (cycleA && cycleB) {
        // Merge consecutive outbound phases into groups
        const groupsA = mergeConsecutivePhases(ja.outboundIdx ?? [], ja.phases_s.length);
        const groupsB = mergeConsecutivePhases(jb.outboundIdx ?? [], jb.phases_s.length);

        groupsA.forEach((groupA, gAi) => {
          groupsB.forEach((groupB, gBi) => {
            const { start: startA, effectiveDur: effectiveDurA } = getMergedPhaseTiming(groupA, ja.phases_s, defaultRed_s);
            const { start: startB, effectiveDur: effectiveDurB } = getMergedPhaseTiming(groupB, jb.phases_s, defaultRed_s);

            // Look back by travel time so the previous cycle's fill renders fully
            const winsA = phaseWindows(t0 - ttOut, t1, cycleA, ja.offset_s, startA, effectiveDurA);
            const winsB = phaseWindows(t0,         t1, cycleB, jb.offset_s, startB, effectiveDurB);

            winsA.forEach((wa, wi) => {
              winsB.forEach((wb, wj) => {
                const departStart = Math.max(wa.t, wb.t - ttOut);
                const departEnd = Math.min(wa.t + wa.w, wb.t + wb.w - ttOut);
                if (departEnd > departStart) {
                  const xStart = plotLeft + (departStart - t0) * pixelsPerSecond;
                  const xEnd = plotLeft + (departEnd - t0) * pixelsPerSecond;
                  const arrStart = departStart + ttOut;
                  const arrEnd = departEnd + ttOut;
                  const xArrStart = plotLeft + (arrStart - t0) * pixelsPerSecond;
                  const xArrEnd = plotLeft + (arrEnd - t0) * pixelsPerSecond;
                  items.push(
                    <polygon
                      pointerEvents="none"
                      key={`oband-${k}-${gAi}-${gBi}-${wi}-${wj}`}
                      points={`${xStart},${yA} ${xEnd},${yA} ${xArrEnd},${yB} ${xArrStart},${yB}`}
                      fill="url(#outboundGrad)"
                      fillOpacity={0.25}
                      stroke="none"
                      opacity={0.95}
                    />
                  );
                }
              });
            });
          });
        });
      }
    }

    // Sum inbound travel time from i1 -> i0 across any intermediate gaps.
    const ttIn = (() => {
      let sum = 0;
      for (let i = i0; i < i1; i++) sum += travelIn_s[i] ?? 0;
      return sum;
    })();

    // Inbound: jb -> ja (filled parallelogram from downstream up to upstream)
    // Merge consecutive phases into single polygons to avoid overlap lines
    if (ttIn > 0) {
      const cycleA = ja.phases_s.reduce((a, b) => a + b, 0);
      const cycleB = jb.phases_s.reduce((a, b) => a + b, 0);
      if (cycleA && cycleB) {
        // Merge consecutive inbound phases into groups
        const groupsA = mergeConsecutivePhases(ja.inboundIdx ?? [], ja.phases_s.length);
        const groupsB = mergeConsecutivePhases(jb.inboundIdx ?? [], jb.phases_s.length);

        groupsB.forEach((groupB, gBi) => {
          groupsA.forEach((groupA, gAi) => {
            const { start: startA, effectiveDur: effectiveDurA } = getMergedPhaseTiming(groupA, ja.phases_s, defaultRed_s);
            const { start: startB, effectiveDur: effectiveDurB } = getMergedPhaseTiming(groupB, jb.phases_s, defaultRed_s);

            // Look back by travel time so the previous cycle's fill renders fully
            const winsB = phaseWindows(t0 - ttIn, t1, cycleB, jb.offset_s, startB, effectiveDurB);
            const winsA = phaseWindows(t0,        t1, cycleA, ja.offset_s, startA, effectiveDurA);

            winsB.forEach((wb, wi) => {
              winsA.forEach((wa, wj) => {
                const departStart = Math.max(wb.t, wa.t - ttIn);
                const departEnd = Math.min(wb.t + wb.w, wa.t + wa.w - ttIn);
                if (departEnd > departStart) {
                  const xStart = plotLeft + (departStart - t0) * pixelsPerSecond;
                  const xEnd = plotLeft + (departEnd - t0) * pixelsPerSecond;
                  const arrStart = departStart + ttIn;
                  const arrEnd = departEnd + ttIn;
                  const xArrStart = plotLeft + (arrStart - t0) * pixelsPerSecond;
                  const xArrEnd = plotLeft + (arrEnd - t0) * pixelsPerSecond;
                  items.push(
                    <polygon
                      pointerEvents="none"
                      key={`iband-${k}-${gBi}-${gAi}-${wi}-${wj}`}
                      points={`${xStart},${yB} ${xEnd},${yB} ${xArrEnd},${yA} ${xArrStart},${yA}`}
                      fill="url(#inboundGrad)"
                      fillOpacity={0.25}
                      stroke="none"
                      opacity={0.95}
                    />
                  );
                }
              });
            });
          });
        });
      }
    }
  }

  // Side road ribbons - Outbound (purple)
  for (let k = 0; k < activeIndices.length - 1; k++) {
    const i0 = activeIndices[k];
    const i1 = activeIndices[k + 1];
    const ja = junctions[i0];
    const jb = junctions[i1];
    const yA = plotTop + (ja.position_m ?? 0) * pixelsPerMeter;
    const yB = plotTop + (jb.position_m ?? 0) * pixelsPerMeter;

    // Sum outbound travel time from i0 -> i1 across any intermediate gaps.
    const ttOut = (() => {
      let sum = 0;
      for (let i = i0; i < i1; i++) sum += travelOut_s[i] ?? 0;
      return sum;
    })();

    // Side road outbound: ja -> jb (purple)
    // Merge consecutive phases into single polygons
    if (ttOut > 0) {
      const cycleA = ja.phases_s.reduce((a, b) => a + b, 0);
      const cycleB = jb.phases_s.reduce((a, b) => a + b, 0);
      if (cycleA && cycleB) {
        const groupsA = mergeConsecutivePhases(ja.sideRoadOutboundIdx ?? [], ja.phases_s.length);
        const groupsB = mergeConsecutivePhases(jb.outboundIdx ?? [], jb.phases_s.length);

        groupsA.forEach((groupA, gAi) => {
          groupsB.forEach((groupB, gBi) => {
            const { start: startA, effectiveDur: effectiveDurA } = getMergedPhaseTiming(groupA, ja.phases_s, defaultRed_s);
            const { start: startB, effectiveDur: effectiveDurB } = getMergedPhaseTiming(groupB, jb.phases_s, defaultRed_s);

            const winsA = phaseWindows(t0, t1, cycleA, ja.offset_s, startA, effectiveDurA);
            const winsB = phaseWindows(t0, t1, cycleB, jb.offset_s, startB, effectiveDurB);

            winsA.forEach((wa, wi) => {
              winsB.forEach((wb, wj) => {
                const departStart = Math.max(wa.t, wb.t - ttOut);
                const departEnd = Math.min(wa.t + wa.w, wb.t + wb.w - ttOut);
                if (departEnd > departStart) {
                  const xStart = plotLeft + (departStart - t0) * pixelsPerSecond;
                  const xEnd = plotLeft + (departEnd - t0) * pixelsPerSecond;
                  const arrStart = departStart + ttOut;
                  const arrEnd = departEnd + ttOut;
                  const xArrStart = plotLeft + (arrStart - t0) * pixelsPerSecond;
                  const xArrEnd = plotLeft + (arrEnd - t0) * pixelsPerSecond;
                  items.push(
                    <polygon
                      pointerEvents="none"
                      key={`side-outband-${k}-${gAi}-${gBi}-${wi}-${wj}`}
                      points={`${xStart},${yA} ${xEnd},${yA} ${xArrEnd},${yB} ${xArrStart},${yB}`}
                      fill="url(#sideOutboundGrad)"
                      fillOpacity={0.25}
                      stroke="url(#sideOutboundGrad)"
                      strokeWidth={1.5}
                      opacity={0.95}
                    />
                  );
                }
              });
            });
          });
        });
      }
    }
  }

  // Side road ribbons - Inbound (orange)
  for (let k = 0; k < activeIndices.length - 1; k++) {
    const i0 = activeIndices[k];
    const i1 = activeIndices[k + 1];
    const ja = junctions[i0];
    const jb = junctions[i1];
    const yA = plotTop + (ja.position_m ?? 0) * pixelsPerMeter;
    const yB = plotTop + (jb.position_m ?? 0) * pixelsPerMeter;

    // Sum inbound travel time from i1 -> i0 across any intermediate gaps.
    const ttIn = (() => {
      let sum = 0;
      for (let i = i0; i < i1; i++) sum += travelIn_s[i] ?? 0;
      return sum;
    })();

    // Side road inbound: jb -> ja (orange)
    // Merge consecutive phases into single polygons
    if (ttIn > 0) {
      const cycleA = ja.phases_s.reduce((a, b) => a + b, 0);
      const cycleB = jb.phases_s.reduce((a, b) => a + b, 0);
      if (cycleA && cycleB) {
        const groupsA = mergeConsecutivePhases(ja.inboundIdx ?? [], ja.phases_s.length);
        const groupsB = mergeConsecutivePhases(jb.sideRoadInboundIdx ?? [], jb.phases_s.length);

        groupsB.forEach((groupB, gBi) => {
          groupsA.forEach((groupA, gAi) => {
            const { start: startA, effectiveDur: effectiveDurA } = getMergedPhaseTiming(groupA, ja.phases_s, defaultRed_s);
            const { start: startB, effectiveDur: effectiveDurB } = getMergedPhaseTiming(groupB, jb.phases_s, defaultRed_s);

            const winsB = phaseWindows(t0, t1, cycleB, jb.offset_s, startB, effectiveDurB);
            const winsA = phaseWindows(t0, t1, cycleA, ja.offset_s, startA, effectiveDurA);

            winsB.forEach((wb, wi) => {
              winsA.forEach((wa, wj) => {
                const departStart = Math.max(wb.t, wa.t - ttIn);
                const departEnd = Math.min(wb.t + wb.w, wa.t + wa.w - ttIn);
                if (departEnd > departStart) {
                  const xStart = plotLeft + (departStart - t0) * pixelsPerSecond;
                  const xEnd = plotLeft + (departEnd - t0) * pixelsPerSecond;
                  const arrStart = departStart + ttIn;
                  const arrEnd = departEnd + ttIn;
                  const xArrStart = plotLeft + (arrStart - t0) * pixelsPerSecond;
                  const xArrEnd = plotLeft + (arrEnd - t0) * pixelsPerSecond;
                  items.push(
                    <polygon
                      pointerEvents="none"
                      key={`side-inband-${k}-${gBi}-${gAi}-${wi}-${wj}`}
                      points={`${xStart},${yB} ${xEnd},${yB} ${xArrEnd},${yA} ${xArrStart},${yA}`}
                      fill="url(#sideInboundGrad)"
                      fillOpacity={0.25}
                      stroke="url(#sideInboundGrad)"
                      strokeWidth={1.5}
                      opacity={0.95}
                    />
                  );
                }
              });
            });
          });
        });
      }
    }
  }

  return items;
}
