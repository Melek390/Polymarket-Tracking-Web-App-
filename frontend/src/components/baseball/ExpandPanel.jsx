import { T, monoText, btn } from "../../theme.js";
import { Bases, OutDots } from "./widgets.jsx";
import { inningText, lastTenText, streakText } from "./gameState.js";

// the moment the first play landed.
function PlayFeed({ live }) {
  const plays = live.plays || [];
  if (!plays.length) {
    return (
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ color: T.sub, fontSize: 10, textTransform: "uppercase", marginBottom: 8 }}>
          Latest plays
        </div>
        <div style={{ fontSize: 12, color: T.faint }}>
          {/* `full` marks the heavy feed; without it we simply haven't loaded yet */}
          {live.full ? "No completed plays yet." : "Loading plays…"}
        </div>
      </div>
    );
  }
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

// Big at-a-glance score: Away X - Y Home, leader's box green (both green if
// tied, the trailing side stays neutral).
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
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
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

// panel before first pitch, and sits beside the play feed once a game is on.
function MatchupPanel({ m }) {
  const lbl = { color: T.sub, fontSize: 10, textTransform: "uppercase" };
  // Reserve the column while it loads, for the same reason as PlayFeed —
  // this is fetched once on expand, so returning null meant it popped in late
  // and shoved the rest of the panel sideways. `false` = the fetch failed.
  if (m === false) return null;
  if (!m || !m.away) {
    return (
      <div style={{ flex: 1, minWidth: 320 }}>
        <div style={{ ...lbl, marginBottom: 6 }}>Matchup</div>
        <div style={{ fontSize: 12, color: T.faint }}>Loading matchup…</div>
      </div>
    );
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
  const side = (t) => (
    <div style={{ flex: 1, minWidth: 150 }}>
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
      {/* spelled out on client request — "L10 4-6 · L4 · +18" was unreadable */}
      <div style={{ ...monoText, fontSize: 11, color: T.sub, marginTop: 4 }}>
        Last 10: {lastTenText(t.lastTen) ?? "—"}
        {streakText(t.streak) ? ` · ${streakText(t.streak)}` : ""}
      </div>
      <div style={{ ...monoText, fontSize: 11, color: T.sub }}>
        Run differential{" "}
        <span style={{ fontWeight: 700,
          color: t.runDiff > 0 ? T.green : t.runDiff < 0 ? T.red : T.sub }}>
          {t.runDiff > 0 ? "+" : ""}{t.runDiff ?? "—"}
        </span>
      </div>
      <div style={{ ...monoText, fontSize: 11, color: T.faint }}>
        {/* win % alongside the raw W-L (client request, Aug 11) */}
        Home {t.homeRecord ?? "—"}{recordPct(t.homeRecord)} · Away {t.awayRecord ?? "—"}{recordPct(t.awayRecord)}
      </div>
      {t.probable && (
        <div style={{ marginTop: 7, paddingTop: 6, borderTop: `1px solid ${T.border}` }}>
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
      )}
    </div>
  );
  return (
    <div style={{ flex: 1, minWidth: 320 }}>
      <div style={{ ...lbl, marginBottom: 6 }}>Matchup</div>
      <div style={{ display: "flex", gap: 26, flexWrap: "wrap", alignItems: "flex-start" }}>
        {side(m.away)}
        {side(m.home)}
        {/* series + venue take the third column so the row fills the panel */}
        <div style={{ flex: 1, minWidth: 150 }}>
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
    </div>
  );
}

// The MLB.com-style line score shown when a row is expanded.
export default function ExpandPanel({ live, onAnalyze, matchup }) {
  if (!live) return <div style={{ ...monoText, fontSize: 12, padding: "8px 10px", color: T.faint }}>Loading live data…</div>;
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
  return (
    <div style={{ padding: "12px 16px", background: T.soft, borderTop: `1px solid ${T.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
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
              <div style={{ color: T.sub, fontSize: 10, textTransform: "uppercase" }}>Pitching</div>
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
              <div style={{ color: T.sub, fontSize: 10, textTransform: "uppercase" }}>At bat</div>
              <div style={{ fontWeight: 600 }}>{live.batter.name ?? "—"}</div>
              {live.batter.ops && <div style={{ color: T.sub }}>{live.batter.ops} OPS</div>}
            </div>
            <div>
              <div style={{ color: T.sub, fontSize: 10, textTransform: "uppercase" }}>Count / Outs</div>
              <div style={{ fontWeight: 600 }}>
                {live.balls}-{live.strikes}, {live.outs} out
                {live.last_pitch?.foul && (
                  <span style={{ color: T.series[1], marginLeft: 8 }}>· foul</span>
                )}
              </div>
              <div style={{ marginTop: 6 }}><OutDots outs={live.outs} size={16} /></div>
              <div style={{ marginTop: 8 }}><Bases bases={live.bases} /></div>
            </div>
          </div>
        )}
      </div>
      {live.status === "Live" && <PlayFeed live={live} />}
      <MatchupPanel m={matchup} />
      </div>
    </div>
  );
}

