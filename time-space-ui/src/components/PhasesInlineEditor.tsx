/** Horizontal phase chips with native number inputs (same style/behavior as Offset box). */
export default function PhasesInlineEditor({
  phases,
  onChange,
  step = 1,
  cycleLocked = false,
  lockedPhases = [],
}: {
  phases: number[];
  onChange: (next: number[], changedIdx?: number) => void;
  step?: number;
  cycleLocked?: boolean;
  lockedPhases?: number[];
}) {
  const setAt = (idx: number, val: number) => {
    const v = Math.max(0, Number.isFinite(val) ? val : 0);
    const next = phases.slice();
    next[idx] = v;
    onChange(next, idx); // Pass the changed index for cycle lock logic
  };

  return (
    <div className="flex flex-row flex-wrap gap-2 items-center">
      {phases.map((p, i) => {
        const isLocked = cycleLocked && lockedPhases.includes(i);
        return (
          <label key={i} className="flex items-center gap-2">
            <span className={`text-xs w-5 text-right ${isLocked ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-neutral-400 dark:text-neutral-300'}`}>
              {i + 1}{isLocked && '🔒'}
            </span>
            <input
              type="number"
              step={step}
              min={0}
              disabled={isLocked}
              className={`w-24 border rounded px-2 py-1 text-right focus:outline-none focus:ring-2 ${
                isLocked
                  ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 cursor-not-allowed opacity-75'
                  : 'bg-sky-50 dark:bg-sky-900/30 border-sky-200 dark:border-sky-700 text-sky-900 dark:text-sky-100 focus:ring-sky-400 dark:focus:ring-sky-500'
              }`}
              value={p}
              onChange={(e) => {
                if (isLocked) return; // Extra safety check
                const raw = e.target.value;
                if (raw === "") {
                  setAt(i, 0);
                  return;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                const clean = Math.max(0, n);
                setAt(i, clean);
                e.target.value = String(clean);
              }}
            />
            <span className="text-xs text-neutral-400 dark:text-neutral-300">s</span>
          </label>
        );
      })}
    </div>
  );
}
