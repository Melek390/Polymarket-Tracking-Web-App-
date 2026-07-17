import { useEffect, useState } from "react";
import PriceChart from "../components/PriceChart.jsx";
import TicksTable from "../components/TicksTable.jsx";
import { fetchTicks, exportCsvFor } from "../api/client.js";
import { T, label, monoText, page, btn } from "../theme.js";
import { fmtDate } from "../utils.js";

const actionBtn = { fontSize: 13, padding: "9px 16px" };

export default function MarketHistory({ market, onBack, onToggle }) {
  const [ticks, setTicks] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    setTicks(await fetchTicks(market));
    setRefreshing(false);
  }

  useEffect(() => {
    setTicks(null);
    load();
  }, [market.id]);

  return (
    <main style={page}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={onBack}
            style={{ ...btn.ghost, fontSize: 13, padding: "6px 12px" }}
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

      {ticks === null ? (
        <div style={{ fontSize: 13, color: T.faint, padding: "40px 0" }}>
          Loading price history…
        </div>
      ) : (
        <PriceChart
          ticks={ticks}
          outcomes={market.outcomes}
          trackedSince={market.createdAt}
        />
      )}

      <div style={{ display: "flex", gap: 10 }}>
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
      </div>

      {ticks && (
        <TicksTable
          ticks={ticks}
          outcomes={market.outcomes}
          pollInterval={market.pollInterval}
          trackedSince={market.createdAt}
          closedAt={market.closed ? market.closedAt : null}
        />
      )}
    </main>
  );
}
