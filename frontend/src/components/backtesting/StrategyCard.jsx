import { useEffect, useRef, useState } from "react";
import { T, card, monoText, btn } from "../../theme.js";
import ParamsDialog from "./ParamsDialog.jsx";
import StrategyStats from "./StrategyStats.jsx";
import { runBacktest, saveBacktestStrategy } from "../../api/client.js";

// One strategy, wired for real: expanding it (or pressing Run) executes the
// simulation server-side over the stored spots and renders the result. The
// default view IS the saved params' run — parameter edits persist server-side
// (shared across windows) and re-run immediately.

export default function StrategyCard({ strategy, defaults, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useState(strategy.params);
  const [stats, setStats] = useState(null);    // null = not run, "running", or result
  const [err, setErr] = useState(null);
  const ranFor = useRef(null);                 // the params the current stats belong to

  async function run(p) {
    setStats("running");
    setErr(null);
    try {
      const r = await runBacktest(p);
      setStats(r);
      ranFor.current = JSON.stringify(p);
    } catch (e) {
      setErr(e.message);
      setStats(null);
    }
  }

  // the main display: first expansion runs the SAVED params automatically
  useEffect(() => {
    if (open && stats === null && ranFor.current !== JSON.stringify(params)) {
      run(params);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function saveAndRun(p) {
    setParams(p);
    setEditing(false);
    try {
      await saveBacktestStrategy(strategy.id, p);
    } catch {
      /* params still run this session; the save retries on next edit */
    }
    setOpen(true);
    run(p);
  }

  return (
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
        <button
          onClick={() => setOpen((o) => !o)}
          title={open ? "Collapse" : "Expand"}
          style={{ ...btn.outline, fontSize: 14, padding: "1px 8px", lineHeight: 1.4 }}
        >
          {open ? "−" : "+"}
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: T.ui, fontSize: 15, fontWeight: 600 }}>{strategy.name}</div>
          <div style={{ fontSize: 12, color: T.sub }}>{strategy.description}</div>
        </div>
        <div style={{ ...monoText, fontSize: 11, color: T.faint, whiteSpace: "nowrap" }}>
          gate {params.hardFilters.minPriceCents}–{params.hardFilters.maxPriceCents}¢
          {params.useScore ? ` · score ≥${params.minScore}` : " · rules only"}
          {" · "}+{params.bounce.targetCents}¢/{params.bounce.horizonHalfInnings}hi
        </div>
        <button
          onClick={() => setEditing(true)}
          style={{ ...btn.outline, fontSize: 13, padding: "7px 14px", whiteSpace: "nowrap" }}
        >
          ⚙ Adjust params
        </button>
        <button
          onClick={() => { setOpen(true); run(params); }}
          disabled={stats === "running"}
          style={{ ...btn.green, fontSize: 13, padding: "7px 14px", whiteSpace: "nowrap" }}
        >
          {stats === "running" ? "Running…" : "▶ Run backtest"}
        </button>
      </div>

      {open && err && (
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.border}`,
          fontSize: 13, color: T.red }}>
          Run failed: {err}
        </div>
      )}
      {open && stats === "running" && (
        <div style={{ padding: "14px 16px", borderTop: `1px solid ${T.border}`,
          fontSize: 13, color: T.faint }}>
          Replaying the corpus…
        </div>
      )}
      {open && stats && stats !== "running" && <StrategyStats stats={stats} />}

      {editing && (
        <ParamsDialog
          strategy={{ ...strategy, params }}
          defaults={defaults}
          onSave={saveAndRun}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
