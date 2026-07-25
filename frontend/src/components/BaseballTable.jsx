import { useEffect, useRef, useState } from "react";
import { T, card, monoText, btn } from "../theme.js";
import { fmtCents } from "../utils.js";
import { fetchMlbGame, fetchLivePrice } from "../api/client.js";

const POLL_MS = 12000; // MLB feed lags Polymarket ~6-8s; 12s is plenty
const th = { ...monoText, fontSize: 10, textTransform: "uppercase",
  letterSpacing: 0.4, color: T.sub, padding: "8px 10px", textAlign: "left" };
const td = { ...monoText, fontSize: 12, padding: "8px 10px", verticalAlign: "top" };

// A small baseball diamond: filled when a runner is on the base.
function Bases({ bases }) {
  const dot = (on) => ({
    width: 9, height: 9, transform: "rotate(45deg)",
    background: on ? T.ink : "transparent",
    border: `1px solid ${on ? T.ink : T.faint}`,
  });
  return (
    <span style={{ display: "inline-grid", gridTemplateColumns: "repeat(3, 11px)", gap: 2 }}>
      <span /><span style={dot(bases?.second)} /><span />
      <span style={dot(bases?.third)} /><span /><span style={dot(bases?.first)} />
    </span>
  );
}

// "▲ Top 6" / "▼ Bot 7" from the live inning, or the scheduled time.
function inningText(live, kickoff) {
  if (!live || live.status === "Preview")
    return kickoff ? new Date(kickoff).toISOString().slice(11, 16) + " UTC" : "—";
  if (live.status === "Final") return "Final";
  const arrow = live.is_top ? "▲" : "▼";
  const half = live.is_top ? "Top" : "Bot";
  return `${arrow} ${half} ${live.inning ?? ""}`;
}

// The MLB.com-style line score shown when a row is expanded.
function ExpandPanel({ live }) {
  if (!live) return <div style={{ ...td, color: T.faint }}>Loading live data…</div>;
  const nums = live.innings.map((i) => i.num);
  const cell = { ...monoText, fontSize: 12, padding: "3px 7px", textAlign: "center", minWidth: 18 };
  const head = { ...cell, color: T.sub, fontSize: 10 };
  const row = (side) => (
    <tr>
      <td style={{ ...cell, textAlign: "left", fontWeight: 600 }}>{live[side].abbr}</td>
      {live.innings.map((i) => (
        <td key={i.num} style={cell}>{i[side] ?? ""}</td>
      ))}
      <td style={{ ...cell, fontWeight: 700, borderLeft: `1px solid ${T.border}` }}>{live[side].runs ?? 0}</td>
      <td style={cell}>{live[side].hits ?? 0}</td>
      <td style={cell}>{live[side].errors ?? 0}</td>
    </tr>
  );
  return (
    <div style={{ padding: "12px 16px", background: T.soft, borderTop: `1px solid ${T.border}` }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
        {live.status === "Final" ? "Final" : inningText(live)}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={head} />
              {nums.map((n) => <th key={n} style={head}>{n}</th>)}
              <th style={{ ...head, borderLeft: `1px solid ${T.border}` }}>R</th>
              <th style={head}>H</th>
              <th style={head}>E</th>
            </tr>
          </thead>
          <tbody>{row("away")}{row("home")}</tbody>
        </table>
      </div>
      {live.status === "Live" && (
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", fontSize: 12 }}>
          <div>
            <div style={{ color: T.sub, fontSize: 10, textTransform: "uppercase" }}>Pitching</div>
            <div style={{ fontWeight: 600 }}>{live.pitcher.name ?? "—"}</div>
            {live.pitcher.era && <div style={{ color: T.sub }}>{live.pitcher.era} ERA</div>}
          </div>
          <div>
            <div style={{ color: T.sub, fontSize: 10, textTransform: "uppercase" }}>At bat</div>
            <div style={{ fontWeight: 600 }}>{live.batter.name ?? "—"}</div>
            {live.batter.ops && <div style={{ color: T.sub }}>{live.batter.ops} OPS</div>}
          </div>
          <div>
            <div style={{ color: T.sub, fontSize: 10, textTransform: "uppercase" }}>Count / Outs</div>
            <div style={{ fontWeight: 600 }}>{live.balls}-{live.strikes}, {live.outs} out</div>
            <div style={{ marginTop: 3 }}><Bases bases={live.bases} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BaseballTable({ rows, onTrack, tracked, trackBusy }) {
  const [liveById, setLiveById] = useState({});
  const [priceBySlug, setPriceBySlug] = useState({}); // live CLOB asks
  const [expanded, setExpanded] = useState(new Set());
  const liveRef = useRef({});
  liveRef.current = liveById;

  // poll the MLB feed + live prices for games in progress (or expanded);
  // future and finished games do not need constant refreshing
  useEffect(() => {
    let stop = false;
    async function tick() {
      const now = Date.now();
      const active = rows
        .filter((r) => r.gamePk)
        .filter((r) => {
          if (expanded.has(r.gamePk)) return true;
          if (liveRef.current[r.gamePk]?.status === "Live") return true;
          return r.kickoff && now - r.kickoff < 5 * 3600e3 && r.kickoff - now < 30 * 60e3;
        });

      const games = await Promise.allSettled(active.map((r) => fetchMlbGame(r.gamePk)));
      const prices = await Promise.allSettled(active.map((r) => fetchLivePrice(r.slug)));
      if (stop) return;
      const nextLive = {}, nextPrice = {};
      active.forEach((r, i) => {
        if (games[i].status === "fulfilled") nextLive[r.gamePk] = games[i].value;
        if (prices[i].status === "fulfilled") nextPrice[r.slug] = prices[i].value;
      });
      setLiveById((prev) => ({ ...prev, ...nextLive }));
      setPriceBySlug((prev) => ({ ...prev, ...nextPrice }));
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(id); };
  }, [rows, expanded]);

  function toggle(pk) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(pk) ? next.delete(pk) : next.add(pk);
      return next;
    });
  }

  const center = { ...td, textAlign: "center" };
  return (
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 28, textAlign: "center" }}>+/−</th>
              <th style={th}>Game</th>
              <th style={th}>Inning</th>
              <th style={th}>Batting</th>
              <th style={th}>Score</th>
              <th style={{ ...th, textAlign: "right", color: T.series[0] }}>Yes</th>
              <th style={{ ...th, textAlign: "right", color: T.series[2] }}>No</th>
              <th style={{ ...th, textAlign: "center" }}>Outs</th>
              <th style={{ ...th, textAlign: "center" }}>Count</th>
              <th style={{ ...th, textAlign: "center" }}>Bases</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const live = r.gamePk ? liveById[r.gamePk] : null;
              const isLive = live?.status === "Live";
              const open = expanded.has(r.gamePk);
              // MLB decides who is home/away; fall back to Polymarket order
              const away = live?.away.abbr ?? r.away;
              const home = live?.home.abbr ?? r.home;
              const score = live && live.status !== "Preview"
                ? `${live.away.runs ?? 0}-${live.home.runs ?? 0}` : "—";
              const battingTeam = isLive
                ? (live.batting === "away" ? live.away : live.home) : null;
              // live CLOB ask overrides the 5-min cached price when available
              const lp = priceBySlug[r.slug];
              const homePrice = lp?.home ?? r.homePrice;
              const awayPrice = lp?.away ?? r.awayPrice;
              // Yes = the home-side price, No = the away-side price (with the
              // team name under each, since baseball has no literal Yes/No)
              const priceCell = (team, price, color) => (
                <td style={{ ...td, textAlign: "right" }}>
                  <div style={{ fontWeight: 700, color }}>
                    {price != null ? fmtCents(price) : "—"}
                  </div>
                  <div style={{ fontFamily: T.ui, fontSize: 11, color: T.sub }}>{team}</div>
                </td>
              );
              return [
                <tr key={r.slug} style={{ borderTop: `1px solid ${T.border}` }}>
                  <td style={center}>
                    <button
                      onClick={() => toggle(r.gamePk)}
                      disabled={!r.gamePk}
                      title={r.gamePk ? "Live game details" : "No live data"}
                      style={{ ...btn.outline, fontSize: 13, padding: "1px 7px", lineHeight: 1 }}
                    >
                      {open ? "−" : "+"}
                    </button>
                  </td>
                  <td style={{ ...td, fontFamily: T.ui, fontWeight: 500, whiteSpace: "nowrap" }}>
                    {away} @ {home}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap", color: isLive ? T.red : T.sub }}>
                    {inningText(live, r.kickoff)}
                  </td>
                  <td style={{ ...td, fontFamily: T.ui, whiteSpace: "nowrap" }}>
                    {battingTeam ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%",
                          background: live.batting === "away" ? T.series[2] : T.series[0] }} />
                        {battingTeam.abbr}
                      </span>
                    ) : "—"}
                  </td>
                  <td style={td}>{score}</td>
                  {priceCell(r.home, homePrice, T.series[0])}
                  {priceCell(r.away, awayPrice, T.series[2])}
                  <td style={center}>{isLive ? live.outs : "—"}</td>
                  <td style={center}>{isLive ? `${live.balls}-${live.strikes}` : "—"}</td>
                  <td style={center}>{isLive ? <Bases bases={live.bases} /> : "—"}</td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    {tracked.has(r.slug) ? (
                      <button disabled style={{ ...btn.outline, fontSize: 12, padding: "5px 9px" }}>Tracked ✓</button>
                    ) : (
                      <button
                        onClick={() => onTrack(r)}
                        disabled={trackBusy === r.slug}
                        style={{ ...btn.green, fontSize: 12, padding: "5px 9px" }}
                      >
                        {trackBusy === r.slug ? "…" : "Track"}
                      </button>
                    )}
                  </td>
                </tr>,
                open && (
                  <tr key={`${r.slug}-x`}>
                    <td colSpan={11} style={{ padding: 0 }}>
                      <ExpandPanel live={live} />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <div style={{ padding: "28px 16px", fontSize: 13, color: T.faint }}>
          No MLB games right now.
        </div>
      )}
    </div>
  );
}
