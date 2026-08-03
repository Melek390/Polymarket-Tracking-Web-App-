import { fmtClock, TZ_LABEL } from "../../utils.js";

// True during the between-halves pause (10-20s): the top just ended (home team
// coming up) or the whole inning ended (visiting team up next inning).
export function isInningBreak(live) {
  return live?.inning_state === "Middle" || live?.inning_state === "End";
}

// Is this game done? A finished market's prices are pinned at ~0¢/100¢, so a
// price alert would match on every tick for the rest of the day.
// With no MLB data at all we are never told it is Final, so fall back to the
// clock: a game with nothing to report 4h after first pitch is over far more
// often than it is still running. Inside that window we let alerts through, so
// a transient MLB outage doesn't silence a genuinely live game.
const NO_DATA_OVER_MS = 4 * 3600e3;
export function isFinished(live, kickoff) {
  if (live) {
    return live.status === "Final" || /postponed|cancel/i.test(live.game_state || "");
  }
  return kickoff != null && Date.now() - kickoff > NO_DATA_OVER_MS;
}

// A game is flagged "Live" during warmup or a delay while no pitch has been
// thrown — show that instead of the misleading "Top 1".
export function preGameLabel(live) {
  const gs = live?.game_state || "";
  if (/warmup/i.test(gs)) return "Warmup";
  if (/delay|suspend/i.test(gs)) return gs; // e.g. "Delayed Start: Rain"
  return null;
}

// "▲ Top 6" / "▼ Bot 7" from the live inning, the between-innings break, warmup,
// or the scheduled time.
export function inningText(live, kickoff) {
  if (!live || live.status === "Preview")
    return kickoff ? `${fmtClock(kickoff)} ${TZ_LABEL}` : "—";
  if (live.status === "Final") return "Final";
  const pg = preGameLabel(live);
  if (pg) return pg;
  const n = live.inning ?? "";
  if (live.inning_state === "Middle") return `End of Top ${n} · break`;
  if (live.inning_state === "End") return `End of Bot ${n} · break`;
  const arrow = live.is_top ? "▲" : "▼";
  const half = live.is_top ? "Top" : "Bot";
  return `${arrow} ${half} ${n}`;
}

// Live event feed — the last few completed plays, newest big on top, so a run,
// home run or out is obvious the moment it happens.
// The column ALWAYS renders while a game is live, even with nothing to show:
// plays only arrive with the heavy feed, so returning null here meant the panel
// opened without this column and then reflowed — shoving the matchup sideways —

// MLB hands us a streak CODE ("W3" / "L4"). Printed raw it read as a mystery
// next to the L10 record, so spell it out.
export function streakText(code) {
  const m = /^([WL])(\d+)$/i.exec(code || "");
  if (!m) return null;
  return `${m[1].toUpperCase() === "W" ? "Won" : "Lost"} ${m[2]} straight`;
}

// "4-6" -> "4W-6L", so it can't be mistaken for a score.
export function lastTenText(record) {
  const m = /^(\d+)-(\d+)$/.exec(record || "");
  return m ? `${m[1]}W-${m[2]}L` : record || null;
}

// Standings, season series and probable starters — the context that fills the
