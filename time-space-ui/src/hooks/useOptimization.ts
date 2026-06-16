import { useState, useMemo } from "react";
import type { J, OptimizationSettings } from "../utils/junctionHelpers";
import { buildComparisonReport } from "../utils/corridorMetrics";
import { authFetch } from "../auth";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export type DiagramSnapshot = {
  junctions: J[];
  travelOut_s: number[];
  travelIn_s: number[];
  queueOut_s: number[];
  queueIn_s: number[];
};

interface Deps {
  junctions: J[];
  setJunctions: React.Dispatch<React.SetStateAction<J[]>>;
  travelOut_s: number[];
  setTravelOut: React.Dispatch<React.SetStateAction<number[]>>;
  travelIn_s: number[];
  setTravelIn: React.Dispatch<React.SetStateAction<number[]>>;
  queueOut_s: number[];
  setQueueOut: React.Dispatch<React.SetStateAction<number[]>>;
  queueIn_s: number[];
  setQueueIn: React.Dispatch<React.SetStateAction<number[]>>;
  timeStart: number;
  timeEnd: number;
  pixelsPerSecond: number;
  pixelsPerMeter: number;
}

export function useOptimization({
  junctions, setJunctions,
  travelOut_s, setTravelOut,
  travelIn_s, setTravelIn,
  queueOut_s, setQueueOut,
  queueIn_s, setQueueIn,
  timeStart, timeEnd, pixelsPerSecond, pixelsPerMeter,
}: Deps) {
  const [optimization, setOptimization] = useState<OptimizationSettings>({
    cycleRange: [1, 200], defaultAmber_s: 3, defaultRed_s: 3, flag: 0, k: 0.9,
    masterJunctionId: "", speedChangeRange_kmh: [-20, 20], speedRange_kmh: [60, 90],
  });
  const [isOptimizing,        setIsOptimizing]        = useState(false);
  const [optimizationError,   setOptimizationError]   = useState<string | null>(null);
  const [optimizationSuccess, setOptimizationSuccess] = useState<string | null>(null);
  const [optimizedCycle,      setOptimizedCycle]      = useState<number | null>(null);

  const [beforeSnapshot, setBeforeSnapshot] = useState<DiagramSnapshot | null>(null);
  const [viewingBefore,  setViewingBefore]  = useState(false);
  const [reportOpen,     setReportOpen]     = useState(false);

  const comparisonReport = useMemo(() => {
    if (!beforeSnapshot || !reportOpen) return null;
    return buildComparisonReport(
      { junctions: beforeSnapshot.junctions, travelOut_s: beforeSnapshot.travelOut_s, travelIn_s: beforeSnapshot.travelIn_s },
      { junctions, travelOut_s, travelIn_s },
      optimization.defaultRed_s
    );
  }, [beforeSnapshot, reportOpen, junctions, travelOut_s, travelIn_s, optimization.defaultRed_s]);

  function validateOptimizationInput(): string | null {
    if (junctions.filter(j => j.enabled !== false).length < 2) return "At least 2 enabled junctions are required.";
    if (optimization.cycleRange[0] >= optimization.cycleRange[1]) return "Min cycle must be less than max cycle.";
    if (optimization.speedRange_kmh[0] >= optimization.speedRange_kmh[1]) return "Min speed must be less than max speed.";
    return null;
  }

  function applyOptimizedResults(data: any) {
    if (Array.isArray(data.travelOut_s)) setTravelOut(data.travelOut_s);
    if (Array.isArray(data.travelIn_s))  setTravelIn(data.travelIn_s);
    if (Array.isArray(data.queueOut_s))  setQueueOut(data.queueOut_s.map(Number));
    if (Array.isArray(data.queueIn_s))   setQueueIn(data.queueIn_s.map(Number));
    if (data.optimization?.optimized_cycle_s) setOptimizedCycle(data.optimization.optimized_cycle_s);
    if (Array.isArray(data.junctions)) {
      setJunctions(prev => prev.map(prevJ => {
        const optJ = data.junctions.find((oj: any) => oj.id === prevJ.id || oj.name === prevJ.name);
        if (!optJ) return prevJ;
        return {
          ...prevJ,
          offset_s: Number(optJ.offset_s ?? prevJ.offset_s),
          phases_s: Array.isArray(optJ.phases_s) ? optJ.phases_s.map(Number) : prevJ.phases_s,
          phaseNames: Array.isArray(optJ.phaseNames) ? optJ.phaseNames : prevJ.phaseNames,
          inboundIdx:  Array.isArray(optJ.inboundIdx)  ? optJ.inboundIdx  : prevJ.inboundIdx,
          outboundIdx: Array.isArray(optJ.outboundIdx) ? optJ.outboundIdx : prevJ.outboundIdx,
        };
      }));
    }
  }

  async function handleOptimize() {
    setOptimizationError(null); setOptimizationSuccess(null);
    const err = validateOptimizationInput();
    if (err) { setOptimizationError(err); return; }
    setIsOptimizing(true);
    try {
      const optimizationJunctions = junctions.map(j => {
        const dir = j.direction ?? "bidirectional";
        if (j.enabled === false || dir === "bidirectional") return j;
        const phases_s = [...j.phases_s];
        if (dir === "outbound") {
          j.inboundIdx.forEach(i => { if (!j.outboundIdx.includes(i)) phases_s[i] = 0; });
        } else {
          j.outboundIdx.forEach(i => { if (!j.inboundIdx.includes(i)) phases_s[i] = 0; });
        }
        return { ...j, phases_s };
      });
      // Zero queue times for the suppressed direction — tao appears in the
      // coordination constraint RHS and would bias the active direction if left non-zero.
      const enabledJunctions = junctions.filter(j => j.enabled !== false);
      const optQueueOut = enabledJunctions.map((j, i) =>
        (j.direction ?? "bidirectional") === "inbound" ? 0 : (queueOut_s[i] ?? 0)
      );
      const optQueueIn = enabledJunctions.map((j, i) =>
        (j.direction ?? "bidirectional") === "outbound" ? 0 : (queueIn_s[i] ?? 0)
      );
      const payload = {
        optimization, timeStart, timeEnd,
        pps: pixelsPerSecond, ppm: pixelsPerMeter,
        travelOut_s, travelIn_s,
        queueOut_s: optQueueOut, queueIn_s: optQueueIn,
        junctions: optimizationJunctions,
      };
      const res = await authFetch(`${API_BASE_URL}/optimize`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      const data = await res.json();
      setBeforeSnapshot({ junctions: structuredClone(junctions), travelOut_s: [...travelOut_s], travelIn_s: [...travelIn_s], queueOut_s: [...queueOut_s], queueIn_s: [...queueIn_s] });
      setViewingBefore(false);
      applyOptimizedResults(data);
      const cycleMsg = data.optimization?.optimized_cycle_s ? ` Optimized cycle: ${data.optimization.optimized_cycle_s}s` : "";
      setOptimizationSuccess(`Optimization completed!${cycleMsg}`);
      setTimeout(() => setOptimizationSuccess(null), 5000);
    } catch (e) {
      setOptimizationError(`Optimization failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally { setIsOptimizing(false); }
  }

  return {
    optimization, setOptimization,
    isOptimizing,
    optimizationError, setOptimizationError,
    optimizationSuccess, setOptimizationSuccess,
    optimizedCycle,
    beforeSnapshot, setBeforeSnapshot,
    viewingBefore, setViewingBefore,
    reportOpen, setReportOpen,
    comparisonReport,
    handleOptimize,
  };
}
