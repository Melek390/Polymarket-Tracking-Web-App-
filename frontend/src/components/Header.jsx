import { T, monoText, btn } from "../theme.js";

// Top bar: app name, collector health dot, and a refresh button.
export default function Header({ collectorRunning, refreshing, onRefresh }) {
  return (
    <header
      style={{
        borderBottom: `1px solid ${T.border}`,
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Market Tracker</span>
        <span style={{ ...monoText, fontSize: 12, color: T.faint }}>
          polymarket · price history · v1
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13,
            color: T.sub,
          }}
        >
          <span
            className={collectorRunning ? "pulse" : ""}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: collectorRunning ? T.green : T.red,
            }}
          />
          {collectorRunning ? "collector running" : "collector offline"}
        </span>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            ...btn.outline,
            fontWeight: 400,
            fontSize: 13,
            padding: "7px 14px",
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span className={refreshing ? "spin" : ""}>↻</span>
          Refresh
        </button>
      </div>
    </header>
  );
}
