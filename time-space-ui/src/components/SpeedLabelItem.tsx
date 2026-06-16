import { useEffect, useState } from "react";

// ─── Editable speed label ─────────────────────────────────────────────────────
// Inline-editable km/h label shown on each corridor speed segment. Hovering
// reveals −/+ steppers; clicking the value turns it into a numeric input.
// Extracted from TimeSpaceDiagram.tsx (Phase 7b) — purely presentational.
export function SpeedLabelItem({
  prefix, color, kmh, segDist: _segDist, segIdx, dir, onAdjust,
}: {
  prefix?: string;
  color: string;
  kmh: number;
  segDist: number;
  segIdx: number;
  dir: "out" | "in" | "both";
  onAdjust: (segIdx: number, dir: "out" | "in" | "both", newKmh: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(String(kmh));

  // Keep editVal in sync when kmh changes from outside (e.g. arrow adjust)
  useEffect(() => { if (!editing) setEditVal(String(kmh)); }, [kmh, editing]);

  const adjust = (delta: number) => {
    const next = Math.max(1, kmh + delta);
    onAdjust(segIdx, dir, next);
  };

  const commitEdit = (val: string) => {
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) onAdjust(segIdx, dir, n);
    setEditing(false);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{ display: "flex", alignItems: "center", gap: 3, pointerEvents: "all" }}
    >
      {/* Decrement button */}
      <button
        onClick={() => adjust(-1)}
        style={{
          visibility: hovered && !editing ? "visible" : "hidden",
          width: 16, height: 16, fontSize: 10, lineHeight: 1,
          background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 3, color: "#9ca3af", cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
        title="Decrease speed"
      >−</button>

      {editing ? (
        <input
          autoFocus
          value={editVal}
          onChange={e => {
            setEditVal(e.target.value);
            const n = parseFloat(e.target.value);
            if (!isNaN(n) && n > 0) onAdjust(segIdx, dir, n);
          }}
          onBlur={e => commitEdit(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") commitEdit((e.target as HTMLInputElement).value);
            if (e.key === "Escape") { setEditing(false); setEditVal(String(kmh)); }
          }}
          style={{
            width: 52, fontSize: 12, textAlign: "center",
            background: "#1f2937", color, border: `1px solid ${color}`,
            borderRadius: 4, padding: "1px 3px", outline: "none",
          }}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          title="Click to edit speed"
          style={{
            fontSize: 12, color,
            cursor: "text",
            userSelect: "none",
            padding: "1px 4px",
            borderRadius: 3,
            borderBottom: hovered ? `1px dashed ${color}` : "1px solid transparent",
            background: hovered ? "rgba(255,255,255,0.05)" : "transparent",
            transition: "background 0.12s, border-bottom 0.12s",
          }}
        >
          {prefix}{kmh} km/h{hovered ? " ✎" : ""}
        </span>
      )}

      {/* Increment button */}
      <button
        onClick={() => adjust(+1)}
        style={{
          visibility: hovered && !editing ? "visible" : "hidden",
          width: 16, height: 16, fontSize: 10, lineHeight: 1,
          background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 3, color: "#9ca3af", cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
        title="Increase speed"
      >+</button>
    </div>
  );
}
