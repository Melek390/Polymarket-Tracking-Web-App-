import { useState } from "react";
import { T, card, monoText, btn } from "../../theme.js";
import { DEFAULT_PARAMS, WEIGHT_LABELS } from "../../api/backtestPreview.js";

// Parameter editor for one strategy. Hard filters and the bounce definition
// sit ABOVE the weights on purpose: they gate whether a spot is scored at all
// (see .claude/V2-BACKTESTING.md — the client wants them separate and first).
// Layout only: Save hands the values back to the card; nothing simulates yet.

const numField = {
  ...monoText, fontSize: 13, padding: "7px 10px", width: 90,
  border: `1px solid ${T.border}`, borderRadius: 8, color: T.ink,
};
const lbl = { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: T.sub };

function Num({ value, onChange, step = 0.5, min = 0 }) {
  return (
    <input
      type="number" value={value} step={step} min={min}
      onChange={(e) => onChange(Number(e.target.value))}
      style={numField}
    />
  );
}

function Row({ label, children, hint }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
      borderBottom: `1px solid ${T.soft}` }}>
      <div style={{ flex: 1, fontSize: 13, fontFamily: T.ui }}>
        {label}
        {hint && <div style={{ fontSize: 11, color: T.faint }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export default function ParamsDialog({ strategy, onSave, onClose }) {
  const [p, setP] = useState(strategy.params);
  const set = (path, value) => {
    setP((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let o = next;
      while (keys.length > 1) o = o[keys.shift()];
      o[keys[0]] = value;
      return next;
    });
  };
  const totalWeight = Object.values(p.weights).reduce((a, b) => a + b, 0);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(26,29,35,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 140,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        ...card, width: "min(680px, 95vw)", maxHeight: "90vh", overflowY: "auto", padding: 20,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Adjust parameters — {strategy.name}</div>
          <button onClick={onClose} style={{ ...btn.ghost, fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        <div style={{ ...lbl, marginTop: 16 }}>Hard filters — applied first; a failed filter means the spot is never scored</div>
        <Row label="Max price of the trailing team (¢)">
          <Num value={p.hardFilters.maxPriceCents} step={1} onChange={(v) => set("hardFilters.maxPriceCents", v)} />
        </Row>
        <Row label="Minimum innings left" hint="to confirm with the client — the spec never fixed this number">
          <Num value={p.hardFilters.minInningsLeft} step={1} onChange={(v) => set("hardFilters.minInningsLeft", v)} />
        </Row>
        <Row label="Entry timing" hint="fixed by design — bases are always empty at evaluation">
          <span style={{ ...monoText, fontSize: 12, color: T.sub }}>after a half-inning ends</span>
        </Row>

        <div style={{ ...lbl, marginTop: 18 }}>Exit — what counts as a win</div>
        <Row label="Bounce target (¢ above entry)" hint="to confirm with the client">
          <Num value={p.bounce.targetCents} step={0.5} onChange={(v) => set("bounce.targetCents", v)} />
        </Row>
        <Row label="Give up after (half-innings)" hint="to confirm with the client">
          <Num value={p.bounce.horizonHalfInnings} step={1} onChange={(v) => set("bounce.horizonHalfInnings", v)} />
        </Row>

        <div style={{ ...lbl, marginTop: 18 }}>
          Checklist weights — total {totalWeight.toFixed(1)} pts · fire at ≥
        </div>
        <Row label="Minimum score to flag a spot">
          <Num value={p.minScore} step={0.5} onChange={(v) => set("minScore", v)} />
        </Row>
        {Object.entries(WEIGHT_LABELS).map(([key, label]) => (
          <Row key={key} label={label}>
            <Num value={p.weights[key]} onChange={(v) => set(`weights.${key}`, v)} />
          </Row>
        ))}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            onClick={() => setP(structuredClone(DEFAULT_PARAMS))}
            title="Back to the client's default checklist"
            style={{ ...btn.outline, fontSize: 13, padding: "8px 14px" }}
          >
            Restore defaults
          </button>
          <button onClick={onClose} style={{ ...btn.ghost, fontSize: 13, padding: "8px 14px" }}>
            Cancel
          </button>
          <button
            onClick={() => onSave(p)}
            style={{ ...btn.primary, fontSize: 13, padding: "8px 16px" }}
          >
            Save parameters
          </button>
        </div>
      </div>
    </div>
  );
}
