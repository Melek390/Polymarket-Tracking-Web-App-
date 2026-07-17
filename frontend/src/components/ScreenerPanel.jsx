import { useState } from "react";
import { T, label, monoText, btn } from "../theme.js";

export default function ScreenerPanel({
  results,
  onTrack,
  onCancel,
  busy,
  title = "Screener results",
  emptyText = "No live markets matched that search.",
}) {
  const [selected, setSelected] = useState(new Set());

  function toggle(conditionId) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(conditionId) ? next.delete(conditionId) : next.add(conditionId);
      return next;
    });
  }

  return (
    <div
      style={{
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div style={label}>{title}</div>
        {results.length > 0 && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              color: T.sub,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={selected.size === results.length}
              onChange={() =>
                setSelected(
                  selected.size === results.length
                    ? new Set()
                    : new Set(results.map((r) => r.conditionId)),
                )
              }
            />
            Select all ({results.length})
          </label>
        )}
      </div>
      <div style={{ fontSize: 13, color: T.sub, margin: "6px 0 14px" }}>
        {results.length === 0
          ? emptyText
          : `${results.length} markets matched — tick the ones to track.`}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxHeight: 420,
          overflowY: "auto",
        }}
      >
        {results.map((r) => (
          <label
            key={r.conditionId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "#fff",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: "10px 14px",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(r.conditionId)}
              onChange={() => toggle(r.conditionId)}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: T.faint,
                  textTransform: "uppercase",
                }}
              >
                {r.eventTitle}
              </span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>
                {r.question}
                <span
                  style={{
                    ...monoText,
                    fontSize: 11,
                    color: T.faint,
                    marginLeft: 10,
                  }}
                >
                  {r.kind}
                </span>
              </span>
            </span>
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {r.outcomes.map((o, i) => {
                const color = T.series[i % T.series.length];
                return (
                  <span
                    key={o.label}
                    style={{
                      ...monoText,
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: `1px solid ${color}`,
                      color,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {o.label}
                    {o.price != null ? ` ${o.price.toFixed(3)}` : ""}
                  </span>
                );
              })}
            </span>
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button
          onClick={() => onTrack([...selected])}
          disabled={selected.size === 0 || busy}
          style={{ ...btn.primary, fontSize: 13, padding: "9px 16px" }}
        >
          {busy ? "Saving…" : `Track selected (${selected.size})`}
        </button>
        <button
          onClick={onCancel}
          style={{ ...btn.ghost, fontSize: 13, padding: "9px 16px" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
