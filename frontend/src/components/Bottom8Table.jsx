import { useEffect, useState } from "react";
import { T, card, label, monoText, btn } from "../theme.js";
import { fetchBottom8, trackAndChart } from "../api/client.js";

// "MLB Bottom 8th Innings" (client spec, Aug 20): every game that reached the
// middle of the 8th still tied, with the prices at that moment, the best each
// side reached afterwards, what happened in the 9th, and how it ended — plus
// the accumulated record underneath.

const th = { ...label, padding: "9px 10px", whiteSpace: "nowrap", textAlign: "right" };
const leftTh = { ...th, textAlign: "left" };
const td = { ...monoText, fontSize: 13, padding: "9px 10px", textAlign: "right",
  whiteSpace: "nowrap" };
const leftTd = { ...td, textAlign: "left" };

const cents = (v) => (v == null ? "—" : v >= 100 ? "$1.00" : `${v}¢`);
const score = (a, h) => (a == null || h == null ? "—" : `${a}–${h}`);
const pct = (v) => (v == null ? "—" : `${v}%`);

// same MMM D the client's sheet uses
function shortDate(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Panel({ title, note, heads, rows }) {
  return (
    <div style={{ borderTop: `1px solid ${T.border}` }}>
      <div style={{ padding: "12px 16px 6px" }}>
        <div style={{ fontFamily: T.ui, fontSize: 13, fontWeight: 700, color: T.ink }}>
          {title}
        </div>
        {note && <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>{note}</div>}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {heads.map((h, i) => (
                <th key={h} style={i === 0 ? leftTh : th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, ri) => (
              <tr key={ri} style={{ borderTop: `1px solid ${T.border}` }}>
                {cells.map((c, ci) => (
                  <td key={ci} style={ci === 0 ? { ...leftTd, fontFamily: T.ui } : td}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div style={{ padding: "14px 16px", fontSize: 12, color: T.faint }}>
            Nothing to show yet — this fills in as games finish.
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ title, value, color }) {
  return (
    <div style={{ minWidth: 118 }}>
      <div style={{ ...label, fontSize: 10 }}>{title}</div>
      <div style={{ ...monoText, fontSize: 20, fontWeight: 700, color: color || T.ink }}>
        {value}
      </div>
    </div>
  );
}

export default function Bottom8Table({ onOpenHistory }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const d = await fetchBottom8();
        if (!stop) { setData(d); setErr(null); }
      } catch (e) {
        if (!stop) setErr(e.message);
      }
    }
    load();
    // a game in progress updates its highs every few seconds server-side
    const id = setInterval(load, 20_000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  // same one-click path as the screener: track the game, then open its chart
  async function openDashboard(r) {
    if (!r.slug) return;
    const tab = window.open("", "_blank");
    if (tab) {
      tab.document.write(
        "<title>Opening chart…</title><body style=\"font:14px system-ui;"
        + "color:#3F4854;padding:28px\">Adding to the tracker and pulling its "
        + "price history…</body>");
      tab.document.close();
    }
    setBusy(r.game_pk);
    try {
      const res = await trackAndChart(r.slug);
      if (tab) tab.location = `/market/${res.market_id}`;
      else onOpenHistory?.(res.market_id);
    } catch (e) {
      tab?.close();
      setErr(`Could not open the chart: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  const rows = data?.rows ?? [];
  const s = data?.stats;

  return (
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontFamily: T.ui, fontSize: 15, fontWeight: 700, color: T.ink }}>
          MLB Bottom 8th Innings
        </div>
        <div style={{ fontSize: 12, color: T.sub, marginTop: 2 }}>
          Every game still tied when the top of the 8th ended and the bottom was
          about to start — recorded automatically, then followed to the last out.
        </div>
      </div>

      {err && (
        <div style={{ padding: "10px 16px", fontSize: 13, color: T.red }}>{err}</div>
      )}
      {!data && !err && (
        <div style={{ padding: "20px 16px", fontSize: 13, color: T.faint }}>Loading…</div>
      )}

      {data && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={leftTh}>Date</th>
                <th style={leftTh}>Game</th>
                <th style={th}>B8 Start Score</th>
                <th style={th}>B8 Home Price</th>
                <th style={th}>B8 Away Price</th>
                <th style={th}>Home High</th>
                <th style={th}>Away High</th>
                <th style={th}>B9 Start Score</th>
                <th style={th}>B9 Home Price</th>
                <th style={th}>Extras</th>
                <th style={th}>Final Score</th>
                <th style={leftTh}>Winner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const live = r.status === "tracking";
                return (
                  <tr key={r.game_pk} style={{ borderTop: `1px solid ${T.border}` }}>
                    <td style={leftTd}>{shortDate(r.game_date)}</td>
                    <td style={{ ...leftTd, fontFamily: T.ui, whiteSpace: "normal" }}>
                      <div style={{ fontWeight: 600 }}>
                        {r.away_abbr || r.away_name} @ {r.home_abbr || r.home_name}
                        {live && (
                          <span style={{ ...monoText, fontSize: 9, fontWeight: 700,
                            color: "#fff", background: T.red, borderRadius: 4,
                            padding: "1px 5px", marginLeft: 6, verticalAlign: "middle" }}>
                            LIVE
                          </span>
                        )}
                      </div>
                      {/* the two links the client asked for under each game */}
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <button onClick={() => openDashboard(r)}
                          disabled={!r.slug || busy === r.game_pk}
                          title="Track this game and open its price chart (new tab)"
                          style={{ ...btn.primary, background: T.faint, fontSize: 10,
                            fontWeight: 700, padding: "3px 8px", whiteSpace: "nowrap" }}>
                          {busy === r.game_pk ? "…" : "📈 Dashboard"}
                        </button>
                        <a href={r.mlb_url} target="_blank" rel="noreferrer"
                          title="Box score, recap and highlights on MLB.com"
                          style={{ display: "inline-flex", alignItems: "center",
                            background: "#041E42", color: "#fff", borderRadius: 5,
                            fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
                            padding: "4px 8px", textDecoration: "none" }}>
                          MLB ↗
                        </a>
                      </div>
                    </td>
                    <td style={td}>{score(r.b8_away_runs, r.b8_home_runs)}</td>
                    <td style={td}>{cents(r.b8_home_price)}</td>
                    <td style={td}>{cents(r.b8_away_price)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{cents(r.home_high)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{cents(r.away_high)}</td>
                    <td style={td}>{score(r.b9_away_runs, r.b9_home_runs)}</td>
                    <td style={td}>{cents(r.b9_home_price)}</td>
                    <td style={td}>
                      {r.went_to_extras ? `Yes (${r.extras_inning}th)` : live ? "—" : "No"}
                    </td>
                    <td style={{ ...td, fontWeight: 700 }}>
                      {score(r.final_away, r.final_home)}
                    </td>
                    <td style={{ ...leftTd, fontFamily: T.ui, fontWeight: 700,
                      color: r.winner === "home" ? T.green : r.winner === "away" ? T.red : T.sub }}>
                      {r.winner
                        ? `${r.winner === "home" ? "HOME" : "AWAY"} — ${
                            r.winner === "home" ? (r.home_abbr || r.home_name)
                                                : (r.away_abbr || r.away_name)}`
                        : live ? "in progress" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div style={{ padding: "20px 16px", fontSize: 13, color: T.faint }}>
              No games yet. A game is added automatically the moment it reaches the
              middle of the 8th inning tied.
            </div>
          )}
        </div>
      )}

      {/* the accumulated record, exactly the two rows the client sketched */}
      {s && (
        <div style={{ borderTop: `1px solid ${T.border}`, background: T.soft,
          padding: "14px 16px" }}>
          <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
            <Stat title="Games Tracked" value={s.games_tracked} />
            <Stat title="Home Wins" value={s.home_wins} color={T.green} />
            <Stat title="Away Wins" value={s.away_wins} color={T.red} />
            <Stat title="Home Win %" value={pct(s.home_win_pct)}
              color={s.home_win_pct >= 50 ? T.green : T.ink} />
            <Stat title="Away Win %" value={pct(s.away_win_pct)} />
          </div>
          <div style={{ display: "flex", gap: 30, flexWrap: "wrap", marginTop: 14 }}>
            <Stat title="Games to Extras" value={s.games_to_extras} />
            <Stat title="Extras %" value={pct(s.extras_pct)} />
            <Stat title="Home Wins in Extras" value={s.home_wins_extras} color={T.green} />
            <Stat title="Away Wins in Extras" value={s.away_wins_extras} color={T.red} />
            <Stat title="Home Win % in Extras" value={pct(s.home_win_pct_extras)}
              color={s.home_win_pct_extras >= 50 ? T.green : T.ink} />
          </div>
          <div style={{ fontSize: 11, color: T.faint, marginTop: 10 }}>
            Percentages count finished games only — a game still in progress has no
            winner yet.
          </div>
        </div>
      )}

      {data?.bands && (
        <Panel
          title="Was the price right?"
          note="Games grouped by the home price when the bottom of the 8th began, against how often that side actually won."
          heads={["Polymarket Price", "Games", "Home Wins", "Home Losses", "Actual Win %"]}
          rows={data.bands.map((b) => [
            b.band, b.games, b.home_wins, b.home_losses, pct(b.actual_win_pct),
          ])}
        />
      )}

      {data?.movement && (
        <Panel
          title="Price Movement After Bottom 8 Entry"
          note="How far the home price travelled after the entry — the levels it reached, and the drawdowns it took getting there."
          heads={["Event", "Games", "% of Games"]}
          rows={data.movement.map((m) => [m.event, m.games, pct(m.pct)])}
        />
      )}

      {data?.teams && (
        <Panel
          title="Team Performance — Tied Entering Bottom 8"
          note="Per home team: the price it commanded at the entry, and what it did with it."
          heads={["Home Team", "Games", "Home Wins", "Home Losses", "Win %",
                  "Avg Entry", "Reached 80¢", "Reached 95¢", "Extras", "Extras Win %"]}
          rows={data.teams.map((t) => [
            t.team, t.games, t.home_wins, t.home_losses, pct(t.win_pct),
            cents(t.avg_entry), pct(t.reached_80_pct), pct(t.reached_95_pct),
            t.extras, pct(t.extras_win_pct),
          ])}
        />
      )}
    </div>
  );
}
