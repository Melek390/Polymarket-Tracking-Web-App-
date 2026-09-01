import { useState } from "react";
import { T, card, btn, monoText } from "../../theme.js";

// Draw at 60' — 2025: the first football strategy. A frozen study (the 2025
// calendar is complete): every minute variant was precomputed server-side by
// backend/backtest/football.py, so "Adjust settings" switches instantly with
// no run step. Shaped like the MLB cards: collapsed by default, +/− to
// expand, ⚙ to change the betting minute.

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
      <td colSpan={9} style={{ padding: "2px 10px 10px 26px" }}>
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {games.map((g, i) => (
              <tr key={i} style={{ color: T.sub, fontSize: 12 }}>
                <td style={{ ...monoText, padding: "1px 10px 1px 0", fontSize: 12 }}>{g.date}</td>
                <td style={{ padding: "1px 10px 1px 0" }}>{g.ha === "H" ? "vs" : "at"} {g.opp}</td>
                <td style={{ padding: "1px 10px 1px 0", color: T.faint }}>{g.league}</td>
                <td style={{ ...monoText, padding: "1px 10px 1px 0", fontSize: 12 }}>{g.scoreAt}</td>
                <td style={{
                  ...monoText, padding: "1px 10px 1px 0", fontSize: 12, fontWeight: 700,
                  color: g.result90 === "W" ? T.green : g.result90 === "L" ? T.red : T.sub,
                }}>{g.result90}</td>
                <td style={{ ...monoText, padding: "1px 0", fontSize: 12 }}>
                  {g.priceAt != null ? `${g.priceAt}¢` : "no price"}
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
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [teamOpen, setTeamOpen] = useState({});
  const { meta, byMinute } = data;
  const [minute, setMinute] = useState(meta.default_minute);
  const view = byMinute[String(minute)];
  if (!view) return null;
  const s = view.summary;

  return (
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
        <button
          onClick={() => setOpen((o) => !o)}
          title={open ? "Collapse" : "Expand"}
          style={{ ...btn.outline, fontSize: 14, padding: "1px 8px", lineHeight: 1.4 }}
        >
          {open ? "−" : "+"}
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: T.ui, fontSize: 15, fontWeight: 600 }}>
            {meta.name}
            <span style={{ fontWeight: 400, color: T.sub, fontSize: 12, marginLeft: 8 }}>
              level at {minute}&apos; · {s.draws} spots · W {s.won} / D {s.drew} / L {s.lost}
              {" "}· after fees {money(s.pnl100_fees)}
            </span>
          </div>
          <div style={{ fontSize: 12, color: T.sub, marginTop: 2 }}>
            {meta.clubs} clubs · calendar {meta.year} · {meta.available_both_apis} games
            on both APIs · frozen study, every minute precomputed
          </div>
        </div>
        <button
          onClick={() => setEditing((e) => !e)}
          style={{ ...btn.outline, fontSize: 13, padding: "7px 14px", whiteSpace: "nowrap" }}
        >
          ⚙ Adjust settings
        </button>
      </div>

      {editing && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          padding: "0 16px 12px",
        }}>
          <span style={{ fontSize: 12, color: T.sub }}>Bet when the game is level at minute:</span>
          {meta.minutes.map((m) => (
            <button
              key={m}
              onClick={() => { setMinute(m); setOpen(true); }}
              style={{
                ...(m === minute ? btn.green : btn.outline),
                fontSize: 13, padding: "4px 12px",
              }}
            >
              {m}&apos;
            </button>
          ))}
          <span style={{ fontSize: 11, color: T.faint }}>
            price sampled at that minute of play — switches instantly, all variants precomputed
          </span>
        </div>
      )}

      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Team</th>
                  <th style={th}>Level at {minute}&apos;</th>
                  <th style={th}>W</th>
                  <th style={th}>D</th>
                  <th style={th}>L</th>
                  <th style={th}>Win rate</th>
                  <th style={th}>Avg price @{minute}&apos;</th>
                  <th style={th} title="Buy the club's win at that minute's price, $100 per priced game, hold to settlement">
                    P&amp;L ($100 flat)
                  </th>
                  <th style={th} title="Same, minus Polymarket's sports taker fee on the buy leg">
                    After fees
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(view.teams).map(([name, d]) => [
                  <tr
                    key={name}
                    onClick={() => setTeamOpen((o) => ({ ...o, [name]: !o[name] }))}
                    style={{ cursor: "pointer" }}
                    title="Show the games"
                  >
                    <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>
                      <span style={{ color: T.faint }}>{teamOpen[name] ? "−" : "+"}</span> {name}
                    </td>
                    <td style={td}>{d.draws}</td>
                    <td style={{ ...td, color: T.green }}>{d.won}</td>
                    <td style={td}>{d.drew}</td>
                    <td style={{ ...td, color: T.red }}>{d.lost}</td>
                    <td style={td}>{d.win_rate != null ? `${Math.round(d.win_rate)}%` : "—"}</td>
                    <td style={td}>{d.avg_price != null ? `${d.avg_price}¢` : "—"}</td>
                    <td style={td}>{money(d.pnl100)}</td>
                    <td style={td}>{money(d.pnl100_fees)}</td>
                  </tr>,
                  teamOpen[name] && <TeamGames key={name + ":games"} games={d.games} />,
                ])}
                <tr style={{ borderTop: `2px solid ${T.line}` }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>Total</td>
                  <td style={{ ...td, fontWeight: 700 }}>{s.draws}</td>
                  <td style={{ ...td, fontWeight: 700, color: T.green }}>{s.won}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{s.drew}</td>
                  <td style={{ ...td, fontWeight: 700, color: T.red }}>{s.lost}</td>
                  <td style={{ ...td, fontWeight: 700 }}>
                    {s.win_rate != null ? `${Math.round(s.win_rate)}%` : "—"}
                  </td>
                  <td style={{ ...td, fontWeight: 700 }}>{s.avg_price}¢</td>
                  <td style={{ ...td, fontWeight: 700 }}>{money(s.pnl100)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{money(s.pnl100_fees)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: T.faint, marginTop: 8 }}>
            {meta.note} {s.priced} of {s.draws} spots had usable price history; the
            rest count in the stats but not the P&amp;L. Polymarket listed
            {" "}{meta.available_both_apis} of the clubs&apos; {meta.fixtures_2025} finished
            2025 games (Jan–Jun league coverage was thin, friendlies and small cups absent).
          </div>
        </div>
      )}
    </div>
  );
}
