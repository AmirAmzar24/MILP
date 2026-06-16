import { useState } from "react";
import type { J } from "../utils/junctionHelpers";

export type JunctionPreset = "cross" | "tjunc" | "crossovl";

function makeJFromPreset(name: string, position_m: number, type: JunctionPreset): J {
  const base: Partial<J> = {
    id: crypto.randomUUID(), name, position_m, offset_s: 0, lost_s: 7,
    sideRoadOutboundIdx: [], sideRoadInboundIdx: [], enabled: true, ovlPhaseIndices: [],
  };
  if (type === "cross") {
    return { ...base, phases_s: [25,60,23,50], phaseNames: ["A1","A2","A3","A4"], outboundIdx: [0], inboundIdx: [1] } as J;
  } else if (type === "tjunc") {
    return { ...base, phases_s: [25,10,60,23], phaseNames: ["A1","OVL","A2","A3"], ovlPhaseIndices: [1], outboundIdx: [0,1], inboundIdx: [1,2] } as J;
  } else {
    return { ...base, phases_s: [25,10,60,23,50], phaseNames: ["A1","OVL","A2","A3","A4"], ovlPhaseIndices: [1], outboundIdx: [0,1], inboundIdx: [1,2] } as J;
  }
}

const DEFAULT_JUNCTIONS: J[] = [
  { id: crypto.randomUUID(), name: "J1", position_m: 0,   offset_s: 0,  lost_s: 7, phases_s: [25,60,23,50], outboundIdx: [0], inboundIdx: [1], sideRoadOutboundIdx: [], sideRoadInboundIdx: [], enabled: true, phaseNames: ["A1","A2","A3","A4"] },
  { id: crypto.randomUUID(), name: "J2", position_m: 400, offset_s: 12, lost_s: 7, phases_s: [25,60,23,50], outboundIdx: [0], inboundIdx: [1], sideRoadOutboundIdx: [], sideRoadInboundIdx: [], enabled: true, phaseNames: ["A1","A2","A3","A4"] },
  { id: crypto.randomUUID(), name: "J3", position_m: 900, offset_s: 24, lost_s: 7, phases_s: [25,60,23,50], outboundIdx: [0], inboundIdx: [1], sideRoadOutboundIdx: [], sideRoadInboundIdx: [], enabled: true, phaseNames: ["A1","A2","A3","A4"] },
];

export function useJunctionEditor() {
  const [junctions, setJunctions] = useState<J[]>(DEFAULT_JUNCTIONS);
  const [expandedJunctions, setExpandedJunctions] = useState<Set<string>>(
    () => new Set([DEFAULT_JUNCTIONS[0].id])
  );

  function updateJ(id: string, patch: Partial<J>) {
    setJunctions(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j));
  }

  function toggleExpanded(id: string) {
    setExpandedJunctions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function addJ() {
    const last = junctions[junctions.length - 1];
    setJunctions(prev => [...prev, {
      id: crypto.randomUUID(), name: `J${prev.length + 1}`,
      position_m: (last?.position_m ?? 0) + 300, offset_s: 0, lost_s: 7,
      phases_s: [30,30,30,30], outboundIdx: last?.outboundIdx ?? [0], inboundIdx: last?.inboundIdx ?? [1],
      sideRoadOutboundIdx: [], sideRoadInboundIdx: [], enabled: true,
      phaseNames: ["A1","A2","A3","A4"],
    }]);
  }

  function removeJ(id: string) {
    setJunctions(prev => prev.filter(j => j.id !== id));
  }

  function getJunctionTypeLabel(j: J): { label: string; style: string } {
    const ovlCount = (j.ovlPhaseIndices ?? []).length;
    const nonOvl = j.phases_s.length - ovlCount;
    if (ovlCount === 0) return { label: "Cross",      style: "bg-neutral-700/80 text-neutral-400" };
    if (nonOvl <= 3)   return { label: "T-Junction", style: "bg-neutral-700/80 text-neutral-400" };
    return                    { label: "Cross+OVL",  style: "bg-neutral-700/80 text-neutral-400" };
  }

  function setSegmentDistance(idx: number, newDist: number) {
    setJunctions(prev => {
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const curDist = Math.max(0, (prev[idx+1]?.position_m ?? 0) - (prev[idx]?.position_m ?? 0));
      const clean = Math.max(0, Number.isFinite(newDist) ? newDist : 0);
      const delta = clean - curDist;
      if (delta === 0) return prev;
      return prev.map((j, jIdx) => jIdx <= idx ? j : { ...j, position_m: (j.position_m ?? 0) + delta });
    });
  }

  return {
    junctions,
    setJunctions,
    expandedJunctions,
    setExpandedJunctions,
    updateJ,
    toggleExpanded,
    addJ,
    removeJ,
    getJunctionTypeLabel,
    makeJFromPreset,
    setSegmentDistance,
  };
}
