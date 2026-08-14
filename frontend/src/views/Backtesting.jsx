import { useEffect, useState } from "react";
import { T, card, page, btn, label, monoText } from "../theme.js";
import StrategyCard from "../components/backtesting/StrategyCard.jsx";
import { fetchBacktestCorpus, fetchBacktestStrategies, fetchBackfillStatus } from "../api/client.js";

// Backtesting — wired. Strategies and their params live server-side; a run is
// arithmetic over the backfilled spots table (see backend/backtest/). The
// simulator honours the Aug 5 execution-realism decisions: delay, slippage,
// fees, and gold/silver tagging are all real, not decoration.

function MenuStat({ title, value, sub }) {
  return (
    <div style={{ ...card, padding: "12px 18px", minWidth: 170 }}>
      <div style={label}>{title}</div>
      <div style={{ ...monoText, fontSize: 22, fontWeight: 700, marginTop: 2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function Backtesting() {
  const [corpus, setCorpus] = useState(null);     // null loading, false failed
  const [strategies, setStrategies] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [backfill, setBackfill] = useState(null);

  useEffect(() => {
    fetchBacktestCorpus().then(setCorpus).catch(() => setCorpus(false));
    fetchBacktestStrategies()
      .then((r) => { setStrategies(r.strategies); setDefaults(r.defaults); })
      .catch(() => setStrategies(false));
    fetchBackfillStatus().then(setBackfill).catch(() => {});
  }, []);

  return (
    <main style={page}>
      <div style={{
        ...card, background: "#FEF9E7", borderColor: "#F5D67B",
        padding: "10px 14px", fontSize: 13, color: T.ink,
      }}>
        <strong>Live simulator, draft win definition</strong> — runs replay the real
        recorded corpus, but the exit defaults (+5¢ within 4 half-innings) and the
        minimum-innings gate are still drafts pending the client. Two checklist
        factors (team form, price-vs-history) are not replayable yet and score as
        unknown.
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>Backtesting</div>
          <div style={{ fontSize: 13, color: T.sub, marginTop: 2 }}>
            Score the comeback checklist against collected games, tweak the parameters,
            and see where the strategy actually wins before risking a cent.
          </div>
        </div>
        <button
          disabled
          title="One strategy for now — cloning comes later"
          style={{ ...btn.green, fontSize: 13, padding: "9px 16px" }}
        >
          + New strategy
        </button>
      </div>

      {/* main menu — the size of the lab at a glance */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <MenuStat
          title="Eligible games"
          value={corpus === null ? "…" : corpus === false ? "—" : corpus.eligible_games.toLocaleString("en-US")}
          sub={corpus && corpus.since
            ? `tracked MLB games with recorded ticks · since ${corpus.since}`
            : "tracked MLB games with recorded ticks"}
        />
        <MenuStat
          title="Price ticks stored"
          value={corpus === null ? "…" : corpus === false ? "—"
            : corpus.total_ticks >= 1e6
              ? `${(corpus.total_ticks / 1e6).toFixed(1)}M`
              : corpus.total_ticks.toLocaleString("en-US")}
          sub="1-second while live — what the replays run on"
        />
        <MenuStat
          title="Backfilled spots"
          value={backfill ? backfill.spots.toLocaleString("en-US") : "…"}
          sub={backfill
            ? `${backfill.games_done} games in (${backfill.gold_games} gold)`
              + (backfill.pending ? ` · ${backfill.pending} pending` : "")
            : "half-inning moments ready to replay"}
        />
        <MenuStat
          title="Strategies"
          value={strategies === null ? "…" : strategies === false ? "—" : strategies.length}
          sub="params saved server-side, shared across windows"
        />
      </div>

      {strategies === false && (
        <div style={{ fontSize: 13, color: T.red }}>
          Could not load the strategies — is the backend up to date?
        </div>
      )}
      {Array.isArray(strategies) && strategies.map((s, i) => (
        <StrategyCard key={s.id} strategy={s} defaults={defaults} defaultOpen={i === 0} />
      ))}

      <div style={{ fontSize: 12, color: T.faint }}>
        Simulations replay the 1-second price history this tracker collects on live
        MLB markets against MLB's own play-by-play timestamps. Gold = live-collected
        ticks; silver = minute-bar backfills — results are always tagged, never mixed.
      </div>
    </main>
  );
}
