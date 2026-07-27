import { useEffect, useRef, useState } from "react";
import { T, card, monoText, btn } from "../theme.js";
import { fmtCents, fmtClock, TZ_LABEL } from "../utils.js";
import { fetchMlbGame, fetchLivePrice } from "../api/client.js";
import { loadAlerts, persistAlerts, matches, playSound, soundType, matchReason } from "../alerts.js";
import AlertDialog from "./AlertDialog.jsx";
import AlertBar from "./AlertBar.jsx";
import LivePrice from "./LivePrice.jsx";

const POLL_MS = 2000; // fast live prices + state; backend caps each at ~2s

// Polymarket lists MLB games away-team-first, so a row's home/away (and their
// prices) can be the opposite of MLB's real home/away. MLB is authoritative
// (home bats 2nd / bottom of inning); match its home team to a Polymarket side
// by name so the HOME column shows the home team + its price.
const _norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function _teamMatch(a, b) {
  a = _norm(a); b = _norm(b);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (a.includes(b) || b.includes(a)) return 2;
  return 0;
}

// Favorite is green, underdog is red: colour a price by how it compares to the
// other side's price.
const priceColor = (a, b) =>
  a == null || b == null ? T.sub : a > b ? T.green : a < b ? T.red : T.sub;
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

// Three out indicators, filled by the number of outs — the MLB.com-style
// visual cue (0/1/2 filled; 3 ends the inning).
function OutDots({ outs, size = 11 }) {
  const n = outs ?? 0;
  return (
    <span style={{ display: "inline-flex", gap: Math.round(size * 0.55) }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: size, height: size, borderRadius: "50%",
            background: i < n ? T.ink : "transparent",
            border: `1.5px solid ${i < n ? T.ink : T.faint}`,
          }}
        />
      ))}
    </span>
  );
}

// True during the between-halves pause (10-20s): the top just ended (home team
// coming up) or the whole inning ended (visiting team up next inning).
function isInningBreak(live) {
  return live?.inning_state === "Middle" || live?.inning_state === "End";
}

// "▲ Top 6" / "▼ Bot 7" from the live inning, the between-innings break, or the
// scheduled time.
function inningText(live, kickoff) {
  if (!live || live.status === "Preview")
    return kickoff ? `${fmtClock(kickoff)} ${TZ_LABEL}` : "—";
  if (live.status === "Final") return "Final";
  const n = live.inning ?? "";
  if (live.inning_state === "Middle") return `End of Top ${n} · break`;
  if (live.inning_state === "End") return `End of Bot ${n} · break`;
  const arrow = live.is_top ? "▲" : "▼";
  const half = live.is_top ? "Top" : "Bot";
  return `${arrow} ${half} ${n}`;
}

// Live event feed — the last few completed plays, newest big on top, so a run,
// home run or out is obvious the moment it happens.
function PlayFeed({ live }) {
  const plays = live.plays || [];
  if (!plays.length) return null;
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ color: T.sub, fontSize: 10, textTransform: "uppercase", marginBottom: 8 }}>
        Latest plays
      </div>
      {plays.slice(0, 3).map((p, i) => {
        const team = p.half === "top" ? live.away.abbr : live.home.abbr;
        let headline, color;
        if (p.event === "Home Run") {
          headline = `🚀 ${team} Home Run${p.rbi ? ` +${p.rbi}` : ""}`;
          color = T.series[2];
        } else if (p.scoring && p.rbi > 0) {
          headline = `${team} scored ${p.rbi} run${p.rbi > 1 ? "s" : ""}`;
          color = T.green;
        } else {
          headline = p.event;
          color = T.ink;
        }
        return (
          <div key={i} style={{ marginBottom: i === 0 ? 12 : 8, opacity: i === 0 ? 1 : 0.55 }}>
            <div style={{ fontSize: i === 0 ? 22 : 15, fontWeight: 800, lineHeight: 1.15, color }}>
              {headline}
            </div>
            <div style={{ fontSize: 12, color: T.sub, marginTop: 2 }}>{p.desc}</div>
          </div>
        );
      })}
    </div>
  );
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
    <div style={{ padding: "12px 16px", background: T.soft, borderTop: `1px solid ${T.border}`,
      display: "flex", gap: 40, flexWrap: "wrap" }}>
      <div style={{ minWidth: 260 }}>
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
              <div style={{ marginTop: 6 }}><OutDots outs={live.outs} size={16} /></div>
              <div style={{ marginTop: 8 }}><Bases bases={live.bases} /></div>
            </div>
          </div>
        )}
      </div>
      {live.status === "Live" && <PlayFeed live={live} />}
    </div>
  );
}

export default function BaseballTable({ rows, onTrack, tracked, trackBusy, trackedCount = () => 0, status = "all" }) {
  const [liveById, setLiveById] = useState({});
  const [priceBySlug, setPriceBySlug] = useState({}); // live CLOB asks
  const [expanded, setExpanded] = useState(new Set());
  const [alerts, setAlerts] = useState(loadAlerts);
  const [hits, setHits] = useState(new Set()); // slugs currently alerting
  const [dialogOpen, setDialogOpen] = useState(false); // global MLB alert dialog
  const [dialogRow, setDialogRow] = useState(null); // per-game alert dialog
  const [toast, setToast] = useState(null);
  const liveRef = useRef({});
  liveRef.current = liveById;
  const priceRef = useRef({});
  priceRef.current = priceBySlug;
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const matchRef = useRef({}); // slug -> { matched, acked }
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  // Alerts live in one flat map: keyed by SPORT for the global MLB alert, and
  // by the match slug for a per-game alert. A game fires if EITHER matches.
  // Read fresh from storage on save so the two never clobber each other.
  const SPORT = "baseball";
  function saveKey(key, alert) {
    const next = { ...loadAlerts(), [key]: alert };
    setAlerts(next);
    persistAlerts(next);
    delete matchRef.current[key]; // re-arm with the new criteria
  }
  function clearKey(key) {
    const next = { ...loadAlerts() };
    delete next[key];
    setAlerts(next);
    persistAlerts(next);
    matchRef.current = {};
    setHits(new Set());
  }
  const saveAlert = (a) => saveKey(SPORT, a); // global
  const clearAlert = () => clearKey(SPORT);
  function dismiss(slug) {
    if (matchRef.current[slug]) matchRef.current[slug].acked = true;
    setHits((prev) => { const n = new Set(prev); n.delete(slug); return n; });
  }

  // Check the global MLB alert AND each game's own alert against the freshest
  // live data. A game matches if EITHER fires. Sound plays (three times) when a
  // game starts matching; each game re-arms only after it stops matching.
  function evaluate(liveMap, priceMap) {
    const globalAlert = alertsRef.current[SPORT];
    const nextHits = new Set();
    let fired = null;
    for (const r of rowsRef.current) {
      const rowAlerts = [globalAlert, alertsRef.current[r.slug]].filter(Boolean);
      const st = matchRef.current[r.slug] || { matched: false, acked: false };
      if (rowAlerts.length === 0) {
        st.matched = false; st.acked = false; // nothing set — reset
        matchRef.current[r.slug] = st;
        continue;
      }
      const live = liveMap[r.gamePk] ?? liveRef.current[r.gamePk] ?? null;
      const lp = priceMap[r.slug] ?? priceRef.current[r.slug];
      const prices = { home: lp?.home ?? r.homePrice, away: lp?.away ?? r.awayPrice, draw: null };
      const hit = rowAlerts.find((a) => matches(a, { prices, live }));
      const m = !!hit;
      if (m && !st.matched && !st.acked) {
        fired = { text: `${r.away} @ ${r.home} matches your alert`, type: soundType(hit),
          reason: matchReason(hit, prices, live) };
      }
      if (!m) st.acked = false;
      st.matched = m;
      matchRef.current[r.slug] = st;
      if (m && !st.acked) nextHits.add(r.slug);
    }
    if (fired) {
      playSound(fired.type);
      setToast(fired.reason ? `${fired.text} · ${fired.reason}` : fired.text);
    }
    setHits(nextHits);
  }

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // Poll the MLB feed + live prices for games in progress (or expanded). A
  // SINGLE stable interval reads the latest rows/expanded from refs, so a
  // re-render never cancels an in-flight fetch (that was leaving rows stuck on
  // their first snapshot — "Top 1" while the game was really in the 3rd).
  useEffect(() => {
    let mounted = true;
    async function tick() {
      const now = Date.now();
      const curRows = rowsRef.current;
      const curExpanded = expandedRef.current;
      const active = curRows
        .filter((r) => r.gamePk)
        .filter((r) => {
          const st = liveRef.current[r.gamePk]?.status;
          if (st === "Final") return false; // finished — stop polling (keeps its final score cached)
          if (st === "Live") return true;
          if (curExpanded.has(r.gamePk)) return true;
          return r.kickoff && now - r.kickoff < 5 * 3600e3 && r.kickoff - now < 30 * 60e3;
        });

      // expanded rows fetch the full feed (ERA/OPS); the rest read the light cache
      const games = await Promise.allSettled(
        active.map((r) => fetchMlbGame(r.gamePk, curExpanded.has(r.gamePk))),
      );
      const prices = await Promise.allSettled(active.map((r) => fetchLivePrice(r.slug)));
      if (!mounted) return;
      const nextLive = {}, nextPrice = {};
      active.forEach((r, i) => {
        if (games[i].status === "fulfilled") nextLive[r.gamePk] = games[i].value;
        if (prices[i].status === "fulfilled") nextPrice[r.slug] = prices[i].value;
      });
      setLiveById((prev) => ({ ...prev, ...nextLive }));
      setPriceBySlug((prev) => ({ ...prev, ...nextPrice }));
      evaluate(nextLive, nextPrice);
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  function toggle(pk) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(pk) ? next.delete(pk) : next.add(pk);
      return next;
    });
  }

  // status for the filter chips: prefer MLB's own state, fall back to kickoff
  const nowMs = Date.now();
  function rowStatus(r) {
    const st = liveById[r.gamePk]?.status;
    if (st === "Live") return "live";
    if (st === "Final") return "over";
    if (st === "Preview") return "soon";
    if (!r.kickoff) return "soon";
    return r.kickoff > nowMs ? "soon" : "over";
  }
  const displayRows = status === "all" ? rows : rows.filter((r) => rowStatus(r) === status);

  const center = { ...td, textAlign: "center" };
  return (
    <div>
      <AlertBar
        sport={SPORT}
        isMlb
        alert={alerts[SPORT]}
        onEdit={() => setDialogOpen(true)}
        onClear={clearAlert}
      />
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
              <th style={{ ...th, textAlign: "right" }}>Away</th>
              <th style={{ ...th, textAlign: "right" }}>Home</th>
              <th style={{ ...th, textAlign: "center" }}>Outs</th>
              <th style={{ ...th, textAlign: "center" }}>Count</th>
              <th style={{ ...th, textAlign: "center" }}>Bases</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r) => {
              const live = r.gamePk ? liveById[r.gamePk] : null;
              const isLive = live?.status === "Live";
              const open = expanded.has(r.gamePk);
              // MLB decides who is home/away. When we have no live data yet,
              // fall back to Polymarket's away-first order (r.home = away).
              const away = live?.away.abbr ?? r.home;
              const home = live?.home.abbr ?? r.away;
              const score = live && live.status !== "Preview"
                ? `${live.away.runs ?? 0}-${live.home.runs ?? 0}` : "—";
              const battingTeam = isLive
                ? (live.batting === "away" ? live.away : live.home) : null;
              // live CLOB mid overrides the cached price when available
              const lp = priceBySlug[r.slug];
              const rHomePrice = lp?.home ?? r.homePrice;
              const rAwayPrice = lp?.away ?? r.awayPrice;
              // Map MLB's real home/away onto the Polymarket price sides by
              // name, so the Home column shows the home team + its price.
              const rHomeIsHome = !live || !live.home || !live.away
                ? false // no MLB data: Polymarket lists away first, so r.home = away
                : _teamMatch(live.home.name, r.home) >= _teamMatch(live.home.name, r.away);
              const homeTeam = rHomeIsHome ? r.home : r.away;
              const homePrice = rHomeIsHome ? rHomePrice : rAwayPrice;
              const awayTeam = rHomeIsHome ? r.away : r.home;
              const awayPrice = rHomeIsHome ? rAwayPrice : rHomePrice;
              // Home / Away columns: the team name under its win price
              const priceCell = (team, price, color) => (
                <td style={{ ...td, textAlign: "right" }}>
                  <div><LivePrice cents={price} color={color} /></div>
                  <div style={{ fontFamily: T.ui, fontSize: 11, color: T.sub }}>{team}</div>
                </td>
              );
              const alerting = hits.has(r.slug);
              return [
                <tr
                  key={r.slug}
                  style={{
                    borderTop: `1px solid ${T.border}`,
                    background: alerting ? "#FEF3C7" : undefined, // yellow while matching
                  }}
                >
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
                    {alerting && (
                      <span
                        title="Dismiss highlight"
                        onClick={() => dismiss(r.slug)}
                        style={{ cursor: "pointer", marginRight: 6 }}
                      >
                        🔔
                      </span>
                    )}
                    {away} @ {home}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap",
                    color: isInningBreak(live) ? T.series[1] : isLive ? T.red : T.sub,
                    fontWeight: isInningBreak(live) ? 700 : undefined }}>
                    {isInningBreak(live) && "⏸ "}{inningText(live, r.kickoff)}
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
                  {/* Away first, then Home — matches the "Away @ Home" game
                      column and the away-home score, so the columns line up */}
                  {priceCell(awayTeam, awayPrice, priceColor(awayPrice, homePrice))}
                  {priceCell(homeTeam, homePrice, priceColor(homePrice, awayPrice))}
                  <td style={center}>
                    {isLive ? (
                      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <span>{live.outs ?? 0} out</span>
                        <OutDots outs={live.outs} size={11} />
                      </span>
                    ) : "—"}
                  </td>
                  <td style={center}>{isLive ? `${live.balls}-${live.strikes}` : "—"}</td>
                  <td style={center}>{isLive ? <Bases bases={live.bases} /> : "—"}</td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => setDialogRow(r)}
                      title={alerts[r.slug] ? "Edit this game's alert" : "Alert for this game only"}
                      style={{ ...btn.outline, fontSize: 13, padding: "5px 8px", marginRight: 6,
                        color: alerts[r.slug] ? T.series[0] : T.sub }}
                    >
                      {alerts[r.slug] ? "🔔" : "🔕"}
                    </button>
                    {(() => {
                      const n = trackedCount(r.slug);
                      return (
                        <button
                          onClick={() => onTrack(r)}
                          disabled={trackBusy === r.slug}
                          title={n
                            ? `${n} prop${n > 1 ? "s" : ""} of this match already tracked — click to add or review`
                            : "Choose which props of this match to track"}
                          style={{
                            ...(n ? btn.outline : btn.green),
                            ...(n ? { color: T.green, borderColor: T.green } : {}),
                            fontSize: 12, padding: "5px 9px",
                          }}
                        >
                          {trackBusy === r.slug ? "…" : n ? `✓ Tracking (${n})` : "Track"}
                        </button>
                      );
                    })()}
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
      {displayRows.length === 0 && (
        <div style={{ padding: "28px 16px", fontSize: 13, color: T.faint }}>
          {rows.length === 0 ? "No MLB games right now." : "No games match this filter."}
        </div>
      )}
      </div>

      {dialogOpen && (
        <AlertDialog
          sport={SPORT}
          isMlb
          hasDraw={false}
          existing={alerts[SPORT]}
          onSave={(a) => { saveAlert(a); setDialogOpen(false); }}
          onClear={() => { clearAlert(); setDialogOpen(false); }}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {dialogRow && (
        <AlertDialog
          row={{ ...dialogRow, sport: "baseball", hasDraw: false }}
          existing={alerts[dialogRow.slug]}
          onSave={(a) => { saveKey(dialogRow.slug, a); setDialogRow(null); }}
          onClear={() => { clearKey(dialogRow.slug); setDialogRow(null); }}
          onClose={() => setDialogRow(null)}
        />
      )}

      {toast && (
        <div
          onClick={() => setToast(null)}
          style={{ position: "fixed", right: 20, bottom: 20, zIndex: 120,
            background: T.ink, color: "#fff", padding: "12px 18px", borderRadius: 8,
            fontSize: 14, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}
        >
          🔔 {toast}
        </div>
      )}
    </div>
  );
}
