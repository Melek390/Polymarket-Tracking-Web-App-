import { useEffect, useMemo, useRef, useState } from "react";
import { T, card, label, monoText, page, btn } from "../theme.js";
import { fmtCents, fmtTimestamp, fmtClock, TZ_LABEL } from "../utils.js";
import {
  traderList, traderAdd, traderDelete, traderSummary, traderOpen,
  traderClosed, traderActivity, traderTagToggle, traderPeak, traderTagVocab,
} from "../api/client.js";
import { playSound } from "../alerts.js";
import Toasts, { useToasts } from "../components/Toasts.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import {
  alertKey, alertSummaryText, loadLastSeen, loadMuted, loadPriceAlerts,
  setLastSeen, setPriceAlert, toggleMuted,
} from "../traderAlerts.js";
import { hiddenKey, loadHidden, toggleHidden } from "../traderHidden.js";

// Accounts tracker — LIVE data from backend/traders (win = net > $0 after
// fees; fees exact per fill via maker/taker detection; tags sit on the round
// trip). Spec and decisions: .claude/V3.md.

// the client's fixed tag list ("for now"), per the confirmed brief
const TAGS = [
  "Bounce", "Average Down", "One Run Behind", "Two Runs Behind",
  "Three Runs Behind", "First Innings Bet", "2nd Innings Bet",
  "Bottom Innings", "Favorite", "Underdog", "AFG",
];

// Muted palette for this page only: the theme's saturated colours over the
// tinted rows read too bright (client request). Rows keep their backgrounds;
// text and accents calm down.
const M = {
  green: "#2F7A59", red: "#A85751",
  winBg: "rgba(47,122,89,0.07)", lossBg: "rgba(168,87,81,0.07)",
  accent: "#64748B",       // averaged down and similar notes
  resolved: "#9A6B67",     // "resolved at 0"
  resolvedWin: "#5F8A72",  // "won at resolution"
  tag: "#5B6B8C",
};

const usd = (n) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pnlColor = (n) => (n > 0 ? M.green : n < 0 ? M.red : T.sub);
const cents = (p01) => fmtCents(Math.round(p01 * 1000) / 10); // 0..1 -> cents, 1dp

// the app speaks Ottawa/Eastern everywhere (utils.js) — day windows follow it
const etDay = (ms) =>
  new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

const PERIODS = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["all", "All time"],
];

function inPeriod(period, tsSec) {
  if (period === "all") return true;
  const ms = tsSec * 1000;
  const now = Date.now();
  if (period === "7d") return ms >= now - 7 * 86_400_000;
  const day = etDay(ms);
  if (period === "today") return day === etDay(now);
  if (period === "yesterday") return day === etDay(now - 86_400_000);
  return true;
}

function hold(seconds) {
  if (seconds == null) return "—";
  const m = Math.round(seconds / 60);
  const h = Math.floor(m / 60);
  if (h >= 48) return `${Math.round(h / 24)}d`;
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

// category from the event slug prefix, so MLB isn't lumped under "sports"
function categoryOf(slug) {
  const s = (slug || "").toLowerCase();
  if (s.startsWith("mlb-")) return "MLB";
  if (s.startsWith("nba-")) return "NBA";
  if (s.startsWith("nfl-")) return "NFL";
  if (s.startsWith("nhl-")) return "NHL";
  if (s.startsWith("wta-") || s.startsWith("atp-")) return "Tennis";
  if (s.startsWith("ufc-")) return "UFC";
  if (/^(lol|cs2|csgo|dota|val)-/.test(s)) return "Esports";
  if (/^(epl|ucl|laliga|seriea|mls)-|-fc-|soccer/.test(s)) return "Soccer";
  return "Other";
}

const th = { ...label, padding: "9px 12px", whiteSpace: "nowrap", textAlign: "left" };
const td = { ...monoText, fontSize: 13, padding: "9px 12px", verticalAlign: "top" };
const rightTh = { ...th, textAlign: "right" };
const rightTd = { ...td, textAlign: "right" };
const chip = (active) => ({ ...(active ? btn.primary : btn.outline), fontSize: 12, padding: "6px 12px" });

// Price-target editor for one open position: notify at/above and/or at/below.
function AlertEditor({ existing, onSave }) {
  const [above, setAbove] = useState(existing?.above ?? "");
  const [below, setBelow] = useState(existing?.below ?? "");
  const num = { ...monoText, fontSize: 12, padding: "5px 8px", width: 70,
    border: `1px solid ${T.border}`, borderRadius: 6, color: T.ink };
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: T.sub }}>notify at ≥</span>
      <input type="number" value={above} min={0} max={100} step={0.5}
        onChange={(e) => setAbove(e.target.value)} placeholder="¢" style={num} />
      <span style={{ fontSize: 11, color: T.sub }}>or ≤</span>
      <input type="number" value={below} min={0} max={100} step={0.5}
        onChange={(e) => setBelow(e.target.value)} placeholder="¢" style={num} />
      <button onClick={() => onSave(above === "" ? null : Number(above), below === "" ? null : Number(below))}
        style={{ ...btn.primary, fontSize: 11, padding: "5px 10px" }}>Save</button>
      {existing && (
        <button onClick={() => onSave(null, null)}
          style={{ ...btn.ghost, fontSize: 11, padding: "5px 8px", color: T.red }}>Remove</button>
      )}
    </span>
  );
}

function Stat({ title, value, sub, color }) {
  return (
    <div style={{ ...card, padding: "12px 16px", minWidth: 140, flex: 1 }}>
      <div style={{ ...label, fontSize: 10 }}>{title}</div>
      <div style={{ ...monoText, fontSize: 20, fontWeight: 700, color: color || T.ink, marginTop: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// tag chips with toggling — the same control on open and closed rows.
// vocab = the fixed list plus every custom tag the account has created;
// the input creates a new tag by applying it to this row (client item 6).
function TagEditor({ tags, vocab, onToggle }) {
  const [draft, setDraft] = useState("");
  const create = () => {
    const name = draft.trim();
    if (!name) return;
    onToggle(name);
    setDraft("");
  };
  return (
    <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
      {vocab.map((t) => {
        const on = tags.includes(t);
        return (
          <button key={t} onClick={() => onToggle(t)}
            title={on ? `Remove "${t}"` : `Add "${t}"`}
            style={{
              fontFamily: T.ui, fontSize: 10, fontWeight: 700, cursor: "pointer",
              borderRadius: 4, padding: "3px 7px",
              color: on ? "#fff" : T.faint,
              background: on ? T.series[0] : "transparent",
              border: on ? `1px solid ${T.series[0]}` : `1px dashed ${T.border}`,
            }}>
            {on ? "✓ " : "+ "}{t}
          </button>
        );
      })}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && create()}
        placeholder="new tag…"
        style={{ ...monoText, fontSize: 11, padding: "3px 7px", width: 90,
          border: `1px dashed ${T.border}`, borderRadius: 4, color: T.ink }}
      />
      <button onClick={create} disabled={!draft.trim()}
        title="Create this tag and apply it to this trade"
        style={{ ...btn.outline, fontSize: 11, padding: "3px 8px" }}>
        + add
      </button>
    </span>
  );
}

function TagPills({ tags }) {
  if (!tags?.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
      {tags.map((t) => (
        <span key={t} style={{ fontFamily: T.ui, fontSize: 9, fontWeight: 700,
          color: "#fff", background: M.tag, borderRadius: 4, padding: "1px 5px" }}>
          {t}
        </span>
      ))}
    </span>
  );
}

function Section({ title, count, extra, children }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "4px 0 8px" }}>
        <span style={{ ...label, fontSize: 12, letterSpacing: 0.8 }}>{title}</span>
        <span style={{ fontSize: 12, color: T.faint }}>{count}</span>
        {extra}
      </div>
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

export default function AccountsTracker() {
  const [accounts, setAccounts] = useState(null); // null = loading
  const [current, setCurrent] = useState(null);   // account id
  const [summary, setSummary] = useState(null);
  const [open, setOpen] = useState([]);
  const [closed, setClosed] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [newInput, setNewInput] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all"); // all | open | closed
  const [result, setResult] = useState("all"); // all | win | loss (closed table)
  const [category, setCategory] = useState(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openRow, setOpenRow] = useState(null); // expanded row key
  const [actShown, setActShown] = useState(60); // activity rows revealed
  const [peaks, setPeaks] = useState({}); // asset|ts -> {peak_cents, source} | "loading" | null
  const [priceAlerts, setPriceAlerts] = useState(loadPriceAlerts);
  const [customTags, setCustomTags] = useState([]);
  const [period, setPeriod] = useState("all");
  const [removing, setRemoving] = useState(null); // account pending delete confirmation
  const [hiddenRows, setHiddenRows] = useState(loadHidden);
  const [showHidden, setShowHidden] = useState(false); // reveal hidden rows (dimmed)
  const [muted, setMuted] = useState(loadMuted); // acctId -> alerts off
  const { toasts, push: pushToast, dismiss: dismissToast, clear: clearToasts } = useToasts();
  const accountsRef = useRef(null);
  const priceAlertsRef = useRef(priceAlerts);
  priceAlertsRef.current = priceAlerts;
  const firedRef = useRef({});   // "acct|asset|dir" -> true while condition holds
  const seenReadyRef = useRef({}); // acctId -> watermark initialised this session

  async function loadAccounts(selectId) {
    try {
      const list = await traderList();
      setAccounts(list);
      accountsRef.current = list;
      const id = selectId ?? current ?? list[0]?.id ?? null;
      setCurrent(list.some((a) => a.id === id) ? id : list[0]?.id ?? null);
    } catch (e) {
      setError(`Could not load accounts: ${e.message}`);
      setAccounts([]);
    }
  }
  useEffect(() => { loadAccounts(); }, []);

  async function loadData(id) {
    if (id == null) { setSummary(null); setOpen([]); setClosed([]); setActivity([]); return; }
    setLoading(true);
    setError(null);
    try {
      const [s, o, c, a, v] = await Promise.all([
        traderSummary(id), traderOpen(id), traderClosed(id), traderActivity(id),
        traderTagVocab(id),
      ]);
      setSummary(s); setOpen(o); setClosed(c); setActivity(a); setCustomTags(v);
    } catch (e) {
      setError(`Could not load account data: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadData(current); setActShown(60); }, [current]);

  // Alert watcher: every 45s (tab visible only) check each account for
  // (a) positions crossing a saved price target, (b) NEW trades/redeems since
  // the last watermark. Server caches keep this at one upstream call per
  // account per interval no matter how many windows are open; the storage
  // listener below keeps windows honest with each other.
  useEffect(() => {
    let stop = false;
    async function tick() {
      if (document.visibilityState !== "visible") return;
      const accts = accountsRef.current || [];
      for (const a of accts) {
        // muted account: no alerts of any kind (he follows his own wallets —
        // trades made on another machine came right back at him as alerts)
        if (loadMuted()[a.id]) continue;
        // --- price targets ---
        const hasAlert = Object.keys(priceAlertsRef.current)
          .some((k) => k.startsWith(`${a.id}|`));
        if (hasAlert) {
          try {
            const rows = await traderOpen(a.id);
            if (stop) return;
            if (a.id === current) setOpen(rows); // freshen the visible table
            for (const r of rows) {
              const al = priceAlertsRef.current[alertKey(a.id, r.asset)];
              if (!al) continue;
              const cur = r.cur_price * 100;
              for (const [dir, hit] of [
                ["above", al.above != null && cur >= al.above],
                ["below", al.below != null && cur <= al.below],
              ]) {
                const fk = `${a.id}|${r.asset}|${dir}`;
                if (hit && !firedRef.current[fk]) {
                  firedRef.current[fk] = true;
                  playSound("price");
                  pushToast(`${a.label}: ${r.title} — ${r.outcome} is ${cents(r.cur_price)} (target ${dir} ${dir === "above" ? al.above : al.below}¢)`);
                } else if (!hit) {
                  firedRef.current[fk] = false; // re-arm once it leaves the zone
                }
              }
            }
          } catch { /* transient — next tick retries */ }
        }
        // --- entry / exit notifications ---
        try {
          const acts = await traderActivity(a.id);
          if (stop) return;
          const newest = acts.length ? acts[0].ts : 0;
          if (!seenReadyRef.current[a.id]) {
            // first look this session: set the watermark silently so a page
            // load never floods with history
            seenReadyRef.current[a.id] = true;
            if (!(loadLastSeen()[a.id] > 0)) setLastSeen(a.id, newest);
            continue;
          }
          const since = loadLastSeen()[a.id] || 0;
          const fresh = acts.filter((x) => x.ts > since && (x.type === "TRADE" || x.type === "REDEEM"));
          if (fresh.length) {
            playSound("situation");
            for (const x of fresh.slice(0, 3)) {
              const verb = x.type === "REDEEM" ? "redeemed" : x.side === "BUY" ? "entered" : "exited";
              pushToast(`${a.label} ${verb}: ${Math.round(x.size).toLocaleString("en-US")} ${x.outcome} (${x.title})${x.type === "TRADE" ? ` @ ${cents(x.price)}` : ""}`);
            }
            if (fresh.length > 3) pushToast(`${a.label}: …and ${fresh.length - 3} more new trades`);
            setLastSeen(a.id, newest);
          }
        } catch { /* transient */ }
      }
    }
    tick();
    const id = setInterval(tick, 45_000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  // other windows editing alerts (same class of bug as V2.md Aug 5)
  useEffect(() => {
    const sync = (e) => {
      if (e.key === "traderPriceAlerts") setPriceAlerts(loadPriceAlerts());
      if (e.key === "traderHiddenRows") setHiddenRows(loadHidden());
      if (e.key === "traderAlertMute") setMuted(loadMuted());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  async function addAccount() {
    if (!newInput.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const acct = await traderAdd(newInput.trim(), newLabel.trim());
      setNewInput(""); setNewLabel("");
      await loadAccounts(acct.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function removeAccount(id) {
    await traderDelete(id);
    await loadAccounts(null);
  }

  async function toggleTag(asset, tag) {
    await traderTagToggle(current, asset, tag);
    // refresh only the tag-bearing lists
    const [o, c, v] = await Promise.all([
      traderOpen(current), traderClosed(current), traderTagVocab(current)]);
    setOpen(o); setClosed(c); setCustomTags(v);
  }

  const hit = (title, slug) => {
    if (search.trim() && !(title || "").toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (category && categoryOf(slug) !== category) return false;
    return true;
  };
  const inRange = (tsSec) => {
    const ms = tsSec * 1000;
    if (from && ms < Date.parse(from)) return false;
    if (to && ms > Date.parse(to) + 86_400_000) return false;
    return true;
  };

  const tagVocab = useMemo(
    () => [...TAGS, ...customTags.filter((t) => !TAGS.includes(t))],
    [customTags]);

  // stats for the selected window, from the closed trips we already hold —
  // portfolio value / unrealized / open describe RIGHT NOW and stay live
  const windowed = useMemo(() => {
    if (period === "all" || !summary) return null;
    const rows = closed.filter((c) => inPeriod(period, c.closed_ts));
    const wins = rows.filter((c) => c.win).length;
    const holds = rows.map((c) => c.hold_s);
    return {
      realized: rows.reduce((a, c) => a + c.net, 0),
      fees: rows.reduce((a, c) => a + c.fees, 0),
      wins,
      count: rows.length,
      winRate: rows.length ? wins / rows.length : null,
      avgHold: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : null,
    };
  }, [period, closed, summary]);

  // Polymarket's profile chart shows P/L BEFORE fees (verified Aug 7 against
  // user-pnl-api), so the headline figures do too — the fee-included truth
  // sits in parentheses underneath. Gross = net + the fees of those trips.
  const closedFeesAll = closed.reduce((a, c) => a + c.fees, 0);
  const realizedNet = windowed ? windowed.realized : (summary ? summary.realized_pnl : 0);
  const realizedGross = realizedNet + (windowed ? windowed.fees : closedFeesAll);

  // hide/unhide rows (client request, Aug 7) — cosmetic only: the stat cards
  // keep counting hidden rows; only the tables (and the open totals) skip them
  const openHideKey = (r) => `o:${r.asset}`;
  const closedHideKey = (r) => `c:${r.asset}:${r.closed_ts}`;
  const isHidden = (rowKey) => !!hiddenRows[hiddenKey(current, rowKey)];
  const hideToggle = (rowKey) => setHiddenRows({ ...toggleHidden(current, rowKey) });

  const openBase = open.filter((r) => hit(r.title, r.event_slug));
  const openHiddenN = openBase.filter((r) => isHidden(openHideKey(r))).length;
  const openShown = showHidden ? openBase : openBase.filter((r) => !isHidden(openHideKey(r)));
  // totals row under the open table (client item 8) — follows the filters;
  // potential profit = shares × $1 − cost (redeems are fee-free, item 9)
  const openTotals = {
    shares: openShown.reduce((a, r) => a + r.shares, 0),
    cost: openShown.reduce((a, r) => a + r.cost, 0),
    value: openShown.reduce((a, r) => a + r.value, 0),
    pnl: openShown.reduce((a, r) => a + r.pnl, 0),
    potential: openShown.reduce((a, r) => a + (r.shares - r.cost), 0),
  };
  const closedBase = closed
    .filter((r) => hit(r.title, r.event_slug) && inRange(r.closed_ts))
    .filter((r) => inPeriod(period, r.closed_ts))
    .filter((r) => result === "all" || (result === "win") === r.win);
  const closedHiddenN = closedBase.filter((r) => isHidden(closedHideKey(r))).length;
  const closedShown = showHidden ? closedBase : closedBase.filter((r) => !isHidden(closedHideKey(r)));
  const categories = useMemo(() => {
    const set = new Set([...open, ...closed].map((r) => categoryOf(r.event_slug)));
    return [...set].sort();
  }, [open, closed]);

  // the "did I sell too early?" number, fetched once per expanded closed row
  function loadPeak(r) {
    if (r.close_reason === "resolved_won") return; // it hit $1, nothing to fetch
    const key = `${r.asset}|${r.closed_ts}`;
    if (peaks[key] !== undefined) return;
    setPeaks((p) => ({ ...p, [key]: "loading" }));
    traderPeak(r.asset, r.closed_ts)
      .then((d) => setPeaks((p) => ({ ...p, [key]: d && d.peak_cents != null ? d : null })))
      .catch(() => setPeaks((p) => ({ ...p, [key]: null })));
  }

  const hiddenToggle = (n) => (n > 0 || showHidden) && (
    <button onClick={() => setShowHidden((s) => !s)}
      style={{ ...btn.ghost, fontSize: 11, padding: "1px 8px", color: T.sub }}>
      {showHidden ? "conceal hidden rows" : `${n} hidden — show`}
    </button>
  );

  // visible on every row (client: "make hide/unhide prominent, easy to spot")
  const hideBtn = (rowKey) => (
    <button onClick={() => hideToggle(rowKey)}
      title={isHidden(rowKey) ? "Show this row again" : "Hide this row from the table (nothing is deleted)"}
      style={{ ...btn.outline, fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
        padding: "3px 9px", whiteSpace: "nowrap",
        color: isHidden(rowKey) ? "#fff" : M.red,
        background: isHidden(rowKey) ? M.green : "transparent",
        borderColor: isHidden(rowKey) ? M.green : M.red }}>
      {isHidden(rowKey) ? "UNHIDE" : "HIDE"}
    </button>
  );

  // blue chip so the jump-to-Polymarket arrows stand out (client request)
  const linkChip = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "#3B82F6", color: "#fff", borderRadius: 4,
    fontSize: 11, fontWeight: 700, lineHeight: 1, padding: "3px 5px",
    textDecoration: "none", verticalAlign: "middle",
  };

  const betLink = (slug) => slug && (
    <a href={`https://polymarket.com/event/${slug}`} target="_blank" rel="noreferrer"
      title="Open this bet on Polymarket"
      style={{ ...linkChip, marginLeft: 6 }}>↗</a>
  );

  const expandBtn = (key) => (
    <button onClick={() => setOpenRow(openRow === key ? null : key)}
      style={{ ...btn.outline, fontSize: 13, padding: "1px 7px", lineHeight: 1 }} title="Details">
      {openRow === key ? "−" : "+"}
    </button>
  );

  return (
    <main style={page}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Accounts tracker</div>
        <div style={{ fontSize: 13, color: T.sub, marginTop: 2 }}>
          Live portfolio analytics for the wallets you follow. A win is a round trip that
          netted more than $0 <em>after fees</em>; fees are exact per fill (makers pay zero).
        </div>
      </div>

      {error && <div style={{ fontSize: 13, color: T.red }}>⚠ {error}</div>}

      {/* add + switch accounts */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={newInput}
          onChange={(e) => setNewInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addAccount()}
          placeholder="Paste a Polymarket profile URL or 0x… wallet address"
          style={{ ...monoText, flex: 2, minWidth: 260, fontSize: 13, padding: "10px 12px",
            border: `1px solid ${T.border}`, borderRadius: 8, color: T.ink }}
        />
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addAccount()}
          placeholder="Label (e.g. Brother)"
          style={{ ...monoText, flex: 1, minWidth: 120, fontSize: 13, padding: "10px 12px",
            border: `1px solid ${T.border}`, borderRadius: 8, color: T.ink }}
        />
        <button onClick={addAccount} disabled={adding || !newInput.trim()}
          style={{ ...btn.green, fontSize: 13, padding: "10px 18px" }}>
          {adding ? "Syncing…" : "Add account"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.sub }}>Account:</span>
        {accounts === null && <span style={{ fontSize: 12, color: T.faint }}>Loading…</span>}
        {accounts?.map((a) => (
          <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => setCurrent(a.id)} style={chip(current === a.id)} title={a.wallet}>
              {a.label}
            </button>
            <a href={`https://polymarket.com/profile/${a.wallet}`} target="_blank" rel="noreferrer"
              title="Open this profile on Polymarket"
              style={{ ...linkChip, fontSize: 12, padding: "3px 6px" }}>↗</a>
            <button onClick={() => setMuted({ ...toggleMuted(a.id) })}
              title={muted[a.id]
                ? "Alerts are OFF for this account — click to turn back on"
                : "Alerts are ON for this account — click to mute (entry/exit and price alerts)"}
              style={{ ...btn.ghost, fontSize: 13, padding: "0 4px",
                opacity: muted[a.id] ? 0.55 : 1 }}>
              {muted[a.id] ? "🔕" : "🔔"}
            </button>
            <button onClick={() => setRemoving(a)} title="Remove account"
              style={{ ...btn.ghost, fontSize: 12, padding: "0 4px", color: T.faint }}>✕</button>
          </span>
        ))}
        {accounts?.length === 0 && (
          <span style={{ fontSize: 13, color: T.faint }}>
            No accounts yet — paste a profile URL above to begin.
          </span>
        )}
      </div>

      {loading && <div style={{ fontSize: 13, color: T.faint }}>Loading account data…</div>}

      {summary && !loading && (
        <>
          {/* period selector — windows the closed-trade stats and table */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: T.sub }}>Stats for:</span>
            {PERIODS.map(([k, lab]) => (
              <button key={k} onClick={() => setPeriod(k)} style={chip(period === k)}>{lab}</button>
            ))}
            {period !== "all" && (
              <span style={{ fontSize: 11, color: T.faint }}>
                portfolio value, unrealized and open positions always show right now
              </span>
            )}
          </div>

          {/* stat cards — headline P/L is BEFORE fees so it reconciles with
              the Polymarket profile page (which ignores fees); the honest
              fee-included figure rides along in parentheses */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Stat title="Portfolio value"
              value={summary.portfolio_value != null ? usd(summary.portfolio_value) : "—"} />
            <Stat title="Realized P/L"
              value={usd(realizedGross)}
              color={pnlColor(realizedGross)}
              sub={`(${usd(realizedNet)} after fees)`} />
            <Stat title="Unrealized P/L" value={usd(summary.unrealized_pnl)}
              color={pnlColor(summary.unrealized_pnl)} sub="open positions" />
            <Stat title="Total P/L"
              value={usd(realizedGross + summary.unrealized_pnl)}
              color={pnlColor(realizedGross + summary.unrealized_pnl)}
              sub={`(${usd(realizedNet + summary.unrealized_pnl)} after fees)`} />
            <Stat title="Win rate"
              value={(windowed ? windowed.winRate : summary.win_rate) != null
                ? `${((windowed ? windowed.winRate : summary.win_rate) * 100).toFixed(1)}%` : "—"}
              sub={(windowed ? windowed.count : summary.closed_count)
                ? `${windowed ? windowed.wins : summary.wins} of ${windowed ? windowed.count : summary.closed_count} closed`
                : "no closed trades"} />
            <Stat title="Open" value={summary.open_count} />
            <Stat title="Closed" value={windowed ? windowed.count : summary.closed_count} />
            <Stat title="Avg hold" value={hold(windowed ? windowed.avgHold : summary.avg_hold_s)} />
            <Stat title="Fees paid"
              value={usd(windowed ? windowed.fees : summary.fees_paid)}
              sub={summary.taker_volume > 0
                ? `${(summary.fees_all_fills / summary.taker_volume * 100).toFixed(1)}% of ${usd(summary.taker_volume)} `
                  + "traded — charged per trade, not on profit; makers pay zero"
                : "takers only — makers are free"} />
          </div>

          {/* filters */}
          <div style={{ ...card, background: T.soft, padding: 14, display: "flex",
            gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>Search market</div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Yankees…"
                style={{ ...monoText, width: "100%", fontSize: 13, padding: "8px 10px",
                  border: `1px solid ${T.border}`, borderRadius: 8, color: T.ink }} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>Show</div>
              <div style={{ display: "flex", gap: 6 }}>
                {["all", "open", "closed"].map((s) => (
                  <button key={s} onClick={() => setStatus(s)} style={chip(status === s)}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>Result</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["all", "All"], ["win", "Wins"], ["loss", "Losses"]].map(([k, lab]) => (
                  <button key={k} onClick={() => setResult(k)}
                    style={{
                      ...chip(result === k),
                      ...(result === k && k === "win" ? { background: M.green, borderColor: M.green } : {}),
                      ...(result === k && k === "loss" ? { background: M.red, borderColor: M.red } : {}),
                    }}>
                    {lab}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>Category</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => setCategory(null)} style={chip(category === null)}>All</button>
                {categories.map((c) => (
                  <button key={c} onClick={() => setCategory(c === category ? null : c)}
                    style={chip(category === c)}>{c}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>Closed between</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  style={{ ...monoText, fontSize: 13, padding: "7px 9px",
                    border: `1px solid ${T.border}`, borderRadius: 8, color: T.ink }} />
                <span style={{ color: T.faint }}>to</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                  style={{ ...monoText, fontSize: 13, padding: "7px 9px",
                    border: `1px solid ${T.border}`, borderRadius: 8, color: T.ink }} />
              </div>
            </div>
          </div>

          {/* ---------------- OPEN POSITIONS ---------------- */}
          {status !== "closed" && (
            <Section title="OPEN POSITIONS" count={`${openShown.length} shown · largest value first`}
              extra={hiddenToggle(openHiddenN)}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 28 }} />
                    <th style={th}>Market</th>
                    <th style={th}>Side</th>
                    <th style={rightTh}>Avg entry</th>
                    <th style={rightTh}>Current</th>
                    <th style={rightTh}>Shares</th>
                    <th style={rightTh}>Cost</th>
                    <th style={rightTh}>Value</th>
                    <th style={rightTh} title="What you pocket if this bet resolves your way: shares × $1 − cost">
                      Potential profit
                    </th>
                    <th style={rightTh}>P/L</th>
                    <th style={rightTh}>ROI</th>
                    <th style={th}>Status</th>
                    <th style={{ ...th, width: 56 }} />
                  </tr>
                </thead>
                <tbody>
                  {openShown.map((r) => {
                    const key = `o-${r.asset}`;
                    return [
                      <tr key={key} style={{ borderTop: `1px solid ${T.border}`,
                        opacity: isHidden(openHideKey(r)) ? 0.45 : 1 }}>
                        <td style={{ ...td, textAlign: "center",
                          boxShadow: `inset 4px 0 0 ${r.pnl > 0 ? M.green : r.pnl < 0 ? M.red : T.border}` }}>{expandBtn(key)}</td>
                        <td style={{ ...td, fontFamily: T.ui, fontWeight: 500, maxWidth: 320 }}>
                          {priceAlerts[alertKey(current, r.asset)] && (
                            <span title={`Alert: ${alertSummaryText(priceAlerts[alertKey(current, r.asset)])}`}
                              style={{ marginRight: 5 }}>🔔</span>
                          )}
                          {r.title}
                          {betLink(r.event_slug)}
                          <div style={{ fontSize: 11, color: T.faint }}>{categoryOf(r.event_slug)}</div>
                          <TagPills tags={r.tags} />
                        </td>
                        <td style={{ ...td, fontFamily: T.ui }}>{r.outcome}</td>
                        <td style={rightTd}>{cents(r.avg_price)}</td>
                        <td style={{ ...rightTd, fontWeight: 700,
                          color: r.cur_price > r.avg_price ? M.green : r.cur_price < r.avg_price ? M.red : T.ink }}>
                          {cents(r.cur_price)}
                        </td>
                        <td style={rightTd}>{Math.round(r.shares).toLocaleString("en-US")}</td>
                        <td style={rightTd}>{usd(r.cost)}</td>
                        <td style={rightTd}>{usd(r.value)}</td>
                        <td style={{ ...rightTd, color: M.green }}>{usd(r.shares - r.cost)}</td>
                        <td style={{ ...rightTd, fontWeight: 700, color: pnlColor(r.pnl) }}>{usd(r.pnl)}</td>
                        <td style={{ ...rightTd, color: pnlColor(r.pnl) }}>
                          {r.pct_pnl > 0 ? "+" : ""}{r.pct_pnl.toFixed(1)}%
                        </td>
                        <td style={{ ...td, fontFamily: T.ui, color: r.redeemable ? M.green : T.sub }}>
                          {r.redeemable ? "Redeemable" : "Open"}
                        </td>
                        <td style={{ ...td, textAlign: "center" }}>{hideBtn(openHideKey(r))}</td>
                      </tr>,
                      openRow === key && (
                        <tr key={`${key}-x`}>
                          <td colSpan={13} style={{ padding: 0 }}>
                            <div style={{ padding: "12px 16px", background: T.soft,
                              borderTop: `1px solid ${T.border}`,
                              display: "flex", gap: 34, flexWrap: "wrap" }}>
                              <div>
                                <div style={{ ...label, fontSize: 10, marginBottom: 6 }}>
                                  Price alert{priceAlerts[alertKey(current, r.asset)]
                                    ? ` — ${alertSummaryText(priceAlerts[alertKey(current, r.asset)])}` : ""}
                                </div>
                                <AlertEditor
                                  key={alertKey(current, r.asset)}
                                  existing={priceAlerts[alertKey(current, r.asset)]}
                                  onSave={(above, below) =>
                                    setPriceAlerts(setPriceAlert(current, r.asset, above, below, r.title))}
                                />
                              </div>
                              <div style={{ flex: 1, minWidth: 260 }}>
                                <div style={{ ...label, fontSize: 10, marginBottom: 6 }}>Tags (saved on this position)</div>
                                <TagEditor tags={r.tags} vocab={tagVocab}
                                  onToggle={(t) => toggleTag(r.asset, t)} />
                              </div>
                              <div style={{ alignSelf: "center" }}>{hideBtn(openHideKey(r))}</div>
                            </div>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
                {openShown.length > 0 && (
                  <tfoot>
                    {/* the glance row (client item 8) — sums follow the filters */}
                    <tr style={{ borderTop: `2px solid ${T.border}`, background: T.soft }}>
                      <td style={td} />
                      <td style={{ ...td, fontFamily: T.ui, fontWeight: 700 }}>
                        Total — {openShown.length} position{openShown.length === 1 ? "" : "s"}
                      </td>
                      <td style={td} />
                      <td style={rightTd} />
                      <td style={rightTd} />
                      <td style={{ ...rightTd, fontWeight: 700 }}>
                        {Math.round(openTotals.shares).toLocaleString("en-US")}
                      </td>
                      <td style={{ ...rightTd, fontWeight: 700 }}>{usd(openTotals.cost)}</td>
                      <td style={{ ...rightTd, fontWeight: 700 }}>{usd(openTotals.value)}</td>
                      <td style={{ ...rightTd, fontWeight: 700, color: M.green }}>{usd(openTotals.potential)}</td>
                      <td style={{ ...rightTd, fontWeight: 700, color: pnlColor(openTotals.pnl) }}>
                        {usd(openTotals.pnl)}
                      </td>
                      <td style={{ ...rightTd, color: pnlColor(openTotals.pnl) }}>
                        {openTotals.cost
                          ? `${openTotals.pnl > 0 ? "+" : ""}${(openTotals.pnl / openTotals.cost * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td style={td} />
                      <td style={td} />
                    </tr>
                  </tfoot>
                )}
              </table>
              {openShown.length > 0 && (
                <div style={{ padding: "8px 16px", fontSize: 12, color: T.sub,
                  borderTop: `1px solid ${T.border}` }}>
                  If every open bet wins you collect{" "}
                  <b style={{ color: M.green }}>{usd(openTotals.shares)}</b>{" "}
                  (a profit of <b style={{ color: M.green }}>{usd(openTotals.potential)}</b>) —
                  if they all lose, the <b style={{ color: M.red }}>{usd(openTotals.cost)}</b> invested is gone.
                </div>
              )}
              {openShown.length === 0 && (
                <div style={{ padding: "20px 16px", fontSize: 13, color: T.faint }}>No open positions match.</div>
              )}
            </Section>
          )}

          {/* ---------------- CLOSED TRADES ---------------- */}
          {status !== "open" && (
            <Section title="CLOSED TRADES"
              count={`${closedShown.length} shown · ${closedShown.filter((r) => r.win).length} won · ${closedShown.filter((r) => !r.win).length} lost · newest first`}
              extra={hiddenToggle(closedHiddenN)}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 28 }} />
                    <th style={th}>Date closed</th>
                    <th style={th}>Market</th>
                    <th style={rightTh}>Buy</th>
                    <th style={rightTh}>Sell</th>
                    <th style={rightTh}>Shares</th>
                    <th style={rightTh}>Cost</th>
                    <th style={rightTh}>Proceeds</th>
                    <th style={rightTh}>Fees</th>
                    <th style={rightTh}>P/L</th>
                    <th style={rightTh}>ROI</th>
                    <th style={{ ...th, width: 56 }} />
                  </tr>
                </thead>
                <tbody>
                  {closedShown.map((r) => {
                    const key = `c-${r.asset}-${r.closed_ts}`;
                    const gross = r.net + r.fees; // pre-fee, like the profile page
                    const roi = r.cost ? gross / r.cost : 0;
                    return [
                      <tr key={key} style={{ borderTop: `1px solid ${T.border}`,
                        // a closed trade wears its outcome: green tint for a
                        // win, red for a loss — readable at scroll speed
                        background: r.win ? M.winBg : M.lossBg,
                        opacity: isHidden(closedHideKey(r)) ? 0.45 : 1 }}>
                        <td style={{ ...td, textAlign: "center",
                          boxShadow: `inset 4px 0 0 ${r.win ? M.green : M.red}` }}
                          onClick={() => loadPeak(r)}>{expandBtn(key)}</td>
                        <td style={{ ...td, color: T.sub, whiteSpace: "nowrap" }}>
                          {fmtTimestamp(r.closed_ts * 1000)}
                        </td>
                        <td style={{ ...td, fontFamily: T.ui, fontWeight: 500, maxWidth: 300 }}>
                          <span style={{ fontFamily: T.ui, fontSize: 9, fontWeight: 800,
                            letterSpacing: 0.5, borderRadius: 4,
                            padding: "0 6px", marginRight: 6, verticalAlign: "middle",
                            color: r.win ? M.green : M.red, background: "transparent",
                            border: `1px solid ${r.win ? M.green : M.red}` }}>
                            {r.win ? "WIN" : "LOSS"}
                          </span>
                          {r.title}
                          {betLink(r.event_slug)}
                          <div style={{ fontSize: 11, color: T.faint }}>
                            {r.outcome} · {categoryOf(r.event_slug)}
                            {r.averaged_down && (
                              <span style={{ color: M.accent, fontWeight: 600 }}> · averaged down</span>
                            )}
                            {r.close_reason === "resolved_zero" && (
                              <span style={{ color: M.resolved, fontWeight: 600 }}> · resolved at 0</span>
                            )}
                            {r.close_reason === "resolved_won" && (
                              <span style={{ color: M.resolvedWin, fontWeight: 600 }}> · won at resolution</span>
                            )}
                          </div>
                          <TagPills tags={r.tags} />
                        </td>
                        <td style={rightTd}>{cents(r.avg_buy)}</td>
                        <td style={rightTd}>{r.avg_sell ? cents(r.avg_sell) : "—"}</td>
                        <td style={rightTd}>{Math.round(r.shares).toLocaleString("en-US")}</td>
                        <td style={rightTd}>{usd(r.cost)}</td>
                        <td style={rightTd}>{usd(r.proceeds)}</td>
                        <td style={{ ...rightTd, color: T.sub }}>{usd(r.fees)}</td>
                        <td style={{ ...rightTd, fontWeight: 700, color: pnlColor(gross) }}>
                          {usd(gross)}
                          <div style={{ fontSize: 10, fontWeight: 400, color: T.sub }}>
                            ({usd(r.net)} after fees)
                          </div>
                        </td>
                        <td style={{ ...rightTd, color: pnlColor(gross) }}>
                          {roi > 0 ? "+" : ""}{(roi * 100).toFixed(1)}%
                        </td>
                        <td style={{ ...td, textAlign: "center" }}>{hideBtn(closedHideKey(r))}</td>
                      </tr>,
                      openRow === key && (
                        <tr key={`${key}-x`}>
                          <td colSpan={12} style={{ padding: 0 }}>
                            <div style={{ padding: "12px 16px", background: T.soft,
                              borderTop: `1px solid ${T.border}`,
                              display: "flex", gap: 34, flexWrap: "wrap" }}>
                              {(() => {
                                // phrased by how the trip actually ended:
                                // sold -> did it climb after the exit?
                                // rode to zero -> where could he have bailed?
                                // held to the win -> nothing to fetch, it hit $1
                                if (r.close_reason === "resolved_won") {
                                  return (
                                    <div style={{ minWidth: 250 }}>
                                      <div style={{ ...label, fontSize: 10 }}>After your last trade</div>
                                      <div style={{ ...monoText, fontSize: 15, fontWeight: 700, color: M.green }}>
                                        resolved at 100¢
                                      </div>
                                      <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>
                                        held to the end — nothing left behind
                                      </div>
                                    </div>
                                  );
                                }
                                const pk = peaks[`${r.asset}|${r.closed_ts}`];
                                const sold = r.close_reason === "sold";
                                const sellC = r.avg_sell * 100;
                                return (
                                  <div style={{ minWidth: 250 }}>
                                    <div style={{ ...label, fontSize: 10 }}>
                                      {sold ? "After you sold" : "After your last trade"}
                                    </div>
                                    {pk === "loading" && (
                                      <div style={{ fontSize: 12, color: T.faint }}>checking the price history…</div>
                                    )}
                                    {pk === null && (
                                      <div style={{ fontSize: 12, color: T.faint }}>no price data after this trade</div>
                                    )}
                                    {pk && pk !== "loading" && (() => {
                                      if (sold) {
                                        const left = (pk.peak_cents - sellC) / 100 * r.shares;
                                        const early = pk.peak_cents > sellC + 0.05;
                                        return (
                                          <>
                                            <div style={{ ...monoText, fontSize: 15, fontWeight: 700,
                                              color: M.green }}>
                                              peaked at {fmtCents(pk.peak_cents)}
                                            </div>
                                            <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>
                                              {early
                                                ? `sold ${fmtCents(pk.peak_cents - sellC)} early — ${usd(left)} left on the table`
                                                : "it never went higher — good exit"}
                                            </div>
                                          </>
                                        );
                                      }
                                      const rescue = pk.peak_cents / 100 * r.shares;
                                      return (
                                        <>
                                          <div style={{ ...monoText, fontSize: 15, fontWeight: 700, color: M.green }}>
                                            peaked at {fmtCents(pk.peak_cents)} before dying
                                          </div>
                                          <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>
                                            {pk.peak_cents > 0.5
                                              ? `never sold — an exit at the peak would have recovered ${usd(rescue)}`
                                              : "never sold — there was no exit worth taking"}
                                          </div>
                                        </>
                                      );
                                    })()}
                                    {pk && pk !== "loading" && (
                                      <div style={{ fontSize: 10, color: T.faint, marginTop: 2 }}>
                                        {pk.source === "tracker"
                                          ? "from our own second-by-second data"
                                          : "from Polymarket history (1–10 min bars)"}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              <div>
                                <div style={{ ...label, fontSize: 10 }}>Held for</div>
                                <div style={{ ...monoText, fontSize: 15, fontWeight: 700 }}>{hold(r.hold_s)}</div>
                              </div>
                              <div>
                                <div style={{ ...label, fontSize: 10 }}>Fees on this trade</div>
                                <div style={{ ...monoText, fontSize: 15, fontWeight: 700 }}>{usd(r.fees)}</div>
                              </div>
                              <div style={{ flex: 1, minWidth: 260 }}>
                                <div style={{ ...label, fontSize: 10, marginBottom: 6 }}>Tags</div>
                                <TagEditor tags={r.tags} vocab={tagVocab}
                                  onToggle={(t) => toggleTag(r.asset, t)} />
                              </div>
                              <div style={{ alignSelf: "center" }}>{hideBtn(closedHideKey(r))}</div>
                            </div>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
              {closedShown.length === 0 && (
                <div style={{ padding: "20px 16px", fontSize: 13, color: T.faint }}>
                  No closed trades match. (Only trades inside Polymarket's 10,000-fill history
                  window can be matched — older history grows from here on as we store it.)
                </div>
              )}
            </Section>
          )}

          {/* ---------------- RECENT ACTIVITY ---------------- */}
          <Section title="RECENT ACTIVITY"
            count={`showing ${Math.min(actShown, activity.length)} of ${activity.length}`}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 130 }}>Time</th>
                  <th style={th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {activity.slice(0, actShown).map((a, i) => {
                  const verb = { TRADE: a.side === "BUY" ? "Bought" : "Sold",
                                 REDEEM: "Redeemed", MERGE: "Merged" }[a.type] || a.type;
                  const color = a.type === "REDEEM" ? T.series[2]
                    : a.side === "BUY" ? T.series[0] : T.green;
                  return (
                    <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                      <td style={{ ...td, color: T.sub, whiteSpace: "nowrap" }}>
                        {fmtClock(a.ts * 1000)} {TZ_LABEL}
                      </td>
                      <td style={td}>
                        <span style={{ fontWeight: 700, color }}>{verb}</span>{" "}
                        {Math.round(a.size).toLocaleString("en-US")} {a.outcome}{" "}
                        <span style={{ color: T.sub }}>({a.title})</span>
                        {a.type === "TRADE" && <> @ <strong>{cents(a.price)}</strong></>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {activity.length === 0 && (
              <div style={{ padding: "20px 16px", fontSize: 13, color: T.faint }}>No recent activity.</div>
            )}
            {actShown < activity.length && (
              <div style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
                <button onClick={() => setActShown((n) => n + 120)}
                  style={{ ...btn.outline, fontSize: 13, padding: "8px 16px" }}>
                  Show more ({activity.length - actShown} older)
                </button>
              </div>
            )}
          </Section>
        </>
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove “${removing.label}”?`}
          message="This deletes the account from the tracker along with its stored fill history and tags."
          detail="Fills older than Polymarket's 10,000-trade window cannot be re-downloaded if you add it back."
          confirmLabel="Remove account"
          onConfirm={async () => {
            const id = removing.id;
            setRemoving(null);
            await removeAccount(id);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
