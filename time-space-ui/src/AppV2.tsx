import React, { useState } from "react";
import { useTour } from "./tour";
import TimeSpaceDiagram from "./components/TimeSpaceDiagram";
import OptimizationSettingsPanel from "./components/OptimizationSettings";
import FolderPanel, { type Folder } from "./components/FolderPanel";
import OptimizationReport from "./components/OptimizationReport";
import type { J } from "./utils/junctionHelpers";
import { clamp, ensurePhaseNames, toggleIdx, reorderPhase, redistributeWithCycleLock } from "./utils/junctionHelpers";
import { useJunctionEditor, type JunctionPreset } from "./hooks/useJunctionEditor";
import { useOptimization } from "./hooks/useOptimization";
import { login as authLogin } from "./auth";

// ─── Phase color palette for the V2 matrix ────────────────────────────────
const PHASE_COLORS = [
  { border: "border-blue-600/50",    bg: "bg-blue-950/40",    text: "text-blue-200",    label: "text-blue-300"    },
  { border: "border-emerald-600/50", bg: "bg-emerald-950/40", text: "text-emerald-200",  label: "text-emerald-300" },
  { border: "border-neutral-600/50", bg: "bg-neutral-800/60", text: "text-neutral-300",  label: "text-neutral-400" },
  { border: "border-amber-600/50",   bg: "bg-amber-950/40",   text: "text-amber-200",    label: "text-amber-400"   }, // OVL
];
function phaseColor(_i: number, isOvl = false, isOut = false, isIn = false) {
  if (isOvl) return PHASE_COLORS[3];
  if (isOut) return PHASE_COLORS[0];
  if (isIn)  return PHASE_COLORS[1];
  return PHASE_COLORS[2];
}

// ─── Phase Matrix (V2 column layout with Out/In circle toggles + barrier groups) ───
function PhaseMatrixV2({
  j,
  onUpdate,
  onAddPhase,
  onRemovePhase,
  onAddOvl,
}: {
  j: J;
  onUpdate: (patch: Partial<J>) => void;
  onAddPhase: () => void;
  onRemovePhase: () => void;
  onAddOvl: () => void;
}) {
  const [localNames, setLocalNames] = React.useState<string[]>(() =>
    ensurePhaseNames(j, j.phases_s.length)
  );
  React.useEffect(() => {
    setLocalNames(ensurePhaseNames(j, j.phases_s.length));
  }, [j.id, j.phases_s.length, j.phaseNames]);

  const [dragFrom, setDragFrom] = React.useState<number | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);
  const [dragInvalid, setDragInvalid] = React.useState(false);

  const ovlSet  = new Set(j.ovlPhaseIndices ?? []);
  const lastIdx = j.phases_s.length - 1;

  // Helper: renders one phase chip column (drag-droppable, with Out/In toggles)
  function renderPhaseChip(i: number, dur: number, showArrow: boolean) {
    const isOvl = ovlSet.has(i);
    const outActive = j.outboundIdx.includes(i);
    const inActive = j.inboundIdx.includes(i);
    const c = phaseColor(i, isOvl, outActive, inActive);
    const isDraggingOver = dragOver === i && dragFrom !== null && dragFrom !== i;
    const prevName = i > 0 ? (localNames[i - 1] ?? `A${i}`) : "?";
    const nextName = i < lastIdx ? (localNames[i + 1] ?? `A${i + 2}`) : "?";
    return (
      <div
        key={`phase-col-${i}`}
        className={`flex flex-col items-center gap-1 flex-shrink-0 relative transition-opacity ${isDraggingOver ? "opacity-50" : ""}`}
        onDragOver={(e) => { e.preventDefault(); const movingSpecial = dragFrom !== null && ovlSet.has(dragFrom); const wouldBeInvalid = movingSpecial && (i === 0 || i === lastIdx); setDragInvalid(wouldBeInvalid); setDragOver(i); }}
        onDrop={(e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== i) { const movingSpecial = ovlSet.has(dragFrom); const invalid = movingSpecial && (i === 0 || i === lastIdx); if (!invalid) { const patch = reorderPhase(j, dragFrom, i, localNames); onUpdate(patch); } } setDragFrom(null); setDragOver(null); setDragInvalid(false); }}
      >
        {showArrow && <span className="absolute -left-1.5 top-[1px] text-[12px] font-bold text-neutral-400 leading-none pointer-events-none select-none">›</span>}
        {/* Name label */}
        <div className="h-4 flex items-center justify-center">
          {isOvl ? (
            <span className="text-[9px] font-bold text-amber-400 flex items-center whitespace-nowrap gap-px">
              <span className={phaseColor(i - 1, false, j.outboundIdx.includes(i - 1), j.inboundIdx.includes(i - 1)).label}>{prevName}</span>
              <span className="text-amber-400 mx-0.5">↔</span>
              <span className={phaseColor(i + 1, false, j.outboundIdx.includes(i + 1), j.inboundIdx.includes(i + 1)).label}>{nextName}</span>
            </span>
          ) : (
            <input value={localNames[i] ?? ""} onChange={(e) => { const next = [...localNames]; next[i] = e.target.value; setLocalNames(next); }} onBlur={(e) => { const v = e.target.value || `A${i + 1}`; const next = [...localNames]; next[i] = v; setLocalNames(next); onUpdate({ phaseNames: next }); }} className={`w-8 text-[10px] font-medium text-center bg-transparent focus:outline-none ${c.label}`} />
          )}
        </div>
        {/* Seq (duration + drag) */}
        <div className={`h-[22px] flex items-center gap-1 rounded px-1.5 ${c.bg} border ${dragFrom === i && dragInvalid ? "border-red-500" : c.border} cursor-grab`} draggable onDragStart={() => { setDragFrom(i); setDragInvalid(false); }} onDragEnd={() => { setDragFrom(null); setDragOver(null); setDragInvalid(false); }}>
          <svg className="w-2 h-2 opacity-30 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M7 2a2 2 0 1 0 .001 3.999A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 3.999A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 3.999A2 2 0 0 0 7 14zm6-12a2 2 0 1 0 .001 3.999A2 2 0 0 0 13 2zm0 6a2 2 0 1 0 .001 3.999A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 3.999A2 2 0 0 0 13 14z" /></svg>
          <input type="number" value={dur} min={1} onChange={(e) => { onUpdate({ phases_s: redistributeWithCycleLock(j, i, Math.max(1, Number(e.target.value) || 1)) }); }} className={`w-8 text-[10px] text-right bg-transparent border-none focus:outline-none ${c.text}`} />
        </div>
        {/* OUT toggle */}
        {(j.direction ?? "bidirectional") !== "inbound" && (isOvl ? (
          <div className="w-[18px] h-[18px] rounded-full border border-blue-500 flex items-center justify-center flex-shrink-0" title="OVL is always outbound"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /></div>
        ) : (
          <button onClick={() => onUpdate({ outboundIdx: toggleIdx(j.outboundIdx, i) })} className={`w-[18px] h-[18px] rounded-full border flex items-center justify-center flex-shrink-0 transition-colors p-0 ${outActive ? "border-blue-500" : "border-neutral-600 hover:border-blue-400"}`}><span className={`w-2.5 h-2.5 rounded-full bg-blue-500 transition-opacity ${outActive ? "opacity-100" : "opacity-0"}`} /></button>
        ))}
        {/* IN toggle */}
        {(j.direction ?? "bidirectional") !== "outbound" && (isOvl ? (
          <div className="w-[18px] h-[18px] rounded-full border border-emerald-500 flex items-center justify-center flex-shrink-0" title="OVL is always inbound"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /></div>
        ) : (
          <button onClick={() => onUpdate({ inboundIdx: toggleIdx(j.inboundIdx, i) })} className={`w-[18px] h-[18px] rounded-full border flex items-center justify-center flex-shrink-0 transition-colors p-0 ${inActive ? "border-emerald-500" : "border-neutral-600 hover:border-emerald-400"}`}><span className={`w-2.5 h-2.5 rounded-full bg-emerald-500 transition-opacity ${inActive ? "opacity-100" : "opacity-0"}`} /></button>
        ))}
      </div>
    );
  }

  return (
    <div data-tour="phase-sequence-cards">
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-neutral-400 flex items-center gap-1">
          Phase Sequence
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-neutral-700 text-neutral-300 text-[9px] font-bold cursor-default leading-none" title="Phase durations are inclusive of Amber and All Red clearance time.">?</span>
        </span>
        <div className="flex gap-1">
          <button onClick={onAddPhase} className="px-1.5 py-0.5 text-[10px] rounded bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors">+</button>
          <button onClick={onAddOvl} className="px-1.5 py-0.5 text-[10px] rounded border transition-colors bg-amber-950/60 border-amber-800/60 text-amber-400 hover:text-amber-300 hover:border-amber-600" title="Insert an overlap phase between two existing phases">+OVL</button>
          <button onClick={onRemovePhase} className="px-1.5 py-0.5 text-[10px] rounded bg-neutral-800 border border-neutral-700 text-red-400 hover:text-red-300 hover:border-red-700 transition-colors">−</button>
        </div>
      </div>

      {/* Phase sequence — flat chip row */}
      <div className="flex items-start gap-3 overflow-x-auto pb-1">
        {/* Row labels */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          <div className="h-4" />
          <div className="h-[22px] flex items-center text-[10px] text-neutral-500">Seq</div>
          <div className="h-[18px] flex items-center text-[10px] text-neutral-500">Out</div>
          <div className="h-[18px] flex items-center text-[10px] text-neutral-500">In</div>
        </div>

        {/* All phase chips — asymmetric barrier pairs rendered with a spanning pill */}
        {(() => {
          // Detect within-barrier asymmetric pairs from the OUT/IN bridge pattern
          type AsymPair = { p0: number; p1: number; dir: 'out' | 'in'; mergeAt: number };
          const pairs: AsymPair[] = [];
          for (let b = 0; b < 2; b++) {
            const p0 = b * 2, p1 = b * 2 + 1;
            if (p1 >= j.phases_s.length) continue;
            if (ovlSet.has(p0) || ovlSet.has(p1)) continue;
            const p0Out = j.outboundIdx.includes(p0), p0In = j.inboundIdx.includes(p0);
            const p1Out = j.outboundIdx.includes(p1), p1In = j.inboundIdx.includes(p1);
            if ((p0Out && !p0In) && (p1Out && p1In))      pairs.push({ p0, p1, dir: 'out', mergeAt: p0 });
            else if ((p1Out && !p1In) && (p0Out && p0In)) pairs.push({ p0, p1, dir: 'out', mergeAt: p1 });
            else if ((p0In && !p0Out) && (p1In && p1Out)) pairs.push({ p0, p1, dir: 'in',  mergeAt: p0 });
            else if ((p1In && !p1Out) && (p0In && p0Out)) pairs.push({ p0, p1, dir: 'in',  mergeAt: p1 });
          }

          const seen = new Set<number>();
          const nodes: React.ReactNode[] = [];

          for (let i = 0; i < j.phases_s.length; i++) {
            if (seen.has(i)) continue;
            const pair = pairs.find(p => p.p0 === i || p.p1 === i);
            if (pair) {
              seen.add(pair.p0); seen.add(pair.p1);
              const { p0, p1, dir, mergeAt } = pair;
              const isFirst = nodes.length === 0;
              const c0 = phaseColor(p0, false, j.outboundIdx.includes(p0), j.inboundIdx.includes(p0));
              const c1 = phaseColor(p1, false, j.outboundIdx.includes(p1), j.inboundIdx.includes(p1));
              nodes.push(
                <div key={`asym-pair-${p0}`} className="flex-shrink-0 flex flex-col gap-1 relative">
                  {!isFirst && <span className="absolute -left-1.5 top-[1px] text-[12px] font-bold text-neutral-400 leading-none pointer-events-none select-none">›</span>}
                  {/* Two name + duration chips side by side */}
                  <div className="flex items-start gap-2">
                    {([p0, p1] as const).map((pi) => {
                      const c = pi === p0 ? c0 : c1;
                      const isDraggingOver = dragOver === pi && dragFrom !== null && dragFrom !== pi;
                      return (
                        <div key={pi}
                          className={`flex flex-col items-center gap-1 flex-shrink-0 relative transition-opacity ${isDraggingOver ? "opacity-50" : ""}`}
                          onDragOver={(e) => { e.preventDefault(); setDragInvalid(false); setDragOver(pi); }}
                          onDrop={(e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== pi) { const patch = reorderPhase(j, dragFrom, pi, localNames); onUpdate(patch); } setDragFrom(null); setDragOver(null); setDragInvalid(false); }}
                        >
                          <div className="h-4 flex items-center justify-center">
                            <input value={localNames[pi] ?? ""} onChange={(e) => { const next = [...localNames]; next[pi] = e.target.value; setLocalNames(next); }} onBlur={(e) => { const v = e.target.value || `A${pi + 1}`; const next = [...localNames]; next[pi] = v; setLocalNames(next); onUpdate({ phaseNames: next }); }} className={`w-8 text-[10px] font-medium text-center bg-transparent focus:outline-none ${c.label}`} />
                          </div>
                          <div className={`h-[22px] flex items-center gap-1 rounded px-1.5 ${c.bg} border ${c.border} cursor-grab`} draggable onDragStart={() => { setDragFrom(pi); setDragInvalid(false); }} onDragEnd={() => { setDragFrom(null); setDragOver(null); setDragInvalid(false); }}>
                            <svg className="w-2 h-2 opacity-30 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M7 2a2 2 0 1 0 .001 3.999A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 3.999A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 3.999A2 2 0 0 0 7 14zm6-12a2 2 0 1 0 .001 3.999A2 2 0 0 0 13 2zm0 6a2 2 0 1 0 .001 3.999A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 3.999A2 2 0 0 0 13 14z" /></svg>
                            <input type="number" value={j.phases_s[pi]} min={1} onChange={(e) => { onUpdate({ phases_s: redistributeWithCycleLock(j, pi, Math.max(1, Number(e.target.value) || 1)) }); }} className={`w-8 text-[10px] text-right bg-transparent border-none focus:outline-none ${c.text}`} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* OUT row: spanning pill when merged outbound, two circles otherwise */}
                  {dir === 'out' ? (
                    <button
                      onClick={() => onUpdate({ outboundIdx: j.outboundIdx.filter(x => x !== mergeAt) })}
                      className="h-[18px] rounded-full border border-blue-500 bg-blue-500/20 flex items-center justify-center gap-1 px-2"
                      title="Merged outbound — click to split back to individual"
                    >
                      <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                      <span className="text-[8px] text-blue-300 font-medium tracking-wide leading-none">OUT</span>
                    </button>
                  ) : (
                    <div className="flex items-center justify-around">
                      {([p0, p1] as const).map(pi => (
                        <button key={pi} onClick={() => onUpdate({ outboundIdx: toggleIdx(j.outboundIdx, pi) })} className={`w-[18px] h-[18px] rounded-full border flex items-center justify-center flex-shrink-0 transition-colors p-0 ${j.outboundIdx.includes(pi) ? "border-blue-500" : "border-neutral-600 hover:border-blue-400"}`}>
                          <span className={`w-2.5 h-2.5 rounded-full bg-blue-500 transition-opacity ${j.outboundIdx.includes(pi) ? "opacity-100" : "opacity-0"}`} />
                        </button>
                      ))}
                    </div>
                  )}
                  {/* IN row: spanning pill when merged inbound, two circles otherwise */}
                  {dir === 'in' ? (
                    <button
                      onClick={() => onUpdate({ inboundIdx: j.inboundIdx.filter(x => x !== mergeAt) })}
                      className="h-[18px] rounded-full border border-emerald-500 bg-emerald-500/20 flex items-center justify-center gap-1 px-2"
                      title="Merged inbound — click to split back to individual"
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      <span className="text-[8px] text-emerald-300 font-medium tracking-wide leading-none">IN</span>
                    </button>
                  ) : (
                    <div className="flex items-center justify-around">
                      {([p0, p1] as const).map(pi => (
                        <button key={pi} onClick={() => onUpdate({ inboundIdx: toggleIdx(j.inboundIdx, pi) })} className={`w-[18px] h-[18px] rounded-full border flex items-center justify-center flex-shrink-0 transition-colors p-0 ${j.inboundIdx.includes(pi) ? "border-emerald-500" : "border-neutral-600 hover:border-emerald-400"}`}>
                          <span className={`w-2.5 h-2.5 rounded-full bg-emerald-500 transition-opacity ${j.inboundIdx.includes(pi) ? "opacity-100" : "opacity-0"}`} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            } else {
              nodes.push(renderPhaseChip(i, j.phases_s[i], nodes.length > 0));
            }
          }
          return nodes;
        })()}
      </div>
    </div>
  );
}

// ─── Compact collapsed phase strip ───────────────────────────────────────────
function CollapsedPhaseStrip({ j }: { j: J }) {
  const names = ensurePhaseNames(j, j.phases_s.length);
  const ovlSet = new Set(j.ovlPhaseIndices ?? []);
  const lockedSet = new Set(j.cycleLocked ? (j.lockedPhases ?? []) : []);
  const lastIdx = j.phases_s.length - 1;

  // Detect asymmetric pairs — same bridge logic as PhaseMatrixV2
  type AsymPair = { p0: number; p1: number; dir: 'out' | 'in'; bridge: number };
  const asymPairs: AsymPair[] = [];
  for (let b = 0; b < 2; b++) {
    const p0 = b * 2, p1 = b * 2 + 1;
    if (p1 >= j.phases_s.length) continue;
    if (ovlSet.has(p0) || ovlSet.has(p1)) continue;
    const p0Out = j.outboundIdx.includes(p0), p0In = j.inboundIdx.includes(p0);
    const p1Out = j.outboundIdx.includes(p1), p1In = j.inboundIdx.includes(p1);
    if      ((p0Out && !p0In) && (p1Out && p1In)) asymPairs.push({ p0, p1, dir: 'out', bridge: p1 });
    else if ((p1Out && !p1In) && (p0Out && p0In)) asymPairs.push({ p0, p1, dir: 'out', bridge: p0 });
    else if ((p0In && !p0Out) && (p1In && p1Out)) asymPairs.push({ p0, p1, dir: 'in',  bridge: p1 });
    else if ((p1In && !p1Out) && (p0In && p0Out)) asymPairs.push({ p0, p1, dir: 'in',  bridge: p0 });
  }
  const pairedMap = new Map<number, AsymPair>();
  asymPairs.forEach(p => { pairedMap.set(p.p0, p); pairedMap.set(p.p1, p); });

  return (
    <div className="border-t border-neutral-800 bg-neutral-950 px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {j.phases_s.map((dur, i) => {
          const pair = pairedMap.get(i);

          // Second phase of a pair is rendered together with the first — skip it here
          if (pair && i === pair.p1) return null;

          // Asymmetric pair: render both phases as a single connected group
          if (pair && i === pair.p0) {
            const { p1, dir, bridge } = pair;
            const col = dir === 'out'
              ? { border: "border-blue-600/50",    bg: "bg-blue-950/40",    text: "text-blue-300",    div: "text-blue-700" }
              : { border: "border-emerald-600/50", bg: "bg-emerald-950/40", text: "text-emerald-300", div: "text-emerald-700" };
            // The bridge phase is also in the OTHER direction — show a small dot for it
            const bridgeDotColor = dir === 'out' ? "bg-emerald-400" : "bg-blue-400";
            const renderSide = (pi: number) => (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5">
                <span className={`text-[10px] font-medium ${col.text}`}>{names[pi]} {Math.round(j.phases_s[pi])}s</span>
                {pi === bridge && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${bridgeDotColor}`} title={dir === 'out' ? "Also inbound" : "Also outbound"} />}
                {lockedSet.has(pi) && <span className="text-[9px] leading-none text-amber-400" title="Phase locked">🔒</span>}
              </span>
            );
            return (
              <React.Fragment key={i}>
                <span className={`inline-flex items-center rounded border ${col.border} ${col.bg}`}>
                  {renderSide(i)}
                  <span className={`text-[10px] font-bold select-none ${col.div}`}>|</span>
                  {renderSide(p1)}
                </span>
                {p1 < lastIdx && <span className="text-xs text-neutral-300 self-center flex-shrink-0 select-none leading-none font-bold">→</span>}
              </React.Fragment>
            );
          }

          // Normal chip
          const isOvl    = ovlSet.has(i);
          const isOut    = j.outboundIdx.includes(i);
          const isIn     = j.inboundIdx.includes(i);
          const isLocked = lockedSet.has(i);
          const border = isOvl ? "border-amber-600/50" : isOut ? "border-blue-600/50" : isIn ? "border-emerald-600/50" : "border-neutral-600/50";
          const bg     = isOvl ? "bg-amber-950/40"     : isOut ? "bg-blue-950/40"     : isIn ? "bg-emerald-950/40"     : "bg-neutral-800/60";
          const text   = isOvl ? "text-amber-300"      : isOut ? "text-blue-300"      : isIn ? "text-emerald-300"      : "text-neutral-400";
          return (
            <React.Fragment key={i}>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${bg} border ${isLocked ? "border-amber-500/70" : border}`}>
                <span className={`text-[10px] font-medium ${text}`}>{names[i]}</span>
                <span className={`text-[10px] tabular-nums ${text}`}>{Math.round(dur)}s</span>
                {isLocked && <span className="text-[9px] leading-none text-amber-400" title="Phase locked">🔒</span>}
              </span>
              {i < lastIdx && <span className="text-xs text-neutral-300 self-center flex-shrink-0 select-none leading-none font-bold">→</span>}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [email,    setEmail]    = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error,    setError]    = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    setSubmitting(true);
    setError("");
    const result = await authLogin(email.trim(), password);
    setSubmitting(false);
    if (result.ok) {
      onLogin();
    } else {
      setError(result.error || "Login failed.");
    }
  }

  return (
    <div className="fixed inset-0 bg-neutral-950 flex items-center justify-center">
      <div className="w-80 bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-sky-600 px-6 py-6 flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
            <span className="text-white text-xl font-bold select-none">S</span>
          </div>
          <h1 className="text-white font-semibold text-base tracking-wide">SASCOO Vision Tool</h1>
        </div>
        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3">
          <div>
            <label className="block text-[11px] text-neutral-500 mb-1">Email</label>
            <input
              type="email"
              autoComplete="email"
              className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-800 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200 transition"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(""); }}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-[11px] text-neutral-500 mb-1">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-800 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-200 transition"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 active:bg-sky-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm rounded-lg transition-colors tracking-widest"
          >{submitting ? "SIGNING IN…" : "LOGIN"}</button>
          <p className="text-center text-[11px] text-neutral-400 hover:text-sky-500 cursor-pointer transition-colors">
            Login to new account
          </p>
        </form>
      </div>
    </div>
  );
}

// ─── Demo corridor factory ─────────────────────────────────────────────────────
// ─── Main V2 App ──────────────────────────────────────────────────────────────
export default function AppV2() {

  // ── Junctions ──────────────────────────────────────────────────────────────
  const {
    junctions, setJunctions,
    expandedJunctions, setExpandedJunctions,
    updateJ, toggleExpanded, removeJ,
    getJunctionTypeLabel, makeJFromPreset,
  } = useJunctionEditor();

  const DEFAULT_SPEED_MS = (40 * 1000) / 3600;
  const defaultTravelSeconds = (d: number) => d > 0 ? Math.round(d / DEFAULT_SPEED_MS) : 0;

  // ── View ──────────────────────────────────────────────────────────────────
  const [timeStart, setTimeStart] = useState(-10);
  const [timeEnd,   setTimeEnd]   = useState(300);
  const [pixelsPerSecond, setPps] = useState(4);
  const [pixelsPerMeter,  setPpm] = useState(0.2);

  // ── Travel / Queue times ───────────────────────────────────────────────────
  const [travelOut_s, setTravelOut] = React.useState<number[]>([]);
  const [travelIn_s,  setTravelIn]  = React.useState<number[]>([]);
  const [queueIn_s,   setQueueIn]   = React.useState<number[]>([]);
  const [queueOut_s,  setQueueOut]  = React.useState<number[]>([]);
  const [queueVehiclesIn,  setQueueVehiclesIn]  = React.useState(0);
  const [queueVehiclesOut, setQueueVehiclesOut] = React.useState(0);

  // ── Trajectory ────────────────────────────────────────────────────────────
  const [trajectoryEnabled,      setTrajectoryEnabled]      = React.useState(false);
  const [queueTrajectoriesEnabled, setQueueTrajectoriesEnabled] = React.useState(false);
  const [queueTrajDirection, setQueueTrajDirection] = React.useState<"both"|"outbound"|"inbound">("both");
  const [queueTrajPanelOpen, setQueueTrajPanelOpen] = React.useState(false);
  const [showDischargeWidth, setShowDischargeWidth] = React.useState(false);
  const saturationHeadway_s = 2;

  // ── Optimization (hook) ───────────────────────────────────────────────────
  const {
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
  } = useOptimization({
    junctions, setJunctions,
    travelOut_s, setTravelOut,
    travelIn_s, setTravelIn,
    queueOut_s, setQueueOut,
    queueIn_s, setQueueIn,
    timeStart, timeEnd, pixelsPerSecond, pixelsPerMeter,
  });

  // ── Auth / project ────────────────────────────────────────────────────────
  const [isLoggedIn,        setIsLoggedIn]        = React.useState(false);

  // Return to the login screen if any API call reports the token is invalid.
  React.useEffect(() => {
    const onUnauthorized = () => setIsLoggedIn(false);
    window.addEventListener("auth:unauthorized", onUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", onUnauthorized);
  }, []);
  const [folderName,        setFolderName]         = React.useState<string|null>(null);
  const [projectName,       setProjectName]        = React.useState<string|null>(null);
  const [demoFolders,       setDemoFolders]        = React.useState<Folder[] | undefined>(undefined);
  const [initialActivePlan, setInitialActivePlan]  = React.useState<{ folderId: string; planId: string } | undefined>(undefined);

  // ── Folder panel imperative add ───────────────────────────────────────────
  const addPlanToFolderRef = React.useRef<((folderId: string, planData: any, planName: string) => void) | null>(null);

  // ── Tour ──────────────────────────────────────────────────────────────────
  const { startTour, registerExpandJunctionControl, registerGetFirstJunctionId, registerHighlightBandControl } = useTour();
  const [tourHighlightBand, setTourHighlightBand] = React.useState<'outbound' | 'inbound' | null>(null);
  React.useEffect(() => {
    registerExpandJunctionControl((id: string) => {
      setExpandedJunctions(prev => { const next = new Set(prev); next.add(id); return next; });
    });
    registerGetFirstJunctionId(() => junctions[0]?.id ?? null);
    registerHighlightBandControl((band) => setTourHighlightBand(band));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [saveSuccess,       setSaveSuccess]       = React.useState<string|null>(null);
  const [folderPanelOpen,   setFolderPanelOpen]   = React.useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const [sidebarTab,        setSidebarTab]        = React.useState<"junctions"|"optimization">("junctions");
  const [viewSettingsOpen,  setViewSettingsOpen]  = React.useState(false);
  const [proMode,           setProMode]           = React.useState(false);

  // ── Wizard / modal state ────────────────────────────────────────────────
  const [wizardOpen,          setWizardOpen]          = React.useState(false);
  const [wizardStep,          setWizardStep]          = React.useState<1|2>(1);
  const [wizardCount,         setWizardCount]         = React.useState(3);
  const [wizardTypes,         setWizardTypes]         = React.useState<JunctionPreset[]>(["cross","cross","cross"]);
  const [wizardTargetFolderId,setWizardTargetFolderId]= React.useState<string|null>(null);
  const [wizardPlanName,      setWizardPlanName]      = React.useState("");
  const [addModalOpen, setAddModalOpen] = React.useState(false);
  const [exportModalOpen, setExportModalOpen] = React.useState(false);

  const isLoadingPlanRef   = React.useRef(false);
  const isInitialMountRef  = React.useRef(true);
  const fileInputRef       = React.useRef<HTMLInputElement|null>(null);
  const viewSettingsBtnRef = React.useRef<HTMLDivElement|null>(null);
  const queueTrajBtnRef    = React.useRef<HTMLDivElement|null>(null);
  const diagramContainerRef = React.useRef<HTMLDivElement|null>(null);

  // ── Resize travel/queue arrays when junctions change ─────────────────────
  React.useEffect(() => {
    if (isLoadingPlanRef.current) return;
    const need = Math.max(0, junctions.length - 1);
    setTravelOut(prev => {
      const next: number[] = [];
      for (let i = 0; i < need; i++) {
        const ex = prev[i];
        if (Number.isFinite(ex) && ex > 0) { next[i] = ex; }
        else {
          const dist = Math.max(0, (junctions[i+1]?.position_m ?? 0) - (junctions[i]?.position_m ?? 0));
          next[i] = defaultTravelSeconds(dist);
        }
      }
      return next;
    });
    setTravelIn(prev => {
      const next: number[] = [];
      for (let i = 0; i < need; i++) {
        const ex = prev[i];
        if (Number.isFinite(ex) && ex > 0) { next[i] = ex; }
        else {
          const dist = Math.max(0, (junctions[i+1]?.position_m ?? 0) - (junctions[i]?.position_m ?? 0));
          next[i] = defaultTravelSeconds(dist);
        }
      }
      return next;
    });
  }, [junctions]);

  React.useEffect(() => {
    if (isLoadingPlanRef.current) return;
    const need = junctions.length;
    setQueueOut(prev => { const n=[...prev]; while(n.length<need) n.push(0); return n.slice(0,need); });
    setQueueIn( prev => { const n=[...prev]; while(n.length<need) n.push(0); return n.slice(0,need); });
  }, [junctions.length]);

  // Track unsaved changes
  React.useEffect(() => {
    if (isInitialMountRef.current) { isInitialMountRef.current = false; return; }
    if (isLoadingPlanRef.current) return;
    setHasUnsavedChanges(true);
  }, [junctions, travelOut_s, travelIn_s, queueOut_s, queueIn_s, optimization]);

  // Auto-fit pixelsPerMeter to fill the diagram container height
  React.useEffect(() => {
    const container = diagramContainerRef.current;
    if (!container) return;

    const compute = () => {
      const activeJ = junctions.filter(j => j.enabled !== false);
      if (activeJ.length < 2) return;
      const maxDist = Math.max(...activeJ.map(j => j.position_m ?? 0));
      if (maxDist <= 0) return;
      // plotMargins: top=80, bottom=64. Bandwidth bar inside component ≈ 70px. padding p-2 = 16px.
      const reserved = 80 + 64 + 70 + 16;
      const available = container.clientHeight - reserved;
      if (available > 20) {
        const newPpm = clamp(available / maxDist, 0.05, 2);
        setPpm(Math.round(newPpm * 1000) / 1000);
      }
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [junctions]); // recompute when junctions change (max distance may change)

  // Click outside to close popovers
  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (viewSettingsOpen && viewSettingsBtnRef.current && !viewSettingsBtnRef.current.contains(e.target as Node)) {
        setViewSettingsOpen(false);
      }
      if (queueTrajPanelOpen && queueTrajBtnRef.current && !queueTrajBtnRef.current.contains(e.target as Node)) {
        setQueueTrajPanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [viewSettingsOpen, queueTrajPanelOpen]);

  // ── Junction helpers (remaining — use hook for CRUD) ─────────────────────
  function addJByType(type: JunctionPreset) {
    const last = junctions[junctions.length-1];
    setJunctions(prev => [...prev, makeJFromPreset(`J${prev.length+1}`, (last?.position_m??0)+300, type)]);
    setAddModalOpen(false);
  }
  function completeWizard() {
    const types = wizardTypes.slice(0, wizardCount);
    while (types.length < wizardCount) types.push("cross");
    const newJ = types.map((t, i) => makeJFromPreset(`J${i+1}`, i*300, t));
    setJunctions(newJ);
    setExpandedJunctions(new Set([newJ[0].id]));
    setWizardOpen(false); setWizardStep(1);

    if (wizardTargetFolderId && addPlanToFolderRef.current) {
      const planName = wizardPlanName.trim() || `New Corridor`;
      const planData = buildExportData();
      planData.junctions = newJ;
      addPlanToFolderRef.current(wizardTargetFolderId, planData, planName);
      setProjectName(planName);
      setHasUnsavedChanges(true);
      setWizardTargetFolderId(null);
    }
  }
  function handleWizardCount(delta: number) {
    const n = Math.max(2, Math.min(10, wizardCount + delta));
    setWizardCount(n);
    setWizardTypes(prev => {
      const next = [...prev]; while (next.length < n) next.push("cross"); return next.slice(0, n);
    });
  }

  function setQueueTime(i: number, dir: "in"|"out", v: number) {
    const val = Math.max(0, Number.isFinite(v) ? v : 0);
    if (dir==="in") setQueueIn( prev => { const n=[...prev]; while(n.length<junctions.length) n.push(0); n[i]=val; return n; });
    else            setQueueOut(prev => { const n=[...prev]; while(n.length<junctions.length) n.push(0); n[i]=val; return n; });
  }
  // ── Export / Import ───────────────────────────────────────────────────────
  function buildExportData() {
    return { optimization, timeStart, timeEnd, pps: pixelsPerSecond, ppm: pixelsPerMeter,
             travelOut_s, travelIn_s, queueOut_s, queueIn_s, queueVehiclesOut, queueVehiclesIn,
             queueTrajectoriesEnabled, saturationHeadway_s, junctions };
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(buildExportData(),null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download="time-space-config.json"; a.click();
    URL.revokeObjectURL(url);
  }
  function applyImportedConfig(data: any) {
    if (Array.isArray(data.junctions)) {
      const mapped = data.junctions.map((j:any,idx:number) => {
        const phases = Array.isArray(j.phases_s) ? j.phases_s.map(Number) : [];
        const phaseNames = Array.isArray(j.phaseNames) ? j.phaseNames.map(String) : phases.map((_:any,i:number)=>`A${i+1}`);
        return {
          ...j, id: j.id||crypto.randomUUID(), name: j.name||`J${idx+1}`,
          position_m: Number(j.position_m??0), offset_s: Number(j.offset_s??0),
          lost_s: Number(j.lost_s??7), phases_s: phases, phaseNames,
          outboundIdx: Array.isArray(j.outboundIdx)?j.outboundIdx.map(Number):[],
          inboundIdx:  Array.isArray(j.inboundIdx) ?j.inboundIdx.map(Number): [],
          sideRoadOutboundIdx: Array.isArray(j.sideRoadOutboundIdx)?j.sideRoadOutboundIdx.map(Number):[],
          sideRoadInboundIdx:  Array.isArray(j.sideRoadInboundIdx) ?j.sideRoadInboundIdx.map(Number): [],
          enabled: j.enabled!==false, cycleLocked: j.cycleLocked===true,
          lockedPhases: Array.isArray(j.lockedPhases)?j.lockedPhases.map(Number):[],
          direction: (j.direction === "outbound" || j.direction === "inbound") ? j.direction : "bidirectional",
        } as J;
      });
      mapped.sort((a:J,b:J) => a.position_m - b.position_m);
      setJunctions(mapped);
      const recalc: number[] = [];
      for (let i=1;i<mapped.length;i++) {
        const dist = Math.abs(mapped[i].position_m - mapped[i-1].position_m);
        recalc.push(Math.max(10, dist>0 ? Math.round((dist/1000)*(3600/50)) : 30));
      }
      setTravelOut(recalc); setTravelIn([...recalc]);
    }
    if (typeof data.timeStart==="number") setTimeStart(data.timeStart);
    if (typeof data.timeEnd==="number")   setTimeEnd(data.timeEnd);
    if (typeof data.pps==="number")       setPps(clamp(data.pps,0.5,20));
    if (typeof data.ppm==="number")       setPpm(clamp(data.ppm,0.01,2));
    if (Array.isArray(data.queueOut_s))   setQueueOut(data.queueOut_s.map(Number));
    if (Array.isArray(data.queueIn_s))    setQueueIn( data.queueIn_s.map(Number));
    if (typeof data.queueVehiclesOut==="number") setQueueVehiclesOut(Math.min(10,Math.max(0,Math.round(data.queueVehiclesOut))));
    if (typeof data.queueVehiclesIn==="number")  setQueueVehiclesIn( Math.min(10,Math.max(0,Math.round(data.queueVehiclesIn))));
    if (typeof data.queueTrajectoriesEnabled==="boolean") setQueueTrajectoriesEnabled(data.queueTrajectoriesEnabled);
    if (data.optimization) {
      const o = data.optimization;
      setOptimization({
        cycleRange: Array.isArray(o.cycleRange)?[Number(o.cycleRange[0])||1,Number(o.cycleRange[1])||200]:[1,200],
        defaultAmber_s: Number(o.defaultAmber_s)||3, defaultRed_s: Number(o.defaultRed_s)||3,
        flag: o.flag===1?1:0, k: Number(o.k)||1, masterJunctionId: String(o.masterJunctionId||""),
        speedChangeRange_kmh: Array.isArray(o.speedChangeRange_kmh)?[Number(o.speedChangeRange_kmh[0])||(-20),Number(o.speedChangeRange_kmh[1])||20]:[-20,20],
        speedRange_kmh: Array.isArray(o.speedRange_kmh)?[Number(o.speedRange_kmh[0])||60,Number(o.speedRange_kmh[1])||90]:[60,90],
      });
    }
  }
  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { applyImportedConfig(JSON.parse(String(reader.result??""))); }
      catch { alert("Invalid JSON file"); }
    };
    reader.readAsText(file); e.target.value="";
  }

  // ── Load plan ─────────────────────────────────────────────────────────────
  function handleLoadPlan(planData: any) {
    isLoadingPlanRef.current = true;
    setBeforeSnapshot(null); setViewingBefore(false);
    applyImportedConfig(planData);
    setTimeout(() => { setHasUnsavedChanges(false); isLoadingPlanRef.current=false; }, 50);
  }
  function handleSaveSuccess(planName: string) {
    setSaveSuccess(`Plan "${planName}" saved successfully!`);
    setHasUnsavedChanges(false);
    setTimeout(() => setSaveSuccess(null), 3000);
  }

  // ── Cycles input helper ───────────────────────────────────────────────────
  function getCycleCount() {
    const active = junctions.filter(j=>j.enabled!==false);
    if (!active.length) return 2;
    const cycle = active[0].phases_s.reduce((a,b)=>a+b,0);
    return cycle>0 ? Math.round((timeEnd-timeStart)/cycle) : 2;
  }
  function setCycleCount(n: number) {
    const active = junctions.filter(j=>j.enabled!==false);
    if (!active.length) return;
    const cycle = active[0].phases_s.reduce((a,b)=>a+b,0);
    if (cycle>0) setTimeEnd(timeStart + Math.max(1,Math.min(20,n)) * cycle);
  }

  // ── Diagram data (before/after) ───────────────────────────────────────────
  // Asymmetric barriers are encoded in outboundIdx/inboundIdx directly (bridge pattern),
  // so mergeConsecutivePhases already renders the correct merged strip — no patch needed.
  const rawJunctions = viewingBefore && beforeSnapshot ? beforeSnapshot.junctions : junctions;
  const diagramJunctions = rawJunctions.map(j => ({
    ...j,
    outboundIdx: (j.direction === "inbound") ? [] : j.outboundIdx,
    inboundIdx:  (j.direction === "outbound") ? [] : j.inboundIdx,
  }));
  const diagramTravelOut = viewingBefore && beforeSnapshot ? beforeSnapshot.travelOut_s : travelOut_s;
  const diagramTravelIn  = viewingBefore && beforeSnapshot ? beforeSnapshot.travelIn_s  : travelIn_s;
  const diagramQueueOut  = viewingBefore && beforeSnapshot ? beforeSnapshot.queueOut_s  : queueOut_s;
  const diagramQueueIn   = viewingBefore && beforeSnapshot ? beforeSnapshot.queueIn_s   : queueIn_s;
  const diagramReadOnly  = viewingBefore && !!beforeSnapshot;


  // ── Demo login ────────────────────────────────────────────────────────────
  async function handleLogin() {
    const res = await fetch('/Demo_Project.json');
    const d = await res.json();
    const junctions = d.junctions as J[];
    const now = Date.now();
    const fId = crypto.randomUUID();
    const pId = crypto.randomUUID();
    setDemoFolders([{
      id: fId,
      name: "Example",
      expanded: true,
      plans: [{
        id: pId,
        name: "Demo Project",
        data: d,
        createdAt: now,
        modifiedAt: now,
      }],
    }]);
    setInitialActivePlan({ folderId: fId, planId: pId });
    setJunctions(junctions);
    setExpandedJunctions(new Set([junctions[0].id]));
    setTravelOut(d.travelOut_s);
    setTravelIn(d.travelIn_s);
    setQueueOut(d.queueOut_s);
    setQueueIn(d.queueIn_s);
    setTimeStart(d.timeStart);
    setTimeEnd(d.timeEnd);
    setPps(d.pps);
    setPpm(d.ppm);
    setOptimization(d.optimization);
    setFolderName("Example");
    setProjectName("Demo Project");
    setWizardOpen(false);
    setHasUnsavedChanges(false);
    setIsLoggedIn(true);
    setTimeout(() => startTour(), 400);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  if (!isLoggedIn) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-neutral-950 text-neutral-100">
      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileInputChange} />

      {/* ════ TOP BAR ════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-neutral-800 flex-shrink-0 bg-neutral-900">
        {/* Left: Logo + Title */}
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-sky-600 flex items-center justify-center text-white text-xs font-bold select-none">S</div>
          <h1 className="text-base font-semibold">SASCOO Vision Tool</h1>
        </div>
        {/* Right: PRO + Tour + Folder */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setProMode(p=>!p)}
            title="Toggle Pro Mode"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border transition-all duration-200 select-none ${
              proMode
                ? "border-amber-500 bg-amber-950/40 text-amber-400"
                : "border-neutral-700 bg-neutral-800 text-neutral-500 hover:border-neutral-500"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full transition-all duration-200 flex-shrink-0 ${proMode ? "bg-amber-400" : "bg-neutral-600"}`} />
            PRO
          </button>
          <div className="h-4 w-px bg-neutral-700" />
          <button
            data-tour="tour-button"
            onClick={() => startTour()}
            title="Guided tour"
            className="p-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            onClick={() => setFolderPanelOpen(p=>!p)}
            title="Open Projects panel"
            className="p-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* ════ MAIN AREA ══════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
        <div className="w-[400px] flex-shrink-0 flex flex-col border-r border-neutral-800 bg-neutral-900">

          {/* Tab buttons */}
          <div className="flex border-b border-neutral-700 flex-shrink-0">
            <button
              onClick={() => setSidebarTab("junctions")}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                sidebarTab==="junctions"
                  ? "text-sky-400 border-b-2 border-sky-400 bg-sky-900/20"
                  : "text-neutral-400 hover:text-neutral-300"
              }`}
            >Junctions</button>
            <button
              data-tour="optimization-tab"
              onClick={() => setSidebarTab("optimization")}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                sidebarTab==="optimization"
                  ? "text-sky-400 border-b-2 border-sky-400 bg-sky-900/20"
                  : "text-neutral-400 hover:text-neutral-300"
              }`}
            >Optimization</button>
          </div>

          {/* Tab content (scrollable) */}
          <div className="flex-1 overflow-y-auto p-3" style={{scrollbarWidth:"thin",scrollbarColor:"#555 transparent"}}>

            {/* ── JUNCTIONS TAB ────────────────────────────────────────────── */}
            {sidebarTab === "junctions" && (
              <div data-tour="junctions-panel">

                {/* Before-view banner */}
                {viewingBefore && beforeSnapshot && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-950/40 border-b border-amber-800/50 text-amber-300 text-[11px]">
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m9-7V7a2 2 0 00-2-2H7a2 2 0 00-2 2v3m14 0H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2" /></svg>
                    Before state — read only
                  </div>
                )}

                {/* Junction rows */}
                {diagramJunctions.map((j, idx) => {
                  const isExpanded = expandedJunctions.has(j.id);
                  const cycle = j.phases_s.reduce((a, b) => a + b, 0);
                  const { label: typeLabel, style: typeStyle } = getJunctionTypeLabel(j);
                  return (
                    <div key={j.id} className={`border-b border-neutral-700 ${j.enabled===false ? "opacity-50" : ""}`}>
                      {/* Summary row — two-line card */}
                      <div
                        className={`cursor-pointer hover:bg-neutral-900 transition-colors ${isExpanded ? "bg-neutral-950 border-l-2 border-sky-500" : "bg-neutral-950 border-l-2 border-transparent"}`}
                        onClick={() => toggleExpanded(j.id)}
                      >
                        {/* Line 1: chevron + number + name + actions */}
                        <div className="flex items-center gap-2 px-2 pt-2 pb-1.5">
                          <div className="flex-shrink-0 w-4 flex items-center justify-center">
                            <svg className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-neutral-700 flex items-center justify-center text-[10px] font-medium">{idx+1}</span>
                          <input
                            className="font-medium text-sm flex-1 min-w-0 bg-transparent border-b border-transparent hover:border-neutral-600 focus:border-sky-500 focus:outline-none text-neutral-100 disabled:opacity-60 disabled:cursor-default"
                            value={j.name}
                            onChange={e => updateJ(j.id, { name: e.target.value })}
                            onClick={e => e.stopPropagation()}
                            disabled={viewingBefore}
                          />
                          <div className="flex items-center gap-1 flex-shrink-0" onClick={e=>e.stopPropagation()}>
                            <button
                              onClick={() => updateJ(j.id, { enabled: j.enabled===false ? true : false })}
                              className={`p-1 rounded transition-colors ${j.enabled!==false ? "text-emerald-400 hover:bg-emerald-900/30" : "text-neutral-500 hover:bg-neutral-700"}`}
                              title={j.enabled!==false ? "Disable" : "Enable"}
                            >
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                {j.enabled!==false
                                  ? <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                                  : <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>}
                              </svg>
                            </button>
                            <button
                              onClick={() => removeJ(j.id)}
                              className="p-1 rounded text-neutral-500 hover:text-red-400 transition-colors"
                              title="Delete junction"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Line 2: badges left · labeled metadata right */}
                        <div className="flex items-center justify-between px-2 py-1.5 border-t border-neutral-800 gap-2">
                          {/* Left: type + master + direction */}
                          <div className="flex items-center gap-1">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${typeStyle}`}>{typeLabel}</span>
                            <select
                              value={j.direction ?? "bidirectional"}
                              onChange={e => { if (!viewingBefore) updateJ(j.id, { direction: e.target.value as J["direction"] }); }}
                              onClick={e => e.stopPropagation()}
                              disabled={viewingBefore}
                              className="text-[9px] bg-neutral-700 border border-neutral-600 rounded px-1 py-0.5 text-neutral-300 cursor-pointer disabled:opacity-60 disabled:cursor-default"
                            >
                              <option value="bidirectional">↔ Bidir</option>
                              <option value="outbound">→ Out only</option>
                              <option value="inbound">← In only</option>
                            </select>
                            {j.id === optimization.masterJunctionId && (
                              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded font-semibold bg-amber-950/60 border border-amber-700/50 text-amber-400" title="Master Junction">
                                <span className="text-[12px] leading-none">⏱</span><span className="text-[9px]"> Master</span>
                              </span>
                            )}
                          </div>
                          {/* Right: labeled data values */}
                          <div className="flex items-center gap-2">
                            <span className="flex flex-col items-end gap-0.5" onClick={e => e.stopPropagation()}>
                              <span className="text-[9px] font-semibold text-neutral-400 uppercase tracking-wider">Pos</span>
                              <div className="flex items-center gap-0.5">
                                <input
                                  type="number"
                                  className="w-10 text-xs tabular-nums text-neutral-200 bg-transparent border-b border-transparent hover:border-neutral-600 focus:border-sky-500 focus:outline-none text-right disabled:opacity-60 disabled:cursor-default"
                                  value={j.position_m}
                                  onChange={e => { const n=Number(e.target.value); if(Number.isFinite(n)) updateJ(j.id,{position_m:Math.max(0,n)}); }}
                                  disabled={viewingBefore}
                                />
                                <span className="text-[10px] text-neutral-400">m</span>
                              </div>
                            </span>
                            <div className="flex items-center gap-3 bg-neutral-700/40 border border-neutral-600/50 rounded px-2 py-1" onClick={e => e.stopPropagation()}>
                              <span className="flex flex-col items-end gap-0.5">
                                <span className="text-[9px] font-semibold text-neutral-400 uppercase tracking-wider">Offset</span>
                                <div className="flex items-center gap-0.5">
                                  <input
                                    type="number"
                                    className="w-8 text-xs tabular-nums text-sky-400 bg-transparent border-b border-transparent hover:border-sky-700 focus:border-sky-500 focus:outline-none text-right disabled:opacity-60 disabled:cursor-default"
                                    value={j.offset_s}
                                    onChange={e => { const n=Number(e.target.value); if(Number.isFinite(n)) updateJ(j.id,{offset_s:n}); }}
                                    disabled={viewingBefore}
                                  />
                                  <span className="text-[10px] text-neutral-400">s</span>
                                </div>
                              </span>
                              <span className="flex flex-col items-end gap-0.5">
                                <span className="text-[9px] font-semibold text-neutral-400 uppercase tracking-wider">Cycle</span>
                                <div className="flex items-center gap-0.5">
                                  <span className="text-xs tabular-nums text-neutral-200">{cycle}s</span>
                                  <button
                                    onClick={() => { if (!viewingBefore) updateJ(j.id, { cycleLocked: !j.cycleLocked, lockedPhases: [] }); }}
                                    disabled={viewingBefore}
                                    title={j.cycleLocked ? "Cycle locked — click to unlock" : "Cycle unlocked — click to lock"}
                                    className={`ml-1 p-1 rounded transition-colors disabled:opacity-40 ${j.cycleLocked ? "text-amber-300 bg-amber-700/50 border border-amber-500/60 hover:bg-amber-700/70" : "text-neutral-500 hover:text-neutral-300"}`}
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                    </svg>
                                  </button>
                                </div>
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Collapsed: phase strip */}
                      {!isExpanded && <CollapsedPhaseStrip j={j} />}

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="bg-neutral-900 border-t border-neutral-800">
                          <div className="ml-2 border-l-2 border-sky-500/50 px-3 py-2 space-y-3">
                          {/* Phase Matrix */}
                          <PhaseMatrixV2
                            j={j}
                            onUpdate={patch => { if (!viewingBefore) updateJ(j.id, patch); }}
                            onAddPhase={() => {
                              if (viewingBefore) return;
                              const next = [...j.phases_s, 10];
                              updateJ(j.id, { phases_s: next, phaseNames: ensurePhaseNames(j, next.length) });
                            }}
                            onAddOvl={() => {
                              if (viewingBefore) return;
                              if (j.phases_s.length < 2) return; // need at least 2 phases to sandwich OVL
                              // Insert OVL at position 1 (between first and second phase)
                              const insertAt = 1;
                              const nextPhases = [...j.phases_s];
                              nextPhases.splice(insertAt, 0, 10);
                              const baseNames = ensurePhaseNames(j, j.phases_s.length);
                              const nextNames = [...baseNames];
                              nextNames.splice(insertAt, 0, "OVL");
                              // Shift all indices >= insertAt up by 1
                              const shift = (idx: number) => idx >= insertAt ? idx + 1 : idx;
                              const nextOvl = [...(j.ovlPhaseIndices ?? []).map(shift), insertAt];
                              updateJ(j.id, {
                                phases_s: nextPhases,
                                phaseNames: nextNames,
                                outboundIdx: [...j.outboundIdx.map(shift), insertAt],
                                inboundIdx:  [...j.inboundIdx.map(shift),  insertAt],
                                ovlPhaseIndices: nextOvl,
                              });
                            }}
                            onRemovePhase={() => {
                              if (viewingBefore) return;
                              if (j.phases_s.length > 1) {
                                const removedIdx = j.phases_s.length - 1;
                                const next = j.phases_s.slice(0, -1);
                                updateJ(j.id, {
                                  phases_s: next,
                                  phaseNames: ensurePhaseNames(j, next.length),
                                  inboundIdx:  j.inboundIdx.filter(i => i < next.length),
                                  outboundIdx: j.outboundIdx.filter(i => i < next.length),
                                  ovlPhaseIndices: (j.ovlPhaseIndices ?? []).filter(i => i !== removedIdx),
                                });
                              }
                            }}
                          />

                          <div className="border-t border-neutral-800" />

                          {/* Queue Clearance */}
                          <div className="space-y-1.5">
                            <span className="text-[11px] text-neutral-400">
                              Queue Clearance Time{" "}
                              <span className="text-neutral-500 font-normal">(Vehicle Arriving from Side Road)</span>
                            </span>
                            {(j.direction ?? "bidirectional") !== "inbound" && (
                            <div className="flex items-center gap-2">
                              <span className="flex items-center gap-1.5 w-16 flex-shrink-0">
                                <span className="inline-block w-[14px] h-[2px] rounded-sm bg-sky-500 flex-shrink-0" />
                                <span className="text-[10px] text-neutral-400">Outbound</span>
                              </span>
                              <input
                                type="number" min={0}
                                className="flex-1 border rounded px-2 py-[3px] text-xs text-right bg-neutral-800 border-neutral-700 focus:border-sky-500 focus:outline-none text-neutral-100"
                                value={diagramQueueOut[idx] ?? 0}
                                onChange={e => setQueueTime(idx,"out",Number(e.target.value)||0)}
                                disabled={viewingBefore}
                              />
                              <span className="text-[10px] text-neutral-500">s</span>
                            </div>
                            )}
                            {(j.direction ?? "bidirectional") !== "outbound" && (
                            <div className="flex items-center gap-2">
                              <span className="flex items-center gap-1.5 w-16 flex-shrink-0">
                                <span className="inline-block w-[14px] h-[2px] rounded-sm bg-emerald-500 flex-shrink-0" />
                                <span className="text-[10px] text-neutral-400">Inbound</span>
                              </span>
                              <input
                                type="number" min={0}
                                className="flex-1 border rounded px-2 py-[3px] text-xs text-right bg-neutral-800 border-neutral-700 focus:border-sky-500 focus:outline-none text-neutral-100"
                                value={diagramQueueIn[idx] ?? 0}
                                onChange={e => setQueueTime(idx,"in",Number(e.target.value)||0)}
                                disabled={viewingBefore}
                              />
                              <span className="text-[10px] text-neutral-500">s</span>
                            </div>
                            )}
                          </div>

                          {/* PRO: Link Overrides (not last junction) */}
                          {proMode && idx < diagramJunctions.length - 1 && (
                            <>
                              <div className="border-t border-amber-900/30" />
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <span className="text-[11px] text-amber-400/80 font-medium">Link Overrides</span>
                                <span className="px-1 py-px rounded text-[9px] bg-amber-950/60 border border-amber-800/50 text-amber-500/80 font-bold tracking-wide">PRO</span>
                                <span className="text-[10px] text-neutral-500 ml-1">{j.name} → {diagramJunctions[idx+1]?.name}</span>
                              </div>
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1.5 text-[11px]">
                                  <span className="text-neutral-400 w-16 flex-shrink-0">Spd range</span>
                                  <input type="number" placeholder="60"
                                    className="w-10 px-1 py-[2px] text-[10px] text-right rounded bg-neutral-800 border border-amber-900/60 text-neutral-300 focus:outline-none focus:border-amber-500 placeholder-neutral-600"
                                    value={j.proLinkSpeedMin_kmh ?? ""}
                                    onChange={e => { const v = e.target.value === "" ? null : Number(e.target.value); updateJ(j.id, { proLinkSpeedMin_kmh: v }); }}
                                  />
                                  <span className="text-neutral-400 text-[10px]">–</span>
                                  <input type="number" placeholder="90"
                                    className="w-10 px-1 py-[2px] text-[10px] text-right rounded bg-neutral-800 border border-amber-900/60 text-neutral-300 focus:outline-none focus:border-amber-500 placeholder-neutral-600"
                                    value={j.proLinkSpeedMax_kmh ?? ""}
                                    onChange={e => { const v = e.target.value === "" ? null : Number(e.target.value); updateJ(j.id, { proLinkSpeedMax_kmh: v }); }}
                                  />
                                  <span className="text-[10px] text-neutral-500">km/h</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px]">
                                  <span className="text-neutral-400 w-16 flex-shrink-0">Δ Speed</span>
                                  <input type="number" placeholder="-20"
                                    className="w-10 px-1 py-[2px] text-[10px] text-right rounded bg-neutral-800 border border-amber-900/60 text-neutral-300 focus:outline-none focus:border-amber-500 placeholder-neutral-600"
                                    value={j.proLinkDeltaSpeedMin_kmh ?? ""}
                                    onChange={e => { const v = e.target.value === "" ? null : Number(e.target.value); updateJ(j.id, { proLinkDeltaSpeedMin_kmh: v }); }}
                                  />
                                  <span className="text-neutral-400 text-[10px]">–</span>
                                  <input type="number" placeholder="20"
                                    className="w-10 px-1 py-[2px] text-[10px] text-right rounded bg-neutral-800 border border-amber-900/60 text-neutral-300 focus:outline-none focus:border-amber-500 placeholder-neutral-600"
                                    value={j.proLinkDeltaSpeedMax_kmh ?? ""}
                                    onChange={e => { const v = e.target.value === "" ? null : Number(e.target.value); updateJ(j.id, { proLinkDeltaSpeedMax_kmh: v }); }}
                                  />
                                  <span className="text-[10px] text-neutral-500">km/h</span>
                                </div>
                                <p className="text-[10px] text-neutral-500">Blank = use global default</p>
                              </div>
                            </>
                          )}
                          {/* PRO: Junction Overrides (amber/red) */}
                          {proMode && (
                            <>
                              <div className="border-t border-amber-900/30" />
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <span className="text-[11px] text-amber-400/80 font-medium">Junction Overrides</span>
                                <span className="px-1 py-px rounded text-[9px] bg-amber-950/60 border border-amber-800/50 text-amber-500/80 font-bold tracking-wide">PRO</span>
                              </div>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-neutral-400 w-16 flex-shrink-0">Amber</span>
                                  <div className="flex items-center gap-1 flex-1">
                                    <input type="number" placeholder="—"
                                      className="flex-1 border rounded px-2 py-[3px] text-xs text-right bg-neutral-800/60 border-amber-900/50 text-neutral-300 focus:border-amber-500 focus:outline-none placeholder-neutral-600"
                                      value={j.proAmber_s ?? ""}
                                      onChange={e => { const v = e.target.value === "" ? null : Number(e.target.value); updateJ(j.id, { proAmber_s: v }); }}
                                    />
                                    <span className="text-[10px] text-neutral-500 w-4">s</span>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-neutral-400 w-16 flex-shrink-0">Red</span>
                                  <div className="flex items-center gap-1 flex-1">
                                    <input type="number" placeholder="—"
                                      className="flex-1 border rounded px-2 py-[3px] text-xs text-right bg-neutral-800/60 border-amber-900/50 text-neutral-300 focus:border-amber-500 focus:outline-none placeholder-neutral-600"
                                      value={j.proRed_s ?? ""}
                                      onChange={e => { const v = e.target.value === "" ? null : Number(e.target.value); updateJ(j.id, { proRed_s: v }); }}
                                    />
                                    <span className="text-[10px] text-neutral-500 w-4">s</span>
                                  </div>
                                </div>
                                <p className="text-[10px] text-neutral-500">Blank = use global default</p>
                              </div>
                            </>
                          )}

                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Add junction button */}
                <div className="flex justify-end px-2 pt-2 pb-1">
                  <button
                    onClick={() => setAddModalOpen(true)}
                    className="px-2.5 py-1 rounded-lg bg-white text-black text-xs font-medium hover:bg-neutral-200 transition-colors"
                  >+ Add Junction</button>
                </div>
              </div>
            )}

            {/* ── OPTIMIZATION TAB ─────────────────────────────────────────── */}
            {sidebarTab === "optimization" && (
              <div>
                {proMode && (
                  <div className="mb-3 flex items-start gap-2 px-2.5 py-2 rounded-lg bg-amber-950/30 border border-amber-800/40 text-[10px] text-amber-300/80 leading-relaxed">
                    <svg className="w-3 h-3 text-amber-400/70 flex-shrink-0 mt-px" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/></svg>
                    <span><strong className="text-amber-300">Pro Mode active.</strong> Values below are global defaults. Override per-junction or per-link in the Junctions panel.</span>
                  </div>
                )}
                <h2 className="font-medium text-sm mb-3">Optimization Settings</h2>
                <OptimizationSettingsPanel
                  settings={optimization}
                  onChange={patch => setOptimization(prev => ({...prev,...patch}))}
                  junctions={junctions.map(j => ({id:j.id, name:j.name, phases_s:j.phases_s}))}
                />
                {optimizedCycle !== null && (
                  <div className="mt-3 p-2 rounded bg-emerald-950/30 border border-emerald-700/50 text-xs text-emerald-300">
                    <span className="font-medium">Optimized Cycle:</span> {optimizedCycle}s
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom: View Report (post-optimization) + Run */}
          <div className="flex-shrink-0 p-3 border-t border-neutral-800 flex gap-2">
            {beforeSnapshot && (
              <button
                onClick={() => setReportOpen(true)}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-medium text-white bg-sky-700 hover:bg-sky-600 transition-colors flex items-center justify-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                View Report
              </button>
            )}
            <button
              data-tour="run-optimization-button"
              onClick={handleOptimize}
              disabled={isOptimizing}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold text-white transition-colors flex items-center justify-center gap-1.5 ${
                isOptimizing ? "bg-neutral-600 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {isOptimizing ? (
                <>
                  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Running...
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/>
                  </svg>
                  Run
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── RIGHT: DIAGRAM AREA ──────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 pl-2">

          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 flex-shrink-0 bg-neutral-900/50">

            {/* Left: breadcrumb */}
            <div className="flex items-center gap-2 text-[11px] min-w-0">
              <svg className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
              <span className="text-neutral-500 truncate">{folderName ?? "Corridor"}</span>
              <span className="text-neutral-700 flex-shrink-0">/</span>
              <span className="text-neutral-300 font-medium truncate">
                {projectName ?? "Untitled"}
              </span>
              {hasUnsavedChanges ? (
                <span className="flex-shrink-0 flex items-center gap-1 ml-1 text-amber-500/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                  Unsaved
                </span>
              ) : (
                <span className="flex-shrink-0 flex items-center gap-1 ml-1 text-emerald-500/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  Saved
                </span>
              )}
            </div>

            {/* Right: controls */}
            <div className="flex items-center gap-3 flex-shrink-0">

              {/* View Settings popover */}
              <div className="relative" ref={viewSettingsBtnRef}>
                <button
                  onClick={() => setViewSettingsOpen(p=>!p)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                    viewSettingsOpen
                      ? "bg-neutral-700 border-neutral-600 text-neutral-200"
                      : "bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700 hover:border-neutral-600"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                  View
                </button>
                {viewSettingsOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl p-3 z-30">
                    <p className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider mb-2.5">View Settings</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                      <div>
                        <label className="block text-[10px] text-neutral-400 mb-1">t₀ (s)</label>
                        <input type="number" className="w-full border rounded px-2 py-1 text-xs bg-neutral-900 border-neutral-700 text-neutral-100 focus:border-sky-600 focus:outline-none"
                          value={timeStart} onChange={e => { const n=Number(e.target.value); if(Number.isFinite(n)) setTimeStart(n); }} />
                      </div>
                      <div>
                        <label className="block text-[10px] text-neutral-400 mb-1">t₁ (s)</label>
                        <input type="number" className="w-full border rounded px-2 py-1 text-xs bg-neutral-900 border-neutral-700 text-neutral-100 focus:border-sky-600 focus:outline-none"
                          value={timeEnd} onChange={e => { const n=Number(e.target.value); if(Number.isFinite(n)) setTimeEnd(Math.max(timeStart+1,n)); }} />
                      </div>
                      <div>
                        <label className="block text-[10px] text-neutral-400 mb-1">Cycles</label>
                        <input type="number" min={1} max={20} className="w-full border rounded px-2 py-1 text-xs bg-neutral-900 border-neutral-700 text-neutral-100 focus:border-sky-600 focus:outline-none"
                          value={getCycleCount()} onChange={e => setCycleCount(parseInt(e.target.value)||2)} />
                      </div>
                      <div>
                        <label className="block text-[10px] text-neutral-400 mb-1">px / s</label>
                        <input type="number" step={0.1} className="w-full border rounded px-2 py-1 text-xs bg-neutral-900 border-neutral-700 text-neutral-100 focus:border-sky-600 focus:outline-none"
                          value={pixelsPerSecond} onChange={e => { const n=Number(e.target.value); if(Number.isFinite(n)) setPps(clamp(n,0.5,20)); }} />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[10px] text-neutral-400 mb-1">px / m</label>
                        <input type="number" step={0.01} className="w-full border rounded px-2 py-1 text-xs bg-neutral-900 border-neutral-700 text-neutral-100 focus:border-sky-600 focus:outline-none"
                          value={pixelsPerMeter} onChange={e => { const n=Number(e.target.value); if(Number.isFinite(n)) setPpm(clamp(n,0.01,2)); }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="h-5 w-px bg-neutral-700" />

              {/* Before / After toggle */}
              {beforeSnapshot && (
                <div className="flex items-center rounded-lg border border-neutral-700 bg-neutral-800 overflow-hidden text-xs select-none">
                  <button
                    onClick={() => setViewingBefore(true)}
                    className={`px-2.5 py-1 font-medium transition-all duration-150 border-r border-neutral-700 ${
                      viewingBefore ? "bg-amber-900/40 text-amber-200" : "text-neutral-400 hover:text-neutral-300"
                    }`}
                  >Before</button>
                  <button
                    onClick={() => setViewingBefore(false)}
                    className={`px-2.5 py-1 font-medium transition-all duration-150 ${
                      !viewingBefore ? "bg-emerald-900/40 text-emerald-200" : "text-neutral-400 hover:text-neutral-300"
                    }`}
                  >After</button>
                </div>
              )}

              {beforeSnapshot && <div className="h-5 w-px bg-neutral-700" />}

              {/* Trajectory pill */}
              <button
                data-tour="trajectory-button"
                onClick={() => !diagramReadOnly && setTrajectoryEnabled(p=>!p)}
                className={`flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs transition-all select-none ${
                  trajectoryEnabled && !diagramReadOnly
                    ? "border-sky-500 bg-sky-900/30 text-sky-300"
                    : "border-neutral-700 bg-neutral-800 text-neutral-400 hover:border-neutral-600"
                } ${diagramReadOnly ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <span className="relative flex-shrink-0" style={{width:26,height:14}}>
                  <span className={`absolute inset-0 rounded-full transition-colors duration-200 ${trajectoryEnabled && !diagramReadOnly ? "bg-sky-500" : "bg-neutral-700"}`} />
                  <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all duration-200 ${trajectoryEnabled && !diagramReadOnly ? "left-[13px] bg-white" : "left-0.5 bg-neutral-500"}`} />
                </span>
                Trajectory
              </button>

              {/* Queue Traj pill + dropdown */}
              <div className="relative" ref={queueTrajBtnRef}>
                <button
                  data-tour="queue-trajectory-button"
                  onClick={() => {
                    if (diagramReadOnly) return;
                    if (!queueTrajectoriesEnabled) {
                      setQueueTrajectoriesEnabled(true);
                      setQueueTrajPanelOpen(true);
                    } else {
                      setQueueTrajPanelOpen(p => !p);
                    }
                  }}
                  className={`flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs transition-all select-none ${
                    queueTrajectoriesEnabled && !diagramReadOnly
                      ? "border-orange-500 bg-orange-900/30 text-orange-300"
                      : "border-neutral-700 bg-neutral-800 text-neutral-400 hover:border-neutral-600"
                  } ${diagramReadOnly ? "opacity-40 cursor-not-allowed" : ""}`}
                  title="Toggle queue trajectories"
                >
                  <span
                    className="relative flex-shrink-0"
                    style={{width:26,height:14}}
                    onClick={e => {
                      if (diagramReadOnly) return;
                      e.stopPropagation();
                      const next = !queueTrajectoriesEnabled;
                      setQueueTrajectoriesEnabled(next);
                      if (next) setQueueTrajPanelOpen(true);
                      else setQueueTrajPanelOpen(false);
                    }}
                  >
                    <span className={`absolute inset-0 rounded-full transition-colors duration-200 ${queueTrajectoriesEnabled && !diagramReadOnly ? "bg-orange-500" : "bg-neutral-700"}`} />
                    <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all duration-200 ${queueTrajectoriesEnabled && !diagramReadOnly ? "left-[13px] bg-white" : "left-0.5 bg-neutral-500"}`} />
                  </span>
                  Queue Traj
                  <span className="text-neutral-500 ml-0.5">{queueTrajPanelOpen ? "▴" : "▾"}</span>
                </button>

                {/* Queue Traj dropdown */}
                {queueTrajPanelOpen && !diagramReadOnly && (
                  <div className="absolute top-full mt-3 right-0 z-50 w-52 bg-neutral-900 border border-neutral-700/80 rounded-xl shadow-2xl overflow-hidden">
                    {/* Caret */}
                    <div className="absolute -top-[7px] right-5 w-3 h-3 bg-neutral-900 border-l border-t border-neutral-700/80 rotate-45 rounded-sm" />
                    {/* Direction */}
                    <div className="px-3 pt-3 pb-2 border-b border-neutral-800">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-neutral-500 mb-2">Direction</p>
                      <div className="flex rounded-lg border border-neutral-700 overflow-hidden text-[10px]">
                        {(["both","outbound","inbound"] as const).map(d => (
                          <button
                            key={d}
                            onClick={() => setQueueTrajDirection(d)}
                            className={`flex-1 py-1 font-medium transition-colors border-r border-neutral-700 last:border-r-0 ${
                              queueTrajDirection===d ? "bg-orange-600/30 text-orange-300" : "text-neutral-400 hover:text-neutral-200"
                            }`}
                          >
                            {d === "outbound" ? (
                              <span className="flex flex-col items-center gap-0.5">
                                <span>Outbound</span>
                                <span className="inline-block w-[18px] h-[2px] rounded-sm bg-sky-500" />
                              </span>
                            ) : d === "inbound" ? (
                              <span className="flex flex-col items-center gap-0.5">
                                <span>Inbound</span>
                                <span className="inline-block w-[18px] h-[2px] rounded-sm bg-emerald-500" />
                              </span>
                            ) : "Both"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Discharge width toggle */}
                    <div className="px-3 pt-2.5 pb-2 border-b border-neutral-800">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-neutral-300">Discharge Width</span>
                        <button
                          onClick={() => setShowDischargeWidth(v => !v)}
                          className="relative w-8 h-4 rounded-full focus:outline-none"
                        >
                          <span className={`absolute inset-0 rounded-full transition-colors duration-200 ${showDischargeWidth ? "bg-orange-500" : "bg-neutral-700"}`} />
                          <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-all duration-200 ${showDischargeWidth ? "left-[17px] bg-white" : "left-0.5 bg-neutral-500"}`} />
                        </button>
                      </div>
                    </div>
                    {/* Queue clearance time per junction */}
                    <div className="px-3 pt-2.5 pb-3">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-neutral-500 mb-2">Queue Clearance Time</p>
                      <div className="space-y-1.5">
                        {junctions.filter(j=>j.enabled!==false).map((j,i) => (
                          <div key={j.id} className="text-[10px]">
                            <div className="font-medium text-neutral-400 mb-0.5">{j.name}</div>
                            <div className="flex gap-2">
                              <div className="flex items-center gap-1 flex-1">
                                <span className="text-blue-400 w-3">↓</span>
                                <input
                                  type="number" min={0}
                                  className="flex-1 w-12 px-1.5 py-0.5 rounded border border-neutral-700 bg-neutral-800 text-right text-[10px] focus:outline-none focus:border-orange-500"
                                  value={queueOut_s[i] ?? 0}
                                  onChange={e => setQueueTime(i,"out",Number(e.target.value)||0)}
                                />
                                <span className="text-neutral-500">s</span>
                              </div>
                              <div className="flex items-center gap-1 flex-1">
                                <span className="text-emerald-400 w-3">↑</span>
                                <input
                                  type="number" min={0}
                                  className="flex-1 w-12 px-1.5 py-0.5 rounded border border-neutral-700 bg-neutral-800 text-right text-[10px] focus:outline-none focus:border-orange-500"
                                  value={queueIn_s[i] ?? 0}
                                  onChange={e => setQueueTime(i,"in",Number(e.target.value)||0)}
                                />
                                <span className="text-neutral-500">s</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* Diagram area */}
          <div ref={diagramContainerRef} data-tour="diagram-container" className="flex-1 min-h-0 overflow-hidden bg-neutral-800 p-2">
            <TimeSpaceDiagram
              key={diagramJunctions.map(j=>j.position_m).join("|")}
              junctions={diagramJunctions}
              travelOut_s={diagramTravelOut}
              travelIn_s={diagramTravelIn}
              timeStart={timeStart}
              timeEnd={timeEnd}
              pixelsPerSecond={pixelsPerSecond}
              pixelsPerMeter={pixelsPerMeter}
              trajectoryEnabled={trajectoryEnabled && !diagramReadOnly}
              queueTrajectoriesEnabled={queueTrajectoriesEnabled && !diagramReadOnly}
              queueTrajDirection={queueTrajDirection}
              showDischargeWidth={showDischargeWidth}
              queueOut_s={queueOut_s}
              queueIn_s={queueIn_s}
              queueVehiclesIn={queueVehiclesIn}
              queueVehiclesOut={queueVehiclesOut}
              saturationHeadway_s={saturationHeadway_s}
              defaultAmber_s={optimization.defaultAmber_s}
              defaultRed_s={optimization.defaultRed_s}
              masterJunctionId={optimization.masterJunctionId}
              readOnly={diagramReadOnly}
              highlightBand={tourHighlightBand}
              onOffsetChange={(id, newOffset) => updateJ(id, { offset_s: newOffset })}
              onPhaseChange={(id, phaseIdx, newLen) => {
                const j = junctions.find(jj => jj.id === id);
                if (!j) return;
                updateJ(id, { phases_s: redistributeWithCycleLock(j, phaseIdx, newLen) });
              }}
              onPhaseLockToggle={(junctionId, phaseIdx) => {
                const j = junctions.find(jj => jj.id === junctionId);
                if (!j || !j.cycleLocked) return;
                const locked = j.lockedPhases ?? [];
                const next = locked.includes(phaseIdx) ? locked.filter(i=>i!==phaseIdx) : [...locked, phaseIdx];
                updateJ(junctionId, { lockedPhases: next });
              }}
              hideScrollHint={false}
              optimizedCycle={optimizedCycle}
              onTravelTimeChange={(segIdx, newOut, newIn) => {
                if (newOut !== null) setTravelOut(prev => { const n = [...prev]; n[segIdx] = newOut; return n; });
                if (newIn  !== null) setTravelIn( prev => { const n = [...prev]; n[segIdx] = newIn;  return n; });
              }}
            />
          </div>

        </div>
      </div>


      {/* ════ FOLDER PANEL ════════════════════════════════════════════════════ */}
      <FolderPanel
        isOpen={folderPanelOpen}
        onToggle={() => setFolderPanelOpen(p=>!p)}
        currentData={buildExportData()}
        onLoadPlan={handleLoadPlan}
        onSaveSuccess={handleSaveSuccess}
        onPlanOpen={(fName, pName) => { setFolderName(fName); setProjectName(pName); }}
        onNewPlan={(folderId) => { setWizardTargetFolderId(folderId); setWizardPlanName(""); setWizardStep(1); setWizardOpen(true); }}
        onRegisterAddPlan={(fn) => { addPlanToFolderRef.current = fn; }}
        hasUnsavedChanges={hasUnsavedChanges}
        hideToggleButton
        initialFolders={demoFolders}
        initialActivePlan={initialActivePlan}
      />

      {/* ════ OPTIMIZATION REPORT MODAL ═══════════════════════════════════════ */}
      {reportOpen && comparisonReport && beforeSnapshot && (
        <OptimizationReport
          report={comparisonReport}
          beforeSnapshot={{ junctions: beforeSnapshot.junctions, travelOut_s: beforeSnapshot.travelOut_s, travelIn_s: beforeSnapshot.travelIn_s }}
          afterSnapshot={{ junctions, travelOut_s, travelIn_s }}
          diagramSettings={{ timeStart, timeEnd, pixelsPerSecond, pixelsPerMeter, defaultAmber_s: optimization.defaultAmber_s, defaultRed_s: optimization.defaultRed_s }}
          onClose={() => setReportOpen(false)}
        />
      )}

      {/* ════ SUCCESS TOAST ════════════════════════════════════════════════════ */}
      {(optimizationSuccess || saveSuccess) && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm">
          {optimizationSuccess && (
            <div className="p-3 rounded-lg bg-emerald-900/60 border border-emerald-600/50 shadow-lg">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <p className="text-sm text-emerald-200 flex-1">{optimizationSuccess}</p>
                <button onClick={() => setOptimizationSuccess(null)} className="text-emerald-500 hover:text-emerald-300">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
            </div>
          )}
          {saveSuccess && (
            <div className="p-3 rounded-lg bg-sky-900/60 border border-sky-600/50 shadow-lg">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-sky-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                <p className="text-sm text-sky-200 flex-1">{saveSuccess}</p>
                <button onClick={() => setSaveSuccess(null)} className="text-sky-500 hover:text-sky-300">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════ ERROR MODAL ══════════════════════════════════════════════════════ */}
      {optimizationError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 rounded-xl shadow-2xl border border-red-800/50 max-w-md w-full mx-4 overflow-hidden">
            <div className="h-1 bg-red-500" />
            <div className="p-6">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-red-900/40 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-neutral-100">Optimization Failed</h3>
                  <p className="mt-2 text-sm text-neutral-400 leading-relaxed">{optimizationError}</p>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button onClick={() => setOptimizationError(null)} className="px-4 py-2 text-sm font-medium rounded-lg bg-red-700 hover:bg-red-600 text-white transition-colors">Dismiss</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════ SETUP WIZARD MODAL ═══════════════════════════════════════════════ */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-700 w-full max-w-xl mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-700">
              <div>
                <h2 className="font-semibold text-base">Set up your corridor</h2>
                <p className="text-[11px] text-neutral-400 mt-0.5">
                  {wizardStep === 1 ? `Step 1 of 2 — ${wizardTargetFolderId ? "Name & junction count" : "How many junctions?"}` : "Step 2 of 2 — Select junction types"}
                </p>
              </div>
              <button onClick={() => setWizardOpen(false)} className="p-1.5 rounded-lg hover:bg-neutral-800 transition-colors text-neutral-400 hover:text-neutral-200">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Step 1 */}
            {wizardStep === 1 && (
              <div className="px-5 py-7 space-y-6">
                {wizardTargetFolderId && (
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1.5">Plan name</label>
                    <input
                      type="text"
                      value={wizardPlanName}
                      onChange={e => setWizardPlanName(e.target.value)}
                      placeholder="e.g. Morning Peak, Scenario A…"
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 transition"
                      autoFocus
                    />
                  </div>
                )}
                <div>
                  <p className="text-sm text-neutral-300 mb-4">How many junctions are in your corridor?</p>
                  <div className="flex items-center gap-4">
                    <button onClick={() => handleWizardCount(-1)} className="w-10 h-10 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 text-2xl font-light flex items-center justify-center transition-colors select-none">−</button>
                    <span className="text-3xl font-bold w-12 text-center tabular-nums">{wizardCount}</span>
                    <button onClick={() => handleWizardCount(1)} className="w-10 h-10 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 text-2xl font-light flex items-center justify-center transition-colors select-none">+</button>
                    <span className="text-sm text-neutral-400">junctions</span>
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-4">You can always add or remove junctions later.</p>
                </div>
              </div>
            )}

            {/* Step 2 */}
            {wizardStep === 2 && (
              <div className="px-5 py-4">
                <p className="text-xs text-neutral-400 mb-3">Select the type for each junction:</p>
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1" style={{scrollbarWidth:"thin",scrollbarColor:"#555 transparent"}}>
                  {Array.from({length: wizardCount}, (_, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-xs text-neutral-400 w-6 text-right flex-shrink-0 mt-4">J{i+1}</span>
                      <div className="grid grid-cols-3 gap-2 flex-1">
                        {([
                          { t: "cross"    as JunctionPreset, label: "Cross",      sub: "4 phases",  img: "/cross-junction.svg" },
                          { t: "tjunc"    as JunctionPreset, label: "T-Junction", sub: "3 + 1 OVL", img: "/t-junction.svg"     },
                          { t: "crossovl" as JunctionPreset, label: "Cross+OVL",  sub: "4 + 1 OVL", img: "/cross-junction.svg" },
                        ]).map(({ t, label, sub, img }) => {
                          const selected = wizardTypes[i] === t;
                          return (
                            <button
                              key={t}
                              onClick={() => setWizardTypes(prev => { const n=[...prev]; n[i]=t; return n; })}
                              className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all text-center ${
                                selected
                                  ? "border-sky-500 bg-sky-950/30"
                                  : "border-neutral-700 bg-neutral-800 hover:border-neutral-500"
                              }`}
                            >
                              <div className="w-full h-12 rounded-lg bg-white flex items-center justify-center overflow-hidden">
                                <img src={img} alt={label} className="h-full w-full object-contain p-1" />
                              </div>
                              <span className={`text-xs font-medium leading-tight ${selected ? "text-sky-300" : "text-neutral-300"}`}>{label}</span>
                              <span className={`text-[9px] leading-tight ${selected ? "text-sky-400/70" : "text-neutral-500"}`}>{sub}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="px-5 py-4 border-t border-neutral-700 flex items-center justify-between">
              <button onClick={() => setWizardOpen(false)} className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors">
                Skip — set up manually
              </button>
              <div className="flex items-center gap-2">
                {wizardStep === 2 && (
                  <button onClick={() => setWizardStep(1)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 transition-colors">← Back</button>
                )}
                {wizardStep === 1
                  ? <button onClick={() => setWizardStep(2)} className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors">Continue →</button>
                  : <button onClick={completeWizard} className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">Create Corridor</button>
                }
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════ ADD JUNCTION TYPE MODAL ══════════════════════════════════════════ */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-700 w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-700">
              <h2 className="font-semibold text-sm">Add Junction</h2>
              <button onClick={() => setAddModalOpen(false)} className="p-1.5 rounded-lg hover:bg-neutral-800 transition-colors text-neutral-400 hover:text-neutral-200">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-5 py-5">
              <p className="text-xs text-neutral-400 mb-4">What type of junction are you adding?</p>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { type: "cross"    as JunctionPreset, label: "Cross",      sub: "4 phases",    img: "/cross-junction.svg" },
                  { type: "tjunc"    as JunctionPreset, label: "T-Junction", sub: "3 + 1 OVL",   img: "/t-junction.svg"     },
                  { type: "crossovl" as JunctionPreset, label: "Cross+OVL",  sub: "4 + 1 OVL",   img: "/cross-junction.svg" },
                ]).map(({type, label, sub, img}) => (
                  <button
                    key={type}
                    onClick={() => addJByType(type)}
                    className="flex flex-col items-center gap-2 p-3 rounded-xl border border-neutral-700 bg-neutral-800 hover:border-sky-500 hover:bg-sky-950/20 transition-all text-center group"
                  >
                    <div className="w-full h-14 rounded-lg bg-white flex items-center justify-center overflow-hidden">
                      <img src={img} alt={label} className="h-full w-full object-contain p-1" />
                    </div>
                    <span className="text-xs font-medium text-neutral-300 group-hover:text-sky-300">{label}</span>
                    <span className="text-[9px] text-neutral-500">{sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════ EXPORT MODAL ═════════════════════════════════════════════════════ */}
      {exportModalOpen && (() => {
        const activeJ = junctions.filter(j => j.enabled !== false);
        const cycles = activeJ.map(j => j.phases_s.reduce((a,b)=>a+b,0));
        const lostTimes = activeJ.map(j => j.lost_s);
        const offsets = activeJ.map(j => j.offset_s);
        const phasesStr = activeJ.map(j => `${j.name}=[${j.phases_s.join(",")}]`).join(" ");
        const greenRatios = activeJ[0]
          ? activeJ[0].phases_s.map(p => (p / cycles[0]).toFixed(3))
          : [];
        const rows = [
          { label: "Cycle lengths", value: `[${cycles.join(", ")}]` },
          { label: "Lost times",    value: `[${lostTimes.join(", ")}]` },
          { label: "Green ratios",  value: `[${greenRatios.join(", ")}]` },
          { label: "Phases",        value: phasesStr },
          { label: "Offsets",       value: `[${offsets.join(", ")}]` },
        ];
        const copyAll = () => navigator.clipboard.writeText(rows.map(r=>`${r.label}: ${r.value}`).join("\n")).catch(()=>{});
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-neutral-800 rounded-xl shadow-2xl border border-neutral-700 max-w-2xl w-full mx-4 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700">
                <h3 className="font-medium text-sm">Export / Copy</h3>
                <button onClick={() => setExportModalOpen(false)} className="p-1 rounded hover:bg-neutral-700 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="px-4 py-2 border-b border-neutral-700/50 flex items-center justify-between">
                <span className="text-[10px] text-neutral-500">{rows.length} values</span>
                <button onClick={copyAll} className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  Copy All
                </button>
              </div>
              <div className="p-4 space-y-2">
                {rows.map(row => (
                  <div key={row.label} className="flex items-center justify-between bg-neutral-900 rounded p-2 gap-3">
                    <code className="text-xs text-neutral-300 font-mono flex-1 truncate">{row.label}: {row.value}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(row.value).catch(()=>{})}
                      className="px-2 py-1 text-[10px] rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 flex-shrink-0"
                    >Copy</button>
                  </div>
                ))}
              </div>
              <div className="px-4 pb-4">
                <button
                  onClick={() => { exportJSON(); setExportModalOpen(false); }}
                  className="w-full py-2 rounded-lg text-xs font-medium bg-neutral-700 border border-neutral-600 hover:bg-neutral-600 text-neutral-200 transition-colors flex items-center justify-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Download JSON
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
