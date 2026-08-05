import { T, card, page, btn } from "../theme.js";
import StrategyCard from "../components/backtesting/StrategyCard.jsx";
import { STRATEGIES } from "../api/backtestPreview.js";

// Backtesting — FIRST DRAFT, layout only (mock data in api/backtestPreview.js).
// Strategies stack vertically per the client's sketch: header row with
// "adjust params", stats underneath. The simulator itself is NOT wired; see
// .claude/V2-BACKTESTING.md for the strategy spec and the open questions.

export default function Backtesting() {
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
