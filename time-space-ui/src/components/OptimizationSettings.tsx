import React from "react";
import type { OptimizationSettings } from "../utils/junctionHelpers";

export default function OptimizationSettingsPanel({
  settings,
  onChange,
  junctions,
}: {
  settings: OptimizationSettings;
  onChange: (patch: Partial<OptimizationSettings>) => void;
  junctions: Array<{ id: string; name: string; phases_s: number[] }>;
}) {
  const autoFillCycleRange = () => {
    const cycleTimes = junctions.map(j => j.phases_s.reduce((a, b) => a + b, 0)).filter(c => c > 0);
    if (cycleTimes.length === 0) return;
    const minCycle = Math.min(...cycleTimes);
    const maxCycle = Math.max(...cycleTimes);
    onChange({
      cycleRange: [Math.floor(minCycle * 0.8), Math.ceil(maxCycle * 1.2)],
    });
  };
  const handleNumberInput = (
    e: React.ChangeEvent<HTMLInputElement>,
    field: keyof OptimizationSettings,
    sanitize?: (n: number) => number
  ) => {
    const raw = e.target.value;
    if (raw === "") {
      onChange({ [field]: 0 } as Partial<OptimizationSettings>);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clean = sanitize ? sanitize(n) : n;
    onChange({ [field]: clean } as Partial<OptimizationSettings>);
    e.target.value = String(clean);
  };

  const handleRangeInput = (
    e: React.ChangeEvent<HTMLInputElement>,
    field: "cycleRange" | "speedRange_kmh" | "speedChangeRange_kmh",
    index: 0 | 1
  ) => {
    const raw = e.target.value;
    if (raw === "") {
      const newRange = [...settings[field]] as [number, number];
      newRange[index] = 0;
      onChange({ [field]: newRange });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const newRange = [...settings[field]] as [number, number];
    newRange[index] = n;
    onChange({ [field]: newRange });
  };

  const inputCls = "w-full border rounded px-2 py-1 text-xs text-right bg-neutral-800 border-neutral-600 text-neutral-100 focus:border-sky-500 focus:outline-none";
  const rangeInputCls = "flex-1 min-w-0 border rounded px-2 py-1 text-xs text-right bg-neutral-800 border-neutral-600 text-neutral-100 focus:border-sky-500 focus:outline-none";
  const labelCls = "block text-[10px] text-neutral-400 mb-1";

  return (
    <div className="space-y-3 text-sm">
      {/* Phase Rearrangement */}
      <div>
        <label className={labelCls}>Phase Rearrangement</label>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={settings.flag === 1}
              onChange={(e) => onChange({ flag: e.target.checked ? 1 : 0 })}
            />
            <span
              className="w-9 h-5 rounded-full bg-neutral-700 relative
                         after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full
                         after:bg-neutral-400 after:transition-all peer-checked:bg-emerald-600
                         peer-checked:after:translate-x-4 peer-checked:after:bg-white"
              aria-hidden
            />
          </label>
          <span className="text-xs text-neutral-400">
            {settings.flag === 1 ? "On" : "Off"}
          </span>
        </div>
      </div>

      {/* Master Junction */}
      <div data-tour="master-junction-select">
        <label className={labelCls}>Master Junction</label>
        <select
          className="w-full border rounded px-2 py-1 text-xs bg-neutral-800 border-neutral-600 text-neutral-100 focus:border-sky-500 focus:outline-none"
          value={settings.masterJunctionId}
          onChange={(e) => onChange({ masterJunctionId: e.target.value })}
        >
          <option value="">-- Select --</option>
          {junctions.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>
      </div>

      {/* Bandwidth Priority Input */}
      <div data-tour="bandwidth-slider">
        <label className={labelCls}>Bandwidth Priority (k)</label>
        <div className="flex flex-col gap-1 mt-1">
          {([
            { label: "Outbound biased", k: 0.3 },
            { label: "Balanced", k: 0.9 },
            { label: "Inbound biased", k: 4.2 },
          ] as const).map(({ label, k }) => {
            const active = settings.k === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => onChange({ k })}
                className={[
                  "w-full text-left px-2 py-1.5 rounded text-xs border transition-colors",
                  active
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-neutral-800 border-neutral-600 text-neutral-300 hover:border-neutral-400 hover:text-white",
                ].join(" ")}
              >
                <span className="font-medium">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Default Amber + All Red — side by side */}
      <div className="grid grid-cols-2 gap-2" data-tour="amber-red-inputs">
        <div>
          <label className={labelCls}>Default Amber (s)</label>
          <input
            type="number"
            step={0.5}
            className={inputCls}
            value={settings.defaultAmber_s}
            onChange={(e) => handleNumberInput(e, "defaultAmber_s", (n) => Math.max(0, n))}
          />
        </div>
        <div>
          <label className={labelCls}>Default All Red (s)</label>
          <input
            type="number"
            step={0.5}
            className={inputCls}
            value={settings.defaultRed_s}
            onChange={(e) => handleNumberInput(e, "defaultRed_s", (n) => Math.max(0, n))}
          />
        </div>
      </div>

      {/* Cycle Range */}
      <div data-tour="cycle-range-inputs">
        <div className="flex items-center justify-between mb-1">
          <label className={labelCls} style={{marginBottom:0}}>Cycle Range (s)</label>
          <button
            type="button"
            onClick={autoFillCycleRange}
            className="text-[10px] text-sky-400 hover:text-sky-300 border border-sky-700 hover:border-sky-500 rounded px-1.5 py-0.5 leading-none transition-colors"
            title="Auto-fill from junction cycle times (±20%)"
          >
            Auto-fill
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className={rangeInputCls}
            value={settings.cycleRange[0]}
            onChange={(e) => handleRangeInput(e, "cycleRange", 0)}
          />
          <span className="text-neutral-500 text-xs flex-shrink-0">–</span>
          <input
            type="number"
            className={rangeInputCls}
            value={settings.cycleRange[1]}
            onChange={(e) => handleRangeInput(e, "cycleRange", 1)}
          />
        </div>
      </div>

      {/* Speed Range */}
      <div data-tour="speed-range-inputs">
        <label className={labelCls}>Speed Range (km/h)</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className={rangeInputCls}
            value={settings.speedRange_kmh[0]}
            onChange={(e) => handleRangeInput(e, "speedRange_kmh", 0)}
          />
          <span className="text-neutral-500 text-xs flex-shrink-0">–</span>
          <input
            type="number"
            className={rangeInputCls}
            value={settings.speedRange_kmh[1]}
            onChange={(e) => handleRangeInput(e, "speedRange_kmh", 1)}
          />
        </div>
      </div>

      {/* Speed Change Range */}
      <div>
        <label className={labelCls}>Speed Change Range (km/h)</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className={rangeInputCls}
            value={settings.speedChangeRange_kmh[0]}
            onChange={(e) => handleRangeInput(e, "speedChangeRange_kmh", 0)}
          />
          <span className="text-neutral-500 text-xs flex-shrink-0">–</span>
          <input
            type="number"
            className={rangeInputCls}
            value={settings.speedChangeRange_kmh[1]}
            onChange={(e) => handleRangeInput(e, "speedChangeRange_kmh", 1)}
          />
        </div>
      </div>
    </div>
  );
}
