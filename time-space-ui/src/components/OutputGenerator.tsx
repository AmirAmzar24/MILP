// Accept a minimal shape to avoid tight coupling
export type OutputJunction = {
  name: string;
  phases_s: number[];
  offset_s: number;
  lost_s: number;
};

function fmtCl(junctions: OutputJunction[]) {
  // 'cl1': 168, 'cl2': 165, 'cl3': 56
  const parts = junctions.map((j, i) => {
    const cl = (j.phases_s || []).reduce((a, b) => a + b, 0);
    return `'cl${i + 1}': ${cl}`;
  });
  return parts.join(", ");
}

function fmtPerJunction(junctions: OutputJunction[]) {
  // 'J1': { 1: 50, 2: 77, 3: 41 }, 'J2': { 1: 55, 2: 30, 3: 40, 4: 40 }, ...
  const parts = junctions.map((j, i) => {
    const body = (j.phases_s || [])
      .map((p, idx) => `${idx + 1}: ${p}`)
      .join(", ");
    return `'J${i + 1}': { ${body} }`;
  });
  return parts.join(", ");
}

function flattenPhases(junctions: OutputJunction[]) {
  // "50 77 41 55 30 40 40 14 14 14 14"
  const arr: number[] = [];
  junctions.forEach((j) => (j.phases_s || []).forEach((p) => arr.push(p)));
  return arr.join(" ");
}

function offsetsStr(junctions: OutputJunction[]) {
  return junctions.map((j) => String(j.offset_s ?? 0)).join(" ");
}

function fmtLosts(junctions: OutputJunction[]) {
  // "'L1': 7, 'L2': 7, 'L3': 7"
  return junctions.map((j, i) => `'L${i + 1}': ${Number(j.lost_s ?? 0)}`).join(", ");
}

function fmtGRs(junctions: OutputJunction[]) {
  // "'GR1': 11.8, 16.4, ..., 'GR2': ..., 'GR3': ..."
  const blocks = junctions.map((j, i) => {
    const cycle = (j.phases_s || []).reduce((a, b) => a + b, 0);
    const L = Math.max(0, Number(j.lost_s ?? 0));
    const grs = (j.phases_s || []).map((p) =>
      cycle > 0 ? ((Math.max(0, p - L) / cycle) * 100).toFixed(1) : "0.0"
    );
    return `'GR${i + 1}': ${grs.join(", ")}`;
  });
  return blocks.join(", ");
}

export default function OutputGenerator({ junctions }: { junctions: OutputJunction[] }) {
  const line1 = fmtCl(junctions);
  const line2 = fmtLosts(junctions);
  const line3 = fmtGRs(junctions);
  const line4 = fmtPerJunction(junctions);
  const line5 = `"${flattenPhases(junctions)}"`;
  const line6 = `"${flattenPhases(junctions)} ${offsetsStr(junctions)}"`;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="mt-3 border rounded-xl p-3 bg-neutral-50 dark:bg-neutral-900/40">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Output / Copy</h3>
        <button
          type="button"
          className="text-[11px] px-2 py-0.5 border rounded bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 whitespace-nowrap"
          onClick={() => copy([line1, line2, line3, line4, line5, line6].join("\n"))}
        >
          Copy all
        </button>
      </div>

      <div className="space-y-2">
        {/* cl1/cl2/... */}
        <div className="flex items-center gap-2">
          <div className="text-xs font-mono overflow-x-auto grow">{line1}</div>
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 border rounded bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 whitespace-nowrap"
            onClick={() => copy(line1)}
          >
            Copy
          </button>
        </div>
        {/* Losts */}
        <div className="flex items-center gap-2">
          <div className="text-xs font-mono overflow-x-auto grow">{line2}</div>
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 border rounded bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 whitespace-nowrap"
            onClick={() => copy(line2)}
          >
            Copy
          </button>
        </div>
        {/* GRs */}
        <div className="flex items-center gap-2">
          <div className="text-xs font-mono overflow-x-auto grow">{line3}</div>
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 border rounded bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 whitespace-nowrap"
            onClick={() => copy(line3)}
          >
            Copy
          </button>
        </div>
        {/* Per-junction phases */}
        <div className="flex items-center gap-2">
          <div className="text-xs font-mono overflow-x-auto grow">{line4}</div>
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 border rounded bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 whitespace-nowrap"
            onClick={() => copy(line4)}
          >
            Copy
          </button>
        </div>
        {/* Flat phases */}
        <div className="flex items-center gap-2">
          <div className="text-xs font-mono overflow-x-auto grow">{line5}</div>
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 border rounded bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 whitespace-nowrap"
            onClick={() => copy(line5)}
          >
            Copy
          </button>
        </div>
        {/* Flat phases + offsets */}
        <div className="flex items-center gap-2">
          <div className="text-xs font-mono overflow-x-auto grow">{line6}</div>
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 border rounded bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 whitespace-nowrap"
            onClick={() => copy(line6)}
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}
