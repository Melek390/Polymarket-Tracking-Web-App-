import { useEffect, useState } from "react";
import { fetchFootballConfig, saveFootballConfig } from "../api/client.js";
import { T, btn, card, label } from "../theme.js";

// The soccer 0-0 alert's thresholds, editable without a deploy — same
// contract as the baseball Comeback dialog. Wording mirrors the client's
// spec: big-5 league + clear pre-match favorite + 0-0 at the 60th minute.
export default function FootballDialog({ onClose }) {
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchFootballConfig().then(setCfg).catch((e) => setErr(e.message));
  }, []);

  const set = (k, v) => {
    setSaved(false);
    setCfg((c) => ({ ...c, [k]: v }));
  };

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      setCfg(await saveFootballConfig(cfg));
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
          ⚽ 0-0 Favorite Alert
        </div>
        <div style={{ fontSize: 12, color: T.sub, marginBottom: 14, lineHeight: 1.5 }}>
          Fires once when a big-5 league match (Premier League, Bundesliga,
          La Liga, Serie A, Ligue 1) with a clear pre-match favorite is still
          0-0 at the check minute. The row flashes until you check it; every
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

            <div style={{ ...label, margin: "10px 0 8px" }}>Criteria</div>
            <div style={row}>
              <span style={lab}>Clear favorite: pre-match price of at least (cents)</span>
              <input style={num} type="number" min="50" max="99" step="1"
                value={cfg.min_favorite_cents}
                onChange={(e) => set("min_favorite_cents", Number(e.target.value))} />
            </div>
            <div style={row}>
              <span style={lab}>Still 0-0 at minute</span>
              <input style={num} type="number" min="1" max="90"
                value={cfg.min_minute}
                onChange={(e) => set("min_minute", Number(e.target.value))} />
            </div>
            <div style={row}>
              <span style={lab}>
                Skip the alert when the favorite already has a red card
                <div style={{ fontSize: 11, color: T.faint }}>
                  Red cards are always shown either way — this makes them a filter
                </div>
              </span>
              <input type="checkbox" checked={!!cfg.skip_if_favorite_red_card}
                onChange={(e) => set("skip_if_favorite_red_card", e.target.checked)} />
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
