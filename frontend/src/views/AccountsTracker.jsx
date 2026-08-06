import { useEffect, useMemo, useState } from "react";
import { T, card, label, monoText, page, btn } from "../theme.js";
import { fmtCents, fmtTimestamp, fmtClock, TZ_LABEL } from "../utils.js";
import {
  traderList, traderAdd, traderDelete, traderSummary, traderOpen,
  traderClosed, traderActivity, traderTagToggle,
} from "../api/client.js";

// Accounts tracker — LIVE data from backend/traders (win = net > $0 after
// fees; fees exact per fill via maker/taker detection; tags sit on the round
// trip). Spec and decisions: .claude/V3.md.

// the client's fixed tag list ("for now"), per the confirmed brief
const TAGS = [
  "Bounce", "Average Down", "One Run Behind", "Two Runs Behind",
  "Three Runs Behind", "First Innings Bet", "2nd Innings Bet",
  "Bottom Innings", "Favorite", "Underdog", "AFG",
];

const usd = (n) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pnlColor = (n) => (n > 0 ? T.green : n < 0 ? T.red : T.sub);
const cents = (p01) => fmtCents(Math.round(p01 * 1000) / 10); // 0..1 -> cents, 1dp

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

// tag chips with toggling — the same control on open and closed rows
function TagEditor({ tags, onToggle }) {
  return (
    <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
      {TAGS.map((t) => {
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
    </span>
  );
}

function TagPills({ tags }) {
  if (!tags?.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
      {tags.map((t) => (
        <span key={t} style={{ fontFamily: T.ui, fontSize: 9, fontWeight: 700,
          color: "#fff", background: T.series[0], borderRadius: 4, padding: "1px 5px" }}>
          {t}
        </span>
      ))}
    </span>
  );
}

function Section({ title, count, children }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "4px 0 8px" }}>
        <span style={{ ...label, fontSize: 12, letterSpacing: 0.8 }}>{title}</span>
        <span style={{ fontSize: 12, color: T.faint }}>{count}</span>
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
  const [category, setCategory] = useState(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openRow, setOpenRow] = useState(null); // expanded row key
  const [actShown, setActShown] = useState(60); // activity rows revealed

  async function loadAccounts(selectId) {
    try {
      const list = await traderList();
      setAccounts(list);
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
      const [s, o, c, a] = await Promise.all([
        traderSummary(id), traderOpen(id), traderClosed(id), traderActivity(id),
      ]);
      setSummary(s); setOpen(o); setClosed(c); setActivity(a);
    } catch (e) {
      setError(`Could not load account data: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadData(current); setActShown(60); }, [current]);

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
    if (!window.confirm("Remove this account and its stored history?")) return;
    await traderDelete(id);
    await loadAccounts(null);
  }

  async function toggleTag(asset, tag) {
    await traderTagToggle(current, asset, tag);
    // refresh only the tag-bearing lists
    const [o, c] = await Promise.all([traderOpen(current), traderClosed(current)]);
    setOpen(o); setClosed(c);
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

  const openShown = open.filter((r) => hit(r.title, r.event_slug));
  const closedShown = closed.filter((r) => hit(r.title, r.event_slug) && inRange(r.closed_ts));
  const categories = useMemo(() => {
    const set = new Set([...open, ...closed].map((r) => categoryOf(r.event_slug)));
    return [...set].sort();
  }, [open, closed]);

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
            <button onClick={() => removeAccount(a.id)} title="Remove account"
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
          {/* stat cards */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Stat title="Portfolio value"
              value={summary.portfolio_value != null ? usd(summary.portfolio_value) : "—"} />
            <Stat title="Realized P/L" value={usd(summary.realized_pnl)}
              color={pnlColor(summary.realized_pnl)} sub="closed trades, net of fees" />
            <Stat title="Unrealized P/L" value={usd(summary.unrealized_pnl)}
              color={pnlColor(summary.unrealized_pnl)} sub="open positions" />
            <Stat title="Total P/L" value={usd(summary.total_pnl)} color={pnlColor(summary.total_pnl)} />
            <Stat title="Win rate"
              value={summary.win_rate != null ? `${(summary.win_rate * 100).toFixed(1)}%` : "—"}
              sub={summary.closed_count ? `${summary.wins} of ${summary.closed_count} closed` : "no closed trades yet"} />
            <Stat title="Open" value={summary.open_count} />
            <Stat title="Closed" value={summary.closed_count} />
            <Stat title="Avg hold" value={hold(summary.avg_hold_s)} />
            <Stat title="Fees paid" value={usd(summary.fees_paid)} sub="takers only — makers are free" />
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
            <Section title="OPEN POSITIONS" count={`${openShown.length} shown · largest value first`}>
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
                    <th style={rightTh}>P/L</th>
                    <th style={rightTh}>ROI</th>
                    <th style={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {openShown.map((r) => {
                    const key = `o-${r.asset}`;
                    return [
                      <tr key={key} style={{ borderTop: `1px solid ${T.border}` }}>
                        <td style={{ ...td, textAlign: "center" }}>{expandBtn(key)}</td>
                        <td style={{ ...td, fontFamily: T.ui, fontWeight: 500, maxWidth: 320 }}>
                          {r.title}
                          <div style={{ fontSize: 11, color: T.faint }}>{categoryOf(r.event_slug)}</div>
                          <TagPills tags={r.tags} />
                        </td>
                        <td style={{ ...td, fontFamily: T.ui }}>{r.outcome}</td>
                        <td style={rightTd}>{cents(r.avg_price)}</td>
                        <td style={{ ...rightTd, fontWeight: 700,
                          color: r.cur_price > r.avg_price ? T.green : r.cur_price < r.avg_price ? T.red : T.ink }}>
                          {cents(r.cur_price)}
                        </td>
                        <td style={rightTd}>{Math.round(r.shares).toLocaleString("en-US")}</td>
                        <td style={rightTd}>{usd(r.cost)}</td>
                        <td style={rightTd}>{usd(r.value)}</td>
                        <td style={{ ...rightTd, fontWeight: 700, color: pnlColor(r.pnl) }}>{usd(r.pnl)}</td>
                        <td style={{ ...rightTd, color: pnlColor(r.pnl) }}>
                          {r.pct_pnl > 0 ? "+" : ""}{r.pct_pnl.toFixed(1)}%
                        </td>
                        <td style={{ ...td, fontFamily: T.ui, color: r.redeemable ? T.green : T.sub }}>
                          {r.redeemable ? "Redeemable" : "Open"}
                        </td>
                      </tr>,
                      openRow === key && (
                        <tr key={`${key}-x`}>
                          <td colSpan={11} style={{ padding: 0 }}>
                            <div style={{ padding: "12px 16px", background: T.soft,
                              borderTop: `1px solid ${T.border}` }}>
                              <div style={{ ...label, fontSize: 10, marginBottom: 6 }}>Tags (saved on this position)</div>
                              <TagEditor tags={r.tags} onToggle={(t) => toggleTag(r.asset, t)} />
                            </div>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
              {openShown.length === 0 && (
                <div style={{ padding: "20px 16px", fontSize: 13, color: T.faint }}>No open positions match.</div>
              )}
            </Section>
          )}

          {/* ---------------- CLOSED TRADES ---------------- */}
          {status !== "open" && (
            <Section title="CLOSED TRADES" count={`${closedShown.length} shown · newest first`}>
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
                  </tr>
                </thead>
                <tbody>
                  {closedShown.map((r) => {
                    const key = `c-${r.asset}-${r.closed_ts}`;
                    const roi = r.cost ? r.net / r.cost : 0;
                    return [
                      <tr key={key} style={{ borderTop: `1px solid ${T.border}` }}>
                        <td style={{ ...td, textAlign: "center" }}>{expandBtn(key)}</td>
                        <td style={{ ...td, color: T.sub, whiteSpace: "nowrap" }}>
                          {fmtTimestamp(r.closed_ts * 1000)}
                        </td>
                        <td style={{ ...td, fontFamily: T.ui, fontWeight: 500, maxWidth: 300 }}>
                          {r.title}
                          <div style={{ fontSize: 11, color: T.faint }}>
                            {r.outcome} · {categoryOf(r.event_slug)}
                            {r.averaged_down && (
                              <span style={{ color: T.series[2], fontWeight: 700 }}> · averaged down</span>
                            )}
                            {r.close_reason === "resolved_zero" && (
                              <span style={{ color: T.red, fontWeight: 700 }}> · resolved at 0</span>
                            )}
                            {r.close_reason === "resolved_won" && (
                              <span style={{ color: T.green, fontWeight: 700 }}> · won at resolution</span>
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
                        <td style={{ ...rightTd, fontWeight: 700, color: pnlColor(r.net) }}>{usd(r.net)}</td>
                        <td style={{ ...rightTd, color: pnlColor(r.net) }}>
                          {roi > 0 ? "+" : ""}{(roi * 100).toFixed(1)}%
                        </td>
                      </tr>,
                      openRow === key && (
                        <tr key={`${key}-x`}>
                          <td colSpan={11} style={{ padding: 0 }}>
                            <div style={{ padding: "12px 16px", background: T.soft,
                              borderTop: `1px solid ${T.border}`,
                              display: "flex", gap: 34, flexWrap: "wrap" }}>
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
                                <TagEditor tags={r.tags} onToggle={(t) => toggleTag(r.asset, t)} />
                              </div>
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
    </main>
  );
}
