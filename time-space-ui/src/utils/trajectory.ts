// Trajectory & queue-band math for the time-space diagram.
//
// Pure functions extracted from TimeSpaceDiagram.tsx (Phase 7a). They compute
// vehicle travel paths, stop detection at red signals, and per-junction queue
// discharge bands. No React — only domain math over Junction data.
//
// See TRAJECTORY_FEATURE_DOCS.md for the feature overview. The rendering of
// these results (cyan dotted line, stop indicators, queue bands) lives in
// TimeSpaceDiagram.tsx.

import { greenWindowAt, mergeConsecutivePhases } from "./phaseWindows";
import type { Junction } from "../types";

// Trajectory stop information at a single junction
export type Stop = {
  junctionIdx: number;      // Index in active junctions array
  junctionName: string;     // Display name of junction
  time: number;             // When stop starts (seconds from time zero)
  duration: number;         // How long to wait (seconds)
  distance: number;         // Position of junction (meters)
};

// Complete trajectory data structure
export type TrajectoryData = {
  path: Array<{ time: number; distance: number }>;  // Points for drawing the line
  stops: Stop[];                                     // All stops along the path
  totalTravelTime: number;                          // Total time from start to end (seconds)
  startTime: number;                                // Starting time
  startDistance: number;                            // Starting position (meters)
  endDistance: number;                              // Ending position (meters)
  direction: "outbound" | "inbound";               // Travel direction
};

// Queue vehicle trajectory data structure
export type QueueVehicleTrajectory = {
  path: Array<{ time: number; distance: number }>;
  vehicleIndex: number;  // 0 = first car at junction, 1 = second car (7m back), etc.
};

/**
 * Find the LAST time a piecewise-linear path is at or passes through targetDist.
 *
 * For vehicle 0 (stops exactly at junctionDist): the path has a stationary
 * segment {arrivalTime → dischargeTime} at junctionDist, so this returns
 * dischargeTime (= when the vehicle departs the junction line).
 *
 * For vehicle N-1 (stops behind junction, then crosses it while moving):
 * the path crosses junctionDist once — so last == first crossing time.
 */
export function interpLastAtDist(
  path: Array<{ time: number; distance: number }>,
  targetDist: number
): number | null {
  let result: number | null = null;
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i], p2 = path[i + 1];
    const d1 = p1.distance, d2 = p2.distance;
    const minD = Math.min(d1, d2), maxD = Math.max(d1, d2);
    if (targetDist < minD - 0.01 || targetDist > maxD + 0.01) continue;
    if (Math.abs(d1 - d2) < 0.01) {
      // Stationary segment — end of wait = departure time
      if (Math.abs(d1 - targetDist) < 0.5) result = p2.time;
    } else {
      const frac = (targetDist - d1) / (d2 - d1);
      if (frac >= 0 && frac <= 1) result = p1.time + frac * (p2.time - p1.time);
    }
  }
  return result;
}

/**
 * Find all red-to-green transitions for a direction within a time window.
 * Uses mergeConsecutivePhases to handle overlap phases correctly - returns
 * the start of the FIRST phase in each merged group, not individual phases.
 */
export function findGreenStarts(
  junction: Junction,
  direction: "outbound" | "inbound",
  t0: number,
  t1: number
): number[] {
  const cycle = junction.phases_s.reduce((a, b) => a + b, 0);
  if (cycle <= 0) return [];

  const phaseIndices = direction === "outbound" ? junction.outboundIdx : junction.inboundIdx;
  if (!phaseIndices || phaseIndices.length === 0) return [];

  // Merge consecutive phases into groups (handles overlap phases)
  const groups = mergeConsecutivePhases(phaseIndices, junction.phases_s.length);
  if (groups.length === 0) return [];

  // Compute phase start times within cycle
  const phaseStarts: number[] = [];
  let acc = 0;
  for (const p of junction.phases_s) {
    phaseStarts.push(acc);
    acc += p;
  }

  const greenStarts: number[] = [];

  // For each merged group, find the start of the FIRST phase in that group
  for (const group of groups) {
    // The first phase in the group determines when green starts
    const firstPhaseIdx = group[0];
    const phaseStartInCycle = phaseStarts[firstPhaseIdx];

    // Find all occurrences within [t0, t1]
    const kStart = Math.floor((t0 - junction.offset_s - phaseStartInCycle) / cycle) - 1;
    const kEnd = Math.ceil((t1 - junction.offset_s - phaseStartInCycle) / cycle) + 1;

    for (let k = kStart; k <= kEnd; k++) {
      const greenStart = junction.offset_s + phaseStartInCycle + k * cycle;
      if (greenStart >= t0 && greenStart <= t1) {
        greenStarts.push(greenStart);
      }
    }
  }

  // Remove duplicates and sort
  return [...new Set(greenStarts)].sort((a, b) => a - b);
}


/**
 * Calculates vehicle queue trajectory band for a SINGLE junction.
 * Each intermediate junction gets its own independent band that:
 *   - Starts at the junction's green onset (leftmost point of band)
 *   - Shows vehicles queued upstream (spaced LINE_SPACING_M apart)
 *   - Follows vehicles as they discharge and travel to the next junction
 *
 * numLines = floor(queueClearance_s / 2), vehicles depart at greenStart + k*2s
 * First and last vehicle paths form the band border; middle paths are intermediate lines.
 */
export function calculatePerJunctionQueueBand(
  junction: Junction,
  direction: "outbound" | "inbound",
  nextJunction: Junction | null,
  allJunctions: Junction[],
  travelTimes: number[],
  queueClearance_s: number,
  t0: number,
  t1: number,
  config: typeof QUEUE_TRAJECTORY_CONFIG
): QueueVehicleTrajectory[] {
  const numLines = Math.min(Math.floor(queueClearance_s / 2), config.MAX_LINES);
  if (numLines < 1) return [];

  const junctionPos = junction.position_m ?? 0;

  // Find green starts for this junction and direction
  const lookbackTime = 120;
  const allGreenStarts = findGreenStarts(junction, direction, t0 - lookbackTime, t1);
  if (allGreenStarts.length === 0) return [];

  // Filter to first green start per cycle
  const cycle = junction.phases_s.reduce((a, b) => a + b, 0);
  const firstGreenPerCycle: number[] = [];
  for (const gs of allGreenStarts) {
    const cycleNumber = Math.floor((gs - junction.offset_s) / cycle);
    const alreadyHasCycle = firstGreenPerCycle.some((existing) => {
      const existingCycleNumber = Math.floor((existing - junction.offset_s) / cycle);
      return existingCycleNumber === cycleNumber;
    });
    if (!alreadyHasCycle) {
      firstGreenPerCycle.push(gs);
    }
  }

  // Compute travel speed — from next link if one exists, otherwise fall back to incoming link
  let travelSpeed = 0;
  let linkDist = 0;
  const jIdxInAll = allJunctions.findIndex((j) => j.id === junction.id);

  if (nextJunction) {
    const nextIdxInAll = allJunctions.findIndex((j) => j.id === nextJunction.id);
    const travelTime = direction === "outbound"
      ? (travelTimes[jIdxInAll] ?? 0)
      : (travelTimes[nextIdxInAll] ?? 0);
    linkDist = Math.abs((nextJunction.position_m ?? 0) - junctionPos);
    if (travelTime > 0 && linkDist > 0) {
      travelSpeed = linkDist / travelTime;
    }
  } else {
    // Terminal junction: derive speed from the incoming link so vehicles can continue past
    if (direction === "outbound" && jIdxInAll > 0) {
      const prevJ = allJunctions[jIdxInAll - 1];
      const incomingTT = travelTimes[jIdxInAll - 1] ?? 0;
      const incomingDist = Math.abs(junctionPos - (prevJ.position_m ?? 0));
      if (incomingTT > 0 && incomingDist > 0) travelSpeed = incomingDist / incomingTT;
    } else if (direction === "inbound" && jIdxInAll < allJunctions.length - 1) {
      const prevJ = allJunctions[jIdxInAll + 1];
      const incomingTT = travelTimes[jIdxInAll] ?? 0;
      const incomingDist = Math.abs(junctionPos - (prevJ.position_m ?? 0));
      if (incomingTT > 0 && incomingDist > 0) travelSpeed = incomingDist / incomingTT;
    }
  }

  const trajectories: QueueVehicleTrajectory[] = [];

  for (const greenStart of firstGreenPerCycle) {
    for (let k = 0; k < numLines; k++) {
      // Queued position: upstream of junction, 7m per vehicle
      const queuedPos = direction === "outbound"
        ? junctionPos - k * config.LINE_SPACING_M
        : junctionPos + k * config.LINE_SPACING_M;

      const departTime = greenStart + k * 2;

      const path: Array<{ time: number; distance: number }> = [];

      // Point A: at green onset, vehicle is already at its queued position (band left edge)
      path.push({ time: greenStart, distance: queuedPos });

      // Point B: vehicle k starts moving (only add if k > 0, otherwise A == B in time)
      if (k > 0) {
        path.push({ time: departTime, distance: queuedPos });
      }

      // Point C: vehicle arrives at next junction
      if (nextJunction && travelSpeed > 0) {
        const distToTravel = k * config.LINE_SPACING_M + linkDist;
        const arrivalTime = departTime + distToTravel / travelSpeed;
        const nextPos = nextJunction.position_m ?? 0;
        if (arrivalTime <= t1) {
          path.push({ time: arrivalTime, distance: nextPos });
        } else {
          // Clip to t1
          const elapsedFromDepart = t1 - departTime;
          const partialDist = elapsedFromDepart * travelSpeed;
          const endPos = direction === "outbound"
            ? queuedPos + partialDist
            : queuedPos - partialDist;
          path.push({ time: t1, distance: endPos });
        }
      } else {
        // Terminal junction — continue at last-segment speed to t1
        if (travelSpeed > 0) {
          const continueDuration = t1 - departTime;
          if (continueDuration > 0) {
            const endDist = direction === "outbound"
              ? queuedPos + travelSpeed * continueDuration
              : queuedPos - travelSpeed * continueDuration;
            path.push({ time: t1, distance: endDist });
          }
        }
      }

      if (path.length >= 2) {
        trajectories.push({ path, vehicleIndex: k });
      }
    }
  }

  return trajectories;
}

/**
 * Calculates complete trajectory from start point to end of corridor
 *
 * @param startTime - Starting time (seconds from time zero)
 * @param startDistance - Starting position (meters)
 * @param direction - Travel direction (outbound = top to bottom, inbound = bottom to top)
 * @param junctions - Array of all junctions
 * @param travelOut_s - Travel times between junctions (outbound direction)
 * @param travelIn_s - Travel times between junctions (inbound direction)
 * @returns TrajectoryData object with path, stops, and metrics, or null if invalid
 *
 * Algorithm:
 * 1. Start from mouse position
 * 2. For each segment, use the actual travel time (matching greenband speed for that segment)
 * 3. At each junction: check signal phase
 * 4. If red: add stop (horizontal segment), wait for next green
 * 5. If green: continue at segment speed
 *
 * The trajectory follows the exact greenband slopes for each segment, perfectly matching
 * the greenband visualization. The trajectory will have different slopes in different
 * segments if the travel speeds vary between junction pairs.
 */
export function calculateTrajectory(
  startTime: number,
  startDistance: number,
  direction: "outbound" | "inbound",
  junctions: Junction[],
  travelOut_s: number[],
  travelIn_s: number[]
): TrajectoryData | null {
  const activeJ = junctions.filter((j) => j.enabled !== false);
  if (activeJ.length < 2) return null;

  const path: Array<{ time: number; distance: number }> = [];
  const stops: Stop[] = [];

  const travelTimes = direction === "outbound" ? travelOut_s : travelIn_s;

  // Get the index of each active junction in the full junctions array
  // This lets us look up the correct travel time for each segment
  const getJunctionIndex = (j: Junction) => junctions.findIndex(jx => jx.id === j.id);

  let currentTime = startTime;
  let currentDistance = startDistance;

  // Add starting point
  path.push({ time: currentTime, distance: currentDistance });

  if (direction === "outbound") {
    // Outbound: travel using actual greenband speeds (matching travel times) to last junction
    for (let i = 0; i < activeJ.length; i++) {
      const junction = activeJ[i];
      const junctionDist = junction.position_m ?? 0;

      // Skip junctions that are above/before our starting position
      if (junctionDist <= currentDistance) {
        continue;
      }

      // Calculate travel time using actual greenband speed for this segment
      const distanceToTravel = junctionDist - currentDistance;

      // Find the previous junction to get the correct travel time
      let travelTime: number;
      if (i === 0 || currentDistance < (activeJ[i-1]?.position_m ?? 0)) {
        // Starting between junctions or before first junction
        // Find which segment we're in
        let segmentStartIdx = getJunctionIndex(activeJ[i]);
        let segmentDistance = junctionDist;
        let segmentTravelTime = 0;

        // Look backwards to find the junction we're starting from
        for (let j = i - 1; j >= 0; j--) {
          const prevJunc = activeJ[j];
          const prevDist = prevJunc.position_m ?? 0;
          if (prevDist <= currentDistance) {
            segmentStartIdx = getJunctionIndex(prevJunc);
            segmentDistance = junctionDist - prevDist;
            segmentTravelTime = travelTimes[segmentStartIdx] ?? 0;
            break;
          }
        }

        // Interpolate travel time based on partial distance
        if (segmentDistance > 0 && segmentTravelTime > 0) {
          travelTime = (distanceToTravel / segmentDistance) * segmentTravelTime;
        } else {
          travelTime = 0;
        }
      } else {
        // Continuing from previous junction - use the travel time for this segment
        const prevJuncIdx = getJunctionIndex(activeJ[i-1]);
        const segmentDistance = junctionDist - (activeJ[i-1].position_m ?? 0);
        const segmentTravelTime = travelTimes[prevJuncIdx] ?? 0;

        // If we didn't travel the full segment, interpolate
        if (segmentDistance > 0 && segmentTravelTime > 0) {
          travelTime = (distanceToTravel / segmentDistance) * segmentTravelTime;
        } else {
          travelTime = 0;
        }
      }

      // Arrive at junction
      currentTime += travelTime;
      currentDistance = junctionDist;

      // Check if signal is green for outbound
      const greenCheck = greenWindowAt(junction, "outbound", currentTime);

      if (!greenCheck.isGreen && greenCheck.nextGreenStart) {
        // Red light - must stop
        const stopDuration = greenCheck.nextGreenStart - currentTime;

        path.push({ time: currentTime, distance: currentDistance });
        path.push({ time: greenCheck.nextGreenStart, distance: currentDistance });

        stops.push({
          junctionIdx: i,
          junctionName: junction.name,
          time: currentTime,
          duration: stopDuration,
          distance: currentDistance,
        });

        currentTime = greenCheck.nextGreenStart;
      } else {
        // Green light - pass through
        path.push({ time: currentTime, distance: currentDistance });
      }
    }

    return {
      path,
      stops,
      totalTravelTime: currentTime - startTime,
      startTime,
      startDistance,
      endDistance: activeJ[activeJ.length - 1].position_m ?? 0,
      direction: "outbound",
    };
  } else {
    // Inbound: travel using actual greenband speeds (matching travel times) to first junction
    for (let i = activeJ.length - 1; i >= 0; i--) {
      const junction = activeJ[i];
      const junctionDist = junction.position_m ?? 0;

      // Skip junctions that are below/after our starting position
      if (junctionDist >= currentDistance) {
        continue;
      }

      // Calculate travel time using actual greenband speed for this segment
      const distanceToTravel = currentDistance - junctionDist;

      // Find the next junction to get the correct travel time
      let travelTime: number;
      if (i === activeJ.length - 1 || currentDistance > (activeJ[i+1]?.position_m ?? Infinity)) {
        // Starting between junctions or after last junction
        // Find which segment we're in
        let segmentEndIdx = getJunctionIndex(activeJ[i]);
        let segmentDistance = currentDistance - junctionDist;
        let segmentTravelTime = 0;

        // Look forwards to find the junction we're starting from
        for (let j = i + 1; j < activeJ.length; j++) {
          const nextJunc = activeJ[j];
          const nextDist = nextJunc.position_m ?? Infinity;
          if (nextDist >= currentDistance) {
            segmentEndIdx = getJunctionIndex(activeJ[i]);
            segmentDistance = nextDist - junctionDist;
            segmentTravelTime = travelTimes[segmentEndIdx] ?? 0;
            break;
          }
        }

        // Interpolate travel time based on partial distance
        if (segmentDistance > 0 && segmentTravelTime > 0) {
          travelTime = (distanceToTravel / segmentDistance) * segmentTravelTime;
        } else {
          travelTime = 0;
        }
      } else {
        // Continuing from previous junction - use the travel time for this segment
        const currentJuncIdx = getJunctionIndex(activeJ[i]);
        const segmentDistance = (activeJ[i+1].position_m ?? Infinity) - junctionDist;
        const segmentTravelTime = travelTimes[currentJuncIdx] ?? 0;

        // If we didn't travel the full segment, interpolate
        if (segmentDistance > 0 && segmentTravelTime > 0) {
          travelTime = (distanceToTravel / segmentDistance) * segmentTravelTime;
        } else {
          travelTime = 0;
        }
      }

      // Arrive at junction
      currentTime += travelTime;
      currentDistance = junctionDist;

      // Check if signal is green for inbound
      const greenCheck = greenWindowAt(junction, "inbound", currentTime);

      if (!greenCheck.isGreen && greenCheck.nextGreenStart) {
        // Red light - must stop
        const stopDuration = greenCheck.nextGreenStart - currentTime;

        path.push({ time: currentTime, distance: currentDistance });
        path.push({ time: greenCheck.nextGreenStart, distance: currentDistance });

        stops.push({
          junctionIdx: i,
          junctionName: junction.name,
          time: currentTime,
          duration: stopDuration,
          distance: currentDistance,
        });

        currentTime = greenCheck.nextGreenStart;
      } else {
        // Green light - pass through
        path.push({ time: currentTime, distance: currentDistance });
      }
    }

    return {
      path,
      stops,
      totalTravelTime: currentTime - startTime,
      startTime,
      startDistance,
      endDistance: activeJ[0].position_m ?? 0,
      direction: "inbound",
    };
  }
}

// Configuration constants for queue vehicle trajectories
export const QUEUE_TRAJECTORY_CONFIG = {
  LINE_SPACING_M: 7,           // 7 meters between trajectory lines (distance axis)
  LINE_COLOR: '#1e3a8a',       // Dark blue - default/fallback color
  LINE_COLOR_OUTBOUND: '#1e3a8a', // Blue-900 - darker than outbound bandwidth (#3b82f6)
  LINE_COLOR_INBOUND: '#14532d',  // Green-900 - darker than inbound bandwidth (#22c55e)
  LINE_WIDTH: 2,               // Border line width for band edges
  LINE_OPACITY: 1,             // Full opacity for edge lines
  BAND_FILL_OPACITY: 0.5,     // Semi-transparent fill for the band
  MAX_LINES: 10,               // Performance limit
  ACCEL_DURATION_S: 3,         // Seconds to reach full speed from stop
};
