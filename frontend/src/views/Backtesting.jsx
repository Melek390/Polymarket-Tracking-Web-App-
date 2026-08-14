import { useEffect, useState } from "react";
import { T, card, page, btn, label, monoText } from "../theme.js";
import StrategyCard from "../components/backtesting/StrategyCard.jsx";
import { STRATEGIES } from "../api/backtestPreview.js";
import { fetchBacktestCorpus } from "../api/client.js";

// Backtesting — FIRST DRAFT, layout only (mock data in api/backtestPreview.js).
// Strategies stack vertically per the client's sketch: header row with
// "adjust params", stats underneath. The simulator itself is NOT wired; see
// .claude/V2-BACKTESTING.md for the strategy spec and the open questions.

// The header menu: the two numbers that size the lab before anything runs.
// Eligible games is REAL — counted from the tracker's own tick store — so
// even while the simulator is a mock, the corpus figure is the truth.
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
  // null = loading, false = fetch failed (server without the endpoint yet)
  const [corpus, setCorpus] = useState(null);
  useEffect(() => {
    fetchBacktestCorpus().then(setCorpus).catch(() => setCorpus(false));
  }, []);

  return (
    <main style={page}>
      <div style={{
        ...card, background: "#FEF9E7", borderColor: "#F5D67B",
        padding: "10px 14px", fontSize: 13, color: T.ink,
      }}>
        <strong>Design preview</strong> — layout only, sample numbers. No backtest has
        actually been run; parameters can be tweaked but nothing simulates yet.
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
          title="Design preview — creating strategies comes with the simulator"
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
          title="Strategies"
          value={STRATEGIES.length}
          sub="design previews until the simulator is wired"
        />
      </div>

      {STRATEGIES.map((s, i) => (
        <StrategyCard key={s.id} strategy={s} defaultOpen={i === 0} />
      ))}

      <div style={{ fontSize: 12, color: T.faint }}>
        Simulations will run against the 1-second price history this tracker already
        collects on live MLB markets, replayed against MLB's play-by-play.
      </div>
    </main>
  );
}
