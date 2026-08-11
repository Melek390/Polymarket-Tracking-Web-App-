import { useEffect, useRef, useState } from "react";
import { T, card, monoText, btn } from "../theme.js";
import { fmtCents } from "../utils.js";
import { fetchMlbGame, fetchLivePrice, fetchMlbAnalyze, fetchMlbMatchup, fetchFavorite } from "../api/client.js";
import { loadAlerts, persistAlerts, matches, playSound, soundType, matchReason } from "../alerts.js";
import { loadHighlights, persistHighlights, highlightColor } from "../highlights.js";
import AlertDialog from "./AlertDialog.jsx";
import AlertBar from "./AlertBar.jsx";
import HighlightPicker, { ClearHighlights } from "./HighlightPicker.jsx";
import LivePrice from "./LivePrice.jsx";
import Toasts, { useToasts } from "./Toasts.jsx";
import ExpandPanel from "./baseball/ExpandPanel.jsx";
import { Bases, BattingTag, HomeAwayTag, OutDots } from "./baseball/widgets.jsx";
import { breakText, inningText, isFinished, isInningBreak, preGameLabel } from "./baseball/gameState.js";
import TeamTagsDialog, { TeamTag } from "./baseball/TeamTagsDialog.jsx";
import { loadTeamTags, tagsFor, taggedTeamCount } from "../teamTags.js";
import { loadScreenerHidden, toggleScreenerHidden } from "../screenerHidden.js";
import { loadNotes, setNote } from "../matchNotes.js";

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

export default function BaseballTable({ rows, onTrack, trackBusy, trackedCount = () => 0, statuses = [] }) {
  const [liveById, setLiveById] = useState({});
  const [priceBySlug, setPriceBySlug] = useState({}); // live CLOB asks
  const [expanded, setExpanded] = useState(new Set());
  const [alerts, setAlerts] = useState(loadAlerts);
  const [highlights, setHighlights] = useState(loadHighlights); // slug -> colour key
  const [hits, setHits] = useState(new Set()); // slugs currently alerting
  // slug -> [team abbrs that have just gone to the bullpen], until dismissed
  const [pitcherChange, setPitcherChange] = useState({});
  // slug -> [team abbrs that have just gone deep], until dismissed
  const [homeRun, setHomeRun] = useState({});
  const [dialogOpen, setDialogOpen] = useState(false); // global MLB alert dialog
  const [dialogRow, setDialogRow] = useState(null); // per-game alert dialog
  const { toasts, push: pushToast, dismiss: dismissToast, clear: clearToasts } = useToasts();
  const [analyze, setAnalyze] = useState(null); // {text, copied, busy}
  const [sort, setSort] = useState({ key: null, dir: "desc" }); // key: away|home|score|null
  const [matchups, setMatchups] = useState({}); // gamePk -> standings/series/probables
  const [teamTags, setTeamTags] = useState(loadTeamTags); // the user's club labels
  const [tagsOpen, setTagsOpen] = useState(false);
  const [hidden, setHidden] = useState(loadScreenerHidden); // slug -> hidden
  const [showHidden, setShowHidden] = useState(false); // reveal hidden (dimmed)
  const [notes, setNotes] = useState(loadNotes); // slug -> the user's note
  const [noteEdit, setNoteEdit] = useState(null); // slug being edited
  const [noteDraft, setNoteDraft] = useState("");
  const [favorites, setFavorites] = useState({}); // gamePk -> Clear Favorite verdict

  // Build the paste-ready snapshot (MLB + Polymarket), copy it to the clipboard
  // and show it in a modal. It stays open until the user closes it; clicking
  // Analyze again regenerates a fresh snapshot.
  async function runAnalyze(gamePk, pmLine) {
    if (!gamePk) return;
    setAnalyze({ busy: true });
    try {
      const res = await fetchMlbAnalyze(gamePk);
      const text = pmLine ? `${pmLine}\n\n${res.text}` : res.text;
      let copied = false;
      try { await navigator.clipboard.writeText(text); copied = true; } catch {}
      setAnalyze({ text, copied });
    } catch (e) {
      setAnalyze({ text: `Could not build the analysis: ${e.message}`, copied: false });
    }
  }
  const liveRef = useRef({});
  liveRef.current = liveById;
  const priceRef = useRef({});
  priceRef.current = priceBySlug;
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const matchRef = useRef({}); // slug -> { matched, acked }
  const pitcherRef = useRef({}); // gamePk -> last seen {away, home} counts
  const homerRef = useRef({});   // same, for home runs
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  // gamePks probed once for a final score (see the poll filter)
  const probedRef = useRef(new Set());

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
    // Turning an alert off must SILENCE it. Toasts live 40s, so without this
    // the ones already raised sat on screen after "Turn off" — which reads as
    // "I turned it off and it still gave me alert".
    clearToasts();
  }
  const saveAlert = (a) => saveKey(SPORT, a); // global
  const clearAlert = () => clearKey(SPORT);

  // Another window of the app keeps its own copy of this state, loaded at
  // mount. Without listening for storage events, turning an alert off in one
  // window left every other window alerting FOREVER — the client runs two
  // screens, so this is a real path, not a corner case.
  useEffect(() => {
    const sync = (e) => {
      if (e.key === "screenerAlerts") {
        setAlerts(loadAlerts());
        matchRef.current = {};
        setHits(new Set());
        clearToasts();
      } else if (e.key === "mlbTeamTags") {
        setTeamTags(loadTeamTags()); // tags edited in another window show here
      } else if (e.key === "screenerHighlights") {
        setHighlights(loadHighlights());
      } else if (e.key === "screenerHiddenRows") {
        setHidden(loadScreenerHidden());
      } else if (e.key === "matchNotes") {
        setNotes(loadNotes());
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  // Row highlights: the user's own colour marks, kept in the browser. Read
  // fresh from storage on write so the screener's other table can't clobber
  // them (same reason the alert map does).
  function setHighlight(slug, colorKey) {
    const next = { ...loadHighlights() };
    if (colorKey) next[slug] = colorKey;
    else delete next[slug];
    setHighlights(next);
    persistHighlights(next);
  }
  function clearHighlights() {
    const next = { ...loadHighlights() };
    for (const r of rows) delete next[r.slug];
    setHighlights(next);
    persistHighlights(next);
  }
  const highlightCount = rows.filter((r) => highlights[r.slug]).length;

  function dismiss(slug) {
    if (matchRef.current[slug]) matchRef.current[slug].acked = true;
    setHits((prev) => { const n = new Set(prev); n.delete(slug); return n; });
  }

  // Which teams' {away, home} counter went UP since the last tick, so an event
  // is visible in the list without expanding anything. Only an INCREASE counts,
  // and the very first reading for a game is merely recorded — otherwise every
  // game would flag on page load just because we hadn't seen it before.
  function risenTeams(liveMap, key, ref) {
    const flags = {};
    for (const r of rowsRef.current) {
      const live = liveMap[r.gamePk] ?? liveRef.current[r.gamePk];
      // Only a LIVE game can have events. MLB posts the announced starter
      // into the boxscore hours before first pitch, so a pre-game row's
      // pitcher count "rises" 0 -> 1 when lineups drop — that painted an
      // orange PITCHER CHANGED badge on a game 4-5h away (client, Aug 7).
      if (!live || live.status !== "Live") continue;
      const now = live[key];
      if (!now) continue;
      const prev = ref.current[r.gamePk];
      ref.current[r.gamePk] = now;
      if (!prev) continue;
      const teams = [];
      if (now.away > prev.away) teams.push(live.away?.abbr ?? "Away");
      if (now.home > prev.home) teams.push(live.home?.abbr ?? "Home");
      if (teams.length) flags[r.slug] = teams;
    }
    return flags;
  }
  function detectEvents(liveMap) {
    const pitchers = risenTeams(liveMap, "pitchers", pitcherRef);
    if (Object.keys(pitchers).length) setPitcherChange((p) => ({ ...p, ...pitchers }));
    const homers = risenTeams(liveMap, "home_runs", homerRef);
    if (Object.keys(homers).length) setHomeRun((p) => ({ ...p, ...homers }));
  }
  const dismissFlag = (setter, slug) =>
    setter((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });

  // Check the global MLB alert AND each game's own alert against the freshest
  // live data. A game matches if EITHER fires. Sound plays (three times) when a
  // game starts matching; each game re-arms only after it stops matching.
  function evaluate(liveMap, priceMap) {
    const globalAlert = alertsRef.current[SPORT];
    const nextHits = new Set();
    const fired = []; // every game that just started matching (each gets a toast)
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
      const over = isFinished(live, r.kickoff);
      // Preview (incl. warmup) or a kickoff still in the future = not started
      const notStarted = live ? live.status === "Preview"
        : (r.kickoff ? r.kickoff > Date.now() : false);
      const hit = rowAlerts.find((a) => matches(a, { prices, live, over, notStarted }));
      const m = !!hit;
      if (m && !st.matched && !st.acked) {
        const reason = matchReason(hit, prices, live);
        fired.push({
          text: `${r.away} @ ${r.home} matches your alert${reason ? ` · ${reason}` : ""}`,
          type: soundType(hit),
        });
      }
      if (!m) st.acked = false;
      st.matched = m;
      matchRef.current[r.slug] = st;
      if (m && !st.acked) nextHits.add(r.slug);
    }
    if (fired.length) {
      playSound(fired[0].type); // one sound per tick, however many matched
      fired.forEach((f) => pushToast(f.text));
    }
    setHits(nextHits);
  }

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
          if (r.kickoff && now - r.kickoff < 5 * 3600e3 && r.kickoff - now < 30 * 60e3) return true;
          // Older games get ONE probe so their final score survives a page
          // reload — the backend keeps yesterday's schedule too, the browser
          // just never asked. Once the answer is Final the branch above stops
          // any re-polling; probedRef stops retry loops for games the backend
          // can't resolve (the July 26 feed flood was exactly such a cycle).
          if (st === undefined && r.kickoff
              && now - r.kickoff >= 5 * 3600e3 && now - r.kickoff < 26 * 3600e3
              && !probedRef.current.has(r.gamePk)) {
            probedRef.current.add(r.gamePk);
            return true;
          }
          return false;
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
      detectEvents(nextLive);
      evaluate(nextLive, nextPrice);
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  function toggle(pk) {
    const opening = !expanded.has(pk);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(pk) ? next.delete(pk) : next.add(pk);
      return next;
    });
    // Pull the heavy feed straight away instead of waiting up to POLL_MS for
    // the next tick. Only it carries plays / ERA / OPS, so without this the
    // panel sat on the light state for a beat before filling in.
    if (opening && pk) {
      fetchMlbGame(pk, true)
        .then((g) => g && setLiveById((prev) => ({ ...prev, [pk]: g })))
        .catch(() => {});
    }
    // standings / series / probables, fetched once per game on first expand
    if (pk && matchups[pk] === undefined) {
      setMatchups((prev) => ({ ...prev, [pk]: null }));
      fetchMlbMatchup(pk)
        .then((m) => setMatchups((prev) => ({ ...prev, [pk]: m })))
        // false, not null: null still means "loading" to MatchupPanel
        .catch(() => setMatchups((prev) => ({ ...prev, [pk]: false })));
    }
  }

  // Clear Favorite verdicts (client scoring spec, Aug 11): fetched for the
  // day's games in small batches — the backend caches each verdict 10 min,
  // so this refresh loop stays cheap however many windows are open.
  useEffect(() => {
    let stop = false;
    async function load() {
      const now = Date.now();
      const targets = rowsRef.current.filter((r) => r.gamePk && r.kickoff
        && r.kickoff > now - 6 * 3600e3 && r.kickoff < now + 36 * 3600e3);
      for (let i = 0; i < targets.length && !stop; i += 3) {
        const batch = targets.slice(i, i + 3);
        const res = await Promise.allSettled(batch.map((r) => fetchFavorite(r.gamePk)));
        if (stop) return;
        setFavorites((prev) => {
          const next = { ...prev };
          batch.forEach((r, j) => {
            if (res[j].status === "fulfilled") next[r.gamePk] = res[j].value;
          });
          return next;
        });
      }
    }
    load();
    const id = setInterval(load, 600_000);
    return () => { stop = true; clearInterval(id); };
  }, [rows]);

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
  const statusRows = statuses.length === 0
    ? rows
    : rows.filter((r) => statuses.includes(rowStatus(r)));
  const hiddenN = statusRows.filter((r) => hidden[r.slug]).length;
  const displayRows = showHidden ? statusRows : statusRows.filter((r) => !hidden[r.slug]);
  // per-match note (client request): free text under the game name.
  // Editor + display live in the title cell; the 📝 button sits with the
  // other row actions. Shared with the generic screener via matchNotes.js.
  const saveNote = (slug) => { setNotes({ ...setNote(slug, noteDraft) }); setNoteEdit(null); };
  const noteBlock = (slug) => (noteEdit === slug ? (
    <div style={{ marginTop: 4 }}>
      <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
        rows={2} autoFocus placeholder="Your note about this match…"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveNote(slug); } }}
        style={{ ...monoText, width: "100%", maxWidth: 420, fontSize: 12, padding: 6,
          border: `1px solid ${T.border}`, borderRadius: 6, color: T.ink, display: "block" }} />
      <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
        <button onClick={() => saveNote(slug)}
          style={{ ...btn.green, fontSize: 11, padding: "3px 10px" }}>Save</button>
        <button onClick={() => setNoteEdit(null)}
          style={{ ...btn.ghost, fontSize: 11, padding: "3px 8px" }}>Cancel</button>
        {notes[slug] && (
          <button onClick={() => { setNotes({ ...setNote(slug, "") }); setNoteEdit(null); }}
            style={{ ...btn.ghost, fontSize: 11, padding: "3px 8px", color: T.red }}>Delete</button>
        )}
      </div>
    </div>
  ) : notes[slug] ? (
    <div style={{ fontSize: 11, color: T.sub, fontStyle: "italic", fontWeight: 400,
      marginTop: 3, whiteSpace: "normal", maxWidth: 420 }}>
      📝 {notes[slug]}
    </div>
  ) : null);
  const noteBtn = (slug) => (
    <button onClick={() => {
        if (noteEdit === slug) { setNoteEdit(null); return; }
        setNoteEdit(slug); setNoteDraft(loadNotes()[slug] || "");
      }}
      title={notes[slug] ? "Edit your note for this match" : "Write a note about this match"}
      style={{ ...btn.outline, fontSize: 12, padding: "5px 8px", marginRight: 6,
        color: notes[slug] ? T.series[0] : T.sub,
        borderColor: notes[slug] ? T.series[0] : undefined }}>
      📝
    </button>
  );

  const rowHideBtn = (slug) => (
    <button onClick={() => setHidden({ ...toggleScreenerHidden(slug) })}
      title={hidden[slug] ? "Show this game again" : "Hide this game from the list (nothing is deleted)"}
      style={{ ...btn.outline, fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
        padding: "3px 9px", whiteSpace: "nowrap",
        color: hidden[slug] ? "#fff" : T.red,
        background: hidden[slug] ? T.green : "transparent",
        borderColor: hidden[slug] ? T.green : T.red }}>
      {hidden[slug] ? "UNHIDE" : "HIDE"}
    </button>
  );

  // Resolve a row's MLB-designated home/away teams + prices (shared by the row
  // render and the sort comparator, so they always agree).
  function resolved(r) {
    const lp = priceBySlug[r.slug];
    const rHome = lp?.home ?? r.homePrice;
    const rAway = lp?.away ?? r.awayPrice;
    const live = liveById[r.gamePk];
    const rHomeIsHome = !live || !live.home || !live.away
      ? false
      : _teamMatch(live.home.name, r.home) >= _teamMatch(live.home.name, r.away);
    return {
      homeTeam: rHomeIsHome ? r.home : r.away,
      homePrice: rHomeIsHome ? rHome : rAway,
      awayTeam: rHomeIsHome ? r.away : r.home,
      awayPrice: rHomeIsHome ? rAway : rHome,
    };
  }
  function sortVal(r, key) {
    if (key === "home") return resolved(r).homePrice;
    if (key === "away") return resolved(r).awayPrice;
    if (key === "score") {
      const l = liveById[r.gamePk];
      return l && l.status !== "Preview" ? (l.away.runs ?? 0) + (l.home.runs ?? 0) : null;
    }
    return null;
  }
  function sortBy(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }
  const arrow = (key) => (sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : "");
  const shown = sort.key
    ? [...displayRows].sort((a, b) => {
        const dir = sort.dir === "asc" ? 1 : -1;
        return dir * ((sortVal(a, sort.key) ?? -Infinity) - (sortVal(b, sort.key) ?? -Infinity));
      })
    : displayRows;

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
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
        {(hiddenN > 0 || showHidden) && (
          <button onClick={() => setShowHidden((s) => !s)}
            style={{ ...btn.outline, fontSize: 12, padding: "6px 10px", fontWeight: 700 }}>
            {showHidden ? "Conceal hidden games" : `👁 ${hiddenN} hidden — show`}
          </button>
        )}
        <button
          onClick={() => setTagsOpen(true)}
          title="Label the clubs you follow so they stand out in the list"
          style={{ ...btn.outline, fontSize: 12, padding: "6px 10px" }}
        >
          🏷 Team tags{taggedTeamCount(teamTags) ? ` (${taggedTeamCount(teamTags)})` : ""}
        </button>
        <ClearHighlights count={highlightCount} onClear={clearHighlights} />
      </div>
      <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 28, textAlign: "center" }}>+/−</th>
              <th style={th}>Game</th>
              <th style={th}>Inning</th>
              <th style={th}>Batting</th>
              <th style={{ ...th, cursor: "pointer" }} onClick={() => sortBy("score")}>Score{arrow("score")}</th>
              <th style={{ ...th, textAlign: "right", cursor: "pointer" }} onClick={() => sortBy("away")}>Away{arrow("away")}</th>
              <th style={{ ...th, textAlign: "right", cursor: "pointer" }} onClick={() => sortBy("home")}>Home{arrow("home")}</th>
              <th style={{ ...th, textAlign: "center" }}>Outs</th>
              <th style={{ ...th, textAlign: "center" }}>Count</th>
              <th style={{ ...th, textAlign: "center" }}>Bases</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const live = r.gamePk ? liveById[r.gamePk] : null;
              const isLive = live?.status === "Live";
              const warmup = isLive && !!preGameLabel(live);
              const inPlay = isLive && !warmup; // actually playing (not warmup/delay)
              const open = expanded.has(r.gamePk);
              // MLB decides who is home/away, but show the full club names —
              // they stayed readable before first pitch and shouldn't collapse
              // to abbreviations once the game starts. Without live data, fall
              // back to Polymarket's away-first order (r.home = away).
              const away = live?.away.name ?? r.home;
              const home = live?.home.name ?? r.away;
              // A finished game KEEPS its score — it used to blank to "—" the
              // moment the status flipped to Final, even though the runs were
              // right there in the cached state (the expand panel still showed
              // them, which is how the client caught it).
              const score = inPlay || live?.status === "Final"
                ? `${live.away.runs ?? 0}-${live.home.runs ?? 0}` : "—";
              const battingTeam = inPlay
                ? (live.batting === "away" ? live.away : live.home) : null;
              // MLB-designated home/away teams + prices (live CLOB mid overrides
              // the cached price); shared with the sort comparator via resolved()
              const { homeTeam, homePrice, awayTeam, awayPrice } = resolved(r);
              // Clear Favorite tag, matched by TEAM NAME (the verdict speaks
              // MLB home/away; the row may be Polymarket away-first)
              const fav = favorites[r.gamePk];
              const favName = fav?.favorite ? fav[`${fav.favorite}_name`] : null;
              const favTip = favName
                ? `CLEAR FAVORITE — ${fav[fav.favorite].total}/100 points\n`
                  + fav[fav.favorite].factors
                    .map((x) => `${x.key}: ${x.points}/${x.max} — ${x.detail}`).join("\n")
                : "";
              // Home / Away columns: the team name under its win price, and a
              // BATTING pill on whichever side is at bat, so these columns can
              // be read without glancing back at the Batting column
              const priceCell = (team, price, color, isBatting) => (
                <td style={{ ...td, textAlign: "right" }}>
                  <div><LivePrice cents={price} color={color} /></div>
                  <div style={{ fontFamily: T.ui, fontSize: 11, color: T.sub }}>{team}</div>
                  {team === favName && (
                    <div style={{ marginTop: 2 }}>
                      <span title={favTip}
                        style={{ fontFamily: T.ui, fontSize: 9, fontWeight: 800,
                          letterSpacing: 0.5, color: "#fff", background: "#D97706",
                          borderRadius: 4, padding: "1px 6px", cursor: "help" }}>
                        ★ CLEAR FAVORITE
                      </span>
                    </div>
                  )}
                  {(() => {
                    const mine = tagsFor(teamTags, team);
                    return mine.length ? (
                      <div style={{ display: "flex", gap: 3, flexWrap: "wrap",
                        justifyContent: "flex-end", marginTop: 2 }}>
                        {mine.map((t) => <TeamTag key={t.id} tag={t} />)}
                      </div>
                    ) : null;
                  })()}
                  {isBatting && <div style={{ marginTop: 3 }}><BattingTag /></div>}
                </td>
              );
              const alerting = hits.has(r.slug);
              const hl = highlightColor(highlights[r.slug]);
              return [
                <tr
                  key={r.slug}
                  style={{
                    borderTop: `1px solid ${T.border}`,
                    // The user's colour WINS. A matching alert used to override
                    // it, so picking a colour on an alerting row looked like it
                    // did nothing at all — the colour was saved, just invisible.
                    // The alert stays obvious via the bell and the amber stripe
                    // down the right edge.
                    background: hl ? hl.bg : alerting ? "#FEF3C7" : undefined,
                    opacity: hidden[r.slug] ? 0.45 : 1,
                  }}
>
                  <td style={{ ...center, boxShadow: hl ? `inset 4px 0 0 ${hl.dot}` : undefined }}>
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
                    {/* running bullpen usage, so the depth is visible without
                        expanding the row */}
                    {inPlay && live?.pitchers && (
                      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.faint, fontWeight: 400 }}>
                        pitchers used: {live.away.abbr} {live.pitchers.away} · {live.home.abbr}{" "}
                        {live.pitchers.home}
                      </div>
                    )}
                    {/* inline event badges — spotted while scanning the list,
                        each dismissable, no popup */}
                    {[
                      homeRun[r.slug] && {
                        key: "hr", teams: homeRun[r.slug], bg: T.series[2],
                        label: "HOME RUN", setter: setHomeRun,
                      },
                      pitcherChange[r.slug] && {
                        key: "pc", teams: pitcherChange[r.slug], bg: T.series[1],
                        label: "PITCHER CHANGED", setter: setPitcherChange,
                      },
                    ].filter(Boolean).map((f) => (
                      <div key={f.key} style={{
                        display: "inline-flex", alignItems: "center", gap: 6, marginTop: 3,
                        marginRight: 5,
                        fontFamily: T.ui, fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                        color: "#fff", background: f.bg, borderRadius: 4, padding: "2px 6px",
                      }}>
                        {f.teams.join(" & ")} {f.label}
                        <span
                          onClick={() => dismissFlag(f.setter, r.slug)}
                          title="Dismiss"
                          style={{ cursor: "pointer", fontWeight: 700, opacity: 0.85 }}
                        >
                          ×
                        </span>
                      </div>
                    ))}
                    {noteBlock(r.slug)}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap",
                    color: warmup || isInningBreak(live) ? T.series[1] : isLive ? T.red : T.sub,
                    fontWeight: warmup || isInningBreak(live) ? 700 : undefined }}>
                    {isInningBreak(live) ? (
                      /* two lines on client request — the one-line
                         "End of Bot 4 · break" was the widest thing in
                         this column and forced horizontal scrolling */
                      <>
                        <div>⏸ {breakText(live)}</div>
                        <div style={{ fontSize: 10, fontWeight: 400 }}>(break)</div>
                      </>
                    ) : inningText(live, r.kickoff)}
                  </td>
                  <td style={{ ...td, fontFamily: T.ui, whiteSpace: "nowrap" }}>
                    {battingTeam ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        {/* During a break this column names the side coming up
                            NEXT, not one that is batting — without saying so it
                            reads as though they are at the plate already. */}
                        {isInningBreak(live) && (
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                            color: T.series[1] }}>
                            UP NEXT:
                          </span>
                        )}
                        {battingTeam.name}
                        {/* the word carries the meaning, the colour makes it
                            scannable; AFTER the name on client request */}
                        <HomeAwayTag side={live.batting} />
                      </span>
                    ) : "—"}
                  </td>
                  <td style={td}>{score}</td>
                  {/* Away first, then Home — matches the "Away @ Home" game
                      column and the away-home score, so the columns line up */}
                  {priceCell(awayTeam, awayPrice, priceColor(awayPrice, homePrice),
                    inPlay && live.batting === "away")}
                  {priceCell(homeTeam, homePrice, priceColor(homePrice, awayPrice),
                    inPlay && live.batting === "home")}
                  <td style={center}>
                    {inPlay ? (
                      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <span>{live.outs ?? 0} out</span>
                        <OutDots outs={live.outs} size={11} />
                      </span>
                    ) : "—"}
                  </td>
                  <td style={center}>
                    {inPlay ? (
                      <>
                        <div>{live.balls}-{live.strikes}</div>
                        {/* a foul with two strikes leaves the count unchanged,
                            so without this the row looks frozen mid at-bat */}
                        {live.last_pitch?.foul && (
                          <div style={{ fontSize: 10, fontWeight: 700, color: T.series[1] }}>
                            FOUL
                          </div>
                        )}
                      </>
                    ) : "—"}
                  </td>
                  <td style={center}>{inPlay ? <Bases bases={live.bases} /> : "—"}</td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap",
                    // a highlighted row keeps its own colour, so the alert
                    // needs its own mark — amber down the right edge
                    boxShadow: alerting && hl ? `inset -4px 0 0 ${T.series[1]}` : undefined }}>
                    <HighlightPicker
                      color={highlights[r.slug]}
                      onPick={(c) => setHighlight(r.slug, c)}
                    />{" "}
                    <button
                      onClick={() => setDialogRow(r)}
                      title={alerts[r.slug] ? "Edit this game's alert" : "Alert for this game only"}
                      style={{ ...btn.outline, fontSize: 13, padding: "5px 8px", marginRight: 6,
                        color: alerts[r.slug] ? T.series[0] : T.sub }}
                    >
                      {alerts[r.slug] ? "🔔" : "🔕"}
                    </button>
                    {noteBtn(r.slug)}
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
                    })()}{" "}
                    <a
                      href={`https://polymarket.com/event/${r.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ ...btn.outline, fontSize: 12, padding: "5px 9px", textDecoration: "none" }}
                    >
                      Web ↗
                    </a>{" "}
                    {rowHideBtn(r.slug)}
                  </td>
                </tr>,
                open && (
                  <tr key={`${r.slug}-x`}>
                    <td colSpan={11} style={{ padding: 0 }}>
                      <ExpandPanel
                        live={live}
                        matchup={matchups[r.gamePk]}
                        prices={{ awayTeam, awayPrice, homeTeam, homePrice }}
                        onAnalyze={() =>
                          runAnalyze(
                            r.gamePk,
                            homePrice != null && awayPrice != null
                              ? `Polymarket (win %): ${awayTeam} ${fmtCents(awayPrice)} | ${homeTeam} ${fmtCents(homePrice)}`
                              : "",
                          )
                        }
                      />
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

      {tagsOpen && (
        <TeamTagsDialog
          state={teamTags}
          onChange={setTeamTags}
          onClose={() => setTagsOpen(false)}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} />

      {analyze && (
        <div
          onClick={() => setAnalyze(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(26,29,35,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 130 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: "min(560px, 94vw)", padding: 20, position: "relative" }}>
            <button
              onClick={() => setAnalyze(null)}
              title="Close"
              style={{ position: "absolute", top: 10, right: 12, background: "none", border: "none",
                fontSize: 22, lineHeight: 1, cursor: "pointer", color: T.sub }}
            >
              ×
            </button>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, paddingRight: 24 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Game analysis</div>
              <div style={{ fontSize: 12, color: analyze.copied ? T.green : T.sub }}>
                {analyze.busy ? "Building…" : analyze.copied ? "✓ Copied to clipboard" : "Select & copy below"}
              </div>
            </div>
            {analyze.busy ? (
              <div style={{ padding: "28px 0", textAlign: "center", color: T.faint }}>Fetching live data…</div>
            ) : (
              <textarea
                readOnly
                value={analyze.text}
                onFocus={(e) => e.target.select()}
                style={{ ...monoText, width: "100%", height: 340, fontSize: 12, lineHeight: 1.5,
                  padding: 12, border: `1px solid ${T.border}`, borderRadius: 8, color: T.ink, resize: "vertical" }}
              />
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
              {!analyze.busy && (
                <button
                  onClick={() => { navigator.clipboard?.writeText(analyze.text).then(() => setAnalyze((a) => ({ ...a, copied: true }))); }}
                  style={{ ...btn.outline, fontSize: 13, padding: "8px 14px" }}
                >
                  Copy again
                </button>
              )}
              <button
                onClick={() => setAnalyze(null)}
                style={{ ...btn.primary, fontSize: 13, padding: "8px 16px" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
