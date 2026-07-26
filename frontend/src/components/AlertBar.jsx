import { T, btn } from "../theme.js";
import { alertSummary } from "../alerts.js";

// One global alert per sport, shown above the games table. Setting it here
// applies the criteria to every game in the current sport at once.
export default function AlertBar({ sport, isMlb, alert, onEdit, onClear }) {
  const label = isMlb ? "MLB" : sport.charAt(0).toUpperCase() + sport.slice(1);
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        padding: "10px 14px", marginBottom: 12, borderRadius: 10,
        background: alert ? "#FEF9E7" : T.soft,
        border: `1px solid ${alert ? "#F5D67B" : T.border}`,
      }}
    >
      <span style={{ fontSize: 16 }}>{alert ? "🔔" : "🔕"}</span>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
          Alert for all {label} games
        </div>
        <div style={{ fontSize: 12, color: T.sub }}>
          {alert
            ? alertSummary(alert, isMlb)
            : "Off — get notified whenever any game matches your criteria."}
        </div>
      </div>
      {alert && (
        <button onClick={onClear} style={{ ...btn.ghost, fontSize: 12, padding: "6px 12px", color: T.red }}>
          Turn off
        </button>
      )}
      <button onClick={onEdit} style={{ ...btn.primary, fontSize: 12, padding: "6px 14px" }}>
        {alert ? "Edit alert" : "Set alert"}
      </button>
    </div>
  );
}
