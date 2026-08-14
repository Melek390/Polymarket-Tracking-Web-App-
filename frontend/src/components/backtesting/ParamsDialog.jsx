import { useState } from "react";
import { T, card, monoText, btn } from "../../theme.js";
import { WEIGHT_LABELS, UNKNOWN_IN_V1 } from "../../api/backtestPreview.js";

// Parameter editor for one strategy — every knob the simulator honours.
// Hard filters and the exit sit ABOVE the weights on purpose: they gate
// whether a spot is scored at all (the client wants them separate and first).
// Saving hands the params back to the card, which persists them server-side
// and re-runs.

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

function Choice({ value, options, onChange }) {
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {options.map(([v, label]) => (
        <button key={String(v)} onClick={() => onChange(v)}
          style={{ ...(value === v ? btn.primary : btn.outline),
            fontSize: 12, padding: "5px 10px" }}>
          {label}
        </button>
      ))}
    </span>
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

export default function ParamsDialog({ strategy, defaults, onSave, onClose }) {
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
        ...card, width: "min(700px, 95vw)", maxHeight: "90vh", overflowY: "auto", padding: 20,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Adjust parameters — {strategy.name}</div>
          <button onClick={onClose} style={{ ...btn.ghost, fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        <div style={{ ...lbl, marginTop: 16 }}>Hard filters — applied first; a failed filter means the spot is never scored</div>
        <Row label="Max price of the trailing team (¢)">
          <Num value={p.hardFilters.maxPriceCents} step={1} onChange={(v) => set("hardFilters.maxPriceCents", v)} />
        </Row>
        <Row label="Min price (¢)" hint="skips lottery tickets where spread + fees eat the bounce">
          <Num value={p.hardFilters.minPriceCents} step={1} onChange={(v) => set("hardFilters.minPriceCents", v)} />
        </Row>
        <Row label="Minimum innings left" hint="draft — the client never fixed this number">
          <Num value={p.hardFilters.minInningsLeft} step={1} onChange={(v) => set("hardFilters.minInningsLeft", v)} />
        </Row>
        <Row label="Max deficit (runs)">
          <Num value={p.hardFilters.maxDeficit} step={1} onChange={(v) => set("hardFilters.maxDeficit", v)} />
        </Row>
        <Row label="Trailing side">
          <Choice value={p.hardFilters.side} onChange={(v) => set("hardFilters.side", v)}
            options={[["both", "Both"], ["home", "Home only"], ["away", "Away only"]]} />
        </Row>
        <Row label="Entry timing" hint="fixed by design — bases are always empty at evaluation">
          <span style={{ ...monoText, fontSize: 12, color: T.sub }}>after a half-inning ends</span>
        </Row>

        <div style={{ ...lbl, marginTop: 18 }}>Exit — what counts as a win (drafts pending the client)</div>
        <Row label="Bounce target (¢ above entry)">
          <Num value={p.bounce.targetCents} step={0.5} onChange={(v) => set("bounce.targetCents", v)} />
        </Row>
        <Row label="Give up after (half-innings, 1–6)">
          <Num value={p.bounce.horizonHalfInnings} step={1} min={1} onChange={(v) => set("bounce.horizonHalfInnings", v)} />
        </Row>
        <Row label="If it never bounces">
          <Choice value={p.bounce.giveUp} onChange={(v) => set("bounce.giveUp", v)}
            options={[["horizon", "Exit at horizon price"], ["stake", "Full loss"]]} />
        </Row>

        <div style={{ ...lbl, marginTop: 18 }}>Execution realism — a naive fill at the signal tick is fiction</div>
        <Row label="Reaction delay" hint="fill at the price this many seconds after the signal">
          <Choice value={p.exec.delaySeconds} onChange={(v) => set("exec.delaySeconds", v)}
            options={[[0, "0s"], [15, "15s"], [30, "30s"], [60, "60s"]]} />
        </Row>
        <Row label="Slippage per side (¢)" hint="our ticks are midpoints; buys pay the ask, exits hit the bid">
          <Num value={p.exec.slippageCentsPerSide} step={0.5} onChange={(v) => set("exec.slippageCentsPerSide", v)} />
        </Row>
        <Row label="Fees" hint="takers pay 5% × p × (1−p) per leg; makers pay zero">
          <Choice value={p.exec.feeMode} onChange={(v) => set("exec.feeMode", v)}
            options={[["taker_both", "Taker both"], ["maker_exit", "Maker exit"], ["maker_both", "Maker both"]]} />
        </Row>

        <div style={{ ...lbl, marginTop: 18 }}>Run controls</div>
        <Row label="Corpus" hint="gold = live-collected 1-10s ticks; silver = minute bars">
          <Choice value={p.corpus.segment} onChange={(v) => set("corpus.segment", v)}
            options={[["both", "Both"], ["gold", "Gold only"], ["silver", "Silver only"]]} />
        </Row>
        <Row label="Stake per spot">
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <Choice value={p.stake.mode} onChange={(v) => set("stake.mode", v)}
              options={[["flat_usd", "Flat $"], ["fixed_shares", "100 shares"]]} />
            {p.stake.mode === "flat_usd" && (
              <Num value={p.stake.usd} step={10} min={1} onChange={(v) => set("stake.usd", v)} />
            )}
          </span>
        </Row>

        <div style={{ ...lbl, marginTop: 18 }}>
          Checklist — total {totalWeight.toFixed(1)} pts
        </div>
        <Row label="Use the score at all" hint="off = hard rules only; the comparison table shows both regardless">
          <Choice value={p.useScore} onChange={(v) => set("useScore", v)}
            options={[[true, "Score"], [false, "Rules only"]]} />
        </Row>
        <Row label="Minimum score to enter">
          <Num value={p.minScore} step={0.5} onChange={(v) => set("minScore", v)} />
        </Row>
        {Object.entries(WEIGHT_LABELS).map(([key, label]) => (
          <Row key={key} label={label}
            hint={UNKNOWN_IN_V1.has(key)
              ? "not replayable yet — scored as unknown (0), weight held for later"
              : undefined}>
            <Num value={p.weights[key]} onChange={(v) => set(`weights.${key}`, v)} />
          </Row>
        ))}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            onClick={() => defaults && setP(structuredClone(defaults))}
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
            Save & run
          </button>
        </div>
      </div>
    </div>
  );
}
