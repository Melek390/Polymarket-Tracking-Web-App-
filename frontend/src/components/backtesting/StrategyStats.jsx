import { useEffect, useRef, useState } from "react";
import { T, card, monoText, btn } from "../../theme.js";
import EquityLine from "./EquityLine.jsx";

// which trades belong to a by-situation row, from its label (fairvalue only —
// its trade rows carry these fields)
function situationFilter(label) {
  const m = label.match(/^Down (\d)/);
  if (m) return (t) => t.reason_deficit === `down ${m[1]}`;
  if (label.startsWith("HOME")) return (t) => t.bought_side === "home";
  if (label.startsWith("AWAY")) return (t) => t.bought_side === "away";
  if (label.startsWith("Both")) return () => true;
  if (label.includes("below 20")) return (t) => t.reason_market_price_cents < 20;
  if (label.includes("20–35")) return (t) => t.reason_market_price_cents >= 20
    && t.reason_market_price_cents < 35;
  if (label.includes("35¢+")) return (t) => t.reason_market_price_cents >= 35;
  return null;
}

// The stats block under an expanded strategy: KPI row, equity curve, and the
// per-situation breakdown the client asked for ("79% on home teams at score X").
// Presentational only — numbers come in as props (mock for now).

const usd = (n) =>
  `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const lbl = { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: T.sub };

function Kpi({ title, value, color }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div style={lbl}>{title}</div>
      <div style={{ ...monoText, fontSize: 20, fontWeight: 700, color: color || T.ink }}>{value}</div>
    </div>
  );
}

export default function StrategyStats({ stats, onDownload, downloading, fetchTrades }) {
  const s = stats;
  // the sell-at-a-level ladder folds out of the side row on a "+" (client:
  // "if he takes these params, what if he sold at a fixed level instead of
  // waiting for settlement")
  const [ladderOpen, setLadderOpen] = useState(false);

  // per-row CSVs: one trades fetch per run, cached; each row filters it
  const tradesRef = useRef(null);
  const [rowBusy, setRowBusy] = useState(null);
  // which situation rows have their per-team breakdown open
  const [openTeams, setOpenTeams] = useState(() => new Set());
  const toggleTeams = (label) => setOpenTeams((prev) => {
    const next = new Set(prev);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });
  useEffect(() => { tradesRef.current = null; }, [stats]);

  async function downloadRow(label, filter, colPick) {
    if (!fetchTrades) return;
    setRowBusy(label);
    try {
      if (!tradesRef.current) tradesRef.current = await fetchTrades();
      const rows = tradesRef.current.filter(filter);
      let cols = [...new Set(rows.flatMap((t) => Object.keys(t)))];
      if (colPick) cols = cols.filter(colPick);
      const esc = (v) => {
        if (v == null) return "";
        const t = typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
        return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
      };
      const csv = [cols.join(","),
        ...rows.map((t) => cols.map((c) => esc(t[c])).join(","))].join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["﻿" + csv],
        { type: "text/csv;charset=utf-8" }));
      a.download = `${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
        .replace(/^-+|-+$/g, "")}-trades.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setRowBusy(null);
    }
  }

  const DlRow = ({ label, filter, colPick, hint }) => (
    <button onClick={() => downloadRow(label, filter, colPick)}
      disabled={rowBusy === label}
      title={hint || "Download this row's trades as a CSV"}
      style={{ ...btn.outline, fontSize: 10, fontWeight: 700,
        padding: "1px 7px", marginLeft: 7,
        opacity: rowBusy === label ? 0.5 : 1 }}>
      {rowBusy === label ? "…" : "⬇"}
    </button>
  );
  // the headline money strip lives right above the equity curve (the client
  // reads them together), not at the top of the panel
  const kpiRow = (
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center",
        margin: "14px 0 10px" }}>
        <Kpi title="Win rate" value={pct(s.winRate)} color={s.winRate >= 0.5 ? T.green : T.red} />
        {/* when only part of the sample has prices, the P&L covers THAT part
            — say so in the label rather than letting it read as all of it */}
        <Kpi
          title={s.gamesWithPrice != null && s.gamesWithPrice < s.spots
            ? `P&L (${s.gamesWithPrice} priced)` : "P&L"}
          value={usd(s.pnl)} color={s.pnl >= 0 ? T.green : T.red} />
        <Kpi title="Spots" value={s.spots} />
        <Kpi title="Wins" value={s.wins} />
        <Kpi title="Avg bounce" value={`${s.avgBounceCents}¢`} />
        <Kpi title="Avg hold" value={`${s.avgHoldHalfInnings} half-inn`} />
        <Kpi title="Max drawdown" value={usd(s.maxDrawdown)} color={T.red} />
        {s.feesPaid != null && <Kpi title="Fees paid" value={usd(-s.feesPaid)} color={T.sub} />}
        {/* the tag's other verdict: did the comeback actually complete —
            read from each market's own settlement, not from the scalp */}
        {s.comebackRate != null && (
          <Kpi title="Comeback completed"
            value={`${pct(s.comebackRate)} (${s.comebackWon}/${s.comebackDecided})`}
            color={s.comebackRate >= 0.5 ? T.green : T.ink} />
        )}
        {onDownload && (
          <button
            onClick={onDownload}
            disabled={downloading || !s.spots}
            title={s.spots ? "Every spot behind these numbers, as a CSV (respects the current params)"
              : "No spots under the current params"}
            style={{ ...btn.outline, fontSize: 13, padding: "7px 14px",
              marginLeft: "auto", whiteSpace: "nowrap",
              opacity: downloading || !s.spots ? 0.6 : 1 }}
          >
            {downloading ? "Preparing…" : "⬇ Download spots (CSV)"}
          </button>
        )}
      </div>
  );
  return (
    <div style={{ padding: "14px 16px", borderTop: `1px solid ${T.border}`, background: T.soft }}>
      {/* gold = live-collected 1-10s ticks, silver = minute bars backfilled
          after the fact — never silently mixed (the Aug 6 rule) */}
      {s.segments && (
        <div style={{ fontSize: 12, color: T.sub, marginTop: 10 }}>
          <b>Gold</b> (live-collected): {s.segments.gold.spots} spots,{" "}
          {pct(s.segments.gold.winRate)} win rate, {usd(s.segments.gold.pnl)}
          {" · "}
          <b>Silver</b> (minute bars): {s.segments.silver.spots} spots,{" "}
          {pct(s.segments.silver.winRate)} win rate, {usd(s.segments.silver.pnl)}
        </div>
      )}
      {/* Clear Favorite coverage: the score is pre-game, so this strategy
          reaches games with NO tick data — say how far it reached */}
      {s.lockedGames != null && (
        <div style={{ fontSize: 12, color: T.sub, marginTop: 10 }}>
          Coverage: <b>{s.lockedGames}</b> real T-5 locks ·{" "}
          <b>{s.reconstructedGames}</b> reconstructed
          {s.outsideTickCorpus > 0 && (
            <> — <b>{s.outsideTickCorpus}</b> of them outside the tick corpus
              (entry from Polymarket's settled history, outcome from MLB finals)</>
          )}
          {s.unsettled > 0 && <> · {s.unsettled} unsettled skipped</>}
          {s.avgEntryCents != null && (
            <> · avg entry {s.avgEntryCents}¢ (implied {pct(s.impliedWinRate)})</>
          )}
        </div>
      )}
      {s.warning && (
        <div style={{ marginTop: 10, padding: "8px 11px", borderRadius: 8,
          background: "#FEF9E7", border: "1px solid #F5D67B",
          fontSize: 12, color: T.ink }}>
          ⚠ {s.warning}
        </div>
      )}
      {s.dateRange && (
        <div style={{ fontSize: 12, color: T.sub, marginTop: 10 }}>
          Backtest window: <b>{s.dateRange.from}</b> → <b>{s.dateRange.to}</b>{" "}
          ({s.dateRange.days} day{s.dateRange.days === 1 ? "" : "s"} of recorded history)
        </div>
      )}
      {/* the fair-value strategy's core exhibit: history vs the market,
          state by state, BEFORE any trading rule is applied */}
      {s.fairTable && (
        <>
          <div style={{ ...lbl, margin: "14px 0 4px" }}>
            Was the market right? — historical win rate vs Polymarket price
            (fair values from {s.fairTable.seasons.join(", ") || "no seasons yet"})
          </div>
          <div style={{ ...card, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Situation", "Real win rate", "Games", "Avg market price",
                    "Priced spots", "Gap"].map((h, i) => (
                    <th key={h} style={{ ...lbl, padding: "8px 12px",
                      textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.fairTable.rows.map((row) => (
                  <tr key={row.state} style={{ borderTop: `1px solid ${T.border}` }}>
                    <td style={{ fontFamily: T.ui, fontSize: 13, padding: "7px 12px" }}>
                      {row.state}
                    </td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>
                      {row.fairPct == null
                        ? <span title={`fewer than ${s.fairTable.minSample} historical games`}>thin</span>
                        : `${row.fairPct}%`}
                    </td>
                    <td style={{ ...monoText, fontSize: 12, padding: "7px 12px",
                      textAlign: "right", color: T.faint }}>
                      {row.fairGames}
                    </td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>
                      {row.avgPriceCents == null ? "—" : `${row.avgPriceCents}¢`}
                    </td>
                    <td style={{ ...monoText, fontSize: 12, padding: "7px 12px",
                      textAlign: "right", color: T.faint }}>
                      {row.pricedSpots}
                    </td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px",
                      textAlign: "right", fontWeight: 700,
                      color: row.gapCents == null ? T.sub
                        : row.gapCents <= -3 ? T.green
                        : row.gapCents >= 3 ? T.red : T.ink }}
                      title="negative = the market prices the team BELOW its history (the buy case)">
                      {row.gapCents == null ? "—"
                        : `${row.gapCents > 0 ? "+" : ""}${row.gapCents}¢`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>
            Gap = average market price − historical win rate. Negative (green)
            means the market is MORE pessimistic than history — the discount
            this strategy buys. This table ignores the entry gate: it is the
            raw market-vs-history picture.
          </div>
        </>
      )}

      {s.bounceStats && s.bounceStats.length > 0 && (
        <>
          <div style={{ ...lbl, margin: "14px 0 4px" }}>
            Bounces after entry — including games the team went on to lose
          </div>
          <div style={{ ...card, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Event", "Entries", "% of entries", "In eventual wins",
                    "In eventual losses",
                    ...(s.bounceStats.some((r) => r.pnl != null)
                      ? ["P&L selling this bounce"] : [])].map((h, i) => (
                    <th key={h} style={{ ...lbl, padding: "8px 12px",
                      textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.bounceStats.map((row) => (
                  <tr key={row.label} style={{ borderTop: `1px solid ${T.border}` }}>
                    <td style={{ fontFamily: T.ui, fontSize: 13, padding: "7px 12px" }}>{row.label}</td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>
                      {row.games}
                    </td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px",
                      textAlign: "right", fontWeight: 700 }}>
                      {row.pct == null ? "—" : `${row.pct}%`}
                    </td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>
                      {row.inEventualWins}
                    </td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>
                      {row.inEventualLosses}
                    </td>
                    {row.pnl != null && (
                      <td title={`full B exit at this target over ${row.pnlSpots} priced entries — sell the bounce, or exit at the window's end when it never comes`}
                        style={{ ...monoText, fontSize: 13, padding: "7px 12px",
                          textAlign: "right", fontWeight: 700,
                          color: row.pnl >= 0 ? T.green : T.red }}>
                        {usd(row.pnl)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {s.coverageNote && (
        <div style={{ fontSize: 12, color: T.sub, marginTop: 10 }}>{s.coverageNote}</div>
      )}
      {s.factorUnknowns && Object.keys(s.factorUnknowns).length > 0 && (
        <div style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>
          Factors scored as unknown (0 pts, never invented):{" "}
          {Object.entries(s.factorUnknowns).map(([k, v]) => `${k} ×${v}`).join(" · ")}
        </div>
      )}

      {kpiRow}
      <div style={{ ...lbl, margin: "0 0 4px" }}>Equity curve (cumulative P&L)</div>
      <div style={{ ...card, padding: "8px 10px" }}>
        <EquityLine points={s.equity} />
      </div>

      {/* rules-only vs score cutoffs, side by side — the spec's FIRST
          deliverable: the score has to EARN its place */}
      {s.comparison && (() => {
        const hasCb = s.comparison.some((r) => r.comebackRate != null);
        // strategies with a separate money table keep these rows outcome-only
        const hasPnl = s.comparison.some((r) => r.pnl != null);
        const hasPriced = hasPnl && s.comparison.some((r) => r.priced != null);
        const heads = ["Variant", "Spots", "Wins", "Win rate",
          ...(hasPriced ? ["Priced"] : []), ...(hasPnl ? ["P&L", "Fees"] : []),
          ...(hasCb ? ["Comeback"] : [])];
        return (
          <>
            <div style={{ ...lbl, margin: "14px 0 4px" }}>
              {s.comparisonTitle
                || (hasCb
                  ? "One knob at a time — fatigue filter and minimum inning"
                  : "Does the checklist earn its place? — same gate, rising score cutoffs")}
            </div>
            <div style={{ ...card, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {heads.map((h, i) => (
                      <th key={h} style={{ ...lbl, padding: "8px 12px",
                        textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.comparison.map((row) => (
                    <tr key={row.label} style={{ borderTop: `1px solid ${T.border}`,
                      ...(row.saved ? { fontWeight: 700 } : {}) }}>
                      <td style={{ fontFamily: T.ui, fontSize: 13, padding: "7px 12px" }}>{row.label}</td>
                      <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>{row.spots}</td>
                      <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>{row.wins}</td>
                      <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right",
                        fontWeight: 700, color: row.winRate >= 0.5 ? T.green : T.red }}>
                        {pct(row.winRate)}
                      </td>
                      {hasPriced && (
                        <td style={{ ...monoText, fontSize: 12, padding: "7px 12px",
                          textAlign: "right", color: T.faint }}
                          title="Games in this row with a recorded price — the only ones the P&L covers">
                          {row.priced ?? "—"}
                        </td>
                      )}
                      {hasPnl && (<>
                      <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right",
                        color: row.pnl >= 0 ? T.green : T.red }}>
                        {usd(row.pnl)}
                      </td>
                      <td style={{ ...monoText, fontSize: 12, padding: "7px 12px", textAlign: "right",
                        color: T.sub }}>
                        {usd(-(row.feesPaid ?? 0))}
                      </td>
                      </>)}
                      {hasCb && (
                        <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>
                          {row.comebackRate != null ? pct(row.comebackRate) : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      })()}

      <div style={{ ...lbl, margin: "14px 0 4px" }}>
        {s.bySituationTitle || "Where it wins — by situation"}
      </div>
      <div style={{ ...card, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Situation", "Spots", "Win rate",
                ...(s.bySituation.some((r) => r.avgEntryCents != null)
                  ? ["Avg entry ¢", "Median entry ¢"] : []),
                ...(s.bySituation.some((r) => r.pnl != null && r.priced != null) ? ["Priced"] : []),
                ...(s.bySituation.some((r) => r.pnl != null) ? ["P&L"] : []),
                ...(s.bySituation.some((r) => r.comebackRate != null) ? ["Comeback"] : []),
              ].map((h, i) => (
                <th key={h} style={{ ...lbl, padding: "8px 12px",
                  textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.bySituation.map((row) => {
              const isLadderRow = !!(s.sellLadder && s.sellLadder.length
                && row.label.includes("trailing"));
              const showSold = s.bySituation.some((r) => r.pnl != null && r.priced != null);
              const hasEntryCols = s.bySituation.some((r) => r.avgEntryCents != null);
              const teamsOpen = openTeams.has(row.label);
              return [(
              <tr key={row.label} style={{ borderTop: `1px solid ${T.border}` }}>
                <td style={{ fontFamily: T.ui, fontSize: 13, padding: "7px 12px" }}>
                  {row.label}
                  {isLadderRow && (
                    <button onClick={() => setLadderOpen((v) => !v)}
                      title="What if you sold at a fixed level instead of waiting for settlement?"
                      style={{ ...btn.outline, fontSize: 11, fontWeight: 700,
                        padding: "1px 8px", marginLeft: 8 }}>
                      {ladderOpen ? "−" : "+"} sell levels
                    </button>
                  )}
                  {s.sellLadder && fetchTrades && situationFilter(row.label) && (
                    <DlRow label={row.label} filter={situationFilter(row.label)}
                      hint="Every trade behind this row, as a CSV" />
                  )}
                  {row.teams && row.teams.length > 0 && (
                    <button onClick={() => toggleTeams(row.label)}
                      title="Team by team: what we paid and how it went in this situation"
                      style={{ ...btn.outline, fontSize: 11, fontWeight: 700,
                        padding: "1px 8px", marginLeft: 7 }}>
                      {teamsOpen ? "−" : "+"} teams
                    </button>
                  )}
                </td>
                <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>{row.spots}</td>
                <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right",
                  fontWeight: 700, color: row.winRate >= 0.5 ? T.green : T.red }}>
                  {pct(row.winRate)}
                </td>
                {hasEntryCols && (
                  <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}
                    title="Average price actually PAID in this situation — entries only, not every moment the situation occurred">
                    {row.avgEntryCents == null ? "—" : `${row.avgEntryCents}¢`}
                  </td>
                )}
                {hasEntryCols && (
                  <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>
                    {row.medianEntryCents == null ? "—" : `${row.medianEntryCents}¢`}
                  </td>
                )}
                {row.pnl != null && row.priced != null && (
                  <td style={{ ...monoText, fontSize: 12, padding: "7px 12px",
                    textAlign: "right", color: T.faint }}
                    title="Games in this row with a recorded price — the only ones the P&L covers">
                    {row.priced}
                  </td>
                )}
                {row.pnl != null && (
                <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right",
                  color: row.pnl >= 0 ? T.green : T.red }}>
                  {usd(row.pnl)}
                </td>
                )}
                {row.comebackRate != null && (
                  <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>
                    {pct(row.comebackRate)}
                  </td>
                )}
              </tr>
              ),
              ...(teamsOpen && row.teams ? row.teams.map((tr) => (
                <tr key={row.label + tr.team} style={{ borderTop: `1px solid ${T.soft}`,
                  background: T.soft }}>
                  <td style={{ fontFamily: T.ui, fontSize: 12.5, color: T.sub,
                    padding: "4px 12px 4px 28px" }}>↳ {tr.team}</td>
                  <td style={{ ...monoText, fontSize: 12.5, padding: "4px 12px",
                    textAlign: "right", color: T.sub }}>{tr.spots}</td>
                  <td style={{ ...monoText, fontSize: 12.5, padding: "4px 12px",
                    textAlign: "right", fontWeight: 700,
                    color: tr.winRate >= 0.5 ? T.green : T.red }}>{pct(tr.winRate)}</td>
                  {hasEntryCols && (
                    <td style={{ ...monoText, fontSize: 12.5, padding: "4px 12px",
                      textAlign: "right" }}>
                      {tr.avgEntryCents == null ? "—" : `${tr.avgEntryCents}¢`}
                    </td>
                  )}
                  {hasEntryCols && (
                    <td style={{ ...monoText, fontSize: 12, padding: "4px 12px",
                      textAlign: "right", color: T.faint }}>—</td>
                  )}
                  {showSold && (
                    <td style={{ ...monoText, fontSize: 12, padding: "4px 12px",
                      textAlign: "right", color: T.faint }}>—</td>
                  )}
                  <td style={{ ...monoText, fontSize: 12.5, padding: "4px 12px",
                    textAlign: "right", fontWeight: 700,
                    color: tr.pnl >= 0 ? T.green : T.red }}>{usd(tr.pnl)}</td>
                </tr>
              )) : []),
              ...(isLadderRow && ladderOpen ? [
                ...s.sellLadder.map((lr) => (
                  <tr key={lr.label} style={{ borderTop: `1px solid ${T.soft}`,
                    background: T.soft }}>
                    <td style={{ fontFamily: T.ui, fontSize: 12.5, color: T.sub,
                      padding: "5px 12px 5px 28px" }}>
                      ↳ {lr.label} instead of holding
                      {fetchTrades && (() => {
                        // "Sold at 60¢" -> keep the core columns plus THIS
                        // level's sold/pnl pair, drop the other levels
                        const lvl = (lr.label.match(/([\d.]+)¢/) || [])[1];
                        return lvl ? (
                          <DlRow label={lr.label} filter={() => true}
                            colPick={(c) => !/^(sold_at_|pnl_if_sold_)/.test(c)
                              || c === `sold_at_${lvl}c`
                              || c === `pnl_if_sold_${lvl}c`}
                            hint="All entries with whether each sold at this level and for how much" />
                        ) : null;
                      })()}
                    </td>
                    <td style={{ ...monoText, fontSize: 12.5, padding: "5px 12px",
                      textAlign: "right", color: T.sub }}>{lr.spots}</td>
                    <td style={{ ...monoText, fontSize: 12.5, padding: "5px 12px",
                      textAlign: "right", fontWeight: 700,
                      color: lr.winRate >= 0.5 ? T.green : T.red }}
                      title="share of trades that actually got out at this level">
                      {lr.winRate == null ? "—" : pct(lr.winRate)}
                    </td>
                    {hasEntryCols && (
                      <td style={{ ...monoText, fontSize: 12, padding: "5px 12px",
                        textAlign: "right", color: T.faint }}>—</td>
                    )}
                    {hasEntryCols && (
                      <td style={{ ...monoText, fontSize: 12, padding: "5px 12px",
                        textAlign: "right", color: T.faint }}>—</td>
                    )}
                    {showSold && (
                      <td style={{ ...monoText, fontSize: 12, padding: "5px 12px",
                        textAlign: "right", color: T.faint }}
                        title="how many of the trades sold at this level">
                        {lr.sold} sold
                      </td>
                    )}
                    <td style={{ ...monoText, fontSize: 12.5, padding: "5px 12px",
                      textAlign: "right", fontWeight: 700,
                      color: lr.pnl >= 0 ? T.green : T.red }}>
                      {usd(lr.pnl)}
                    </td>
                  </tr>
                )),
                (
                  <tr key="ladder-note" style={{ background: T.soft }}>
                    <td colSpan={99} style={{ fontSize: 11, color: T.faint,
                      padding: "4px 12px 8px 28px" }}>
                      A winner's price must pass every level on its way to $1, so wins
                      always sell; a loss sells only if its recorded price path touched
                      the level. Unsold trades ride to settlement.
                    </td>
                  </tr>
                ),
              ] : []),
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* the money, in its own table (client: keep the outcome tables clean).
          P&L per variant over the PRICED games only, then how far the backed
          side's price travelled after the break — through settlement, so a
          winner's run to $1 counts as reaching every level. */}
      {s.moneyTable && (
        <>
          <div style={{ ...lbl, margin: "16px 0 4px" }}>
            Money — the {s.moneyTable.pricedGames} priced games only
            ({s.moneyTable.side} side)
          </div>
          <div style={{ ...card, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Variant", "Priced games", "Win rate (priced)", "P&L", "Fees"].map((h, i) => (
                    <th key={h} style={{ ...lbl, padding: "8px 12px",
                      textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.moneyTable.variants.map((row) => (
                  <tr key={row.label} style={{ borderTop: `1px solid ${T.border}` }}>
                    <td style={{ fontFamily: T.ui, fontSize: 13, padding: "7px 12px" }}>{row.label}</td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>
                      {row.priced}
                    </td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right",
                      color: row.winRatePriced >= 0.5 ? T.green : T.red }}>
                      {row.spots ? pct(row.winRatePriced) : "—"}
                    </td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right",
                      fontWeight: 700, color: row.pnl >= 0 ? T.green : T.red }}>
                      {usd(row.pnl)}
                    </td>
                    <td style={{ ...monoText, fontSize: 12, padding: "7px 12px", textAlign: "right",
                      color: T.sub }}>
                      {usd(-(row.feesPaid ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ ...lbl, margin: "14px 0 4px" }}>
            Price movement after the break — {s.moneyTable.pricedGames} priced
            games, {s.moneyTable.side} price
          </div>
          {s.moneyTable.breakNote && (
            <div style={{ fontSize: 11, color: T.faint, margin: "0 0 4px" }}>
              "The break" = {s.moneyTable.breakNote}.
            </div>
          )}
          <div style={{ ...card, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Event", "Games", "% of priced", "P&L if sold there"].map((h, i) => (
                    <th key={h} style={{ ...lbl, padding: "8px 12px",
                      textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.moneyTable.thresholds.map((row) => (
                  <tr key={row.label} style={{ borderTop: `1px solid ${T.border}` }}>
                    <td style={{ fontFamily: T.ui, fontSize: 13, padding: "7px 12px" }}
                      title={row.rule}>
                      {row.label}
                    </td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right" }}>
                      {row.games}
                    </td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right",
                      fontWeight: 700 }}>
                      {row.pct == null ? "—" : `${row.pct}%`}
                    </td>
                    <td style={{ ...monoText, fontSize: 13, padding: "7px 12px", textAlign: "right",
                      fontWeight: 700,
                      color: row.pnl == null ? T.sub : row.pnl >= 0 ? T.green : T.red }}
                      title={row.rule}>
                      {row.pnl == null ? "—" : usd(row.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: T.faint, marginTop: 6 }}>
            Levels are measured from the break to settlement on our recorded
            prices — a winning side always finishes near $1, so "rose above"
            includes the run to resolution; "fell below" includes the slide of
            an eventual loser. The P&L column answers "what if we sold there":
            for "rose above" rows a sell order at that level (filled whenever
            the price touches it, held to settlement otherwise); for "fell
            below" rows a stop-loss at that level. Both run over all{" "}
            {s.moneyTable.pricedGames} priced games with the strategy's own
            stake, slippage and fee settings.
          </div>
        </>
      )}
    </div>
  );
}
