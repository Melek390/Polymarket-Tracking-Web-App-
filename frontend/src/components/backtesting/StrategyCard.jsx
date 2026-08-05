import { useState } from "react";
import { T, card, monoText, btn } from "../../theme.js";
import ParamsDialog from "./ParamsDialog.jsx";
import StrategyStats from "./StrategyStats.jsx";

// One strategy: the header row from the client's sketch (+ name … adjust
// params) with its stats block underneath when expanded. Param edits live in
// component state only while this is a design preview.

export default function StrategyCard({ strategy, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useState(strategy.params);

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
          gate ≤{params.hardFilters.maxPriceCents}¢ · score ≥{params.minScore}
        </div>
        <button
          onClick={() => setEditing(true)}
          style={{ ...btn.outline, fontSize: 13, padding: "7px 14px", whiteSpace: "nowrap" }}
        >
          ⚙ Adjust params
        </button>
        <button
          disabled
          title="Design preview — the simulator isn't wired yet"
          style={{ ...btn.green, fontSize: 13, padding: "7px 14px", whiteSpace: "nowrap" }}
        >
          ▶ Run backtest
        </button>
      </div>

      {open && <StrategyStats stats={strategy.stats} />}

      {editing && (
        <ParamsDialog
          strategy={{ ...strategy, params }}
          onSave={(p) => { setParams(p); setEditing(false); }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
