import { useState } from "react";
import { T, card, label, monoText, btn } from "../theme.js";
import { fmtDate, timeAgo } from "../utils.js";
import Sparkline from "./Sparkline.jsx";
import OutcomeChips from "./OutcomeChips.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { exportCsvFor } from "../api/client.js";

const GRID = "minmax(240px,1.6fr) 110px minmax(140px,0.9fr) 100px 280px";
const rowBtn = { fontSize: 12, padding: "6px 10px" };

function MarketRow({ market: m, onToggle, onHistory, onRequestDelete }) {
  return (
    <div
      className="mkt-row"
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderTop: `1px solid ${T.border}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          title={`${m.event} · ${m.question}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 14,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span
            className={m.tracking && !m.closed ? "pulse" : ""}
            style={{
              flexShrink: 0,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: m.closed ? T.red : m.tracking ? T.green : T.faint,
            }}
          />
          <span
            style={{
              ...monoText,
              flexShrink: 0,
              fontSize: 10,
              textTransform: "uppercase",
              color: m.closed ? T.red : m.tracking ? T.green : T.faint,
            }}
          >
            {m.closed ? "closed" : m.tracking ? "open" : "paused"}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {m.event} · {m.question}
          </span>
        </div>
        <div
          style={{ ...monoText, fontSize: 11, color: T.faint, marginTop: 3 }}
        >
          #{m.id} · {m.kind} · every {m.pollInterval}s · added{" "}
          {fmtDate(m.createdAt)} · updated {timeAgo(m.lastUpdate)}
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

export default function MarketList({ markets, onToggle, onHistory, onDelete }) {
  // market awaiting delete confirmation; null = dialog closed
  const [pendingDelete, setPendingDelete] = useState(null);

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
      <div style={{ ...card, overflow: "hidden" }}>
        <div
          style={{
            ...label,
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 12,
            padding: "10px 16px",
            background: T.soft,
          }}
        >
          <span>Market</span>
          <span>Trend</span>
          <span>Outcomes</span>
          <span>Records</span>
          <span />
        </div>

        {markets.length === 0 ? (
          <div
            style={{
              padding: "28px 16px",
              fontSize: 13,
              color: T.faint,
              borderTop: `1px solid ${T.border}`,
            }}
          >
            No markets tracked yet — paste a Polymarket event URL above to
            start collecting.
          </div>
        ) : (
          markets.map((m) => (
            <MarketRow
              key={m.id}
              market={m}
              onToggle={onToggle}
              onHistory={onHistory}
              onRequestDelete={setPendingDelete}
            />
          ))
        )}
      </div>

      <div style={{ fontSize: 12, color: T.faint, marginTop: 10 }}>
        Data collection runs server-side and continues when this page is
        closed.
      </div>
    </div>
  );
}
