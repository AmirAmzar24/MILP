import type React from "react";
import { phaseWindows, mergeConsecutivePhases, getMergedPhaseTiming } from "../../utils/phaseWindows";
import { QUEUE_TRAJECTORY_CONFIG } from "../../utils/trajectory";
import type { DiagramBuildContext } from "./context";

/**
 * Bandwidth corridors: the green-band corridors through the arterial and the
 * resulting outbound/inbound bandwidth (seconds). Handles both the 3+-junction
 * overlap case and the 2-junction pairwise case. Returns the corridor geometry
 * (polygon point strings, per-segment fills, on-corridor labels), the bandwidth
 * line nodes (bwItems), and the two bandwidth scalars. Pure over its ctx input —
 * the orchestrator merges the result into its accumulators and return value.
 */
export function buildBandwidthCorridors(ctx: DiagramBuildContext) {
  const {
    junctions, activeIndices, pixelsPerSecond, pixelsPerMeter, travelIn_s, travelOut_s,
    queueTrajectoriesEnabled, queueOut_s, queueIn_s, defaultRed_s, plotLeft, plotTop, t0, t1,
  } = ctx;

  const bwItems: React.ReactNode[] = []; // Bandwidth lines – rendered last so they appear on top
  const outbandPolygons: string[] = []; // full 6-pt corridor polygon — used for border only
  const outbandFillSegs: { points: string; angleDeg: number }[] = []; // per-segment fills
  const outbandLabels: { cx: number; cy: number; bw: number }[] = []; // on-corridor text labels
  const inbandPolygons: string[] = [];  // full 6-pt corridor polygon — used for border only
  const inbandFillSegs:  { points: string; angleDeg: number }[] = []; // per-segment fills
  const inbandLabels:  { cx: number; cy: number; bw: number }[] = []; // on-corridor text labels
  let outboundBandwidth: number | null = null;
  let inboundBandwidth: number | null = null;

  // ========== BANDWIDTH LINES ==========
  // Calculate bandwidth by finding overlapping regions across 3+ junctions
  // Bandwidth = where traffic can pass through without stopping

  // Pre-compute queue vehicle counts for bandwidth adjustment.

  // OUTBOUND bandwidth (need at least 3 junctions)
  for (let k = 0; k < activeIndices.length - 2; k++) {
    const i0 = activeIndices[k];
    const i1 = activeIndices[k + 1];
    const i2 = activeIndices[k + 2];
    const j0 = junctions[i0];
    const j1 = junctions[i1];
    const j2 = junctions[i2];

    const y0 = plotTop + (j0.position_m ?? 0) * pixelsPerMeter;
    const y1 = plotTop + (j1.position_m ?? 0) * pixelsPerMeter;
    const y2 = plotTop + (j2.position_m ?? 0) * pixelsPerMeter;

    // Travel times
    let tt01 = 0;
    for (let i = i0; i < i1; i++) tt01 += travelOut_s[i] ?? 0;
    let tt12 = 0;
    for (let i = i1; i < i2; i++) tt12 += travelOut_s[i] ?? 0;

    if (tt01 > 0 && tt12 > 0) {
      const cycle0 = j0.phases_s.reduce((a, b) => a + b, 0);
      const cycle1 = j1.phases_s.reduce((a, b) => a + b, 0);
      const cycle2 = j2.phases_s.reduce((a, b) => a + b, 0);

      if (cycle0 && cycle1 && cycle2) {
        const groups0 = mergeConsecutivePhases(j0.outboundIdx ?? [], j0.phases_s.length);
        const groups1 = mergeConsecutivePhases(j1.outboundIdx ?? [], j1.phases_s.length);
        const groups2 = mergeConsecutivePhases(j2.outboundIdx ?? [], j2.phases_s.length);

        groups0.forEach((group0, g0i) => {
          groups1.forEach((group1, g1i) => {
            groups2.forEach((group2, g2i) => {
              const { start: start0, effectiveDur: dur0 } = getMergedPhaseTiming(group0, j0.phases_s, defaultRed_s);
              const { start: start1, effectiveDur: dur1 } = getMergedPhaseTiming(group1, j1.phases_s, defaultRed_s);
              const { start: start2, effectiveDur: dur2 } = getMergedPhaseTiming(group2, j2.phases_s, defaultRed_s);

              // Look back by the corridor travel time so previous-cycle bands render fully
              const wins0 = phaseWindows(t0 - (tt01 + tt12), t1, cycle0, j0.offset_s, start0, dur0);
              const wins1 = phaseWindows(t0 - tt12,           t1, cycle1, j1.offset_s, start1, dur1);
              const wins2 = phaseWindows(t0,                  t1, cycle2, j2.offset_s, start2, dur2);

              wins0.forEach((w0, w0i) => {
                wins1.forEach((w1, w1i) => {
                  wins2.forEach((w2, w2i) => {
                    // Use ORIGINAL (unclipped) window values for bandwidth calculation
                    // This ensures correct bandwidth when windows extend beyond visible area
                    // Arrival window at j1 from j0
                    const arrAtJ1_start = w0.originalT + tt01;
                    const arrAtJ1_end = w0.originalT + w0.originalW + tt01;

                    // Departure window at j1 (j1's green phase)
                    const depFromJ1_start = w1.originalT;
                    const depFromJ1_end = w1.originalT + w1.originalW;

                    // Overlap at j1 (what can pass through j1 without stopping)
                    const overlapAtJ1_start = Math.max(arrAtJ1_start, depFromJ1_start);
                    const overlapAtJ1_end = Math.min(arrAtJ1_end, depFromJ1_end);

                    if (overlapAtJ1_end > overlapAtJ1_start) {
                      // Now check if this overlap can reach j2's green phase
                      const arrAtJ2_start = overlapAtJ1_start + tt12;
                      const arrAtJ2_end = overlapAtJ1_end + tt12;

                      // j2's green phase
                      const greenAtJ2_start = w2.originalT;
                      const greenAtJ2_end = w2.originalT + w2.originalW;

                      // Final overlap at j2
                      const finalOverlap_start = Math.max(arrAtJ2_start, greenAtJ2_start);
                      const finalOverlap_end = Math.min(arrAtJ2_end, greenAtJ2_end);

                      if (finalOverlap_end > finalOverlap_start) {
                        // We have bandwidth! Track the value
                        const bwValue = finalOverlap_end - finalOverlap_start;

                        // Calculate the path
                        // Work backwards from j2 overlap to find j1 and j0 times
                        const atJ2_start = finalOverlap_start;
                        const atJ2_end = finalOverlap_end;
                        const atJ1_start = atJ2_start - tt12;
                        const atJ1_end = atJ2_end - tt12;
                        const atJ0_start = atJ1_start - tt01;
                        const atJ0_end = atJ1_end - tt01;

                        // Queue-to-bandwidth adjustment: shift left border so it lands exactly on the
                        // last queue vehicle's trajectory line at each junction. Delay = departure
                        // lag + travel time from queued position to the junction stop line.
                        let outQueueShift = 0;
                        if (queueTrajectoriesEnabled) {
                          const numLines_j1 = Math.floor((queueOut_s[i1] ?? 0) / 2);
                          const numLines_j2 = Math.floor((queueOut_s[i2] ?? 0) / 2);
                          const speed01 = tt01 > 0 ? Math.abs((j1.position_m ?? 0) - (j0.position_m ?? 0)) / tt01 : 0;
                          const speed12 = tt12 > 0 ? Math.abs((j2.position_m ?? 0) - (j1.position_m ?? 0)) / tt12 : 0;
                          const delay_j1 = numLines_j1 > 0 && speed01 > 0
                            ? (numLines_j1 - 1) * 2 + (numLines_j1 - 1) * QUEUE_TRAJECTORY_CONFIG.LINE_SPACING_M / speed01
                            : 0;
                          const delay_j2 = numLines_j2 > 0 && speed12 > 0
                            ? (numLines_j2 - 1) * 2 + (numLines_j2 - 1) * QUEUE_TRAJECTORY_CONFIG.LINE_SPACING_M / speed12
                            : 0;
                          const S_j1 = w1.originalT + delay_j1 - atJ1_start;
                          const S_j2 = w2.originalT + delay_j2 - atJ2_start;
                          outQueueShift = Math.max(0, S_j1, S_j2);
                        }
                        const effectiveOutBwValue = bwValue - outQueueShift;
                        if (effectiveOutBwValue <= 0) return; // queue consumed entire bandwidth window

                        if (outboundBandwidth === null || effectiveOutBwValue < outboundBandwidth) {
                          outboundBandwidth = effectiveOutBwValue;
                        }

                        // Convert to pixels (start times shifted by queue offset, end times fixed)
                        const x0_start = plotLeft + (atJ0_start + outQueueShift - t0) * pixelsPerSecond;
                        const x0_end = plotLeft + (atJ0_end - t0) * pixelsPerSecond;
                        const x1_start = plotLeft + (atJ1_start + outQueueShift - t0) * pixelsPerSecond;
                        const x1_end = plotLeft + (atJ1_end - t0) * pixelsPerSecond;
                        const x2_start = plotLeft + (atJ2_start + outQueueShift - t0) * pixelsPerSecond;
                        const x2_end = plotLeft + (atJ2_end - t0) * pixelsPerSecond;

                        // Full 6-point corridor polygon — used for the marching-ants border
                        outbandPolygons.push(
                          `${x0_start},${y0} ${x0_end},${y0} ${x1_end},${y1} ${x2_end},${y2} ${x2_start},${y2} ${x1_start},${y1}`
                        );
                        // Per-segment fills — each segment has its own travel angle
                        outbandFillSegs.push({
                          points: `${x0_start},${y0} ${x0_end},${y0} ${x1_end},${y1} ${x1_start},${y1}`,
                          angleDeg: Math.atan2(y1 - y0, tt01 * pixelsPerSecond) * 180 / Math.PI,
                        });
                        outbandFillSegs.push({
                          points: `${x1_start},${y1} ${x1_end},${y1} ${x2_end},${y2} ${x2_start},${y2}`,
                          angleDeg: Math.atan2(y2 - y1, tt12 * pixelsPerSecond) * 180 / Math.PI,
                        });
                        // Label at visual centre — midpoint along the corridor length
                        outbandLabels.push({
                          cx: (x0_start + x0_end + x2_start + x2_end) / 4,
                          cy: (y0 + y2) / 2,
                          bw: effectiveOutBwValue,
                        });

                        // Draw left edge (earliest path)
                        bwItems.push(
                          <line key={`bw-out-left-${k}-${g0i}-${g1i}-${g2i}-${w0i}-${w1i}-${w2i}`}
                            x1={x0_start} y1={y0} x2={x1_start} y2={y1}
                            stroke="#2563eb" strokeWidth={1.5} opacity={0.95} pointerEvents="none"
                          />
                        );
                        bwItems.push(
                          <line key={`bw-out-left2-${k}-${g0i}-${g1i}-${g2i}-${w0i}-${w1i}-${w2i}`}
                            x1={x1_start} y1={y1} x2={x2_start} y2={y2}
                            stroke="#2563eb" strokeWidth={1.5} opacity={0.95} pointerEvents="none"
                          />
                        );

                        // Draw right edge (latest path)
                        bwItems.push(
                          <line key={`bw-out-right-${k}-${g0i}-${g1i}-${g2i}-${w0i}-${w1i}-${w2i}`}
                            x1={x0_end} y1={y0} x2={x1_end} y2={y1}
                            stroke="#2563eb" strokeWidth={1.5} opacity={0.95} pointerEvents="none"
                          />
                        );
                        bwItems.push(
                          <line key={`bw-out-right2-${k}-${g0i}-${g1i}-${g2i}-${w0i}-${w1i}-${w2i}`}
                            x1={x1_end} y1={y1} x2={x2_end} y2={y2}
                            stroke="#2563eb" strokeWidth={1.5} opacity={0.95} pointerEvents="none"
                          />
                        );
                      }
                    }
                  });
                });
              });
            });
          });
        });
      }
    }
  }

  // INBOUND bandwidth (need at least 3 junctions)
  for (let k = 0; k < activeIndices.length - 2; k++) {
    const i0 = activeIndices[k];
    const i1 = activeIndices[k + 1];
    const i2 = activeIndices[k + 2];
    const j0 = junctions[i0]; // upstream
    const j1 = junctions[i1]; // middle
    const j2 = junctions[i2]; // downstream (departure for inbound)

    const y0 = plotTop + (j0.position_m ?? 0) * pixelsPerMeter;
    const y1 = plotTop + (j1.position_m ?? 0) * pixelsPerMeter;
    const y2 = plotTop + (j2.position_m ?? 0) * pixelsPerMeter;

    // Travel times (inbound goes from downstream to upstream: j2→j1→j0)
    let tt21 = 0;
    for (let i = i1; i < i2; i++) tt21 += travelIn_s[i] ?? 0;
    let tt10 = 0;
    for (let i = i0; i < i1; i++) tt10 += travelIn_s[i] ?? 0;

    if (tt21 > 0 && tt10 > 0) {
      const cycle0 = j0.phases_s.reduce((a, b) => a + b, 0);
      const cycle1 = j1.phases_s.reduce((a, b) => a + b, 0);
      const cycle2 = j2.phases_s.reduce((a, b) => a + b, 0);

      if (cycle0 && cycle1 && cycle2) {
        const groups0 = mergeConsecutivePhases(j0.inboundIdx ?? [], j0.phases_s.length);
        const groups1 = mergeConsecutivePhases(j1.inboundIdx ?? [], j1.phases_s.length);
        const groups2 = mergeConsecutivePhases(j2.inboundIdx ?? [], j2.phases_s.length);

        groups2.forEach((group2, g2i) => {
          groups1.forEach((group1, g1i) => {
            groups0.forEach((group0, g0i) => {
              const { start: start0, effectiveDur: dur0 } = getMergedPhaseTiming(group0, j0.phases_s, defaultRed_s);
              const { start: start1, effectiveDur: dur1 } = getMergedPhaseTiming(group1, j1.phases_s, defaultRed_s);
              const { start: start2, effectiveDur: dur2 } = getMergedPhaseTiming(group2, j2.phases_s, defaultRed_s);

              // Look back by the corridor travel time so previous-cycle bands render fully
              const wins2 = phaseWindows(t0 - (tt21 + tt10), t1, cycle2, j2.offset_s, start2, dur2);
              const wins1 = phaseWindows(t0 - tt10,           t1, cycle1, j1.offset_s, start1, dur1);
              const wins0 = phaseWindows(t0,                  t1, cycle0, j0.offset_s, start0, dur0);

              wins2.forEach((w2, w2i) => {
                wins1.forEach((w1, w1i) => {
                  wins0.forEach((w0, w0i) => {
                    // Use ORIGINAL (unclipped) window values for bandwidth calculation
                    // This ensures correct bandwidth when windows extend beyond visible area
                    // Arrival window at j1 from j2 (inbound direction)
                    const arrAtJ1_start = w2.originalT + tt21;
                    const arrAtJ1_end = w2.originalT + w2.originalW + tt21;

                    // Departure window at j1 (j1's green phase)
                    const depFromJ1_start = w1.originalT;
                    const depFromJ1_end = w1.originalT + w1.originalW;

                    // Overlap at j1
                    const overlapAtJ1_start = Math.max(arrAtJ1_start, depFromJ1_start);
                    const overlapAtJ1_end = Math.min(arrAtJ1_end, depFromJ1_end);

                    if (overlapAtJ1_end > overlapAtJ1_start) {
                      // Check if overlap can reach j0's green phase
                      const arrAtJ0_start = overlapAtJ1_start + tt10;
                      const arrAtJ0_end = overlapAtJ1_end + tt10;

                      const greenAtJ0_start = w0.originalT;
                      const greenAtJ0_end = w0.originalT + w0.originalW;

                      const finalOverlap_start = Math.max(arrAtJ0_start, greenAtJ0_start);
                      const finalOverlap_end = Math.min(arrAtJ0_end, greenAtJ0_end);

                      if (finalOverlap_end > finalOverlap_start) {
                        // We have bandwidth! Track the value
                        const bwValue = finalOverlap_end - finalOverlap_start;

                        // Calculate the path
                        const atJ0_start = finalOverlap_start;
                        const atJ0_end = finalOverlap_end;
                        const atJ1_start = atJ0_start - tt10;
                        const atJ1_end = atJ0_end - tt10;
                        const atJ2_start = atJ1_start - tt21;
                        const atJ2_end = atJ1_end - tt21;

                        // Queue-to-bandwidth adjustment: shift left border so it lands exactly on the
                        // last queue vehicle's trajectory line at each junction (j0 and j1 for
                        // inbound j2→j1→j0). Delay = departure lag + travel to stop line.
                        let inQueueShift = 0;
                        if (queueTrajectoriesEnabled) {
                          const numLines_j1 = Math.floor((queueIn_s[i1] ?? 0) / 2);
                          const numLines_j0 = Math.floor((queueIn_s[i0] ?? 0) / 2);
                          // Inbound: j1 queue vehicles approach from j2 side; j0 queue from j1 side
                          const speed21 = tt21 > 0 ? Math.abs((j2.position_m ?? 0) - (j1.position_m ?? 0)) / tt21 : 0;
                          const speed10 = tt10 > 0 ? Math.abs((j1.position_m ?? 0) - (j0.position_m ?? 0)) / tt10 : 0;
                          const delay_j1 = numLines_j1 > 0 && speed21 > 0
                            ? (numLines_j1 - 1) * 2 + (numLines_j1 - 1) * QUEUE_TRAJECTORY_CONFIG.LINE_SPACING_M / speed21
                            : 0;
                          const delay_j0 = numLines_j0 > 0 && speed10 > 0
                            ? (numLines_j0 - 1) * 2 + (numLines_j0 - 1) * QUEUE_TRAJECTORY_CONFIG.LINE_SPACING_M / speed10
                            : 0;
                          const S_j1 = w1.originalT + delay_j1 - atJ1_start;
                          const S_j0 = w0.originalT + delay_j0 - atJ0_start;
                          inQueueShift = Math.max(0, S_j1, S_j0);
                        }
                        const effectiveInBwValue = bwValue - inQueueShift;
                        if (effectiveInBwValue <= 0) return; // queue consumed entire bandwidth window

                        if (inboundBandwidth === null || effectiveInBwValue < inboundBandwidth) {
                          inboundBandwidth = effectiveInBwValue;
                        }

                        // Convert to pixels (start times shifted by queue offset, end times fixed)
                        const x0_start = plotLeft + (atJ0_start + inQueueShift - t0) * pixelsPerSecond;
                        const x0_end = plotLeft + (atJ0_end - t0) * pixelsPerSecond;
                        const x1_start = plotLeft + (atJ1_start + inQueueShift - t0) * pixelsPerSecond;
                        const x1_end = plotLeft + (atJ1_end - t0) * pixelsPerSecond;
                        const x2_start = plotLeft + (atJ2_start + inQueueShift - t0) * pixelsPerSecond;
                        const x2_end = plotLeft + (atJ2_end - t0) * pixelsPerSecond;

                        // Full 6-point corridor polygon — used for the marching-ants border
                        inbandPolygons.push(
                          `${x2_start},${y2} ${x2_end},${y2} ${x1_end},${y1} ${x0_end},${y0} ${x0_start},${y0} ${x1_start},${y1}`
                        );
                        // Per-segment fills — inbound travels upward so dy is negative
                        inbandFillSegs.push({
                          points: `${x2_start},${y2} ${x2_end},${y2} ${x1_end},${y1} ${x1_start},${y1}`,
                          angleDeg: Math.atan2(y1 - y2, tt21 * pixelsPerSecond) * 180 / Math.PI,
                        });
                        inbandFillSegs.push({
                          points: `${x1_start},${y1} ${x1_end},${y1} ${x0_end},${y0} ${x0_start},${y0}`,
                          angleDeg: Math.atan2(y0 - y1, tt10 * pixelsPerSecond) * 180 / Math.PI,
                        });
                        // Label at visual centre — midpoint along the corridor length
                        inbandLabels.push({
                          cx: (x2_start + x2_end + x0_start + x0_end) / 4,
                          cy: (y2 + y0) / 2,
                          bw: effectiveInBwValue,
                        });

                        // Draw left edge (earliest path) - from j2 to j1 to j0
                        bwItems.push(
                          <line key={`bw-in-left-${k}-${g2i}-${g1i}-${g0i}-${w2i}-${w1i}-${w0i}`}
                            x1={x2_start} y1={y2} x2={x1_start} y2={y1}
                            stroke="#16a34a" strokeWidth={1.5} opacity={0.95} pointerEvents="none"
                          />
                        );
                        bwItems.push(
                          <line key={`bw-in-left2-${k}-${g2i}-${g1i}-${g0i}-${w2i}-${w1i}-${w0i}`}
                            x1={x1_start} y1={y1} x2={x0_start} y2={y0}
                            stroke="#16a34a" strokeWidth={1.5} opacity={0.95} pointerEvents="none"
                          />
                        );

                        // Draw right edge (latest path)
                        bwItems.push(
                          <line key={`bw-in-right-${k}-${g2i}-${g1i}-${g0i}-${w2i}-${w1i}-${w0i}`}
                            x1={x2_end} y1={y2} x2={x1_end} y2={y1}
                            stroke="#16a34a" strokeWidth={1.5} opacity={0.95} pointerEvents="none"
                          />
                        );
                        bwItems.push(
                          <line key={`bw-in-right2-${k}-${g2i}-${g1i}-${g0i}-${w2i}-${w1i}-${w0i}`}
                            x1={x1_end} y1={y1} x2={x0_end} y2={y0}
                            stroke="#16a34a" strokeWidth={1.5} opacity={0.95} pointerEvents="none"
                          />
                        );
                      }
                    }
                  });
                });
              });
            });
          });
        });
      }
    }
  }

  // OUTBOUND bandwidth for 2-junction corridors (the 3+ loop above never runs with only 2 junctions)
  if (activeIndices.length < 3) {
    for (let k = 0; k < activeIndices.length - 1; k++) {
      const i0 = activeIndices[k];
      const i1 = activeIndices[k + 1];
      const j0 = junctions[i0];
      const j1 = junctions[i1];

      const y0 = plotTop + (j0.position_m ?? 0) * pixelsPerMeter;
      const y1 = plotTop + (j1.position_m ?? 0) * pixelsPerMeter;

      let tt01 = 0;
      for (let i = i0; i < i1; i++) tt01 += travelOut_s[i] ?? 0;

      if (tt01 > 0) {
        const cycle0 = j0.phases_s.reduce((a, b) => a + b, 0);
        const cycle1 = j1.phases_s.reduce((a, b) => a + b, 0);

        if (cycle0 && cycle1) {
          const groups0 = mergeConsecutivePhases(j0.outboundIdx ?? [], j0.phases_s.length);
          const groups1 = mergeConsecutivePhases(j1.outboundIdx ?? [], j1.phases_s.length);

          groups0.forEach((group0, g0i) => {
            groups1.forEach((group1, g1i) => {
              const { start: start0, effectiveDur: dur0 } = getMergedPhaseTiming(group0, j0.phases_s, defaultRed_s);
              const { start: start1, effectiveDur: dur1 } = getMergedPhaseTiming(group1, j1.phases_s, defaultRed_s);

              const wins0 = phaseWindows(t0 - tt01, t1, cycle0, j0.offset_s, start0, dur0);
              const wins1 = phaseWindows(t0,        t1, cycle1, j1.offset_s, start1, dur1);

              wins0.forEach((w0, w0i) => {
                wins1.forEach((w1, w1i) => {
                  const arrAtJ1_start = w0.originalT + tt01;
                  const arrAtJ1_end   = w0.originalT + w0.originalW + tt01;
                  const overlapStart  = Math.max(arrAtJ1_start, w1.originalT);
                  const overlapEnd    = Math.min(arrAtJ1_end,   w1.originalT + w1.originalW);

                  if (overlapEnd > overlapStart) {
                    const bwValue = overlapEnd - overlapStart;

                    let outQueueShift = 0;
                    if (queueTrajectoriesEnabled) {
                      const numLines_j1 = Math.floor((queueOut_s[i1] ?? 0) / 2);
                      const speed01 = tt01 > 0 ? Math.abs((j1.position_m ?? 0) - (j0.position_m ?? 0)) / tt01 : 0;
                      const delay_j1 = numLines_j1 > 0 && speed01 > 0
                        ? (numLines_j1 - 1) * 2 + (numLines_j1 - 1) * QUEUE_TRAJECTORY_CONFIG.LINE_SPACING_M / speed01
                        : 0;
                      outQueueShift = Math.max(0, w1.originalT + delay_j1 - (overlapStart - tt01));
                    }
                    const effectiveOutBwValue = bwValue - outQueueShift;
                    if (effectiveOutBwValue <= 0) return;

                    if (outboundBandwidth === null || effectiveOutBwValue < outboundBandwidth) {
                      outboundBandwidth = effectiveOutBwValue;
                    }

                    const atJ1_start = overlapStart;
                    const atJ1_end   = overlapEnd;
                    const atJ0_start = atJ1_start - tt01;
                    const atJ0_end   = atJ1_end   - tt01;

                    const x0s = plotLeft + (atJ0_start + outQueueShift - t0) * pixelsPerSecond;
                    const x0e = plotLeft + (atJ0_end   - t0) * pixelsPerSecond;
                    const x1s = plotLeft + (atJ1_start + outQueueShift - t0) * pixelsPerSecond;
                    const x1e = plotLeft + (atJ1_end   - t0) * pixelsPerSecond;

                    outbandPolygons.push(`${x0s},${y0} ${x0e},${y0} ${x1e},${y1} ${x1s},${y1}`);
                    outbandFillSegs.push({
                      points: `${x0s},${y0} ${x0e},${y0} ${x1e},${y1} ${x1s},${y1}`,
                      angleDeg: Math.atan2(y1 - y0, tt01 * pixelsPerSecond) * 180 / Math.PI,
                    });
                    outbandLabels.push({ cx: (x0s + x0e + x1s + x1e) / 4, cy: (y0 + y1) / 2, bw: effectiveOutBwValue });

                    bwItems.push(<line key={`bw2-out-left-${k}-${g0i}-${g1i}-${w0i}-${w1i}`}  x1={x0s} y1={y0} x2={x1s} y2={y1} stroke="#2563eb" strokeWidth={1.5} opacity={0.95} pointerEvents="none" />);
                    bwItems.push(<line key={`bw2-out-right-${k}-${g0i}-${g1i}-${w0i}-${w1i}`} x1={x0e} y1={y0} x2={x1e} y2={y1} stroke="#2563eb" strokeWidth={1.5} opacity={0.95} pointerEvents="none" />);
                  }
                });
              });
            });
          });
        }
      }
    }
  }

  // INBOUND bandwidth for 2-junction corridors
  if (activeIndices.length < 3) {
    for (let k = 0; k < activeIndices.length - 1; k++) {
      const i0 = activeIndices[k];
      const i1 = activeIndices[k + 1];
      const j0 = junctions[i0];
      const j1 = junctions[i1];

      const y0 = plotTop + (j0.position_m ?? 0) * pixelsPerMeter;
      const y1 = plotTop + (j1.position_m ?? 0) * pixelsPerMeter;

      let tt10 = 0;
      for (let i = i0; i < i1; i++) tt10 += travelIn_s[i] ?? 0;

      if (tt10 > 0) {
        const cycle0 = j0.phases_s.reduce((a, b) => a + b, 0);
        const cycle1 = j1.phases_s.reduce((a, b) => a + b, 0);

        if (cycle0 && cycle1) {
          const groups0 = mergeConsecutivePhases(j0.inboundIdx ?? [], j0.phases_s.length);
          const groups1 = mergeConsecutivePhases(j1.inboundIdx ?? [], j1.phases_s.length);

          groups1.forEach((group1, g1i) => {
            groups0.forEach((group0, g0i) => {
              const { start: start0, effectiveDur: dur0 } = getMergedPhaseTiming(group0, j0.phases_s, defaultRed_s);
              const { start: start1, effectiveDur: dur1 } = getMergedPhaseTiming(group1, j1.phases_s, defaultRed_s);

              const wins1 = phaseWindows(t0 - tt10, t1, cycle1, j1.offset_s, start1, dur1);
              const wins0 = phaseWindows(t0,        t1, cycle0, j0.offset_s, start0, dur0);

              wins1.forEach((w1, w1i) => {
                wins0.forEach((w0, w0i) => {
                  const arrAtJ0_start = w1.originalT + tt10;
                  const arrAtJ0_end   = w1.originalT + w1.originalW + tt10;
                  const overlapStart  = Math.max(arrAtJ0_start, w0.originalT);
                  const overlapEnd    = Math.min(arrAtJ0_end,   w0.originalT + w0.originalW);

                  if (overlapEnd > overlapStart) {
                    const bwValue = overlapEnd - overlapStart;

                    let inQueueShift = 0;
                    if (queueTrajectoriesEnabled) {
                      const numLines_j0 = Math.floor((queueIn_s[i0] ?? 0) / 2);
                      const speed10 = tt10 > 0 ? Math.abs((j1.position_m ?? 0) - (j0.position_m ?? 0)) / tt10 : 0;
                      const delay_j0 = numLines_j0 > 0 && speed10 > 0
                        ? (numLines_j0 - 1) * 2 + (numLines_j0 - 1) * QUEUE_TRAJECTORY_CONFIG.LINE_SPACING_M / speed10
                        : 0;
                      inQueueShift = Math.max(0, w0.originalT + delay_j0 - (overlapStart - tt10));
                    }
                    const effectiveInBwValue = bwValue - inQueueShift;
                    if (effectiveInBwValue <= 0) return;

                    if (inboundBandwidth === null || effectiveInBwValue < inboundBandwidth) {
                      inboundBandwidth = effectiveInBwValue;
                    }

                    const atJ0_start = overlapStart;
                    const atJ0_end   = overlapEnd;
                    const atJ1_start = atJ0_start - tt10;
                    const atJ1_end   = atJ0_end   - tt10;

                    const x1s = plotLeft + (atJ1_start + inQueueShift - t0) * pixelsPerSecond;
                    const x1e = plotLeft + (atJ1_end   - t0) * pixelsPerSecond;
                    const x0s = plotLeft + (atJ0_start + inQueueShift - t0) * pixelsPerSecond;
                    const x0e = plotLeft + (atJ0_end   - t0) * pixelsPerSecond;

                    inbandPolygons.push(`${x1s},${y1} ${x1e},${y1} ${x0e},${y0} ${x0s},${y0}`);
                    inbandFillSegs.push({
                      points: `${x1s},${y1} ${x1e},${y1} ${x0e},${y0} ${x0s},${y0}`,
                      angleDeg: Math.atan2(y0 - y1, tt10 * pixelsPerSecond) * 180 / Math.PI,
                    });
                    inbandLabels.push({ cx: (x1s + x1e + x0s + x0e) / 4, cy: (y1 + y0) / 2, bw: effectiveInBwValue });

                    bwItems.push(<line key={`bw2-in-left-${k}-${g1i}-${g0i}-${w1i}-${w0i}`}  x1={x1s} y1={y1} x2={x0s} y2={y0} stroke="#16a34a" strokeWidth={1.5} opacity={0.95} pointerEvents="none" />);
                    bwItems.push(<line key={`bw2-in-right-${k}-${g1i}-${g0i}-${w1i}-${w0i}`} x1={x1e} y1={y1} x2={x0e} y2={y0} stroke="#16a34a" strokeWidth={1.5} opacity={0.95} pointerEvents="none" />);
                  }
                });
              });
            });
          });
        }
      }
    }
  }

  return { outboundBandwidth, inboundBandwidth, outbandPolygons, outbandFillSegs, outbandLabels, inbandPolygons, inbandFillSegs, inbandLabels, bwItems };
}
