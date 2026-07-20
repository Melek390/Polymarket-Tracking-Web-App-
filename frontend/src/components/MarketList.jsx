import { useState } from "react";
import { T, card, monoText, btn } from "../theme.js";
import { fmtDate, timeAgo } from "../utils.js";
import Sparkline from "./Sparkline.jsx";
import OutcomeChips from "./OutcomeChips.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { exportCsvFor } from "../api/client.js";

const GRID = "minmax(220px,1.6fr) 110px minmax(140px,0.9fr) 90px 340px";
const rowBtn = { fontSize: 12, padding: "6px 10px" };

// Small colored dot that pulses while a market is actively collecting.
function StatusDot({ color, pulse }) {
  return (
    <span
      className={pulse ? "pulse" : ""}
      style={{
        flexShrink: 0,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
      }}
    />
  );
}

// One market row: status, sparkline, outcomes, record count and its actions.
function PropRow({ market: m, showEvent, onToggle, onHistory, onRequestDelete }) {
  const statusColor = m.closed ? T.red : m.tracking ? T.green : T.faint;
  return (
    <div
      className="mkt-row"
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <StatusDot color={statusColor} pulse={m.tracking && !m.closed} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              ...monoText,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: statusColor,
            }}
          >
            {m.closed ? "closed" : m.tracking ? "open" : "paused"}
            {showEvent && (
              <span style={{ color: T.faint }}> · {m.event}</span>
            )}
          </div>
          <div
            onClick={() => onHistory(m.id)}
            className="name-link"
            title={m.question}
            style={{
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              margin: "1px 0",
            }}
          >
            {m.question}
          </div>
          <div style={{ ...monoText, fontSize: 11, color: T.faint }}>
            #{m.id} · {m.kind} · every {m.pollInterval}s · added{" "}
            {fmtDate(m.createdAt)} · updated {timeAgo(m.lastUpdate)}
          </div>
        </div>
      </div>

      <Sparkline points={m.spark} dimmed={!m.tracking} />

      <OutcomeChips outcomes={m.outcomes} />

      <div style={{ ...monoText, fontSize: 13 }}>
        {m.records.toLocaleString("en-US")}
      </div>

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {m.closed ? (
          <button disabled style={{ ...btn.redOutline, ...rowBtn }}>
            Closed
          </button>
        ) : m.tracking ? (
          <button
            onClick={() => onToggle(m.id, false)}
            style={{ ...btn.redOutline, ...rowBtn }}
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => onToggle(m.id, true)}
            style={{ ...btn.green, ...rowBtn }}
          >
            Start
          </button>
        )}
        <button
          onClick={() => exportCsvFor(m)}
          style={{ ...btn.outline, ...rowBtn }}
        >
          ⬇ CSV
        </button>
        <button
          onClick={() => onHistory(m.id)}
          style={{ ...btn.outline, ...rowBtn }}
        >
          History →
        </button>
        <a
          href={`https://polymarket.com/event/${m.eventSlug}`}
          target="_blank"
          rel="noreferrer"
          style={{
            ...btn.outline,
            ...rowBtn,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Web ↗
        </a>
        <button
          onClick={() => onRequestDelete(m)}
          title="Delete this market and all its data"
          style={{
            ...rowBtn,
            fontFamily: T.ui,
            fontWeight: 600,
            borderRadius: 8,
            cursor: "pointer",
            border: "none",
            background: T.red,
            color: "#fff",
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// The dashboard list: events as expandable groups, each with a tree of props.
export default function MarketList({ groups, onToggle, onHistory, onDelete }) {
  const [pendingDelete, setPendingDelete] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set()); // groups start expanded

  // Flip one event group between expanded and collapsed.
  function toggleGroup(slug) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  }

  const rowProps = {
    onToggle,
    onHistory,
    onRequestDelete: setPendingDelete,
  };

  return (
    <div>
      {pendingDelete && (
        <ConfirmDialog
          title="Delete market?"
          message={`${pendingDelete.event} · ${pendingDelete.question} — ${pendingDelete.records.toLocaleString("en-US")} stored records will be removed.`}
          detail="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            onDelete(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {groups.length === 0 ? (
        <div
          style={{ ...card, padding: "28px 16px", fontSize: 13, color: T.faint }}
        >
          No markets here — paste a Polymarket event URL above to start
          collecting, or change the status filter.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {groups.map((g) => {
            // an event with one prop shows as a plain row, no accordion needed
            if (g.markets.length === 1) {
              return (
                <PropRow
                  key={g.markets[0].id}
                  market={g.markets[0]}
                  showEvent
                  {...rowProps}
                />
              );
            }

            const open = !collapsed.has(g.slug);
            const active = g.markets.filter(
              (m) => m.tracking && !m.closed,
            ).length;
            const records = g.markets.reduce((sum, m) => sum + m.records, 0);
            const statusColor = active
              ? T.green
              : g.markets.every((m) => m.closed)
                ? T.red
                : T.faint;
            return (
              <div key={g.slug} style={{ ...card, overflow: "hidden" }}>
                <div
                  onClick={() => toggleGroup(g.slug)}
                  className="mkt-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  {/* circular blue +/- toggle — the obvious expand/collapse control */}
                  <span
                    title={open ? "Collapse props" : "Expand props"}
                    style={{
                      flexShrink: 0,
                      width: 30,
                      height: 30,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "50%",
                      background: T.series[0],
                      color: "#fff",
                      fontSize: 18,
                      fontWeight: 600,
                      lineHeight: 1,
                    }}
                  >
                    {open ? "−" : "+"}
                  </span>
                  <StatusDot color={statusColor} pulse={active > 0} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        ...monoText,
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        color: statusColor,
                      }}
                    >
                      event · {g.markets.length} props
                    </div>
                    <div
                      title={g.event}
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        margin: "1px 0",
                      }}
                    >
                      {g.event}
                    </div>
                    <div style={{ ...monoText, fontSize: 11, color: T.faint }}>
                      {active} active · {records.toLocaleString("en-US")} records
                      · added {fmtDate(g.createdAt)}
                    </div>
                  </div>
                </div>

                {open && (
                  <div
                    style={{
                      padding: "10px 12px 12px",
                      background: T.soft,
                      borderTop: `1px solid ${T.border}`,
                    }}
                  >
                    {g.markets.map((m, i) => {
                      const isLast = i === g.markets.length - 1;
                      return (
                        <div key={m.id} style={{ display: "flex" }}>
                          {/* tree connector: vertical trunk + horizontal branch */}
                          <div
                            style={{
                              position: "relative",
                              width: 30,
                              flexShrink: 0,
                              marginLeft: 3,
                            }}
                          >
                            <div
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                bottom: isLast ? "50%" : 0,
                                width: 2,
                                background: T.series[0],
                              }}
                            />
                            <div
                              style={{
                                position: "absolute",
                                left: 0,
                                top: "50%",
                                width: 18,
                                height: 2,
                                background: T.series[0],
                              }}
                            />
                          </div>
                          <div style={{ flex: 1, minWidth: 0, paddingTop: 8 }}>
                            <PropRow market={m} {...rowProps} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 12, color: T.faint, marginTop: 10 }}>
        Data collection runs server-side and continues when this page is
        closed.
      </div>
    </div>
  );
}
