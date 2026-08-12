import { useState } from "react";
import { T, monoText, btn, meter } from "../../theme.js";
import { fmtCents } from "../../utils.js";
import { Bases, OutDots } from "./widgets.jsx";
import { inningText, lastTenText, streakText } from "./gameState.js";

// The Clear Favorite chip colour, kept identical to the one BaseballTable
// paints on the price columns so the two never read as different features.
const AMBER = "#D97706";

const lbl = { color: T.sub, fontSize: 10, textTransform: "uppercase" };

// Flashscore-style tab strip (client request, Aug 12): the panel used to be one
// wide wall of columns under the + button. Small uppercase buttons, the active
// one underlined — everything below swaps, nothing else moves.
function TabStrip({ tabs, active, onChange }) {
  return (
    <div style={{
      display: "flex", gap: 2, flexWrap: "wrap",
      borderBottom: `1px solid ${T.border}`, marginBottom: 14,
    }}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            title={t.title}
            style={{
              fontFamily: T.ui, fontSize: 11, fontWeight: on ? 800 : 600,
              letterSpacing: 0.7, textTransform: "uppercase",
              color: on ? T.ink : T.sub,
              background: "transparent", border: "none", cursor: "pointer",
              padding: "8px 14px", marginBottom: -1,
              borderBottom: `2px solid ${on ? T.ink : "transparent"}`,
            }}
          >
            {t.label}
            {/* a count/《•》badge tells him a tab has something in it before he
                clicks — an empty tab that looks identical to a full one is the
                exact complaint that started this redesign */}
            {t.badge ? (
              <span style={{
                marginLeft: 6, fontSize: 9, fontWeight: 800,
                color: on ? T.green : T.faint,
              }}>
                {t.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// the moment the first play landed.
function PlayFeed({ live }) {
  const plays = live.plays || [];
  if (!plays.length) {
    return (
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ ...lbl, marginBottom: 8 }}>Latest plays</div>
        <div style={{ fontSize: 12, color: T.faint }}>
          {/* `full` marks the heavy feed; without it we simply haven't loaded yet */}
          {live.full ? "No completed plays yet." : "Loading plays…"}
        </div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ ...lbl, marginBottom: 8 }}>Latest plays</div>
      {plays.slice(0, 3).map((p, i) => {
        const team = p.half === "top" ? live.away.abbr : live.home.abbr;
        // the 🚀 and the 22px headline already make a home run unmissable —
        // it does not also need to be purple while runs are green
        let headline;
        if (p.event === "Home Run") {
          headline = `🚀 ${team} Home Run${p.rbi ? ` +${p.rbi}` : ""}`;
        } else if (p.scoring && p.rbi > 0) {
          headline = `${team} scored ${p.rbi} run${p.rbi > 1 ? "s" : ""}`;
        } else {
          headline = p.event;
        }
        const color = T.ink;
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

// Big at-a-glance score: Away X - Y Home, leader's box green (both green if
// tied, the trailing side stays neutral). Stays ABOVE the tabs — Flashscore
// keeps the score pinned while the tabs swap underneath, and so do we.
function Scoreboard({ live }) {
  const ar = live.away.runs ?? 0;
  const hr = live.home.runs ?? 0;
  const box = (team, runs, lead) => (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, minWidth: 130,
      padding: "8px 16px", borderRadius: 10,
      background: lead ? T.green : "#fff",
      color: lead ? "#fff" : T.ink,
      border: `1px solid ${lead ? T.green : T.border}`,
    }}>
      <span style={{ fontWeight: 700, fontSize: 15 }}>{team.abbr}</span>
      <span style={{ fontWeight: 800, fontSize: 26, marginLeft: "auto", lineHeight: 1 }}>{runs}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {box(live.away, ar, ar >= hr)}
      <span style={{ color: T.faint, fontWeight: 700, fontSize: 18 }}>–</span>
      {box(live.home, hr, hr >= ar)}
    </div>
  );
}

// "NL East" -> "NL", so a league rank can name its league. Falls back to
// "league" rather than guessing if MLB ever changes the division wording.
function leagueOf(division) {
  const m = /^(AL|NL)\b/.exec(division || "");
  return m ? m[1] : "league";
}

// "39-21" -> " (65%)" — the home/away split as a percentage too
function recordPct(record) {
  const m = /^(\d+)-(\d+)$/.exec(record || "");
  if (!m) return "";
  const w = Number(m[1]);
  const games = w + Number(m[2]);
  return games ? ` (${Math.round((w / games) * 100)}%)` : "";
}

// ---------------------------------------------------------------- MATCH tab
// The MLB.com-style line score, the live situation, and the play feed — the
// "what is happening right now" tab.
function MatchTab({ live }) {
  const nums = live.innings.map((i) => i.num);
  const cell = { ...monoText, fontSize: 12, padding: "3px 7px", textAlign: "center", minWidth: 18 };
  const head = { ...cell, color: T.sub, fontSize: 10 };
  // client scoreboard upgrade (Aug 7): each team shows Runs / Hits / Walks /
  // Duration per inning. Hits come with the linescore; walks and batting
  // durations come from play-by-play (inning_extras) and can lag a moment.
  const ex = live.inning_extras;
  const walks = ex?.walks;
  const durs = ex?.durations;
  const fmtDur = (s) => {
    if (s == null) return "";
    const m = Math.round(s / 60);
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  };
  // an inning cell is only 0 (rather than blank) once that half was played
  const played = (i, side) => durs?.[String(i.num)]?.[side] != null || i[side] != null;
  const rowsFor = (side) => {
    const t = live[side];
    const defs = [
      { label: "Runs", val: (i) => i[side] ?? "", bold: true,
        tot: { R: t.runs ?? 0, H: t.hits ?? 0, E: t.errors ?? 0 } },
      { label: "Hits", val: (i) => i[`${side}_hits`] ?? "",
        tot: { H: t.hits ?? 0 } },
    ];
    if (walks) defs.push({
      label: "Walks",
      val: (i) => (played(i, side) ? (walks[String(i.num)]?.[side] ?? 0) : ""),
      tot: { H: Object.keys(walks).reduce((a, k) => a + (walks[k][side] || 0), 0) },
    });
    if (durs) defs.push({
      label: "Duration",
      val: (i) => fmtDur(durs[String(i.num)]?.[side]),
      tot: { R: fmtDur(ex.duration_totals?.[side]) },
    });
    return defs.map((d, ri) => (
      <tr key={`${side}-${d.label}`}
        style={ri === 0 && side === "home" ? { borderTop: `1px solid ${T.border}` } : undefined}>
        {ri === 0 && (
          <td rowSpan={defs.length} style={{ ...cell, textAlign: "left", fontWeight: 700 }}>
            {t.abbr}
          </td>
        )}
        <td style={{ ...cell, textAlign: "left", color: T.sub, fontSize: 10 }}>{d.label}</td>
        {live.innings.map((i) => (
          <td key={i.num} style={{ ...cell, fontWeight: d.bold ? 600 : 400 }}>{d.val(i)}</td>
        ))}
        <td style={{ ...cell, fontWeight: 700, borderLeft: `1px solid ${T.border}` }}>{d.tot.R ?? ""}</td>
        <td style={{ ...cell, fontWeight: 700 }}>{d.tot.H ?? ""}</td>
        <td style={{ ...cell, fontWeight: 700 }}>{d.tot.E ?? ""}</td>
      </tr>
    ));
  };

  // Before first pitch there is no line score to draw — say so plainly and
  // point at the tab that DOES have something, rather than showing an empty
  // grid that looks broken.
  if (live.status === "Preview" || !live.innings.length) {
    return (
      <div style={{ fontSize: 13, color: T.sub }}>
        Not started yet — the line score, pitching and play feed appear at first
        pitch. Until then the <strong>Matchup</strong>, <strong>Lineups</strong> and{" "}
        <strong>Favorite</strong> tabs carry the pre-game read.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
      <div style={{ minWidth: 260 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
          {live.status === "Final" ? "Final" : inningText(live)}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", marginBottom: 12 }}>
            <thead>
              <tr>
                <th style={head} />
                <th style={head} />
                {nums.map((n) => <th key={n} style={head}>{n}</th>)}
                <th style={{ ...head, borderLeft: `1px solid ${T.border}` }}>R</th>
                <th style={head}>H</th>
                <th style={head}>E</th>
              </tr>
            </thead>
            <tbody>{rowsFor("away")}{rowsFor("home")}</tbody>
          </table>
        </div>
        {live.status === "Live" && (
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap", fontSize: 12 }}>
            <div>
              <div style={lbl}>Pitching</div>
              <div style={{ fontWeight: 600 }}>{live.pitcher.name ?? "—"}</div>
              {/* only the full feed carries season stats — don't claim a
                  pitcher has no ERA while the light state is still showing */}
              {live.pitcher.era ? (
                // bold on client request — the number he checks most
                <div style={{ color: T.ink, fontWeight: 700 }}>{live.pitcher.era} ERA</div>
              ) : live.full ? (
                <div style={{ color: T.faint }}>no season ERA yet</div>
              ) : null}
              {/* this game's line — tells a fresh reliever from a worked arm */}
              {live.pitcher.line && (
                <div style={{ color: T.faint, fontSize: 11 }}>{live.pitcher.line}</div>
              )}
            </div>
            <div>
              <div style={lbl}>At bat</div>
              <div style={{ fontWeight: 600 }}>{live.batter.name ?? "—"}</div>
              {live.batter.ops && <div style={{ color: T.sub }}>{live.batter.ops} OPS</div>}
            </div>
            <div>
              <div style={lbl}>Count / Outs</div>
              <div style={{ fontWeight: 600 }}>
                {live.balls}-{live.strikes}, {live.outs} out
                {live.last_pitch?.foul && (
                  <span style={{ color: T.sub, marginLeft: 8 }}>· foul</span>
                )}
              </div>
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

// -------------------------------------------------------------- MATCHUP tab
// Standings, form and the market's read. The probables/lineup half moved to
// its own tab — cramming both into one column is what made this unreadable.
function TeamStandings({ t }) {
  return (
    <div style={{ flex: 1, minWidth: 190 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{t.abbr}</div>
      <div style={{ ...monoText, fontSize: 13, fontWeight: 700 }} title="Wins-losses this season">
        {t.wins}-{t.losses}{" "}
        <span style={{ color: T.sub, fontWeight: 400 }} title="Win percentage">{t.pct}</span>
      </div>
      <div style={{ color: T.sub, fontSize: 11, marginTop: 2 }}>
        {t.division}
        {t.divisionRank ? ` · #${t.divisionRank}` : ""}
        {t.gamesBack && t.gamesBack !== "-" ? ` · ${t.gamesBack} games back` : ""}
      </div>
      {/* standing beyond the division, on client request — division rank alone
          hides that a #4 team can still be mid-pack league-wide */}
      {(t.leagueRank || t.sportRank) && (
        <div style={{ ...monoText, color: T.sub, fontSize: 11, marginTop: 1 }}>
          {t.leagueRank ? `#${t.leagueRank} in the ${leagueOf(t.division)}` : ""}
          {t.leagueRank && t.sportRank ? " · " : ""}
          {t.sportRank ? `#${t.sportRank} in MLB` : ""}
        </div>
      )}
      {/* last 3 completed series, newest first (client request, Aug 11):
          "● W 2-1 vs MIN · ● L 1-2 @ NYY" — vs = home, @ = away; the abbr
          shows the full club name on hover (dotted underline, kept subtle) */}
      {t.lastSeries?.length > 0 && (
        <div style={{ ...monoText, fontSize: 11, color: T.sub, marginTop: 4 }}>
          Last series:{" "}
          {t.lastSeries.map((s, i) => (
            <span key={i} style={{ whiteSpace: "nowrap" }}>
              {/* W green / L red — a result is exactly the kind of thing
                  colour SHOULD carry; greying these was a step too far */}
              <span style={{ color: s.res === "W" ? T.green : s.res === "L" ? T.red : T.sub,
                fontSize: 9, verticalAlign: "middle" }}>●</span>
              {" "}
              <span style={{ fontWeight: 700,
                color: s.res === "W" ? T.green : s.res === "L" ? T.red : T.sub }}>
                {s.res} {s.wins}-{s.losses}
              </span>
              {" "}{s.home ? "vs" : "@"}{" "}
              <span title={s.opponent}
                style={{ borderBottom: `1px dotted ${T.faint}`, cursor: "help" }}>
                {s.opp_abbr}
              </span>
              {i < t.lastSeries.length - 1 ? " · " : ""}
            </span>
          ))}
        </div>
      )}
      {/* spelled out on client request — "L10 4-6 · L4 · +18" was unreadable */}
      <div style={{ ...monoText, fontSize: 11, color: T.sub, marginTop: 4 }}>
        Last 10: {lastTenText(t.lastTen) ?? "—"}
        {streakText(t.streak) ? ` · ${streakText(t.streak)}` : ""}
      </div>
      {/* the actual order of those results, newest first (client, Aug 11) */}
      {t.lastTenSeq?.length > 0 && (
        <div style={{ ...monoText, fontSize: 11, marginTop: 1 }}>
          {/* the streak pattern has to pop at a glance — W green, L red */}
          <span style={{ letterSpacing: 3 }}>
            {t.lastTenSeq.map((r, i) => (
              <span key={i} style={{ color: r === "W" ? T.green : T.red, fontWeight: 700 }}>{r}</span>
            ))}
          </span>
          <div style={{ fontSize: 9, color: T.faint }}>↑ most recent</div>
        </div>
      )}
      <div style={{ ...monoText, fontSize: 11, color: T.sub }}>
        Run differential{" "}
        {/* signed number: + green, - red */}
        <span style={{ fontWeight: 700,
          color: t.runDiff > 0 ? T.green : t.runDiff < 0 ? T.red : T.sub }}>
          {t.runDiff > 0 ? "+" : ""}{t.runDiff ?? "—"}
        </span>
      </div>
      <div style={{ ...monoText, fontSize: 11, color: T.faint }}>
        {/* win % alongside the raw W-L (client request, Aug 11) */}
        Home {t.homeRecord ?? "—"}{recordPct(t.homeRecord)} · Away {t.awayRecord ?? "—"}{recordPct(t.awayRecord)}
      </div>
    </div>
  );
}

function MatchupTab({ m, prices }) {
  // Reserve the column while it loads, for the same reason as PlayFeed —
  // this is fetched once on expand, so returning null meant it popped in late
  // and shoved the rest of the panel sideways. `false` = the fetch failed.
  if (m === false) {
    return <div style={{ fontSize: 12, color: T.faint }}>Matchup data unavailable for this game.</div>;
  }
  if (!m || !m.away) {
    return <div style={{ fontSize: 12, color: T.faint }}>Loading matchup…</div>;
  }

  // A one-line read on who the numbers favour, from the records we already have
  const edge = (() => {
    const a = m.away, h = m.home;
    if (a.wins == null || h.wins == null) return null;
    const bits = [];
    const aPct = a.wins / Math.max(1, a.wins + a.losses);
    const hPct = h.wins / Math.max(1, h.wins + h.losses);
    const better = aPct === hPct ? null : aPct > hPct ? a : h;
    if (better) {
      bits.push(`${better.abbr} has the better record`);
    } else {
      bits.push("Even records");
    }
    if (a.runDiff != null && h.runDiff != null && a.runDiff !== h.runDiff) {
      const rd = a.runDiff > h.runDiff ? a : h;
      bits.push(`${rd.abbr} the better run differential`);
    }
    const ten = (t) => Number(String(t.lastTen || "0-0").split("-")[0]);
    if (a.lastTen && h.lastTen && ten(a) !== ten(h)) {
      const hot = ten(a) > ten(h) ? a : h;
      bits.push(`${hot.abbr} hotter over the last 10`);
    }
    return bits.join(" · ");
  })();

  // the market's verdict, stated plainly (client request, Aug 11): who is
  // favored right now and by how much — "no clear favorite" inside 5c
  const fav = (() => {
    const p = prices;
    if (!p || p.awayPrice == null || p.homePrice == null) return null;
    const diff = Math.abs(p.awayPrice - p.homePrice);
    if (diff < 5) return { text: "No clear favorite", sub: `${p.awayTeam} ${fmtCents(p.awayPrice)} · ${p.homeTeam} ${fmtCents(p.homePrice)}` };
    const lead = p.awayPrice > p.homePrice
      ? { team: p.awayTeam, price: p.awayPrice, other: p.homePrice }
      : { team: p.homeTeam, price: p.homePrice, other: p.awayPrice };
    return { text: `${lead.team} favored`, sub: `${fmtCents(lead.price)} vs ${fmtCents(lead.other)} on Polymarket` };
  })();

  return (
    <div style={{ display: "flex", gap: 26, flexWrap: "wrap", alignItems: "flex-start" }}>
      <TeamStandings t={m.away} />
      <TeamStandings t={m.home} />
      {/* series + venue take the third column so the row fills the panel */}
      <div style={{ flex: 1, minWidth: 190 }}>
        {fav && (
          <div style={{ marginBottom: 8 }}>
            <div style={lbl}>Market favorite</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2,
              color: fav.text === "No clear favorite" ? T.sub : T.ink }}>
              {fav.text}
            </div>
            <div style={{ ...monoText, fontSize: 11, color: T.sub }}>{fav.sub}</div>
          </div>
        )}
        <div style={lbl}>Season series</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
          {m.series || "—"}
        </div>
        {m.venue && (
          <div style={{ fontSize: 11, color: T.sub, marginTop: 6 }}>{m.venue}</div>
        )}
        {edge && (
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${T.border}` }}>
            <div style={lbl}>Season form</div>
            <div style={{ fontSize: 12, color: T.sub, marginTop: 2, lineHeight: 1.5 }}>
              {edge}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- LINEUPS tab
// Probable starter + tonight's nine vs the last game, per team.
function TeamLineup({ t }) {
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{t.abbr}</div>
      {t.probable ? (
        <div>
          <div style={lbl}>Probable</div>
          <div style={{ fontWeight: 600, fontSize: 12 }}>{t.probable.name}</div>
          <div style={{ ...monoText, fontSize: 11, color: T.sub }}>
            {[t.probable.record && `${t.probable.record}`,
              t.probable.era && `${t.probable.era} ERA`,
              t.probable.whip && `${t.probable.whip} WHIP`,
              t.probable.strikeOuts != null && `${t.probable.strikeOuts} K`]
              .filter(Boolean).join(" · ")}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: T.faint }}>No probable starter posted yet.</div>
      )}
      {/* lineup continuity vs the previous game (client request, Aug 11):
          personnel only — order/position moves don't count; SP separate */}
      {t.lineup ? (
        <div style={{ marginTop: 9, paddingTop: 7, borderTop: `1px solid ${T.border}` }}>
          <div style={lbl}>
            {t.lineup.status === "confirmed" ? "Confirmed lineup vs last game" : "Lineup vs last game"}
          </div>
          {t.lineup.status === "confirmed" ? (
            <>
              <div style={{ ...monoText, fontSize: 12, fontWeight: 700, marginTop: 2 }}>
                {t.lineup.returning}/{t.lineup.total} returning · {t.lineup.pct}% same
              </div>
              {/* same up/down family as +/-: IN green, OUT red */}
              {t.lineup.ins.length > 0 && (
                <div style={{ ...monoText, fontSize: 11, color: T.green, marginTop: 2 }}>
                  ↑ IN: {t.lineup.ins.map((p) => `${p.name}${p.pos ? ` (${p.pos})` : ""}`).join(", ")}
                </div>
              )}
              {t.lineup.outs.length > 0 && (
                <div style={{ ...monoText, fontSize: 11, color: T.red, marginTop: 1 }}>
                  ↓ OUT: {t.lineup.outs.map((p) => `${p.name}${p.pos ? ` (${p.pos})` : ""}`).join(", ")}
                </div>
              )}
              {t.lineup.ins.length === 0 && t.lineup.outs.length === 0 && (
                <div style={{ fontSize: 11, color: T.sub, marginTop: 1 }}>
                  same nine as last game
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>
              {/* MLB publishes no projected lineups — this is not our gap */}
              Today's lineup not available yet.
            </div>
          )}
          {(t.lineup.sp_prev || t.probable) && (
            <div style={{ ...monoText, fontSize: 11, color: T.sub, marginTop: 3 }}>
              SP: {t.lineup.sp_prev
                ? `${t.lineup.sp_prev.name}${t.lineup.sp_prev.era ? ` (${t.lineup.sp_prev.era} ERA)` : ""}`
                : "—"}
              {" → "}
              {t.probable
                ? `${t.probable.name}${t.probable.era ? ` (${t.probable.era} ERA)` : ""}`
                : "—"}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function LineupsTab({ m }) {
  if (m === false) {
    return <div style={{ fontSize: 12, color: T.faint }}>Lineup data unavailable for this game.</div>;
  }
  if (!m || !m.away) {
    return <div style={{ fontSize: 12, color: T.faint }}>Loading lineups…</div>;
  }
  return (
    <div style={{ display: "flex", gap: 40, flexWrap: "wrap", alignItems: "flex-start" }}>
      <TeamLineup t={m.away} />
      <TeamLineup t={m.home} />
    </div>
  );
}

// ------------------------------------------------------------- FAVORITE tab
// The Clear Favorite engine scores every game 0-100 but only TAGS a team at
// >= 75 with a 59c+ price and no disqualifiers, which on a normal slate means
// nothing is tagged at all (Aug 12: the best team in the league was 57/100).
// A feature that is silent most days reads as broken, so this tab always shows
// the scores and says plainly how far off the bar each side is.
const FACTOR_LABELS = {
  market: "Market price",
  sp: "Starting pitcher",
  bullpen: "Bullpen",
  strength: "Team strength",
  rest: "Rest & travel",
  lineup: "Lineup",
  form: "Recent form",
  park: "Park & weather",
};
const THRESHOLD = 75;

function FactorRow({ f }) {
  const pct = f.max ? Math.max(0, Math.min(1, f.points / f.max)) : 0;
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, flex: 1 }}>
          {FACTOR_LABELS[f.key] || f.key}
        </span>
        <span style={{ ...monoText, fontSize: 11, fontWeight: 700, color: T.sub }}>
          {f.points}/{f.max}
        </span>
      </div>
      {/* one neutral grey for every factor bar: the LENGTH already says how
          the factor scored, so colouring it too was 16 coloured bars per
          game saying nothing extra */}
      <div style={{ height: 3, background: meter.track, borderRadius: 2, overflow: "hidden", marginTop: 3 }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: meter.fill }} />
      </div>
      {f.detail && (
        <div style={{ fontSize: 10, color: T.faint, marginTop: 2, lineHeight: 1.4 }}>{f.detail}</div>
      )}
    </div>
  );
}

function FavoriteSide({ name, side, isFavorite }) {
  const total = side.total ?? 0;
  const short = THRESHOLD - total;
  return (
    <div style={{
      flex: 1, minWidth: 260, padding: 12, borderRadius: 8,
      border: `1px solid ${isFavorite ? AMBER : T.border}`,
      background: isFavorite ? "#FFFBEB" : "#fff",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
        <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{name}</span>
        <span style={{ ...monoText, fontSize: 20, fontWeight: 800,
          color: side.qualifies ? AMBER : T.ink }}>
          {total}
        </span>
        <span style={{ ...monoText, fontSize: 11, color: T.faint }}>/100</span>
      </div>
      {/* the 75 bar drawn where it actually sits, so "how close was it" is a
          glance rather than arithmetic. This is the ONE accented bar on the
          card, and only when the team actually cleared the rules — amber, to
          match the ★ chip in the table. */}
      <div style={{ position: "relative", height: 6, background: meter.track,
        borderRadius: 3, overflow: "hidden", marginTop: 4 }}>
        <div style={{ width: `${Math.max(0, Math.min(100, total))}%`, height: "100%",
          background: side.qualifies ? AMBER : meter.fillStrong }} />
      </div>
      <div style={{ position: "relative", height: 12 }}>
        <div style={{ position: "absolute", left: `${THRESHOLD}%`, top: -6,
          width: 1, height: 10, background: T.ink, opacity: 0.55 }} />
        <div style={{ position: "absolute", left: `${THRESHOLD}%`, top: 3,
          fontSize: 9, color: T.faint, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>
          75 needed
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, marginTop: 8, marginBottom: 8,
        color: side.qualifies ? AMBER : T.sub }}>
        {side.qualifies
          ? "★ Qualifies as a clear favorite"
          : short > 0
            ? `${short} point${short === 1 ? "" : "s"} below the bar`
            : "At the points bar, but blocked below"}
      </div>
      {/* red survives here: a disqualifier is the one thing on this card that
          is genuinely a stop sign */}
      {side.disqualifiers?.length > 0 && (
        <div style={{ fontSize: 10, color: T.red, marginBottom: 8, lineHeight: 1.5 }}>
          {side.disqualifiers.map((d, i) => <div key={i}>✕ {d}</div>)}
        </div>
      )}
      {/* a flag is a caveat, not a block — the ⚠ says that without amber */}
      {side.flags?.length > 0 && (
        <div style={{ fontSize: 10, color: T.sub, marginBottom: 8, lineHeight: 1.5 }}>
          {side.flags.map((f, i) => <div key={i}>⚠ {f}</div>)}
        </div>
      )}
      <div style={{ paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
        {(side.factors || []).map((f) => <FactorRow key={f.key} f={f} />)}
      </div>
    </div>
  );
}

function FavoriteTab({ fav }) {
  if (!fav) {
    // Undefined covers both "still scoring" and "outside the scoring window" —
    // BaseballTable only scores games from ~36h before to ~6h after first
    // pitch. Say that instead of spinning forever.
    return (
      <div style={{ fontSize: 12, color: T.faint, lineHeight: 1.6 }}>
        Not scored yet. The Clear Favorite engine scores each game from about
        36 hours before first pitch, and refreshes every 10 minutes.
      </div>
    );
  }
  const favSide = fav.favorite ? fav[fav.favorite] : null;
  const favName = fav.favorite ? fav[`${fav.favorite}_name`] : null;
  return (
    <div>
      {favSide ? (
        <div style={{
          display: "inline-block", marginBottom: 12, padding: "6px 12px",
          borderRadius: 6, background: AMBER, color: "#fff",
          fontSize: 12, fontWeight: 800, letterSpacing: 0.3,
        }}>
          ★ CLEAR FAVORITE — {favName} · {favSide.total}/100
        </div>
      ) : (
        <div style={{ fontSize: 12, color: T.sub, marginBottom: 12, lineHeight: 1.6 }}>
          <strong>No clear favorite in this game.</strong> A team is tagged only
          at <strong>75+ points</strong> with a price of <strong>59¢ or better</strong>{" "}
          and no disqualifiers — a deliberately high bar, so most games score
          without ever earning the tag. The full breakdown is below either way.
        </div>
      )}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <FavoriteSide name={fav.away_name} side={fav.away} isFavorite={fav.favorite === "away"} />
        <FavoriteSide name={fav.home_name} side={fav.home} isFavorite={fav.favorite === "home"} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- PANEL
export default function ExpandPanel({ live, onAnalyze, matchup, prices, favorite }) {
  // null = "follow the game state"; a string = the user picked a tab and we
  // stop moving it under them. Declared before the early return so the hook
  // order never changes as `live` arrives.
  const [picked, setPicked] = useState(null);

  if (!live) {
    return (
      <div style={{ ...monoText, fontSize: 12, padding: "8px 10px", color: T.faint }}>
        Loading live data…
      </div>
    );
  }

  // Pre-game there is nothing on the Match tab, so open on Matchup instead.
  const active = picked ?? (live.status === "Preview" ? "matchup" : "match");
  const favTagged = favorite?.favorite ? "★" : null;
  const tabs = [
    { key: "match", label: "Match", title: "Line score, pitching and the play feed" },
    { key: "matchup", label: "Matchup", title: "Standings, form, season series and the market's read" },
    { key: "lineups", label: "Lineups", title: "Probable starters and tonight's nine vs the last game" },
    { key: "favorite", label: "Favorite", title: "Clear Favorite scores and the factor breakdown",
      badge: favTagged },
  ];

  return (
    <div style={{ padding: "12px 16px", background: T.soft, borderTop: `1px solid ${T.border}` }}>
      {/* header: score + Analyze stay put while the tabs swap underneath */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        {live.status !== "Preview" ? <Scoreboard live={live} /> : <div />}
        {onAnalyze && (
          <button
            onClick={onAnalyze}
            title="Copy a paste-ready breakdown of this game (MLB + Polymarket)"
            style={{ ...btn.green, fontSize: 12, padding: "8px 14px", whiteSpace: "nowrap" }}
          >
            📋 Analyze
          </button>
        )}
      </div>

      <TabStrip tabs={tabs} active={active} onChange={setPicked} />

      {/* minHeight keeps the row from jumping as tabs of different lengths
          swap — the panel is inside a table row and a collapsing height
          scrolls the whole page under him */}
      <div style={{ minHeight: 190 }}>
        {active === "match" && <MatchTab live={live} />}
        {active === "matchup" && <MatchupTab m={matchup} prices={prices} />}
        {active === "lineups" && <LineupsTab m={matchup} />}
        {active === "favorite" && <FavoriteTab fav={favorite} />}
      </div>
    </div>
  );
}
