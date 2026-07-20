import { useMemo, useState } from "react";
import { T, card, label, monoText, btn } from "../theme.js";
import { fmtCents, fmtTimestamp } from "../utils.js";

const CELL_PAD = "7px 14px";

const thBase = {
  ...label,
  position: "sticky",
  top: 0,
  background: T.soft,
  padding: CELL_PAD,
};

// Chronological table of every poll, with up/down deltas and boundary dividers.
export default function TicksTable({
  ticks,
  outcomes,
  pollInterval,
  trackedSince,
  closedAt,
}) {
  const [order, setOrder] = useState("desc");

  const closedDivider = closedAt && (
    <tr key="closed-divider">
      <td
        colSpan={1 + outcomes.length}
        style={{
          ...monoText,
          fontSize: 12,
          fontWeight: 600,
          textAlign: "center",
          color: T.red,
          background: T.soft,
          padding: "7px 14px",
        }}
      >
        Market closed on Polymarket {fmtTimestamp(closedAt)} · no further data
      </td>
    </tr>
  );

  const rows = useMemo(() => {
    const withDeltas = ticks.map((t, i) => {
      const prev = i > 0 ? ticks[i - 1] : null;
      const deltas = {};
      outcomes.forEach((o) => {
        if (!prev || t[o] == null || prev[o] == null || t[o] === prev[o])
          deltas[o] = "flat";
        else deltas[o] = t[o] > prev[o] ? "up" : "down";
      });
      return { ...t, deltas };
    });
    return order === "desc" ? [...withDeltas].reverse() : withDeltas;
  }, [ticks, outcomes, order]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Recorded ticks</span>
          <span style={{ fontSize: 12, color: T.faint }}>
            one row per poll ({pollInterval}s)
          </span>
        </div>
        <button
          onClick={() => setOrder((o) => (o === "desc" ? "asc" : "desc"))}
          style={{
            ...btn.outline,
            fontWeight: 400,
            fontSize: 12,
            padding: "5px 10px",
            color: T.sub,
          }}
        >
          {order === "desc" ? "Newest first ↓" : "Oldest first ↑"}
        </button>
      </div>

      <div style={{ ...card, maxHeight: 340, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thBase, textAlign: "left" }}>Timestamp (UTC)</th>
              {outcomes.map((o, i) => (
                <th
                  key={o}
                  style={{
                    ...thBase,
                    textAlign: "right",
                    color: T.series[i % T.series.length],
                  }}
                >
                  {o}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order === "desc" && closedDivider}
            {rows.map((row, i) => {
              const isLive = trackedSince && row.ts >= trackedSince;
              const prev = rows[i - 1];
              // first row after the historical/live boundary gets a divider
              const boundary =
                trackedSince && prev && (prev.ts >= trackedSince) !== isLive;
              return [
                boundary && (
                  <tr key={`${row.ts}-divider`}>
                    <td
                      colSpan={1 + outcomes.length}
                      style={{
                        ...monoText,
                        fontSize: 12,
                        fontWeight: 600,
                        textAlign: "center",
                        color: T.ink,
                        background: T.soft,
                        padding: "7px 14px",
                      }}
                    >
                      Live tracking started {fmtTimestamp(trackedSince)} ·
                      older rows are backfilled 1-min history
                    </td>
                  </tr>
                ),
                <tr key={row.ts} style={{ borderTop: `1px solid ${T.border}` }}>
                <td style={{ ...monoText, fontSize: 12, padding: CELL_PAD }}>
                  {fmtTimestamp(row.ts)}{" "}
                  {trackedSince && !isLive && (
                    <span style={{ fontSize: 10, color: T.faint }}>hist</span>
                  )}
                </td>
                {outcomes.map((o) => (
                  <td
                    key={o}
                    style={{
                      ...monoText,
                      fontSize: 12,
                      padding: CELL_PAD,
                      textAlign: "right",
                    }}
                  >
                    {row[o] != null ? fmtCents(row[o]) : "—"}{" "}
                    {row.deltas[o] === "up" && (
                      <span style={{ color: T.green, fontSize: 9 }}>▲</span>
                    )}
                    {row.deltas[o] === "down" && (
                      <span style={{ color: T.red, fontSize: 9 }}>▼</span>
                    )}
                    {row.deltas[o] === "flat" && (
                      <span style={{ color: T.faint }}>·</span>
                    )}
                  </td>
                ))}
              </tr>,
              ];
            })}
            {order === "asc" && closedDivider}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, color: T.faint, marginTop: 8 }}>
        Every poll is stored and nothing is thrown away — the full history is
        available via CSV export.
      </div>
    </div>
  );
}
