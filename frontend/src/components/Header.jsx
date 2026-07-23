import { T } from "../theme.js";

const NAVY = "#191970"; // header keeps its own darker blue

// Top bar: app name, page nav, collector health, refresh.
export default function Header({ collectorRunning, refreshing, onRefresh }) {
  return (
    <header
      style={{
        background: NAVY,
        color: "#fff",
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Market Tracker</span>
        <nav style={{ display: "flex", gap: 8 }}>
          {[
            ["Dashboard", "#/"],
            ["Screener", "#/screener"],
          ].map(([name, href]) => {
            const onScreener = window.location.hash.startsWith("#/screener");
            const active = href === "#/screener" ? onScreener : !onScreener;
            return (
              <a
                key={name}
                href={href}
                style={{
                  fontFamily: T.ui,
                  fontWeight: 600,
                  fontSize: 13,
                  padding: "6px 14px",
                  borderRadius: 8,
                  textDecoration: "none",
                  background: active ? "#fff" : "transparent",
                  color: active ? NAVY : "#fff",
                  border: active
                    ? "1px solid #fff"
                    : "1px solid rgba(255, 255, 255, 0.55)",
                }}
              >
                {name}
              </a>
            );
          })}
        </nav>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13,
            color: "rgba(255, 255, 255, 0.9)",
          }}
        >
          <span
            className={collectorRunning ? "pulse" : ""}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: collectorRunning ? T.green : T.red,
              boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.6)",
            }}
          />
          {collectorRunning ? "collector running" : "collector offline"}
        </span>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            fontFamily: T.ui,
            fontSize: 13,
            padding: "7px 14px",
            borderRadius: 8,
            border: "1px solid rgba(255, 255, 255, 0.55)",
            background: "transparent",
            color: "#fff",
            cursor: "pointer",
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
