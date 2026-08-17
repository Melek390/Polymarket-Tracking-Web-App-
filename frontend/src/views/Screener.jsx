import { useEffect, useState, useRef } from "react";
import { T, card, label, monoText, page, btn } from "../theme.js";
import { fmtTimestamp, fmtVolume, TZ_LABEL } from "../utils.js";
import { fetchScreener, fetchLivePrice, lookupEvent, trackSelected,
  fetchFootballLive, fetchFootballActive, ackFootball,
  fetchFootballConfig } from "../api/client.js";
import FootballDialog from "../components/FootballDialog.jsx";
import ScreenerPanel from "../components/ScreenerPanel.jsx";
import BaseballTable from "../components/BaseballTable.jsx";
import AlertDialog from "../components/AlertDialog.jsx";
import AlertBar from "../components/AlertBar.jsx";
import LivePrice from "../components/LivePrice.jsx";
import Toasts, { useToasts } from "../components/Toasts.jsx";
import HighlightPicker, { ClearHighlights } from "../components/HighlightPicker.jsx";
import { loadAlerts, persistAlerts, matches, playSound, soundType, matchReason } from "../alerts.js";
import { loadHighlights, persistHighlights, highlightColor } from "../highlights.js";
import { loadScreenerHidden, toggleScreenerHidden } from "../screenerHidden.js";
import { loadNotes, setNote } from "../matchNotes.js";

// key = the sport param sent to the API
const SPORTS = [
  { key: "soccer", label: "Soccer" },
  { key: "basketball", label: "Basketball" },
  { key: "baseball", label: "Baseball" },
  { key: "tennis", label: "Tennis" },
  { key: "football", label: "Football" },
  { key: "cricket", label: "Cricket" },
  { key: "esports", label: "Esports" },
];
const DATE_RANGES = ["Any", "Today", "Tomorrow", "This week", "Custom"];
const REFRESH_OPTIONS = [
  { label: "Off", seconds: 0 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
];
const EMPTY_FILTERS = {
  minVolume: "",
  homeMin: "",
  homeMax: "",
  drawMin: "",
  drawMax: "",
  awayMin: "",
  awayMax: "",
  dateRange: "Any",
  customFrom: "",
  customTo: "",
};

const chipBtn = (active) => ({
  ...(active ? btn.primary : btn.outline),
  fontSize: 12,
  padding: "6px 12px",
});

const input = {
  ...monoText,
  fontSize: 13,
  padding: "7px 10px",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.ink,
  width: 90,
};

const th = {
  ...label,
  position: "sticky",
  top: 0,
  background: T.soft,
  padding: "9px 14px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const td = { ...monoText, fontSize: 13, padding: "9px 14px" };

// soccer runs ~2 hours; give a match a 2.5h live window after kickoff
const LIVE_WINDOW_MS = 2.5 * 60 * 60 * 1000;
const STATUS_FILTERS = ["all", "soon", "live", "over"];
const EMPTY_SET = new Set();
const STATUS_META = {
  soon: { label: "COMING SOON", color: "#2563EB" },
  live: { label: "LIVE", color: "#D64545" },
  over: { label: "OVER", color: "#646B76" },
};

// API-FOOTBALL fixture statuses -> our three buckets (big-5 soccer rows)
const FB_OVER = new Set(["FT", "AET", "PEN", "FT?", "AWD", "WO", "ABD", "CANC"]);
const FB_LIVE = new Set(["1H", "HT", "2H", "ET", "P", "BT", "LIVE", "INT", "SUSP"]);

// Where a match sits in time, from its kickoff. Purely client-side so it
// stays accurate between the 5-minute cache refreshes.
function matchStatus(kickoff) {
  if (kickoff == null) return "soon";
  const now = Date.now();
  if (now < kickoff) return "soon";
  if (now < kickoff + LIVE_WINDOW_MS) return "live";
  return "over";
}

// Lowercase and strip accents, so typing "bolivar" finds "Club Bolívar"
// and "gremio" finds "Grêmio FBPA".
function plain(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Is a kickoff inside the selected date range?
function inDateRange(kickoff, f) {
  if (f.dateRange === "Any") return true;
  if (kickoff == null) return false;
  const day = 24 * 3600 * 1000;
  const midnight = new Date().setHours(0, 0, 0, 0);
  if (f.dateRange === "Today") return kickoff < midnight + day;
  if (f.dateRange === "Tomorrow")
    return kickoff >= midnight + day && kickoff < midnight + 2 * day;
  if (f.dateRange === "This week") return kickoff < midnight + 7 * day;
  const from = f.customFrom ? Date.parse(f.customFrom) : -Infinity;
  const to = f.customTo ? Date.parse(f.customTo) + day : Infinity;
  return kickoff >= from && kickoff <= to;
}

// A price passes when it is inside the bounds; unquoted prices only pass
// when no bound is set for that column.
function between(value, min, max) {
  if (value == null) return !min && !max;
  return (!min || value >= Number(min)) && (!max || value <= Number(max));
}

function matchesFilters(m, f, league, search) {
  if (league && m.league !== league) return false;
  if (search.trim()) {
    const text = plain(`${m.home} ${m.away} ${m.league}`);
    if (!text.includes(plain(search).trim())) return false;
  }
  if (f.minVolume && m.volume < Number(f.minVolume)) return false;
  if (!between(m.homePrice, f.homeMin, f.homeMax)) return false;
  if (!between(m.drawPrice, f.drawMin, f.drawMax)) return false;
  if (!between(m.awayPrice, f.awayMin, f.awayMax)) return false;
  return inDateRange(m.kickoff, f);
}

// Session cache (module scope): the screener refetched from zero on every
// visit and sport switch, flashing "Loading markets…" each time. The last
// response paints instantly and refreshes underneath.
const sportCache = {};

export default function Screener({ sport, onSport, onTracked, markets = [] }) {
  const [data, setData] = useState(() => sportCache[sport] ?? null); // {rows, leagues, updatedAt}
  const [error, setError] = useState(null);
  const [league, setLeague] = useState(null); // one league, null = all
  const [search, setSearch] = useState(""); // team or league text, filters live
  // Selected match statuses. Empty = show all; otherwise a match must be one of
  // them, so LIVE + COMING SOON can be watched together. Clicking a chip again
  // unchecks it.
  const [statuses, setStatuses] = useState([]);
  const toggleStatus = (s) =>
    setStatuses((prev) =>
      s === "all" ? [] : prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  // Big-5 soccer rows: the football API knows the REAL match state, while
  // Polymarket can leave a finished match's market unresolved (and our
  // time-window badge on "LIVE") for a while after full time. Where the
  // live cache has the fixture, its status wins; everything else keeps the
  // kickoff-window fallback.
  const rowStatus = (m) => {
    const st = fbLive[m.slug]?.status;
    if (st) {
      if (FB_OVER.has(st)) return "over";
      if (FB_LIVE.has(st)) return "live";
    }
    return matchStatus(m.kickoff);
  };
  const statusOk = (m) =>
    statuses.length === 0 || statuses.includes(rowStatus(m));
  const [draft, setDraft] = useState(EMPTY_FILTERS); // what the user is typing
  const [applied, setApplied] = useState(EMPTY_FILTERS); // what the table uses
  const [sort, setSort] = useState({ key: "volume", dir: "desc" });
  const [refreshSecs, setRefreshSecs] = useState(0);
  const [trackBusy, setTrackBusy] = useState(null); // slug whose props are loading
  const [picker, setPicker] = useState(null); // {row, results} chooser state
  const [pickerBusy, setPickerBusy] = useState(false);
  const [livePrices, setLivePrices] = useState({}); // slug -> fresh CLOB asks
  const [alerts, setAlerts] = useState(loadAlerts);
  const [highlights, setHighlights] = useState(loadHighlights); // slug -> colour key
  const [hidden, setHidden] = useState(loadScreenerHidden); // slug -> hidden
  const [showHidden, setShowHidden] = useState(false); // reveal hidden (dimmed)
  const [notes, setNotes] = useState(loadNotes); // slug -> the user's note
  const [noteEdit, setNoteEdit] = useState(null); // slug being edited
  const [noteDraft, setNoteDraft] = useState("");
  const [hits, setHits] = useState(new Set());
  const [dialogOpen, setDialogOpen] = useState(false); // global sport alert
  const [alertRow, setAlertRow] = useState(null); // per-game alert
  const { toasts, push: pushToast, dismiss: dismissToast, clear: clearToasts } = useToasts();
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const livePricesRef = useRef(livePrices);
  livePricesRef.current = livePrices;
  const matchRef = useRef({});
  const [presets, setPresets] = useState(() =>
    JSON.parse(localStorage.getItem("screenerPresets") || "[]"),
  );
  // soccer: big-5 live fixtures (score/minute/possession/shots/reds) and the
  // 0-0 clear-favorite triggers — server detects, the browser only reads
  const [fbLive, setFbLive] = useState({});     // slug -> live fixture + stats
  const [fbTrig, setFbTrig] = useState({});     // slug -> newest trigger
  const [fbCfgOpen, setFbCfgOpen] = useState(false);
  const [fbCfg, setFbCfg] = useState(null);     // current thresholds for the banner
  const fbSeen = useRef(new Set());             // trigger ids already announced

  async function load() {
    try {
      const d = await fetchScreener(sport);
      sportCache[sport] = d;
      setData(d);
      setError(null);
    } catch (e) {
      setError(`Could not load markets: ${e.message}`);
    }
  }

  // reload whenever the sport changes; clear the league since the list differs.
  // A cached response paints immediately, the fetch replaces it underneath.
  useEffect(() => {
    setData(sportCache[sport] ?? null);
    setLeague(null);
    load();
  }, [sport]);

  // An alert belongs to the sport that raised it. Toasts live 40s and this view
  // does NOT unmount when the sport changes, so without clearing them you arrive
  // on Cricket still reading alerts about Soccer games — which reads as "my MLB
  // alert is firing on every category". The matched-row state goes too, so a
  // highlight can't survive into a sport it was never about.
  useEffect(() => {
    clearToasts();
    matchRef.current = {};
    setHits(new Set());
  }, [sport]);

  // Soccer live data + 0-0 triggers, only while the soccer tab is open. The
  // server polls API-FOOTBALL on its own clock; this just reads the caches.
  // An unacked trigger this window hasn't announced yet gets a toast + the
  // situation tone — including on page load (unacked = "not checked yet").
  // the banner shows the saved thresholds; refresh after the dialog closes
  useEffect(() => {
    if (sport !== "soccer" || fbCfgOpen) return;
    fetchFootballConfig().then(setFbCfg).catch(() => {});
  }, [sport, fbCfgOpen]);

  useEffect(() => {
    if (sport !== "soccer") return;
    let stop = false;
    async function pull() {
      try {
        const [liveR, actR] = await Promise.all([
          fetchFootballLive(), fetchFootballActive()]);
        if (stop) return;
        const bySlug = {};
        for (const f of liveR.fixtures || []) {
          if (f.slug) bySlug[f.slug] = f;
        }
        setFbLive(bySlug);
        const trig = {};
        for (const t of actR.triggers || []) {
          const cur = trig[t.slug];
          if (!cur || (!t.ack_at && cur.ack_at)) trig[t.slug] = t;
        }
        setFbTrig(trig);
        for (const t of actR.triggers || []) {
          if (t.ack_at || fbSeen.current.has(t.id)) continue;
          fbSeen.current.add(t.id);
          pushToast(`⚽ 0-0 Alert — ${t.home_name} vs ${t.away_name} (${t.league}), `
            + `${t.minute}': favorite ${t.favorite_name} was `
            + `${t[`prematch_${t.favorite}_cents`]}¢ pre-match`
            + (t.favorite_red_cards ? ` · 🟥 favorite a man down!` : ""));
          playSound("situation");
        }
      } catch {
        /* server hiccup — next tick retries */
      }
    }
    pull();
    const id = setInterval(pull, 15_000);
    return () => { stop = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  // "stays there until I check it" — the ack lands server-side so it holds
  // across reloads and every open window
  async function checkFootball(t) {
    setFbTrig((prev) => ({ ...prev, [t.slug]: { ...t, ack_at: new Date().toISOString() } }));
    try {
      await ackFootball(t.id);
    } catch {
      /* the next pull re-flags it if the ack didn't land */
    }
  }

  // auto-refresh pulls fresh prices on the chosen interval
  useEffect(() => {
    if (!refreshSecs) return;
    const id = setInterval(load, refreshSecs * 1000);
    return () => clearInterval(id);
  }, [refreshSecs, sport]);

  // live games move too fast for the 5-min cache: pull their prices straight
  // from the CLOB every 12s so they track Polymarket (baseball has its own)
  useEffect(() => {
    if (sport === "baseball") return;
    let stop = false;
    async function tick() {
      const live = (data?.rows ?? []).filter(
        (m) => m.kickoff && matchStatus(m.kickoff) === "live",
      );
      const res = await Promise.allSettled(live.map((m) => fetchLivePrice(m.slug)));
      if (stop) return;
      const next = {};
      live.forEach((m, i) => {
        if (res[i].status === "fulfilled") next[m.slug] = res[i].value;
      });
      if (Object.keys(next).length) setLivePrices((prev) => ({ ...prev, ...next }));
      const merged = { ...livePricesRef.current, ...next };
      evaluate(merged);
    }
    tick();
    const id = setInterval(tick, 2000); // keep live rows tracking Polymarket (same as baseball)
    return () => { stop = true; clearInterval(id); };
  }, [data, sport, alerts]);

  // --- alerts: one global alert per sport (keyed by sport) PLUS an optional
  // per-game alert (keyed by slug). A game fires if EITHER matches. ----------
  function saveKey(key, alert) {
    const nextA = { ...loadAlerts(), [key]: alert };
    setAlerts(nextA);
    persistAlerts(nextA);
    delete matchRef.current[key]; // re-arm with the new criteria
  }
  function clearKey(key) {
    const nextA = { ...loadAlerts() };
    delete nextA[key];
    setAlerts(nextA);
    persistAlerts(nextA);
    matchRef.current = {};
    setHits(new Set());
    clearToasts(); // silence what was already raised, not just future fires
  }
  const saveAlert = (a) => saveKey(sport, a); // global (the AlertBar)
  const clearAlert = () => clearKey(sport);

  // Keep other windows of the app in sync — see BaseballTable for the story.
  useEffect(() => {
    const sync = (e) => {
      if (e.key === "screenerAlerts") {
        setAlerts(loadAlerts());
        matchRef.current = {};
        setHits(new Set());
        clearToasts();
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
  // fresh from storage on write so the baseball table can't clobber them.
  function setHighlight(slug, colorKey) {
    const next = { ...loadHighlights() };
    if (colorKey) next[slug] = colorKey;
    else delete next[slug];
    setHighlights(next);
    persistHighlights(next);
  }

  function dismiss(slug) {
    const st = matchRef.current[slug];
    if (st) st.acked = true; // stop highlighting until it stops then matches again
    setHits((prev) => { const n = new Set(prev); n.delete(slug); return n; });
  }
  function evaluate(priceMap) {
    const globalAlert = alertsRef.current[sport];
    const rows = data?.rows ?? [];
    const nextHits = new Set();
    const fired = []; // every game that just started matching (each gets a toast)
    rows.forEach((m) => {
      const rowAlerts = [globalAlert, alertsRef.current[m.slug]].filter(Boolean);
      const st = matchRef.current[m.slug] || { matched: false, acked: false };
      if (rowAlerts.length === 0) {
        st.matched = false; st.acked = false;
        matchRef.current[m.slug] = st;
        return;
      }
      const lp = priceMap[m.slug] || {};
      const prices = {
        home: lp.home ?? m.homePrice,
        away: lp.away ?? m.awayPrice,
        draw: lp.draw ?? m.drawPrice,
      };
      // a finished match's prices are pinned, so it must never alert — and a
      // match that hasn't kicked off must not either (pre-game odds sit under
      // price thresholds for hours; client caught it on MLB, Aug 7)
      const status = matchStatus(m.kickoff);
      const hit = rowAlerts.find((a) => matches(a, {
        prices, live: null, over: status === "over", notStarted: status === "soon",
      }));
      if (hit) {
        if (!st.matched && !st.acked) {
          const reason = matchReason(hit, prices, null);
          fired.push({
            text: `${m.away} @ ${m.home} matches your ${sport} alert${reason ? ` · ${reason}` : ""}`,
            type: soundType(hit),
          });
        }
        st.matched = true;
        if (!st.acked) nextHits.add(m.slug);
      } else {
        st.matched = false;
        st.acked = false; // re-arm: a later match sounds again
      }
      matchRef.current[m.slug] = st;
    });
    if (fired.length) {
      playSound(fired[0].type); // one sound per tick, however many matched
      fired.forEach((f) => pushToast(f.text));
    }
    setHits(nextHits);
  }

  // Track opens a chooser with every prop of the match. The extra props
  // (spreads, totals) live in a twin event whose slug is always the match
  // slug plus "-more-markets"; if that twin does not exist we just show
  // the winner and draw props.
  async function openPicker(row) {
    setTrackBusy(row.slug);
    try {
      const settled = await Promise.allSettled([
        lookupEvent(row.slug),
        lookupEvent(`${row.slug}-more-markets`),
      ]);
      const results = [];
      for (const s of settled) {
        if (s.status !== "fulfilled") continue;
        for (const m of s.value.markets) {
          results.push({
            eventSlug: s.value.slug,
            eventTitle: s.value.title,
            conditionId: m.conditionId,
            question: m.question,
            kind: m.kind,
            outcomes: m.outcomes.map((name) => ({ label: name })),
          });
        }
      }
      if (results.length === 0) throw new Error("no props found");
      setPicker({ row, results });
      window.scrollTo(0, 0); // the chooser opens at the top of the page
    } catch (e) {
      setError(`Could not load props: ${e.message}`);
    } finally {
      setTrackBusy(null);
    }
  }

  async function trackPicked(conditionIds) {
    setPickerBusy(true);
    try {
      const bySlug = {};
      for (const r of picker.results) {
        if (conditionIds.includes(r.conditionId)) {
          (bySlug[r.eventSlug] ??= []).push(r.conditionId);
        }
      }
      let picked = 0;
      let alreadyClosed = 0;
      for (const [slug, ids] of Object.entries(bySlug)) {
        const res = await trackSelected(slug, ids);
        picked += res?.market_ids?.length ?? 0;
        alreadyClosed += res?.closed_market_ids?.length ?? 0;
      }
      onTracked?.(); // dashboard picks the new markets up right away
      setPicker(null);
      // A resolved market can't be re-tracked — say so instead of doing
      // nothing visible (this game is over, its history is already stored).
      if (alreadyClosed > 0) {
        setError(
          alreadyClosed === picked
            ? "That market is already settled on Polymarket, so it can't be tracked again — its price history is already saved and still open from the dashboard."
            : `${alreadyClosed} of the ${picked} props you picked are already settled on Polymarket and were skipped; the rest are now tracking.`,
        );
      }
    } catch (e) {
      setError(`Tracking failed: ${e.message}`);
    } finally {
      setPickerBusy(false);
    }
  }

  function sortBy(key) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  }

  function savePreset() {
    const name = prompt("Name this filter preset:");
    if (!name) return;
    const next = [
      ...presets.filter((p) => p.name !== name),
      { name, filters: draft, league },
    ];
    setPresets(next);
    localStorage.setItem("screenerPresets", JSON.stringify(next));
  }

  function loadPreset(p) {
    setDraft(p.filters);
    setApplied(p.filters);
    // p.leagues covers presets saved before leagues became single-select
    setLeague(p.league ?? p.leagues?.[0] ?? null);
  }

  function removePreset(name) {
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    localStorage.setItem("screenerPresets", JSON.stringify(next));
  }

  const rows = data?.rows ?? [];

  // Which of a match's props are ALREADY in the tracker, from the real backend
  // state (not the ephemeral "just tracked" set) — so it stays correct after a
  // refresh. Keyed by the match slug (a prop can live on the "-more-markets"
  // twin, so strip that suffix). Resolved/closed markets don't count.
  const trackedByEvent = {};
  for (const m of markets) {
    if (m.closed || !m.conditionId) continue;
    const base = (m.eventSlug || "").replace(/-more-markets$/, "");
    (trackedByEvent[base] ??= new Set()).add(m.conditionId);
  }
  const trackedIdsFor = (slug) => trackedByEvent[slug] ?? EMPTY_SET;
  const trackedCount = (slug) => trackedIdsFor(slug).size;

  // soccer is the only 3-way sport; hide the Draw column for the rest
  const hasDraw = rows.some((m) => m.drawPrice != null);
  const visibleBase = rows
    .filter((m) => matchesFilters(m, applied, league, search))
    .filter((m) => statusOk(m));
  const hiddenN = visibleBase.filter((m) => hidden[m.slug]).length;
  // per-match note — same feature and storage as the baseball table
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
      style={{ ...btn.outline, fontSize: 12, padding: "6px 8px", marginRight: 6,
        color: notes[slug] ? T.series[0] : T.sub,
        borderColor: notes[slug] ? T.series[0] : undefined }}>
      📝
    </button>
  );

  const rowHideBtn = (slug) => (
    <button onClick={() => setHidden({ ...toggleScreenerHidden(slug) })}
      title={hidden[slug] ? "Show this match again" : "Hide this match from the list (nothing is deleted)"}
      style={{ ...btn.outline, fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
        padding: "3px 9px", whiteSpace: "nowrap",
        color: hidden[slug] ? "#fff" : T.red,
        background: hidden[slug] ? T.green : "transparent",
        borderColor: hidden[slug] ? T.green : T.red }}>
      {hidden[slug] ? "UNHIDE" : "HIDE"}
    </button>
  );
  const visible = (showHidden ? visibleBase : visibleBase.filter((m) => !hidden[m.slug]))
    .sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "match") return dir * a.home.localeCompare(b.home);
      if (sort.key === "league") return dir * a.league.localeCompare(b.league);
      return dir * ((a[sort.key] ?? -Infinity) - (b[sort.key] ?? -Infinity));
    });

  // only offer league chips that still have a match under the other active
  // filters (volume, price, date, status, search) — otherwise a chip could
  // look present while showing nothing
  const leagueSet = new Set(
    rows
      .filter((m) => matchesFilters(m, applied, null, search))
      .filter((m) => statusOk(m))
      .map((m) => m.league),
  );
  if (league) leagueSet.add(league); // keep the current pick deselectable
  const leagueOptions = [...leagueSet].sort();

  // esports competitions are "games" (LoL, Dota 2, …), not leagues
  const leagueWord = sport === "esports" ? "Game" : "League";

  // baseball has its own live scoreboard table; search-filter it, live/soon first
  const isBaseball = sport === "baseball";
  const baseballRows = rows
    .filter((m) => !search.trim() || plain(`${m.home} ${m.away}`).includes(plain(search).trim()))
    .sort((a, b) => (a.kickoff ?? Infinity) - (b.kickoff ?? Infinity));

  const arrow = (key) =>
    sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : "";

  const field = (key, placeholder) => (
    <input
      value={draft[key]}
      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      placeholder={placeholder}
      style={input}
    />
  );

  return (
    <main style={page}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Market screener</div>
        <div style={{ fontSize: 13, color: T.sub, marginTop: 2 }}>
          Browse every match on Polymarket and filter down to the ones worth
          tracking.
        </div>
      </div>

      {error && <div style={{ fontSize: 13, color: T.red }}>⚠ {error}</div>}

      {picker && (
        <ScreenerPanel
          results={picker.results}
          trackedIds={trackedIdsFor(picker.row.slug)}
          onTrack={trackPicked}
          onCancel={() => setPicker(null)}
          busy={pickerBusy}
          title={`${picker.row.home} vs ${picker.row.away} — choose the props to track`}
          emptyText="No props found for this match."
        />
      )}

      {/* quick text search — filters as you type, handy for checking
          whether one particular game is in the feed */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a team or league…"
          style={{
            ...monoText,
            flex: 1,
            fontSize: 14,
            padding: "11px 14px",
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            color: T.ink,
          }}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            style={{ ...btn.outline, fontSize: 13, padding: "10px 16px" }}
          >
            Clear
          </button>
        )}
      </div>

      {/* sport, then leagues discovered from the live data */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.sub }}>Sport:</span>
        {SPORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => !s.disabled && onSport(s.key)}
            disabled={s.disabled}
            title={s.disabled ? "Coming soon" : ""}
            style={chipBtn(sport === s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {isBaseball ? (
        <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: T.sub }}>Status:</span>
          {STATUS_FILTERS.map((s) => (
            <button key={s} onClick={() => toggleStatus(s)}
              style={chipBtn(s === "all" ? statuses.length === 0 : statuses.includes(s))}>
              {s === "all" ? "All" : STATUS_META[s].label}
            </button>
          ))}
        </div>
        <BaseballTable
          rows={baseballRows}
          statuses={statuses}
          onTrack={openPicker}
          trackBusy={trackBusy}
          trackedCount={trackedCount}
        />
        </>
      ) : (
      <>
      <AlertBar
        sport={sport}
        isMlb={false}
        alert={alerts[sport]}
        onEdit={() => setDialogOpen(true)}
        onClear={clearAlert}
      />
      {sport === "soccer" && (() => {
        // Same visual language as the Set-Alert bar above: a banner with a
        // real button, so the feature reads at a glance (client feedback:
        // the old small outline button "skipped my eyes").
        const on = fbCfg ? !!fbCfg.enabled : true;
        return (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              padding: "10px 14px", marginBottom: 12, borderRadius: 10,
              background: on ? "#FEF9E7" : T.soft,
              border: `1px solid ${on ? "#F5D67B" : T.border}`,
            }}
          >
            <span style={{ fontSize: 16 }}>⚽</span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
                0-0 Favorite Alert — big-5 leagues{on ? "" : " (OFF)"}
              </div>
              <div style={{ fontSize: 12, color: T.sub }}>
                {on
                  ? `Fires when a clear pre-match favorite (≥${fbCfg?.min_favorite_cents ?? 60}¢) `
                    + `is still 0-0 at ${fbCfg?.min_minute ?? 60}' — the row flashes red until checked.`
                  : "Off — no 0-0 favorite alerts will fire until it is re-enabled."}
              </div>
            </div>
            <button
              onClick={() => setFbCfgOpen(true)}
              title="0-0 Favorite Alert — thresholds and on/off"
              style={{ ...btn.primary, fontSize: 12, padding: "6px 14px" }}
            >
              {on ? "Edit alert" : "Turn on"}
            </button>
          </div>
        );
      })()}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.sub }}>Status:</span>
        {STATUS_FILTERS.map((s) => (
          <button key={s} onClick={() => toggleStatus(s)}
              style={chipBtn(s === "all" ? statuses.length === 0 : statuses.includes(s))}>
            {s === "all" ? "All" : STATUS_META[s].label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.sub }}>{leagueWord}:</span>
        <button onClick={() => setLeague(null)} style={chipBtn(league === null)}>
          All {leagueWord.toLowerCase()}s
        </button>
        {leagueOptions.map((l) => (
          <button
            key={l}
            onClick={() => setLeague(l === league ? null : l)}
            style={chipBtn(league === l)}
          >
            {l}
          </button>
        ))}
      </div>

      {/* filters */}
      <div style={{ ...card, background: T.soft, padding: 18 }}>
        <div style={label}>Filters</div>
        <div
          style={{
            display: "flex",
            gap: 22,
            flexWrap: "wrap",
            alignItems: "flex-end",
            marginTop: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>
              Minimum volume ($)
            </div>
            {field("minVolume", "50000")}
          </div>
          {[
            ["Home price (¢)", "homeMin", "homeMax"],
            ...(hasDraw ? [["Draw price (¢)", "drawMin", "drawMax"]] : []),
            ["Away price (¢)", "awayMin", "awayMax"],
          ].map(([title, minKey, maxKey]) => (
            <div key={minKey}>
              <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>
                {title}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {field(minKey, "min")}
                <span style={{ color: T.faint }}>to</span>
                {field(maxKey, "max")}
              </div>
            </div>
          ))}
          <div>
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>
              Kickoff
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DATE_RANGES.map((d) => (
                <button
                  key={d}
                  onClick={() => setDraft({ ...draft, dateRange: d })}
                  style={chipBtn(draft.dateRange === d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          {draft.dateRange === "Custom" && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="date"
                value={draft.customFrom}
                onChange={(e) => setDraft({ ...draft, customFrom: e.target.value })}
                style={{ ...input, width: 150 }}
              />
              <span style={{ color: T.faint }}>to</span>
              <input
                type="date"
                value={draft.customTo}
                onChange={(e) => setDraft({ ...draft, customTo: e.target.value })}
                style={{ ...input, width: 150 }}
              />
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 16,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => setApplied(draft)}
            style={{ ...btn.primary, fontSize: 13, padding: "9px 18px" }}
          >
            Apply filters
          </button>
          <button
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
              setLeague(null);
              setSearch("");
              setStatuses([]);
            }}
            style={{ ...btn.ghost, fontSize: 13, padding: "9px 14px" }}
          >
            Reset
          </button>
          <button
            onClick={savePreset}
            style={{ ...btn.outline, fontSize: 13, padding: "9px 14px" }}
          >
            Save as preset
          </button>
          {presets.map((p) => (
            <span
              key={p.name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: `1px solid ${T.border}`,
                background: "#fff",
                borderRadius: 999,
                padding: "5px 6px 5px 12px",
                fontSize: 12,
              }}
            >
              <span onClick={() => loadPreset(p)} style={{ cursor: "pointer" }}>
                {p.name}
              </span>
              <button
                onClick={() => removePreset(p.name)}
                title="Delete preset"
                style={{ ...btn.ghost, fontSize: 12, padding: "0 4px", color: T.faint }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* result count + auto refresh */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: T.sub }}>
          <strong style={{ color: T.ink }}>{visible.length}</strong> of{" "}
          {rows.length} matches
        </span>
        <span style={{ flex: 1 }} />
        {(hiddenN > 0 || showHidden) && (
          <button onClick={() => setShowHidden((s) => !s)}
            style={{ ...btn.outline, fontSize: 12, padding: "6px 10px", fontWeight: 700 }}>
            {showHidden ? "Conceal hidden matches" : `👁 ${hiddenN} hidden — show`}
          </button>
        )}
        <ClearHighlights
          count={visible.filter((m) => highlights[m.slug]).length}
          onClear={() => {
            const next = { ...loadHighlights() };
            for (const m of rows) delete next[m.slug];
            setHighlights(next);
            persistHighlights(next);
          }}
        />
        <span style={{ fontSize: 12, color: T.sub }}>Auto-refresh:</span>
        {REFRESH_OPTIONS.map((o) => (
          <button
            key={o.label}
            onClick={() => setRefreshSecs(o.seconds)}
            style={chipBtn(refreshSecs === o.seconds)}
          >
            {o.label}
          </button>
        ))}
        {data?.updatedAt && (
          <span style={{ ...monoText, fontSize: 12, color: T.faint }}>
            prices updated {fmtTimestamp(data.updatedAt).slice(11)} {TZ_LABEL}
          </span>
        )}
      </div>

      {/* results */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }} onClick={() => sortBy("match")}>
                  Match{arrow("match")}
                </th>
                <th style={{ ...th, textAlign: "left" }} onClick={() => sortBy("league")}>
                  {leagueWord}{arrow("league")}
                </th>
                <th style={{ ...th, textAlign: "left" }} onClick={() => sortBy("kickoff")}>
                  Kickoff ({TZ_LABEL}){arrow("kickoff")}
                </th>
                <th style={{ ...th, textAlign: "right" }} onClick={() => sortBy("volume")}>
                  Volume{arrow("volume")}
                </th>
                <th
                  style={{ ...th, textAlign: "right" }}
                  onClick={() => sortBy("homePrice")}
                >
                  Home{arrow("homePrice")}
                </th>
                {hasDraw && (
                  <th
                    style={{ ...th, textAlign: "right" }}
                    onClick={() => sortBy("drawPrice")}
                  >
                    Draw{arrow("drawPrice")}
                  </th>
                )}
                <th
                  style={{ ...th, textAlign: "right" }}
                  onClick={() => sortBy("awayPrice")}
                >
                  Away{arrow("awayPrice")}
                </th>
                <th style={{ ...th, textAlign: "right" }} />
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const hl = highlightColor(highlights[m.slug]);
                // soccer: the 0-0 trigger (flash until checked) + live stats
                const ft = fbTrig[m.slug];
                const ftActive = ft && !ft.ack_at;
                const fl = fbLive[m.slug];
                return (
                <tr key={m.slug} className={ftActive ? "mkt-row comeback-flash" : "mkt-row"}
                  style={{ borderTop: `1px solid ${T.border}`,
                    // The user's colour WINS — a matching alert used to override
                    // it, which made highlighting an alerting row look broken.
                    // The alert keeps its bell and gets an amber right edge.
                    background: hl ? hl.bg : hits.has(m.slug) ? "#FEF3C7" : undefined,
                    opacity: hidden[m.slug] ? 0.45 : 1 }}>
                  <td style={{ ...td, fontFamily: T.ui, fontWeight: 500,
                    boxShadow: hl ? `inset 4px 0 0 ${hl.dot}` : undefined }}>
                    {hits.has(m.slug) && (
                      <span title="Alert matching — click to dismiss"
                        onClick={() => dismiss(m.slug)}
                        style={{ cursor: "pointer", marginRight: 6 }}>🔔</span>
                    )}
                    {(() => {
                      const s = rowStatus(m);
                      const meta = STATUS_META[s];
                      return (
                        <span
                          className={s === "live" ? "pulse" : ""}
                          style={{
                            ...monoText,
                            fontSize: 9,
                            fontWeight: 600,
                            color: "#fff",
                            background: meta.color,
                            borderRadius: 4,
                            padding: "1px 5px",
                            marginRight: 8,
                            verticalAlign: "middle",
                          }}
                        >
                          {meta.label}
                        </span>
                      );
                    })()}
                    {m.home} vs {m.away}
                    {/* live match strip — the data the client asked to see:
                        score/minute, possession, shots (on target), reds */}
                    {fl && (
                      <div style={{ ...monoText, fontSize: 11, color: T.sub,
                        marginTop: 3, whiteSpace: "nowrap" }}>
                        <b style={{ color: T.ink }}>
                          {fl.status === "HT" ? "HT" : `${fl.elapsed ?? "?"}'`}
                          {" "}{fl.home_goals ?? "-"}–{fl.away_goals ?? "-"}
                        </b>
                        {fl.stats && (
                          <>
                            {" · poss "}{fl.stats.home.possession_pct ?? "?"}%–
                            {fl.stats.away.possession_pct ?? "?"}%
                            {" · shots "}{fl.stats.home.shots ?? 0}
                            ({fl.stats.home.shots_on_target ?? 0})–
                            {fl.stats.away.shots ?? 0}
                            ({fl.stats.away.shots_on_target ?? 0})
                            {(fl.stats.home.red_cards > 0 || fl.stats.away.red_cards > 0) && (
                              <b style={{ color: T.red }}>
                                {" · 🟥 "}
                                {fl.stats.home.red_cards > 0 && `${fl.stats.home.team} ${fl.stats.home.red_cards}`}
                                {fl.stats.home.red_cards > 0 && fl.stats.away.red_cards > 0 && " / "}
                                {fl.stats.away.red_cards > 0 && `${fl.stats.away.team} ${fl.stats.away.red_cards}`}
                              </b>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {/* the 0-0 alert tag — sticky until checked, like baseball */}
                    {ft && (
                      <div style={{ marginTop: 4, display: "flex", alignItems: "center",
                        gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, fontWeight: 700,
                          color: ftActive ? "#fff" : T.red,
                          background: ftActive ? T.red : "transparent",
                          border: `1px solid ${T.red}`, borderRadius: 5,
                          padding: "2px 7px" }}>
                          ⚽ 0-0 at {ft.minute}&apos; — favorite {ft.favorite_name}{" "}
                          {ft[`prematch_${ft.favorite}_cents`]}¢ pre-match
                          {ft.favorite_red_cards > 0 && " · 🟥 a man down"}
                        </span>
                        {ftActive && (
                          <button onClick={() => checkFootball(ft)}
                            title="Mark as checked — stops the flashing, the tag stays"
                            style={{ ...btn.outline, fontSize: 10, fontWeight: 700,
                              padding: "2px 9px", color: T.red, borderColor: T.red }}>
                            CHECK
                          </button>
                        )}
                      </div>
                    )}
                    {noteBlock(m.slug)}
                  </td>
                  <td style={{ ...td, fontFamily: T.ui, color: T.sub, fontSize: 13 }}>
                    {m.league}
                  </td>
                  <td style={{ ...td, color: T.sub }}>
                    {m.kickoff ? fmtTimestamp(m.kickoff) : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{fmtVolume(m.volume)}</td>
                  {(() => {
                    // live rows use fresh CLOB prices; others use the cache
                    const lp = livePrices[m.slug];
                    const eff = {
                      homePrice: lp?.home ?? m.homePrice,
                      drawPrice: lp?.draw ?? m.drawPrice,
                      awayPrice: lp?.away ?? m.awayPrice,
                    };
                    // favorite green, longest odds red (middle stays neutral)
                    const vals = [eff.homePrice, hasDraw ? eff.drawPrice : null, eff.awayPrice].filter((v) => v != null);
                    const maxV = vals.length ? Math.max(...vals) : null;
                    const minV = vals.length ? Math.min(...vals) : null;
                    const colorFor = (v) =>
                      v == null || maxV === minV ? T.sub : v === maxV ? T.green : v === minV ? T.red : T.sub;
                    // same layout as baseball: bold green/red price with the
                    // team (or Draw) name under it
                    return [
                      ["homePrice", m.home],
                      ...(hasDraw ? [["drawPrice", "Draw"]] : []),
                      ["awayPrice", m.away],
                    ].map(([key, label]) => (
                      <td key={key} style={{ ...td, textAlign: "right" }}>
                        <div><LivePrice cents={eff[key]} color={colorFor(eff[key])} /></div>
                        <div style={{ fontFamily: T.ui, fontSize: 11, color: T.sub }}>{label}</div>
                      </td>
                    ));
                  })()}
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap",
                    boxShadow: hits.has(m.slug) && hl ? `inset -4px 0 0 ${T.series[1]}` : undefined }}>
                    <HighlightPicker
                      color={highlights[m.slug]}
                      onPick={(c) => setHighlight(m.slug, c)}
                    />{" "}
                    <button
                      onClick={() => setAlertRow(m)}
                      title={alerts[m.slug] ? "Edit this game's alert" : "Alert for this game only"}
                      style={{ ...btn.outline, fontSize: 12, padding: "6px 8px", marginRight: 6,
                        color: alerts[m.slug] ? T.series[0] : T.sub }}
                    >
                      {alerts[m.slug] ? "🔔" : "🔕"}
                    </button>
                    {noteBtn(m.slug)}
                    {(() => {
                      const n = trackedCount(m.slug);
                      return (
                        <button
                          onClick={() => openPicker(m)}
                          disabled={trackBusy === m.slug}
                          title={n
                            ? `${n} prop${n > 1 ? "s" : ""} of this match already tracked — click to add or review`
                            : "Choose which props of this match to track"}
                          style={{
                            ...(n ? btn.outline : btn.green),
                            ...(n ? { color: T.green, borderColor: T.green } : {}),
                            fontSize: 12, padding: "6px 10px",
                          }}
                        >
                          {trackBusy === m.slug ? "…" : n ? `✓ Tracking (${n})` : "Track"}
                        </button>
                      );
                    })()}{" "}
                    <a
                      href={`https://polymarket.com/event/${m.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ ...btn.outline, fontSize: 12, padding: "6px 10px", textDecoration: "none" }}
                    >
                      Web ↗
                    </a>{" "}
                    {rowHideBtn(m.slug)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {data === null && !error && (
          <div style={{ padding: "28px 16px", fontSize: 13, color: T.faint }}>
            Loading markets…
          </div>
        )}
        {data !== null && visible.length === 0 && (
          <div style={{ padding: "28px 16px", fontSize: 13, color: T.faint }}>
            No markets match these filters. Widen the price ranges or lower the
            minimum volume.
          </div>
        )}
      </div>
      </>
      )}

      <div style={{ fontSize: 12, color: T.faint }}>
        {isBaseball
          ? "Prices from Polymarket; live game data from the MLB Stats API (about 6-8s behind the market). The + button expands the live line score."
          : "Prices are the best ask (buy price), matching Polymarket. Click any column heading to sort. Track opens the full list of the match's props so you choose exactly which ones to collect."}
      </div>

      {dialogOpen && !isBaseball && (
        <AlertDialog
          sport={sport}
          isMlb={false}
          hasDraw={hasDraw}
          existing={alerts[sport]}
          onSave={(a) => { saveAlert(a); setDialogOpen(false); }}
          onClear={() => { clearAlert(); setDialogOpen(false); }}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {alertRow && !isBaseball && (
        <AlertDialog
          row={{ ...alertRow, sport, hasDraw }}
          existing={alerts[alertRow.slug]}
          onSave={(a) => { saveKey(alertRow.slug, a); setAlertRow(null); }}
          onClear={() => { clearKey(alertRow.slug); setAlertRow(null); }}
          onClose={() => setAlertRow(null)}
        />
      )}

      {fbCfgOpen && <FootballDialog onClose={() => setFbCfgOpen(false)} />}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
