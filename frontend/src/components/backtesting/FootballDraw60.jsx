import { useState } from "react";
import { T, card, monoText } from "../../theme.js";

// Draw at 60' — 2025: the first football strategy. A frozen study (the 2025
// calendar is complete), served whole by /api/backtest/football — no Run
// button, no params. Seven clubs, every game that was LEVEL at the 60th
// minute, what happened by the 90th, and what Polymarket charged for the
// club's win at that moment.

const th = {
  textAlign: "right", padding: "6px 10px", fontSize: 11, fontWeight: 600,
  color: T.sub, borderBottom: `1px solid ${T.line}`, whiteSpace: "nowrap",
};
const td = { ...monoText, textAlign: "right", padding: "5px 10px", fontSize: 13, whiteSpace: "nowrap" };
const money = (v) => (
  <span style={{ color: v >= 0 ? T.green : T.red }}>
    {v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}
  </span>
);

function TeamGames({ games }) {
  return (
    <tr>
      <td colSpan={8} style={{ padding: "2px 10px 10px 26px" }}>
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {games.map((g, i) => (
              <tr key={i} style={{ color: T.sub, fontSize: 12 }}>
                <td style={{ ...monoText, padding: "1px 10px 1px 0", fontSize: 12 }}>{g.date}</td>
                <td style={{ padding: "1px 10px 1px 0" }}>{g.ha === "H" ? "vs" : "at"} {g.opp}</td>
                <td style={{ padding: "1px 10px 1px 0", color: T.faint }}>{g.league}</td>
                <td style={{ ...monoText, padding: "1px 10px 1px 0", fontSize: 12 }}>{g.score60} at 60&apos;</td>
                <td style={{
                  ...monoText, padding: "1px 10px 1px 0", fontSize: 12, fontWeight: 700,
                  color: g.result90 === "W" ? T.green : g.result90 === "L" ? T.red : T.sub,
                }}>{g.result90}</td>
                <td style={{ ...monoText, padding: "1px 0", fontSize: 12 }}>
                  {g.price60 != null ? `${g.price60}¢ @60'` : "no price"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

export default function FootballDraw60({ data }) {
  const [open, setOpen] = useState({});
  if (!data) return null;
  const { meta, teams } = data;
  return (
    <div style={{ ...card, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{meta.name}</div>
        <div style={{ fontSize: 12, color: T.sub }}>
          {meta.clubs} clubs · calendar {meta.year} · {meta.available_both_apis} games
          on both APIs · frozen study
        </div>
      </div>
      <div style={{ fontSize: 12, color: T.sub, margin: "6px 0 10px" }}>
        Every game these clubs played level at the 60th minute: result by the 90th,
        and the club&apos;s win price on Polymarket at that moment. Click a team for
        its games.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Team</th>
              <th style={th}>Draws at 60&apos;</th>
              <th style={th}>W</th>
              <th style={th}>D</th>
              <th style={th}>L</th>
              <th style={th}>Win rate</th>
              <th style={th}>Avg price @60&apos;</th>
              <th style={th} title="Buy the club's win at the 60' price, $100 per priced game, hold to settlement, no fees">
                P&amp;L ($100 flat)
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(teams).map(([name, d]) => [
              <tr
                key={name}
                onClick={() => setOpen((o) => ({ ...o, [name]: !o[name] }))}
                style={{ cursor: "pointer" }}
                title="Show the games"
              >
                <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>
                  <span style={{ color: T.faint }}>{open[name] ? "▾" : "▸"}</span> {name}
                </td>
                <td style={td}>{d.draw_at_60}</td>
                <td style={{ ...td, color: T.green }}>{d.won}</td>
                <td style={td}>{d.drew}</td>
                <td style={{ ...td, color: T.red }}>{d.lost}</td>
                <td style={td}>{d.win_rate != null ? `${Math.round(d.win_rate)}%` : "—"}</td>
                <td style={td}>{d.avg_price60 != null ? `${d.avg_price60}¢` : "—"}</td>
                <td style={td}>{money(d.pnl100)}</td>
              </tr>,
              open[name] && <TeamGames key={name + ":games"} games={d.games} />,
            ])}
            <tr style={{ borderTop: `2px solid ${T.line}` }}>
              <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>Total</td>
              <td style={{ ...td, fontWeight: 700 }}>{meta.draws_at_60}</td>
              <td style={{ ...td, fontWeight: 700, color: T.green }}>{meta.won}</td>
              <td style={{ ...td, fontWeight: 700 }}>{meta.drew}</td>
              <td style={{ ...td, fontWeight: 700, color: T.red }}>{meta.lost}</td>
              <td style={{ ...td, fontWeight: 700 }}>{Math.round(meta.win_rate)}%</td>
              <td style={{ ...td, fontWeight: 700 }}>{meta.avg_price60}¢</td>
              <td style={{ ...td, fontWeight: 700 }}>{money(meta.pnl100)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: T.faint, marginTop: 8 }}>
        {meta.note} {meta.priced} of {meta.draws_at_60} draws had usable price
        history; the rest count in the stats but not the P&amp;L. Polymarket listed
        {" "}{meta.available_both_apis} of the clubs&apos; {meta.fixtures_2025} finished
        2025 games (Jan–Jun league coverage was thin, friendlies and small cups absent).
      </div>
    </div>
  );
}
