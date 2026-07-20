import { useState } from "react";
import { T, label, monoText, btn } from "../theme.js";
import OutcomeChips from "./OutcomeChips.jsx";

// Panel listing one event's props with checkboxes so the user picks what to track.
export default function EventPanel({ event, onTrack, onCancel, busy }) {
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
        <div style={label}>Event found</div>
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
            checked={selected.size === event.markets.length}
            onChange={() =>
              setSelected(
                selected.size === event.markets.length
                  ? new Set()
                  : new Set(event.markets.map((m) => m.conditionId)),
              )
            }
          />
          Select all ({event.markets.length})
        </label>
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, margin: "6px 0 4px" }}>
        {event.title}
      </div>
      <div style={{ fontSize: 13, color: T.sub, marginBottom: 14 }}>
        This event contains {event.markets.length} markets (props). Tick the
        ones to track — each is stored as its own price series.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {event.markets.map((m) => (
          <label
            key={m.conditionId}
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
              checked={selected.has(m.conditionId)}
              onChange={() => toggle(m.conditionId)}
            />
            <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>
              {m.question}
              <span
                style={{
                  ...monoText,
                  fontSize: 11,
                  color: T.faint,
                  marginLeft: 10,
                }}
              >
                {m.kind}
              </span>
            </span>
            <OutcomeChips outcomes={m.outcomes} />
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button
          onClick={() => onTrack(event.slug, [...selected])}
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
