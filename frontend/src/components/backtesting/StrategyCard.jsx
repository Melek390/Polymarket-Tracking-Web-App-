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

  const [downloading, setDownloading] = useState(false);
  const kindDefaults = defaults?.byKind?.[params.kind] ?? null;
  const customized = kindDefaults
    && JSON.stringify(params) !== JSON.stringify(kindDefaults);

  // Every spot the current params selected, as a CSV the client can open in
  // Excel — re-runs server-side with includeTrades so the file always matches
  // the params exactly, then downloads client-side (no new endpoint).
  async function downloadSpots() {
    setDownloading(true);
    try {
      const r = await runBacktest(params, true);
      const rows = r.trades || [];
      const cols = [...new Set(rows.flatMap((t) => Object.keys(t)))];
      const esc = (v) => {
        if (v == null) return "";
        const s = typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
        return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
      };
      const csv = [cols.join(","),
        ...rows.map((t) => cols.map((c) => esc(t[c])).join(","))].join("\n");
      const a = document.createElement("a");
      // BOM so Excel opens the accents in team names correctly
      a.href = URL.createObjectURL(new Blob(["﻿" + csv],
        { type: "text/csv;charset=utf-8" }));
      a.download = `${strategy.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
        .replace(/^-+|-+$/g, "")}-spots.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e.message);
    } finally {
      setDownloading(false);
    }
  }

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
          <div style={{ fontFamily: T.ui, fontSize: 15, fontWeight: 600 }}>
            {strategy.name}
            {/* the card always runs its SAVED params, so an experiment left in
                place quietly becomes the headline — flag it and offer the way
                back rather than letting it look like the strategy's own result */}
            {customized && (
              <span title="These numbers use edited settings, not the strategy's own"
                style={{ fontFamily: T.ui, fontSize: 10, fontWeight: 800,
                  letterSpacing: 0.4, color: "#92400E", background: "#FEF3C7",
                  border: "1px solid #F5D67B", borderRadius: 5,
                  padding: "2px 6px", marginLeft: 8, verticalAlign: "middle" }}>
                CUSTOM SETTINGS
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: T.sub }}>{strategy.description}</div>
          {customized && (
            <button onClick={() => saveAndRun(structuredClone(kindDefaults))}
              style={{ ...btn.ghost, fontSize: 11, padding: "2px 0", color: T.series[0] }}>
              ↩ back to the strategy's own settings
            </button>
          )}
        </div>
        <div style={{ ...monoText, fontSize: 11, color: T.faint, whiteSpace: "nowrap" }}>
          {params.kind === "fairvalue_replay" ? (
            <>≥{params.entry.discountCents}¢ under fair
              {" · down "}{(params.entry.deficits || []).join("/")}
              {" · inn ≤"}{params.entry.maxInning}
              {" · "}{params.exit.mode === "hold" ? "hold" : `sell +${params.exit.bounceCents}¢`}</>
          ) : params.kind === "bottom8_replay" ? (
            <>tied at the {params.situation.inning}th
              {" · back "}{params.situation.side}
              {params.situation.extras !== "all" && ` · ${params.situation.extras} only`}</>
          ) : params.kind === "favorite_replay" ? (
            <>total ≥{params.filter.minTotal}
              {" · "}{params.filter.minPriceCents}–{params.filter.maxPriceCents}¢
              {" · hold to win"}</>
          ) : params.kind === "comeback_replay" ? (
            <>inn ≥{params.situation.minInning}
              {" · "}{(params.situation.scoreStates || []).map((s) => s === "down1" ? "down 1" : s).join(" / ") || "no state?"}
              {" · tired ≥"}{params.fatigue.minMatches}
              {" · +"}{params.bounce.targetCents}¢/{params.bounce.horizonHalfInnings}hi</>
          ) : (
            <>gate {params.hardFilters.minPriceCents}–{params.hardFilters.maxPriceCents}¢
              {params.useScore ? ` · score ≥${params.minScore}` : " · rules only"}
              {" · "}+{params.bounce.targetCents}¢/{params.bounce.horizonHalfInnings}hi</>
          )}
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
      {open && stats && stats !== "running" && (
        <StrategyStats stats={stats} onDownload={downloadSpots} downloading={downloading} />
      )}

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
