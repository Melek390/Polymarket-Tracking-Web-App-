import { T, card, label, monoText } from "../theme.js";
import { timeAgo } from "../utils.js";

// One dashboard stat: a label, a big value, and a faint hint line.
function StatCard({ title, value, hint }) {
  return (
    <div style={{ ...card, flex: "1 1 200px", padding: "14px 18px" }}>
      <div style={{ ...label, marginBottom: 6 }}>{title}</div>
      <div style={{ ...monoText, fontSize: 21, color: T.ink }}>{value}</div>
      {hint && (
        <div style={{ fontSize: 12, color: T.faint, marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}

// The four summary cards across the top of the dashboard.
export default function StatsRow({ stats }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
      <StatCard
        title="Tracked markets"
        value={stats ? `${stats.active} / ${stats.total}` : "—"}
        hint="active / total"
      />
      <StatCard
        title="Database size"
        value={stats ? stats.dbSize : "—"}
        hint="prices.db (SQLite)"
      />
      <StatCard
        title="Last successful update"
        value={stats ? timeAgo(stats.lastUpdate) : "—"}
        hint="across all markets"
      />
      <StatCard
        title="Records today"
        value={stats ? stats.recordsToday.toLocaleString("en-US") : "—"}
        hint="one row per outcome per poll"
      />
    </div>
  );
}
