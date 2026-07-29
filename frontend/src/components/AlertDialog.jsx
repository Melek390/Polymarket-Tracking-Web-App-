import { useState } from "react";
import { T, card, btn, monoText } from "../theme.js";
import { soundType, playSound } from "../alerts.js";

const EMPTY = {
  priceMax: "",
  priceMin: "",
  side: "any",
  inningFrom: "",
  inningTo: "",
  runDiff: "any",
};

const num = (v) => (v === "" || v == null ? null : Number(v));

const field = {
  ...monoText,
  fontSize: 13,
  padding: "7px 10px",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.ink,
  width: 70,
};
const rowStyle = { display: "flex", alignItems: "center", gap: 8, marginTop: 12 };
const labelStyle = { fontSize: 13, color: T.sub, width: 130 };

// `row` present = a per-game alert (specific team names, this match);
// otherwise a global alert for all games of `sport` (generic roles).
export default function AlertDialog({ sport, isMlb, hasDraw, row, existing, onSave, onClear, onClose }) {
  const [f, setF] = useState(existing ?? EMPTY);
  const set = (k, v) => setF({ ...f, [k]: v });
  const isMlbMode = row ? row.sport === "baseball" : isMlb;
  const hasDrawMode = row ? !!row.hasDraw : hasDraw;
  const theSport = row ? row.sport : sport;
  const sportLabel = isMlbMode ? "MLB" : theSport.charAt(0).toUpperCase() + theSport.slice(1);

  // Per-game uses the real team names; the global alert uses generic roles
  // (relative to each game). MLB adds "currently batting"; soccer adds "draw".
  const sides = [
    { key: "any", label: "Any team" },
    { key: "home", label: row ? row.home : "Home team" },
    { key: "away", label: row ? row.away : "Away team" },
    ...(hasDrawMode ? [{ key: "draw", label: "Draw" }] : []),
    ...(isMlbMode ? [{ key: "batting", label: "Currently batting" }] : []),
  ];

  function save() {
    const alert = {
      priceMax: num(f.priceMax),
      priceMin: num(f.priceMin),
      side: f.side,
      inningFrom: isMlbMode ? num(f.inningFrom) : null,
      inningTo: isMlbMode ? num(f.inningTo) : null,
      runDiff: isMlbMode ? f.runDiff : "any",
    };
    if (alert.priceMax == null && alert.priceMin == null && alert.inningFrom == null &&
        alert.inningTo == null && alert.runDiff === "any") {
      return; // nothing set — ignore
    }
    onSave(alert);
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(26,29,35,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: "min(440px, 92vw)", padding: 22 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>
          {row ? "Alert for this game" : `Alert for all ${sportLabel} games`}
        </div>
        <div style={{ fontSize: 13, color: T.sub, marginTop: 2 }}>
          {row
            ? `${row.away} @ ${row.home}`
            : `Applies to every ${sportLabel} game — you're notified whenever any game matches.`}
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Price ≤ (¢)</span>
          <input value={f.priceMax} onChange={(e) => set("priceMax", e.target.value)}
            placeholder="e.g. 25" style={field} />
          <span style={{ fontSize: 11, color: T.faint }}>at or below</span>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Price ≥ (¢)</span>
          <input value={f.priceMin} onChange={(e) => set("priceMin", e.target.value)}
            placeholder="e.g. 80" style={field} />
          <span style={{ fontSize: 11, color: T.faint }}>at or above</span>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Team</span>
          <select value={f.side} onChange={(e) => set("side", e.target.value)}
            style={{ ...field, width: 190, fontFamily: T.ui }}>
            {sides.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        {isMlbMode && (
          <>
            <div style={rowStyle}>
              <span style={labelStyle}>Inning from / to</span>
              <input value={f.inningFrom} onChange={(e) => set("inningFrom", e.target.value)}
                placeholder="6" style={field} />
              <span style={{ color: T.faint }}>to</span>
              <input value={f.inningTo} onChange={(e) => set("inningTo", e.target.value)}
                placeholder="8" style={field} />
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>Run difference</span>
              <select value={f.runDiff} onChange={(e) => set("runDiff", e.target.value)}
                style={{ ...field, width: 190, fontFamily: T.ui }}>
                <option value="any">Any</option>
                <option value="win1">Winning by 1</option>
                <option value="lose1">Losing by 1</option>
                <option value="tie">Tie game</option>
              </select>
            </div>
          </>
        )}

        <div style={{ ...rowStyle, color: T.faint, fontSize: 12 }}>
          <span style={labelStyle}>Sound</span>
          <span>{soundType(f) === "situation" ? "game situation" : "price"}</span>
          <button onClick={() => playSound(soundType(f))}
            style={{ ...btn.outline, fontSize: 12, padding: "4px 10px" }}>
            ▶ Preview
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          {existing && (
            <button onClick={onClear} style={{ ...btn.ghost, fontSize: 13, padding: "8px 14px", color: T.red }}>
              Remove alert
            </button>
          )}
          <button onClick={onClose} style={{ ...btn.ghost, fontSize: 13, padding: "8px 14px" }}>
            Cancel
          </button>
          <button onClick={save} style={{ ...btn.primary, fontSize: 13, padding: "8px 16px" }}>
            Save alert
          </button>
        </div>
      </div>
    </div>
  );
}
