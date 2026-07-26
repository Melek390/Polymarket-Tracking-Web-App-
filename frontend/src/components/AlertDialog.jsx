import { useState } from "react";
import { T, card, btn, monoText } from "../theme.js";
import { soundType, playSound } from "../alerts.js";

const EMPTY = {
  priceMax: "",
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

export default function AlertDialog({ sport, isMlb, hasDraw, existing, onSave, onClear, onClose }) {
  const [f, setF] = useState(existing ?? EMPTY);
  const set = (k, v) => setF({ ...f, [k]: v });
  const sportLabel = isMlb ? "MLB" : sport.charAt(0).toUpperCase() + sport.slice(1);

  // The alert is global, so sides are generic roles (relative to each game),
  // not specific team names. MLB adds "currently batting"; soccer adds "draw".
  const sides = [
    { key: "any", label: "Any team" },
    { key: "home", label: "Home team" },
    { key: "away", label: "Away team" },
    ...(hasDraw ? [{ key: "draw", label: "Draw" }] : []),
    ...(isMlb ? [{ key: "batting", label: "Currently batting" }] : []),
  ];

  function save() {
    const alert = {
      priceMax: num(f.priceMax),
      side: f.side,
      inningFrom: isMlb ? num(f.inningFrom) : null,
      inningTo: isMlb ? num(f.inningTo) : null,
      runDiff: isMlb ? f.runDiff : "any",
    };
    if (alert.priceMax == null && alert.inningFrom == null &&
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
        <div style={{ fontSize: 16, fontWeight: 600 }}>Alert for all {sportLabel} games</div>
        <div style={{ fontSize: 13, color: T.sub, marginTop: 2 }}>
          Applies to every {sportLabel} game — you're notified whenever any game matches.
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Price ≤ (¢)</span>
          <input value={f.priceMax} onChange={(e) => set("priceMax", e.target.value)}
            placeholder="25" style={field} />
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Team</span>
          <select value={f.side} onChange={(e) => set("side", e.target.value)}
            style={{ ...field, width: 190, fontFamily: T.ui }}>
            {sides.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        {isMlb && (
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
