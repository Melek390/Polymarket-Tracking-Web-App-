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

// The Comeback Setup replay's own param sheet — the tag's spec, adjustable.
function ComebackFields({ p, set }) {
  const states = p.situation.scoreStates || [];
  const toggleState = (s) =>
    set("situation.scoreStates",
      states.includes(s) ? states.filter((x) => x !== s) : [...states, s]);
  return (
    <>
      <div style={{ ...lbl, marginTop: 16 }}>Situation — when the tag fires</div>
      <Row label="Minimum inning" hint="he wrote 8 (after the top of the 8th); 7 was his first draft">
        <Choice value={p.situation.minInning} onChange={(v) => set("situation.minInning", v)}
          options={[[7, "7"], [8, "8"], [9, "9"]]} />
      </Row>
      <Row label="Home team is trailing by exactly 1">
        <input type="checkbox" checked={states.includes("down1")}
          onChange={() => toggleState("down1")} />
      </Row>
      <Row label="Home team is tied">
        <input type="checkbox" checked={states.includes("tied")}
          onChange={() => toggleState("tied")} />
      </Row>
      <Row label="Only when the home team is about to bat (bottom half)">
        <input type="checkbox" checked={!!p.situation.requireHomeNext}
          onChange={(e) => set("situation.requireHomeNext", e.target.checked)} />
      </Row>

      <div style={{ ...lbl, marginTop: 18 }}>Tired away pitcher — the replayable checks</div>
      <Row label="Checks that must match (0 = no fatigue filter)"
        hint="'pitched yesterday' isn't in the stored spots — WHIP, walks and pitch count stand in">
        <Choice value={p.fatigue.minMatches} onChange={(v) => set("fatigue.minMatches", v)}
          options={[[0, "0"], [1, "1"], [2, "2"], [3, "3"]]} />
      </Row>
      <Row label="Season WHIP above">
        <Num value={p.fatigue.whipAbove} step={0.05} onChange={(v) => set("fatigue.whipAbove", v)} />
      </Row>
      <Row label="Walks this game at least">
        <Num value={p.fatigue.minWalksGame} step={1} onChange={(v) => set("fatigue.minWalksGame", v)} />
      </Row>
      <Row label="Pitches this game at least">
        <Num value={p.fatigue.minPitches} step={5} onChange={(v) => set("fatigue.minPitches", v)} />
      </Row>
    </>
  );
}

// The Clear Favorite replay's sheet: the verdict thresholds, re-applied over
// the locks. No exit section — a favorite bet holds to settlement, and the
// winning redemption is fee-free, so only the entry leg has costs.
function FairvalueFields({ p, set }) {
  const toggleDeficit = (d) => {
    const cur = new Set(p.entry.deficits || []);
    if (cur.has(d)) cur.delete(d); else cur.add(d);
    set("entry.deficits", [...cur].sort());
  };
  return (
    <>
      <div style={{ ...lbl, marginTop: 16 }}>
        Entry — buy the trailing side when it is priced BELOW its historical win rate
      </div>
      <Row label="Minimum discount vs history (¢)"
        hint="sweeps show 3/5/7/10 side by side either way">
        <Num value={p.entry.discountCents} step={1} min={0}
          onChange={(v) => set("entry.discountCents", v)} />
      </Row>
      <Row label="Deficits to trade">
        <span style={{ display: "inline-flex", gap: 4 }}>
          {[1, 2, 3].map((d) => (
            <button key={d} onClick={() => toggleDeficit(d)}
              style={{ ...((p.entry.deficits || []).includes(d) ? btn.primary : btn.outline),
                fontSize: 12, padding: "5px 12px" }}>
              down {d}
            </button>
          ))}
        </span>
      </Row>
      <Row label="Through which inning">
        <Choice value={String(p.entry.maxInning)}
          options={[["1", "1st"], ["2", "2nd"], ["3", "3rd"], ["5", "5th"]]}
          onChange={(v) => set("entry.maxInning", Number(v))} />
      </Row>
      <Row label="Which trailing side">
        <Choice value={p.entry.side}
          options={[["both", "Both"], ["home", "Home"], ["away", "Away"]]}
          onChange={(v) => set("entry.side", v)} />
      </Row>

      <div style={{ ...lbl, marginTop: 16 }}>Fair values</div>
      <Row label="Seasons behind the historical win rates"
        hint="prior = past seasons only (honest); all includes the season being traded">
        <Choice value={p.fair.seasons}
          options={[["prior", "Prior seasons"], ["all", "All seasons"]]}
          onChange={(v) => set("fair.seasons", v)} />
      </Row>

      <div style={{ ...lbl, marginTop: 16 }}>
        Exit — Strategy A holds to the end, Strategy B sells the first bounce
      </div>
      <Row label="Headline exit">
        <Choice value={p.exit.mode}
          options={[["hold", "A: hold to settlement"], ["bounce", "B: sell the bounce"]]}
          onChange={(v) => set("exit.mode", v)} />
      </Row>
      <Row label="Bounce target (¢ above entry)">
        <Choice value={String(p.exit.bounceCents)}
          options={[["5", "+5¢"], ["8", "+8¢"], ["10", "+10¢"]]}
          onChange={(v) => set("exit.bounceCents", Number(v))} />
      </Row>
      <Row label="Bounce window (half-innings)">
        <Num value={p.exit.horizonHalfInnings} step={1} min={1}
          onChange={(v) => set("exit.horizonHalfInnings", Math.min(6, v))} />
      </Row>
      <div style={{ fontSize: 11, color: T.faint, marginTop: 6, lineHeight: 1.5 }}>
        Both exits are always computed from the same entries — the comparison
        table shows A vs B at every discount regardless of the headline choice.
      </div>
    </>
  );
}


function Bottom8Fields({ p, set }) {
  return (
    <>
      <div style={{ ...lbl, marginTop: 16 }}>
        The moment — the away side has just batted and the scores are level
      </div>
      <Row label="Tied at the middle of which inning">
        <Choice value={String(p.situation.inning)}
          options={[["7", "7th"], ["8", "8th"], ["9", "9th"]]}
          onChange={(v) => set("situation.inning", Number(v))} />
      </Row>
      <Row label="Keep the record for which side">
        <Choice value={p.situation.side}
          options={[["home", "Home"], ["away", "Away"]]}
          onChange={(v) => set("situation.side", v)} />
      </Row>
      <Row label="Which games to include">
        <Choice value={p.situation.extras}
          options={[["all", "All"], ["regulation", "Settled in 9"], ["extras", "Extras only"]]}
          onChange={(v) => set("situation.extras", v)} />
      </Row>
      <div style={{ fontSize: 11, color: T.faint, marginTop: 6, lineHeight: 1.5 }}>
        Whether a game was tied at that break needs no tick data, so the record
        covers every game of the season. P&L can only be shown for the games our
        own recording priced — the run reports how many those are.
      </div>
    </>
  );
}


function FavoriteFields({ p, set }) {
  return (
    <>
      <div style={{ ...lbl, marginTop: 16 }}>The verdict thresholds — re-applied over the stored locks</div>
      <Row label="Minimum total score (/100)" hint="the client's bar is 75; the sweep table shows 65/70/80 regardless">
        <Num value={p.filter.minTotal} step={1} onChange={(v) => set("filter.minTotal", v)} />
      </Row>
      <Row label="Price floor (¢)" hint="his rule: 59¢ or better">
        <Num value={p.filter.minPriceCents} step={1} onChange={(v) => set("filter.minPriceCents", v)} />
      </Row>
      <Row label="Price ceiling (¢)" hint="skip favorites already priced near certainty">
        <Num value={p.filter.maxPriceCents} step={1} onChange={(v) => set("filter.maxPriceCents", v)} />
      </Row>
      <Row label="Require no disqualifiers" hint="bullpen game / missing data / unannounced starter — price ones are re-checked above">
        <input type="checkbox" checked={!!p.filter.requireNoDisqualifiers}
          onChange={(e) => set("filter.requireNoDisqualifiers", e.target.checked)} />
      </Row>
      <Row label="Max uncertainty flags" hint="his rule kills a side at 2+">
        <Num value={p.filter.maxFlags} step={1} onChange={(v) => set("filter.maxFlags", v)} />
      </Row>
      <Row label="Verdict source"
        hint="locked = real T-5 snapshots (since Aug 13); reconstructed = historical re-computation, approximations flagged">
        <Choice value={p.filter.source || "both"} onChange={(v) => set("filter.source", v)}
          options={[["both", "Both"], ["locked", "Locked"], ["reconstructed", "Reconstructed"]]} />
      </Row>

      <div style={{ ...lbl, marginTop: 18 }}>Entry costs — the exit is a fee-free redemption</div>
      <Row label="Slippage on entry (¢)">
        <Num value={p.exec.slippageCentsPerSide} step={0.5} onChange={(v) => set("exec.slippageCentsPerSide", v)} />
      </Row>
      <Row label="Entry fee">
        <Choice value={p.exec.entryFee} onChange={(v) => set("exec.entryFee", v)}
          options={[["taker", "Taker"], ["maker", "Maker (free)"]]} />
      </Row>
    </>
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
  const isComeback = p.kind === "comeback_replay";
  const isFavorite = p.kind === "favorite_replay";
  const isBottom8 = p.kind === "bottom8_replay";
  const isFairvalue = p.kind === "fairvalue_replay";
  // restore must give back THIS strategy's defaults, not another kind's
  const kindDefaults = defaults?.byKind?.[p.kind] ?? defaults?.plain ?? defaults;
  const totalWeight = (isComeback || isFavorite || isBottom8 || isFairvalue) ? 0
    : Object.values(p.weights).reduce((a, b) => a + b, 0);

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

        {isComeback && <ComebackFields p={p} set={set} />}
        {isFavorite && <FavoriteFields p={p} set={set} />}
        {isBottom8 && <Bottom8Fields p={p} set={set} />}
        {isFairvalue && <FairvalueFields p={p} set={set} />}

        {!isComeback && !isFavorite && !isBottom8 && !isFairvalue && (<>
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
        </>)}

        {!isFavorite && !isBottom8 && !isFairvalue && (<>
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

        </>)}

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

        {!isComeback && !isFavorite && !isBottom8 && !isFairvalue && (<>
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
        </>)}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            onClick={() => { const d = kindDefaults; if (d) setP(structuredClone(d)); }}
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
