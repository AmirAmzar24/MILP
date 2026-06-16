import React from "react";

export default function QueueTimeEditor({
  junctionName,
  inVal,
  outVal,
  onIn,
  onOut,
  vehiclesInVal = 0,
  vehiclesOutVal = 0,
  onVehiclesIn,
  onVehiclesOut,
}: {
  junctionName: string;
  inVal: number;
  outVal: number;
  onIn: (v: number) => void;
  onOut: (v: number) => void;
  vehiclesInVal?: number;
  vehiclesOutVal?: number;
  onVehiclesIn?: (v: number) => void;
  onVehiclesOut?: (v: number) => void;
}) {
  const handleTimeChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    dir: "in" | "out"
  ) => {
    const raw = e.target.value;

    if (raw === "") {
      if (dir === "in") onIn(0);
      else onOut(0);
      return;
    }

    const n = Number(raw);
    if (!Number.isFinite(n)) return;

    const cleanTime = Math.max(0, Math.round(n));
    e.target.value = String(cleanTime);

    if (dir === "in") onIn(cleanTime);
    else onOut(cleanTime);
  };

  const handleVehicleChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    dir: "in" | "out"
  ) => {
    const raw = e.target.value;

    if (raw === "") {
      if (dir === "in") onVehiclesIn?.(0);
      else onVehiclesOut?.(0);
      return;
    }

    const n = Number(raw);
    if (!Number.isFinite(n)) return;

    const cleanCount = Math.max(0, Math.min(10, Math.round(n))); // Cap at 10
    e.target.value = String(cleanCount);

    if (dir === "in") onVehiclesIn?.(cleanCount);
    else onVehiclesOut?.(cleanCount);
  };

  return (
    <div className="mt-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/40 p-2">
      <div className="text-xs text-neutral-400 dark:text-neutral-300 mb-1">
        Queue Discharge at {junctionName}
      </div>

      <div className="flex flex-col gap-2 text-xs text-neutral-600 dark:text-neutral-300">
        {/* Outbound row */}
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs text-blue-500 dark:text-blue-400 font-medium w-16">Outbound:</span>
          <div className="flex items-center gap-1">
            <span className="text-neutral-400 dark:text-neutral-300">Time</span>
            <input
              type="number"
              min={0}
              step={1}
              className="w-16 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono text-sm text-right"
              value={Number.isFinite(outVal) ? outVal : 0}
              onChange={(e) => handleTimeChange(e, "out")}
            />
            <span className="text-xs text-neutral-400 dark:text-neutral-300">s</span>
          </div>
          {onVehiclesOut && (
            <div className="flex items-center gap-1">
              <span className="text-neutral-400 dark:text-neutral-300">Vehicles</span>
              <input
                type="number"
                min={0}
                max={10}
                step={1}
                className="w-14 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono text-sm text-right"
                value={Number.isFinite(vehiclesOutVal) ? vehiclesOutVal : 0}
                onChange={(e) => handleVehicleChange(e, "out")}
                title="Number of vehicles to show as queue trajectories (max 10)"
              />
            </div>
          )}
        </div>

        {/* Inbound row */}
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs text-green-500 dark:text-green-400 font-medium w-16">Inbound:</span>
          <div className="flex items-center gap-1">
            <span className="text-neutral-400 dark:text-neutral-300">Time</span>
            <input
              type="number"
              min={0}
              step={1}
              className="w-16 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono text-sm text-right"
              value={Number.isFinite(inVal) ? inVal : 0}
              onChange={(e) => handleTimeChange(e, "in")}
            />
            <span className="text-xs text-neutral-400 dark:text-neutral-300">s</span>
          </div>
          {onVehiclesIn && (
            <div className="flex items-center gap-1">
              <span className="text-neutral-400 dark:text-neutral-300">Vehicles</span>
              <input
                type="number"
                min={0}
                max={10}
                step={1}
                className="w-14 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono text-sm text-right"
                value={Number.isFinite(vehiclesInVal) ? vehiclesInVal : 0}
                onChange={(e) => handleVehicleChange(e, "in")}
                title="Number of vehicles to show as queue trajectories (max 10)"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
