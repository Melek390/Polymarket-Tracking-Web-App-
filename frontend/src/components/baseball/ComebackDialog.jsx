import { useEffect, useState } from "react";
import { fetchComebackConfig, saveComebackConfig } from "../../api/client.js";
import { T, btn, card, label } from "../../theme.js";

// Every threshold of the Comeback Setup trigger, editable without a deploy —
// the client's explicit ask. The wording mirrors his spec so the mapping from
// "what I asked for" to "what I am toggling" is one-to-one.
export default function ComebackDialog({ onClose }) {
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchComebackConfig().then(setCfg).catch((e) => setErr(e.message));
  }, []);

  const set = (k, v) => {
    setSaved(false);
    setCfg((c) => ({ ...c, [k]: v }));
  };

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      setCfg(await saveComebackConfig(cfg));
      setSaved(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const row = { display: "flex", alignItems: "center", gap: 10, marginBottom: 11 };
  const lab = { fontSize: 13, color: T.ink, flex: 1 };
  const num = {
    width: 76, padding: "6px 9px", fontSize: 13, fontFamily: T.mono,
    border: `1px solid ${T.border}`, borderRadius: 8, textAlign: "right",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(26,29,35,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ ...card, width: 460, maxWidth: "92vw", maxHeight: "88vh",
        overflowY: "auto", padding: 20, position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 10, right: 12,
          background: "none", border: "none", fontSize: 22, lineHeight: 1,
          cursor: "pointer", color: T.sub }}>×</button>

        <div style={{ fontSize: 16, fontWeight: 800, color: T.ink, marginBottom: 2 }}>
          ⚡ Comeback Setup
        </div>
        <div style={{ fontSize: 12, color: T.sub, marginBottom: 14, lineHeight: 1.5 }}>
          Fires once when the away team, protecting a one-run lead{cfg?.allow_tied ? " (or tied)" : ""} late,
          brings in a tired reliever. The row flashes red until you check it; every
          trigger is logged for review.
        </div>

        {err && (
          <div style={{ background: "#FEF2F2", border: `1px solid ${T.red}`, color: T.red,
            borderRadius: 8, padding: "8px 11px", fontSize: 12, marginBottom: 12 }}>
            {err}
          </div>
        )}

        {!cfg ? (
          <div style={{ fontSize: 13, color: T.faint, padding: "12px 0" }}>Loading…</div>
        ) : (
          <>
            <div style={row}>
              <span style={lab}><b>Enabled</b></span>
              <input type="checkbox" checked={!!cfg.enabled}
                onChange={(e) => set("enabled", e.target.checked)} />
            </div>

            <div style={{ ...label, margin: "10px 0 8px" }}>Situation</div>
            <div style={row}>
              <span style={lab}>Minimum inning</span>
              {[7, 8, 9].map((n) => (
                <button key={n} onClick={() => set("min_inning", n)}
                  style={{ ...(cfg.min_inning === n ? btn.primary : btn.outline),
                    fontSize: 12, padding: "5px 12px" }}>
                  {n}
                </button>
              ))}
            </div>
            <div style={row}>
              <span style={lab}>Only when the home team bats (bottom half / inning break)</span>
              <input type="checkbox" checked={!!cfg.require_bottom}
                onChange={(e) => set("require_bottom", e.target.checked)} />
            </div>
            <div style={row}>
              <span style={lab}>A tied game counts too (not only trailing by 1)</span>
              <input type="checkbox" checked={!!cfg.allow_tied}
                onChange={(e) => set("allow_tied", e.target.checked)} />
            </div>

            <div style={{ ...label, margin: "10px 0 8px" }}>Tired-pitcher filters</div>
            <div style={{ fontSize: 11, color: T.faint, marginBottom: 10, lineHeight: 1.5 }}>
              The new pitcher must meet at least the minimum below. Checks: pitched
              yesterday · recent WHIP above the threshold · heavy previous outing.
            </div>
            <div style={row}>
              <span style={lab}>Minimum checks that must match (0 = fire on any change)</span>
              <input style={num} type="number" min="0" max="3" value={cfg.quality_min}
                onChange={(e) => set("quality_min", Number(e.target.value))} />
            </div>
            <div style={row}>
              <span style={lab}>"Pitched yesterday" is mandatory</span>
              <input type="checkbox" checked={!!cfg.require_consecutive_days}
                onChange={(e) => set("require_consecutive_days", e.target.checked)} />
            </div>
            <div style={row}>
              <span style={lab}>Recent WHIP above</span>
              <input style={num} type="number" step="0.05" value={cfg.whip_threshold}
                onChange={(e) => set("whip_threshold", Number(e.target.value))} />
            </div>
            <div style={row}>
              <span style={lab}>…measured over his last N appearances</span>
              <input style={num} type="number" min="3" max="20" value={cfg.whip_apps}
                onChange={(e) => set("whip_apps", Number(e.target.value))} />
            </div>
            <div style={row}>
              <span style={lab}>Previous outing pitch count of at least</span>
              <input style={num} type="number" min="1" value={cfg.prev_pitches}
                onChange={(e) => set("prev_pitches", Number(e.target.value))} />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
              <button onClick={save} disabled={busy}
                style={{ ...btn.primary, fontSize: 13, padding: "8px 16px" }}>
                {busy ? "Saving…" : "Save"}
              </button>
              {saved && <span style={{ fontSize: 12, color: T.green, fontWeight: 600 }}>Saved ✓</span>}
              <span style={{ flex: 1 }} />
              <button onClick={onClose} style={{ ...btn.outline, fontSize: 13, padding: "8px 14px" }}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
