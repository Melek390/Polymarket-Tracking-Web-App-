import { useMemo, useState } from "react";
import { T, card, label, monoText, page, btn } from "../theme.js";
import { fmtCents, fmtTimestamp, fmtClock, TZ_LABEL } from "../utils.js";
import AnimatedNumber from "../components/AnimatedNumber.jsx";
import { ACCOUNTS, ACTIVITY, CLOSED, OPEN, SUMMARY, TAGS } from "../api/accountsPreview.js";

// V3 accounts tracker — FIRST DRAFT, mock data (api/accountsPreview.js).
// Tables only, no charts, prices in cents, profit green / loss red.

const usd = (n) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n * 100).toFixed(1)}%`;
const pnlColor = (n) => (n > 0 ? T.green : n < 0 ? T.red : T.sub);

// "1h 14m" — the client wants holding time readable at a glance
function hold(minutes) {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

const th = { ...label, padding: "9px 12px", whiteSpace: "nowrap", textAlign: "left" };
const td = { ...monoText, fontSize: 13, padding: "9px 12px", verticalAlign: "top" };
const rightTh = { ...th, textAlign: "right" };
const rightTd = { ...td, textAlign: "right" };
const chip = (active) => ({ ...(active ? btn.primary : btn.outline), fontSize: 12, padding: "6px 12px" });

// A stat card. The client asked for these small and along the top.
function Stat({ title, value, sub, color }) {
  return (
    <div style={{ ...card, padding: "12px 16px", minWidth: 150, flex: 1 }}>
      <div style={{ ...label, fontSize: 10 }}>{title}</div>
      <div style={{ ...monoText, fontSize: 22, fontWeight: 700, color: color || T.ink, marginTop: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function TagRow({ tags }) {
  if (!tags?.length) return <span style={{ color: T.faint, fontSize: 12 }}>no tags</span>;
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {tags.map((t) => (
        <span key={t} style={{
          fontFamily: T.ui, fontSize: 11, padding: "2px 8px", borderRadius: 999,
          background: T.soft, border: `1px solid ${T.border}`, color: T.sub,
        }}>
          {t}
        </span>
      ))}
    </span>
  );
}

// Section heading in the client's all-caps layout sketch.
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
  const [account, setAccount] = useState(ACCOUNTS[0].id);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all"); // all | open | closed
  const [category, setCategory] = useState(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openRow, setOpenRow] = useState(null); // expanded row id
  const [newTrader, setNewTrader] = useState("");

  const categories = useMemo(
    () => [...new Set([...OPEN, ...CLOSED].map((r) => r.category))].sort(),
    [],
  );

  const hit = (r) => {
    if (search.trim() && !r.market.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (category && r.category !== category) return false;
    return true;
  };
  const inRange = (ts) => {
    if (from && ts < Date.parse(from)) return false;
    if (to && ts > Date.parse(to) + 86_400_000) return false;
    return true;
  };

  // client: "Sort open positions by largest position value"
  const openRows = OPEN.filter(hit).sort((a, b) => b.value - a.value);
  // client: "Sort closed trades by newest first"
  const closedRows = CLOSED.filter((r) => hit(r) && inRange(r.closedAt))
    .sort((a, b) => b.closedAt - a.closedAt);

  const totalPnl = SUMMARY.realizedPnl + SUMMARY.unrealizedPnl;
  const expandBtn = (id) => (
    <button
      onClick={() => setOpenRow(openRow === id ? null : id)}
      style={{ ...btn.outline, fontSize: 13, padding: "1px 7px", lineHeight: 1 }}
      title="More detail"
    >
      {openRow === id ? "−" : "+"}
    </button>
  );

  return (
    <main style={page}>
      <div style={{
        ...card, background: "#FEF9E7", borderColor: "#F5D67B",
        padding: "10px 14px", fontSize: 13, color: T.ink,
      }}>
        <strong>Design preview</strong> — layout only, showing sample numbers. Nothing
        here is your real account yet.
      </div>

      <div>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Accounts tracker</div>
        <div style={{ fontSize: 13, color: T.sub, marginTop: 2 }}>
          Portfolio analytics for the accounts you follow — win rate, open positions and
          what happened to the price after you sold.
        </div>
      </div>

      {/* add a trader + switch between the tracked accounts */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={newTrader}
          onChange={(e) => setNewTrader(e.target.value)}
          placeholder="Paste a Polymarket profile URL or wallet address…"
          style={{ ...monoText, flex: 1, minWidth: 280, fontSize: 13, padding: "10px 12px",
            border: `1px solid ${T.border}`, borderRadius: 8, color: T.ink }}
        />
        <button style={{ ...btn.green, fontSize: 13, padding: "10px 18px" }}>Add account</button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.sub }}>Account:</span>
        {ACCOUNTS.map((a) => (
          <button key={a.id} onClick={() => setAccount(a.id)} style={chip(account === a.id)}>
            {a.label}
          </button>
        ))}
      </div>

      {/* stat cards */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Stat title="Portfolio value" value={<AnimatedNumber value={SUMMARY.portfolioValue} format={usd} />} />
        <Stat title="Realized P/L" value={usd(SUMMARY.realizedPnl)} color={pnlColor(SUMMARY.realizedPnl)}
          sub="closed trades" />
        <Stat title="Unrealized P/L" value={usd(SUMMARY.unrealizedPnl)} color={pnlColor(SUMMARY.unrealizedPnl)}
          sub="open trades" />
        <Stat title="Total P/L" value={usd(totalPnl)} color={pnlColor(totalPnl)} />
        <Stat title="Win rate" value={`${(SUMMARY.winRate * 100).toFixed(1)}%`}
          sub={`of ${SUMMARY.closedTrades} closed`} />
        <Stat title="Open" value={SUMMARY.openPositions} />
        <Stat title="Closed" value={SUMMARY.closedTrades} />
        <Stat title="Avg hold" value={hold(SUMMARY.avgHoldMinutes)} />
      </div>

      {/* filters */}
      <div style={{ ...card, background: T.soft, padding: 14, display: "flex",
        gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>Search market</div>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Yankees…"
            style={{ ...monoText, width: "100%", fontSize: 13, padding: "8px 10px",
              border: `1px solid ${T.border}`, borderRadius: 8, color: T.ink }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>Show</div>
          <div style={{ display: "flex", gap: 6 }}>
            {["all", "open", "closed"].map((s) => (
              <button key={s} onClick={() => setStatus(s)} style={chip(status === s)}>
                {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
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
              style={{ ...monoText, fontSize: 13, padding: "7px 9px", border: `1px solid ${T.border}`,
                borderRadius: 8, color: T.ink }} />
            <span style={{ color: T.faint }}>to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              style={{ ...monoText, fontSize: 13, padding: "7px 9px", border: `1px solid ${T.border}`,
                borderRadius: 8, color: T.ink }} />
          </div>
        </div>
      </div>

      {/* ---------------- OPEN POSITIONS ---------------- */}
      {status !== "closed" && (
        <Section title="OPEN POSITIONS" count={`${openRows.length} shown · largest first`}>
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
              {openRows.map((r) => {
                const pnl = r.value - r.cost;
                const roi = pnl / r.cost;
                return [
                  <tr key={r.id} style={{ borderTop: `1px solid ${T.border}` }}>
                    <td style={{ ...td, textAlign: "center" }}>{expandBtn(r.id)}</td>
                    <td style={{ ...td, fontFamily: T.ui, fontWeight: 500 }}>
                      {r.market}
                      <div style={{ fontSize: 11, color: T.faint }}>{r.category}</div>
                    </td>
                    <td style={{ ...td, fontFamily: T.ui }}>{r.side}</td>
                    <td style={rightTd}>{fmtCents(r.avgEntry)}</td>
                    <td style={{ ...rightTd, fontWeight: 700,
                      color: r.current > r.avgEntry ? T.green : r.current < r.avgEntry ? T.red : T.ink }}>
                      {fmtCents(r.current)}
                    </td>
                    <td style={rightTd}>{r.shares.toLocaleString("en-US")}</td>
                    <td style={rightTd}>{usd(r.cost)}</td>
                    <td style={rightTd}>{usd(r.value)}</td>
                    <td style={{ ...rightTd, fontWeight: 700, color: pnlColor(pnl) }}>{usd(pnl)}</td>
                    <td style={{ ...rightTd, color: pnlColor(pnl) }}>{pct(roi)}</td>
                    <td style={{ ...td, fontFamily: T.ui, color: T.sub }}>Open</td>
                  </tr>,
                  openRow === r.id && (
                    <tr key={`${r.id}-x`}>
                      <td colSpan={11} style={{ padding: 0 }}>
                        <div style={{ padding: "12px 16px", background: T.soft,
                          borderTop: `1px solid ${T.border}`, display: "flex", gap: 34, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ ...label, fontSize: 10 }}>Lowest since entry</div>
                            <div style={{ ...monoText, fontSize: 15, fontWeight: 700 }}>
                              {fmtCents(r.lowSinceEntry)}
                            </div>
                            <div style={{ fontSize: 11, color: T.sub }}>
                              {r.lowSinceEntry < r.avgEntry
                                ? `dipped ${fmtCents(r.avgEntry - r.lowSinceEntry)} below your entry`
                                : "never traded below your entry"}
                            </div>
                          </div>
                          <div>
                            <div style={{ ...label, fontSize: 10 }}>Held for</div>
                            <div style={{ ...monoText, fontSize: 15, fontWeight: 700 }}>
                              {hold(Math.round((Date.now() - r.openedAt) / 60000))}
                            </div>
                            <div style={{ fontSize: 11, color: T.sub }}>
                              since {fmtTimestamp(r.openedAt)} {TZ_LABEL}
                            </div>
                          </div>
                          {r.averagedDown && (
                            <div>
                              <div style={{ ...label, fontSize: 10 }}>Averaged down</div>
                              <div style={{ ...monoText, fontSize: 13 }}>
                                {r.averagedDown.map((f, i) => (
                                  <div key={i}>{f.shares} @ {fmtCents(f.price)}</div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ ...label, fontSize: 10, marginBottom: 4 }}>Tags</div>
                            <TagRow tags={r.tags} />
                          </div>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                            <button style={{ ...btn.outline, fontSize: 12, padding: "6px 10px" }}>
                              🔔 Price alert
                            </button>
                            <button style={{ ...btn.outline, fontSize: 12, padding: "6px 10px" }}>
                              Edit tags
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </Section>
      )}

      {/* ---------------- CLOSED TRADES ---------------- */}
      {status !== "open" && (
        <Section title="CLOSED TRADES" count={`${closedRows.length} shown · newest first`}>
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
                <th style={rightTh}>P/L</th>
                <th style={rightTh}>ROI</th>
              </tr>
            </thead>
            <tbody>
              {closedRows.map((r) => {
                const pnl = r.proceeds - r.cost;
                const roi = pnl / r.cost;
                const left = (r.peakAfterExit - r.sell) * r.shares / 100;
                return [
                  <tr key={r.id} style={{ borderTop: `1px solid ${T.border}` }}>
                    <td style={{ ...td, textAlign: "center" }}>{expandBtn(r.id)}</td>
                    <td style={{ ...td, color: T.sub, whiteSpace: "nowrap" }}>{fmtTimestamp(r.closedAt)}</td>
                    <td style={{ ...td, fontFamily: T.ui, fontWeight: 500 }}>
                      {r.market}
                      <div style={{ fontSize: 11, color: T.faint }}>{r.side} · {r.category}</div>
                    </td>
                    <td style={rightTd}>{fmtCents(r.buy)}</td>
                    <td style={rightTd}>{fmtCents(r.sell)}</td>
                    <td style={rightTd}>{r.shares.toLocaleString("en-US")}</td>
                    <td style={rightTd}>{usd(r.cost)}</td>
                    <td style={rightTd}>{usd(r.proceeds)}</td>
                    <td style={{ ...rightTd, fontWeight: 700, color: pnlColor(pnl) }}>{usd(pnl)}</td>
                    <td style={{ ...rightTd, color: pnlColor(pnl) }}>{pct(roi)}</td>
                  </tr>,
                  openRow === r.id && (
                    <tr key={`${r.id}-x`}>
                      <td colSpan={10} style={{ padding: 0 }}>
                        <div style={{ padding: "12px 16px", background: T.soft,
                          borderTop: `1px solid ${T.border}`, display: "flex", gap: 34, flexWrap: "wrap" }}>
                          {/* the metric the client cares most about: did he sell too early? */}
                          <div style={{ minWidth: 260 }}>
                            <div style={{ ...label, fontSize: 10 }}>After you sold</div>
                            <div style={{ ...monoText, fontSize: 15, fontWeight: 700,
                              color: left > 0 ? T.red : T.green }}>
                              peaked at {fmtCents(r.peakAfterExit)}
                            </div>
                            <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>
                              {left > 0
                                ? `sold ${fmtCents(r.peakAfterExit - r.sell)} early — ${usd(left)} left on the table`
                                : `it never went higher — good exit`}
                            </div>
                          </div>
                          <div>
                            <div style={{ ...label, fontSize: 10 }}>Held for</div>
                            <div style={{ ...monoText, fontSize: 15, fontWeight: 700 }}>{hold(r.heldMinutes)}</div>
                          </div>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ ...label, fontSize: 10, marginBottom: 4 }}>Tags</div>
                            <TagRow tags={r.tags} />
                          </div>
                          <div>
                            <button style={{ ...btn.outline, fontSize: 12, padding: "6px 10px" }}>
                              Edit tags
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </Section>
      )}

      {/* ---------------- RECENT ACTIVITY ---------------- */}
      <Section title="RECENT ACTIVITY" count={`last ${ACTIVITY.length}`}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 110 }}>Time</th>
              <th style={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {ACTIVITY.map((a) => {
              const verb = { BUY: "Bought", SELL: "Sold", REDEEM: "Redeemed" }[a.type] || a.type;
              const color = { BUY: T.series[0], SELL: T.green, REDEEM: T.series[2] }[a.type] || T.ink;
              return (
                <tr key={a.id} style={{ borderTop: `1px solid ${T.border}` }}>
                  <td style={{ ...td, color: T.sub, whiteSpace: "nowrap" }}>
                    {fmtClock(a.ts)} {TZ_LABEL}
                  </td>
                  <td style={td}>
                    <span style={{ fontWeight: 700, color }}>{verb}</span>{" "}
                    {a.shares.toLocaleString("en-US")} {a.side}{" "}
                    <span style={{ color: T.sub }}>({a.market})</span> @{" "}
                    <strong>{fmtCents(a.price)}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <div style={{ fontSize: 12, color: T.faint }}>
        Available tags: {TAGS.join(" · ")}
      </div>
    </main>
  );
}
