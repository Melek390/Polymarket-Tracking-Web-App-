import { useEffect, useRef, useState } from "react";
import PriceChart from "../components/PriceChart.jsx";
import TicksTable from "../components/TicksTable.jsx";
import { fetchTicks, fetchChart, exportCsvFor, fetchMlbTimeline } from "../api/client.js";
import { T, label, monoText, page, btn } from "../theme.js";
import { fmtCents, fmtDate, timeAgo, gameWhen } from "../utils.js";

const actionBtn = { fontSize: 13, padding: "9px 16px" };
const DEFAULT_WINDOW_MS = 10 * 60 * 1000; // open focused on the last 10 minutes

// The single-market view: current price, chart, action row and the ticks table.
export default function MarketHistory({ market, onBack, onToggle }) {
  const [ticks, setTicks] = useState(null);
  const [history, setHistory] = useState([]); // whole life, downsampled
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderDone, setOlderDone] = useState(false);
  const [win, setWin] = useState(null); // [fromTs, toTs] the user is looking at
  const [live, setLive] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [timeline, setTimeline] = useState(null); // MLB play-by-play for the tooltip
  const ticksRef = useRef(null); // latest ticks for the live interval closure

  async function load(followEdge = false) {
    setRefreshing(true);
    try {
      // raw newest ticks for the table + the downsampled whole life for the
      // chart (V1 promised closed markets their full history; the newest-2000
      // cap had silently broken that — client caught it, Aug 11)
      const [rows, hist] = await Promise.all([
        fetchTicks(market),
        fetchChart(market).catch(() => []),
      ]);
      const prev = ticksRef.current;
      ticksRef.current = rows;
      setTicks(rows);
      setHistory(hist);
      if (rows.length) {
        const last = rows[rows.length - 1].ts;
        const spanStart = hist.length ? Math.min(hist[0].ts, rows[0].ts) : rows[0].ts;
        setWin((w) => {
          if (!w) {
            // first load: live markets focus on the latest activity; closed
            // ones show their whole life (V1 behaviour, now truly the whole
            // life thanks to the downsampled history)
            if (market.closed) return [spanStart, last];
            return [Math.max(rows[0].ts, last - DEFAULT_WINDOW_MS), last];
          }
          const prevLast = prev?.length ? prev[prev.length - 1].ts : w[1];
          if (followEdge && w[1] >= prevLast) {
            // live mode at the newest edge: follow new data, keep zoom width
            return [last - (w[1] - w[0]), last];
          }
          return w; // otherwise the view stays frozen where the user left it
        });
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    setTicks(null);
    setHistory([]);
    setOlderDone(false);
    ticksRef.current = null;
    setWin(null);
    setLive(false);
    load();
  }, [market.id]);

  // table paging: pull the next 2000 raw rows older than what we hold
  async function loadOlder() {
    const cur = ticksRef.current;
    if (!cur?.length || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const older = await fetchTicks(market, 2000, cur[0].iso);
      if (older.length === 0) setOlderDone(true);
      const next = [...older, ...cur];
      ticksRef.current = next;
      setTicks(next);
    } finally {
      setLoadingOlder(false);
    }
  }

  // the chart draws the whole life (downsampled) with the raw ticks laid
  // over the recent end, so zooming near "now" keeps full 1-5s detail
  const chartTicks = (() => {
    if (!ticks?.length) return history;
    if (!history.length) return ticks;
    const cutoff = ticks[0].ts;
    return [...history.filter((h) => h.ts < cutoff), ...ticks];
  })();

  // MLB games: pull the play-by-play timeline once so the chart tooltip can
  // show the inning + pitcher + batter at the hovered moment.
  useEffect(() => {
    setTimeline(null);
    const slug = market.eventSlug || "";
    if (!slug.startsWith("mlb-")) return;
    let ok = true;
    // keep it even with no plays yet — the chart says "not started" rather
    // than silently showing nothing
    fetchMlbTimeline(slug)
      .then((r) => { if (ok && r.game_pk) setTimeline(r); })
      .catch(() => {});
    return () => { ok = false; };
  }, [market.id, market.eventSlug]);

  // live mode: refetch on the market's own rhythm until switched off
  useEffect(() => {
    if (!live) return;
    const id = setInterval(
      () => load(true),
      Math.max(market.pollInterval, 3) * 1000,
    );
    return () => clearInterval(id);
  }, [live, market.id]);

  // latest price per outcome for the highlight chips
  const current = [];
  if (ticks?.length) {
    for (const o of market.outcomes) {
      for (let i = ticks.length - 1; i >= 0; i--) {
        if (ticks[i][o] != null) {
          current.push({ label: o, price: ticks[i][o] });
          break;
        }
      }
    }
  }

  return (
    <main style={page}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={onBack}
            style={{ ...btn.primary, fontSize: 15, padding: "12px 22px" }}
          >
            ← Back to markets
          </button>
          <span style={{ ...monoText, fontSize: 12, color: T.faint }}>
            #{market.id}
          </span>
        </div>
        <div style={{ ...label, color: T.faint, marginTop: 12 }}>
          {market.event}
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, margin: "4px 0" }}>
          {market.question}
          {market.gameDate && (
            <span
              title="Which game in the series this market is for"
              style={{ ...monoText, fontSize: 13, fontWeight: 700, color: T.ink,
                background: "#FEF3C7", borderRadius: 5, padding: "2px 8px", marginLeft: 10 }}
            >
              {gameWhen(market.gameDate)}
            </span>
          )}
        </div>
        <div style={{ ...monoText, fontSize: 12, color: T.sub }}>
          {market.kind} · polled every {market.pollInterval}s ·{" "}
          {market.records.toLocaleString("en-US")} records stored · tracking
          since {fmtDate(market.createdAt)}
          {market.closed && (
            <span style={{ color: T.red }}>
              {" "}
              · closed {fmtDate(market.closedAt)}
            </span>
          )}
        </div>
      </div>

      {/* current price, always visible and impossible to miss */}
      {current.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: T.sub }}>Current price:</span>
          {current.map((c, i) => (
            <span
              key={c.label}
              style={{
                ...monoText,
                fontSize: 15,
                fontWeight: 600,
                padding: "6px 14px",
                borderRadius: 8,
                background: T.series[i % T.series.length],
                color: "#fff",
              }}
            >
              {c.label} {fmtCents(c.price)}
            </span>
          ))}
          <span style={{ ...monoText, fontSize: 12, color: T.faint }}>
            updated {timeAgo(ticks[ticks.length - 1].ts)}
          </span>
        </div>
      )}

      {ticks === null ? (
        <div style={{ fontSize: 13, color: T.faint, padding: "40px 0" }}>
          Loading price history…
        </div>
      ) : (
        <PriceChart
          ticks={chartTicks}
          outcomes={market.outcomes}
          trackedSince={market.createdAt}
          window={win}
          onWindowChange={setWin}
          timeline={timeline}
        />
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => exportCsvFor(market)}
          style={{ ...btn.primary, ...actionBtn }}
        >
          ⬇ Export CSV
        </button>
        <button
          onClick={load}
          disabled={refreshing}
          style={{
            ...btn.outline,
            ...actionBtn,
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span className={refreshing ? "spin" : ""}>↻</span>
          Refresh data
        </button>
        <button
          onClick={() => setLive((v) => !v)}
          disabled={market.closed}
          title="Automatically pull new data as it arrives"
          style={{
            ...(live ? btn.green : btn.outline),
            ...actionBtn,
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span className={live ? "pulse" : ""}>●</span>
          {live ? "Live: on" : "Live: off"}
        </button>
        {market.closed ? (
          <button disabled style={{ ...btn.redOutline, ...actionBtn }}>
            Market closed
          </button>
        ) : market.tracking ? (
          <button
            onClick={() => onToggle(market.id, false)}
            style={{ ...btn.redOutline, ...actionBtn }}
          >
            Stop tracking
          </button>
        ) : (
          <button
            onClick={() => onToggle(market.id, true)}
            style={{ ...btn.green, ...actionBtn }}
          >
            Start tracking
          </button>
        )}
        <a
          href={`https://polymarket.com/event/${market.eventSlug}`}
          target="_blank"
          rel="noreferrer"
          style={{
            ...btn.outline,
            ...actionBtn,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Web ↗
        </a>
      </div>

      {ticks && (
        <TicksTable
          ticks={ticks}
          outcomes={market.outcomes}
          pollInterval={market.pollInterval}
          trackedSince={market.createdAt}
          closedAt={market.closed ? market.closedAt : null}
          totalRecords={market.records}
          onLoadOlder={loadOlder}
          loadingOlder={loadingOlder}
          olderDone={olderDone}
        />
      )}
    </main>
  );
}
