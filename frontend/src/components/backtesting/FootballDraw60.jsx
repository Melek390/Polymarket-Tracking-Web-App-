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

// Aggregates recomputed from the per-game rows so the Home/Away and YES/NO
// filters can slice everything client-side — same $100-flat and taker-fee
// arithmetic as backend/backtest/football.py, which ships every game.
//
// mode "yes": buy the club's win — pays only on a W.
// mode "no":  buy NO on the opponent's win (entry = 100 - opponent price) —
//             pays on a W or a D, at a much higher entry price.
// spread: the client's delayed-data safety margin, in CENTS (Polymarket
// prices are cents-on-the-dollar, so ±5¢ — never a percentage). Every entry
// pays the full margin on top of the recorded price; an entry pushed to
// 100¢ or beyond is untradeable and drops out of the priced set.
export function entryPrice(g, mode, spread = 0) {
  const base = mode === "no"
    ? (g.oppPriceAt != null ? 100 - g.oppPriceAt : null)
    : g.priceAt;
  if (base == null) return null;
  const e = base + spread;
  return e > 0 && e < 100 ? e : null;
}

function aggregate(teams, side, mode, spread, keep) {
  const out = {};
  let draws = 0, won = 0, drew = 0, lost = 0, priced = 0, pxSum = 0, pnl = 0, pnlFees = 0;
  let hits = 0;
  for (const [name, d] of Object.entries(teams)) {
    let games = side === "both" ? d.games : d.games.filter((g) => g.ha === side);
    if (keep) games = games.filter(keep);
    let w = 0, dr = 0, l = 0, h = 0, p = 0, px = 0, money0 = 0, fee = 0;
    for (const g of games) {
      if (g.result90 === "W") w++; else if (g.result90 === "D") dr++; else l++;
      const hit = mode === "no" ? g.result90 !== "L" : g.result90 === "W";
      if (hit) h++;
      const entry = entryPrice(g, mode, spread);
      if (entry != null) {
        p++; px += entry;
        const shares = 100 / (entry / 100);
        fee += shares * 0.05 * (entry / 100) * (1 - entry / 100);
        money0 += hit ? (shares * (100 - entry)) / 100 : -100;
      }
    }
    out[name] = {
      games, draws: games.length, won: w, drew: dr, lost: l,
      win_rate: games.length ? (100 * h) / games.length : null,
      priced: p, avg_price: p ? px / p : null,
      pnl100: money0, pnl100_fees: money0 - fee,
    };
    draws += games.length; won += w; drew += dr; lost += l; hits += h;
    priced += p; pxSum += px; pnl += money0; pnlFees += money0 - fee;
  }
  return {
    teams: out,
    summary: {
      draws, won, drew, lost, priced,
      win_rate: draws ? (100 * hits) / draws : null,
      avg_price: priced ? pxSum / priced : null,
      pnl100: pnl, pnl100_fees: pnlFees,
    },
  };
}

function TeamGames({ games, mode, spread }) {
  return (
    <tr>
      <td colSpan={9} style={{ padding: "2px 10px 10px 26px" }}>
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {games.map((g, i) => {
              const entry = entryPrice(g, mode, spread);
              return (
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
                    {entry != null ? `${entry.toFixed(1)}¢` : "no price"}
                  </td>
                </tr>
              );
            })}
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
  const [side, setSide] = useState("both");
  const [mode, setMode] = useState("yes");
  const [spread, setSpread] = useState(0);
  const [scoreline, setScoreline] = useState("01"); // down cards: 0-1 only vs any 1-goal deficit
  const isDown = meta.trigger === "down";
  const raw = byMinute[String(minute)];
  if (!raw) return null;
  const keep = isDown && scoreline === "01" ? (g) => g.scoreAt === "0-1" : null;
  const view = aggregate(raw.teams, side, mode, spread, keep);
  const s = view.summary;
  const trigLabel = isDown
    ? (scoreline === "01" ? "down 0-1" : "a goal down") : "level";
  const sideLabel = (side === "H" ? " · home only" : side === "A" ? " · away only" : "")
    + (mode === "no" ? " · NO on the opponent" : "")
    + (spread ? ` · ±${spread}¢ spread` : "");

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
              {trigLabel} at {minute}&apos;{sideLabel} · {s.draws} spots · W {s.won} / D {s.drew} / L {s.lost}
              {" "}· after fees {money(s.pnl100_fees)}
            </span>
          </div>
          <div style={{ fontSize: 12, color: T.sub, marginTop: 2 }}>
            {meta.clubs} clubs · calendar {meta.year} · {meta.available_both_apis} games
            on both APIs · {isDown ? "the club is a goal behind" : "the game is level"} at
            the chosen minute · frozen study, every minute precomputed
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
        <div style={{ padding: "0 16px 12px", display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: T.sub }}>
              Bet when the club is {isDown ? "a goal behind" : "level"} at minute:
            </span>
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: T.sub }}>Where the club is playing:</span>
            {[["both", "Both"], ["H", "Home"], ["A", "Away"]].map(([v, lbl]) => (
              <button
                key={v}
                onClick={() => { setSide(v); setOpen(true); }}
                style={{
                  ...(v === side ? btn.green : btn.outline),
                  fontSize: 13, padding: "4px 12px",
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: T.sub }}>What to buy:</span>
            {[["yes", "YES — club to win"], ["no", "NO — opponent to win"]].map(([v, lbl]) => (
              <button
                key={v}
                onClick={() => { setMode(v); setOpen(true); }}
                style={{
                  ...(v === mode ? btn.green : btn.outline),
                  fontSize: 13, padding: "4px 12px",
                }}
              >
                {lbl}
              </button>
            ))}
            <span style={{ fontSize: 11, color: T.faint }}>
              NO pays when the club wins OR draws — pricier entry, draws count as hits
            </span>
          </div>
          {isDown && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: T.sub }}>Scoreline:</span>
              {[["01", "0-1 only"], ["any", "any one-goal deficit"]].map(([v, lbl]) => (
                <button
                  key={v}
                  onClick={() => { setScoreline(v); setOpen(true); }}
                  style={{
                    ...(v === scoreline ? btn.green : btn.outline),
                    fontSize: 13, padding: "4px 12px",
                  }}
                >
                  {lbl}
                </button>
              ))}
              <span style={{ fontSize: 11, color: T.faint }}>
                0-1 is the client&apos;s spec; any deficit (1-2, 2-3…) widens the sample
              </span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: T.sub }}>Fake spread (delayed-data safety):</span>
            {[[0, "none"], [5, "±5¢"], [10, "±10¢"]].map(([v, lbl]) => (
              <button
                key={v}
                onClick={() => { setSpread(v); setOpen(true); }}
                style={{
                  ...(v === spread ? btn.green : btn.outline),
                  fontSize: 13, padding: "4px 12px",
                }}
              >
                {lbl}
              </button>
            ))}
            <span style={{ fontSize: 11, color: T.faint }}>
              every entry pays the full margin on top of the recorded price — cents, not
              percent, because Polymarket prices are cents on the dollar
            </span>
          </div>
        </div>
      )}

      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Team</th>
                  <th style={th}>{isDown ? "Down" : "Level"} at {minute}&apos;</th>
                  <th style={th}>W</th>
                  <th style={th}>D</th>
                  <th style={th}>L</th>
                  <th style={th} title="YES mode: wins. NO mode: wins + draws (the bet's hit rate)">Hit rate</th>
                  <th style={th}>Avg price @{minute}&apos;</th>
                  <th style={th} title="$100 per priced game at that minute's entry price, hold to settlement">
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
                    <td style={td}>{d.avg_price != null ? `${d.avg_price.toFixed(1)}¢` : "—"}</td>
                    <td style={td}>{money(d.pnl100)}</td>
                    <td style={td}>{money(d.pnl100_fees)}</td>
                  </tr>,
                  teamOpen[name] && <TeamGames key={name + ":games"} games={d.games} mode={mode} spread={spread} />,
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
                  <td style={{ ...td, fontWeight: 700 }}>{s.avg_price != null ? s.avg_price.toFixed(1) : "—"}¢</td>
                  <td style={{ ...td, fontWeight: 700 }}>{money(s.pnl100)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{money(s.pnl100_fees)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ ...monoText, fontSize: 13, marginTop: 10, fontWeight: 600 }}>
            Invested {"$" + (s.priced * 100).toLocaleString("en-US")}
            <span style={{ color: T.sub, fontWeight: 400 }}> ($100 × {s.priced} priced) · </span>
            return {money(s.pnl100)}
            <span style={{ color: s.pnl100 >= 0 ? T.green : T.red }}>
              {" "}({s.priced ? (s.pnl100 >= 0 ? "+" : "−") + Math.abs((100 * s.pnl100) / (s.priced * 100)).toFixed(1) + "%" : "—"})
            </span>
            <span style={{ color: T.sub, fontWeight: 400 }}> · after fees </span>
            {money(s.pnl100_fees)}
            <span style={{ color: s.pnl100_fees >= 0 ? T.green : T.red }}>
              {" "}({s.priced ? (s.pnl100_fees >= 0 ? "+" : "−") + Math.abs((100 * s.pnl100_fees) / (s.priced * 100)).toFixed(1) + "%" : "—"})
            </span>
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
