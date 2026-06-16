import React from "react";

const KMH_FACTOR = 3.6;

export default function TravelEditor({
  aName,
  bName,
  distMeters,
  inVal,
  outVal,
  onIn,
  onOut,
  onDistChange,
}: {
  aName: string;
  bName: string;
  distMeters: number;
  inVal: number;
  outVal: number;
  onIn: (v: number) => void;
  onOut: (v: number) => void;
  onDistChange?: (v: number) => void;
}) {
  const speedFromTime = (dist: number, t: number): number | null => {
    if (!Number.isFinite(dist) || dist <= 0) return null;
    if (!Number.isFinite(t) || t <= 0) return null;
    return (dist / t) * KMH_FACTOR; // km/h
  };

  // --- Local locked speeds (km/h, integer) ---
  const [speedIn, setSpeedIn] = React.useState<number>(() => {
    const s = speedFromTime(distMeters, inVal);
    return s != null && Number.isFinite(s) ? Math.max(0, Math.round(s)) : 0;
  });

  const [speedOut, setSpeedOut] = React.useState<number>(() => {
    const s = speedFromTime(distMeters, outVal);
    return s != null && Number.isFinite(s) ? Math.max(0, Math.round(s)) : 0;
  });

  const prevDistRef = React.useRef<number>(distMeters);

  // When WE change time (because of distance or speed edits) we don't want the
  // "time -> speed" sync to re-derive speed and fight our locked value.
  const skipSyncRef = React.useRef<{ in: boolean; out: boolean }>({
    in: false,
    out: false,
  });

  // Sync speeds only when time changes from *outside* (e.g. JSON import)
  React.useEffect(() => {
    if (skipSyncRef.current.in) {
      skipSyncRef.current.in = false;
      return;
    }
    const s = speedFromTime(distMeters, inVal);
    const rounded =
      s != null && Number.isFinite(s) ? Math.max(0, Math.round(s)) : 0;
    setSpeedIn(rounded);
  }, [inVal]); // note: NO distMeters here

  React.useEffect(() => {
    if (skipSyncRef.current.out) {
      skipSyncRef.current.out = false;
      return;
    }
    const s = speedFromTime(distMeters, outVal);
    const rounded =
      s != null && Number.isFinite(s) ? Math.max(0, Math.round(s)) : 0;
    setSpeedOut(rounded);
  }, [outVal]); // note: NO distMeters here

  // When distance changes, HOLD speed and recompute time once.
  React.useEffect(() => {
    if (!Number.isFinite(distMeters) || distMeters <= 0) return;

    if (distMeters === prevDistRef.current) return;
    prevDistRef.current = distMeters;

    // Inbound: time from locked speed
    if (speedIn > 0) {
      const tIn = distMeters / (speedIn / KMH_FACTOR);
      const cleanIn = Math.max(0, Math.round(tIn));
      if (cleanIn !== inVal) {
        skipSyncRef.current.in = true; // don't recalc speed from this time
        onIn(cleanIn);
      }
    }

    // Outbound: time from locked speed
    if (speedOut > 0) {
      const tOut = distMeters / (speedOut / KMH_FACTOR);
      const cleanOut = Math.max(0, Math.round(tOut));
      if (cleanOut !== outVal) {
        skipSyncRef.current.out = true;
        onOut(cleanOut);
      }
    }
  }, [distMeters, speedIn, speedOut, inVal, outVal, onIn, onOut]);

  const handleTimeChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    dir: "in" | "out"
  ) => {
    const raw = e.target.value;

    if (raw === "") {
      if (dir === "in") {
        onIn(0);
        setSpeedIn(0);
      } else {
        onOut(0);
        setSpeedOut(0);
      }
      return;
    }

    const n = Number(raw);
    if (!Number.isFinite(n)) return;

    const cleanTime = Math.max(0, Math.round(n));
    e.target.value = String(cleanTime);

    // Here we *do* want speed to update from time
    if (dir === "in") {
      onIn(cleanTime);
      const s = speedFromTime(distMeters, cleanTime);
      const rounded =
        s != null && Number.isFinite(s) ? Math.max(0, Math.round(s)) : 0;
      setSpeedIn(rounded);
    } else {
      onOut(cleanTime);
      const s = speedFromTime(distMeters, cleanTime);
      const rounded =
        s != null && Number.isFinite(s) ? Math.max(0, Math.round(s)) : 0;
      setSpeedOut(rounded);
    }
  };

  const handleSpeedChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    dir: "in" | "out"
  ) => {
    const raw = e.target.value;

    if (raw === "") {
      // 0-speed -> 0-time
      if (dir === "in") {
        setSpeedIn(0);
        skipSyncRef.current.in = true;
        onIn(0);
      } else {
        setSpeedOut(0);
        skipSyncRef.current.out = true;
        onOut(0);
      }
      return;
    }

    const n = Number(raw);
    if (!Number.isFinite(n)) return;

    const spd = Math.max(0, Math.round(n)); // integer km/h

    // Update locked speed immediately
    if (dir === "in") setSpeedIn(spd);
    else setSpeedOut(spd);

    let t = 0;
    if (distMeters > 0 && spd > 0) {
      // time = distance / speed(m/s) = dist / (km/h / 3.6)
      t = distMeters / (spd / KMH_FACTOR);
    }

    const cleanTime = Math.max(0, Math.round(t));
    if (dir === "in") {
      skipSyncRef.current.in = true; // time came from speed; keep speed locked
      onIn(cleanTime);
    } else {
      skipSyncRef.current.out = true;
      onOut(cleanTime);
    }
  };

  const handleDistChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onDistChange) return;

    const raw = e.target.value;

    if (raw === "") {
      onDistChange(0);
      return;
    }

    const n = Number(raw);
    if (!Number.isFinite(n)) return;

    const clean = Math.max(0, Math.round(n));
    e.target.value = String(clean);
    onDistChange(clean);
  };

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/40 p-2">
      <div className="text-xs text-neutral-400 dark:text-neutral-300 mb-1">
        Travel time (between consecutive junctions)
      </div>

      {/* Outbound + Inbound on the same row */}
      <div className="flex flex-wrap items-center gap-6 text-xs text-neutral-600 dark:text-neutral-300">
        {/* Outbound group */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="inline-block w-[14px] h-[2px] rounded-sm bg-sky-500 flex-shrink-0" />
            Outbound {aName}→{bName}
          </span>

          {/* Time (s) */}
          <input
            type="number"
            min={0}
            step={1}
            className="w-20 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono text-sm text-right"
            value={Number.isFinite(outVal) ? outVal : 0}
            onChange={(e) => handleTimeChange(e, "out")}
          />
          <span className="text-sm text-neutral-400 dark:text-neutral-300">s</span>

          {/* Speed (km/h) */}
          <span className="ml-1 text-xs text-neutral-400 dark:text-neutral-300">≈</span>
          <input
            type="number"
            min={0}
            step={1}
            className="w-20 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono text-sm text-right"
            value={speedOut}
            onChange={(e) => handleSpeedChange(e, "out")}
          />
          <span className="text-sm text-neutral-400 dark:text-neutral-300">km/h</span>
        </div>

        {/* Inbound group */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="inline-block w-[14px] h-[2px] rounded-sm bg-emerald-500 flex-shrink-0" />
              Inbound {bName}→{aName}
            </span>

            {/* Time (s) */}
            <input
              type="number"
              min={0}
              step={1}
              className="w-20 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono text-sm text-right"
              value={Number.isFinite(inVal) ? inVal : 0}
              onChange={(e) => handleTimeChange(e, "in")}
            />
            <span className="text-sm text-neutral-400 dark:text-neutral-300">s</span>

            {/* Speed (km/h) */}
            <span className="ml-1 text-xs text-neutral-400 dark:text-neutral-300">≈</span>
            <input
              type="number"
              min={0}
              step={1}
              className="w-20 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono text-sm text-right"
              value={speedIn}
              onChange={(e) => handleSpeedChange(e, "in")}
            />
            <span className="text-sm text-neutral-400 dark:text-neutral-300">km/h</span>
          </div>

          {/* Distance between junctions */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="whitespace-nowrap">
              Distance
            </span>
            <input
              type="number"
              min={0}
              step={1}
              className="w-24 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono text-sm text-right"
              value={Number.isFinite(distMeters) ? Math.round(distMeters) : 0}
              onChange={handleDistChange}
            />
            <span className="text-sm text-neutral-400 dark:text-neutral-300 pr-2">m</span>
          </div>
      </div>
    </div>
  );
}
