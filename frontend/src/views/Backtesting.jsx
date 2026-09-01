import { useEffect, useState } from "react";
import { T, card, page, btn, label, monoText } from "../theme.js";
import StrategyCard from "../components/backtesting/StrategyCard.jsx";
import FootballDraw60 from "../components/backtesting/FootballDraw60.jsx";
import {
  fetchBacktestCorpus, fetchBacktestStrategies, fetchBackfillStatus,
  fetchFootballBacktest,
} from "../api/client.js";

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

// Session cache (module scope, survives view unmounts): leaving for another
// page and coming back used to refetch everything from zero — a blank
// "Loading…" on every visit. The cached copy paints immediately and the
// fresh fetch replaces it underneath (same pattern as Screener/Accounts).
const memo = { corpus: null, strategies: null, defaults: null, backfill: null, football: null };

// Section divider — the page now holds two sports, so each gets a banner.
function SportHeader({ title, sub }) {
  return (
    <div style={{ borderBottom: `2px solid ${T.line}`, paddingBottom: 6, marginTop: 8 }}>
      <span style={{ fontSize: 17, fontWeight: 700 }}>{title}</span>
      {sub && <span style={{ fontSize: 12, color: T.sub, marginLeft: 10 }}>{sub}</span>}
    </div>
  );
}

export default function Backtesting() {
  const [corpus, setCorpus] = useState(() => memo.corpus);     // null loading, false failed
  const [strategies, setStrategies] = useState(() => memo.strategies);
  const [defaults, setDefaults] = useState(() => memo.defaults);
  const [backfill, setBackfill] = useState(() => memo.backfill);
  const [football, setFootball] = useState(() => memo.football);

  useEffect(() => {
    fetchBacktestCorpus()
      .then((r) => { memo.corpus = r; setCorpus(r); })
      .catch(() => setCorpus((c) => c ?? false)); // keep the cached copy on a failed refresh
    fetchBacktestStrategies()
      .then((r) => {
        memo.strategies = r.strategies;
        memo.defaults = { plain: r.defaults, byKind: r.defaultsByKind || {} };
        setStrategies(memo.strategies);
        setDefaults(memo.defaults);
      })
      .catch(() => setStrategies((s) => s ?? false));
    fetchBackfillStatus()
      .then((r) => { memo.backfill = r; setBackfill(r); })
      .catch(() => {});
    fetchFootballBacktest()
      .then((r) => { memo.football = r; setFootball(r); })
      .catch(() => setFootball((f) => f ?? false));
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

      <SportHeader title="MLB" sub="live replays over the recorded tick corpus" />

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
      {/* all cards start collapsed — the user chooses what to expand */}
      {Array.isArray(strategies) && strategies.map((s) => (
        <StrategyCard key={s.id} strategy={s} defaults={defaults} />
      ))}

      <div style={{ fontSize: 12, color: T.faint }}>
        Simulations replay the 1-second price history this tracker collects on live
        MLB markets against MLB's own play-by-play timestamps. Gold = live-collected
        ticks; silver = minute-bar backfills — results are always tagged, never mixed.
      </div>

      <SportHeader title="Football" sub="historical studies over api-football × Polymarket" />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <MenuStat
          title="Games on both APIs"
          value={football === null ? "…" : football === false ? "—"
            : football.meta.available_both_apis}
          sub={football && football.meta
            ? `of ${football.meta.fixtures_2025} finished 2025 games · ${football.meta.clubs} clubs`
            : "7 clubs · calendar 2025"}
        />
        <MenuStat
          title="Draws at 60'"
          value={football === null ? "…" : football === false ? "—"
            : football.byMinute?.["60"]?.summary.draws ?? "—"}
          sub={football && football.byMinute?.["60"]
            ? `won ${football.byMinute["60"].summary.won} · drew ${football.byMinute["60"].summary.drew} · lost ${football.byMinute["60"].summary.lost}`
            : "level games at the hour"}
        />
        <MenuStat
          title="Avg win price @60'"
          value={football === null ? "…" : football === false ? "—"
            : `${football.byMinute?.["60"]?.summary.avg_price ?? "—"}¢`}
          sub={football && football.byMinute?.["60"]
            ? `${football.byMinute["60"].summary.priced} games with usable price history`
            : "Polymarket, 1-minute history"}
        />
      </div>

      {football === false && (
        <div style={{ fontSize: 13, color: T.red }}>
          Could not load the football study — is the backend up to date?
        </div>
      )}
      {football && football.byMinute && <FootballDraw60 data={football} />}
    </main>
  );
}
