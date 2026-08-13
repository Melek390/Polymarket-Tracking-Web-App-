import { useState } from "react";
import { changePassword } from "../api/auth.js";
import { T, btn, card, label, monoText, page } from "../theme.js";

const field = {
  width: "100%", boxSizing: "border-box", padding: "9px 11px",
  border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 14,
  fontFamily: T.ui, color: T.ink, background: "#fff", marginBottom: 12,
};
const fieldLabel = {
  display: "block", fontSize: 11, fontWeight: 600, color: T.sub,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5,
};

// Change your own password. Until now the only route was asking an admin for
// a reset link, which for the admin himself meant minting one for himself.
export default function Account({ me }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (next !== confirm) {
      setErr("the two new passwords do not match");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={page}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: T.ink }}>Your account</h1>
        <p style={{ fontSize: 13, color: T.sub, margin: "4px 0 0" }}>
          Signed in as <b>{me?.display_name || me?.username}</b>
          {me?.is_admin ? " · administrator" : ""}.
        </p>
      </div>

      <div style={{ ...card, padding: 20, maxWidth: 430 }}>
        <div style={{ ...label, marginBottom: 12 }}>Change password</div>

        {done && (
          <div style={{
            background: "#ECFDF5", border: `1px solid ${T.green}`, color: T.green,
            borderRadius: 8, padding: "9px 12px", fontSize: 12,
            marginBottom: 14, lineHeight: 1.5,
          }}>
            Password changed. Every other signed-in browser was signed out —
            this one stays in.
          </div>
        )}
        {err && (
          <div style={{
            background: "#FEF2F2", border: `1px solid ${T.red}`, color: T.red,
            borderRadius: 8, padding: "9px 12px", fontSize: 12,
            marginBottom: 14, lineHeight: 1.5,
          }}>
            {err}
          </div>
        )}

        <form onSubmit={submit}>
          <label style={fieldLabel} htmlFor="cur">Current password</label>
          <input id="cur" style={field} type="password" value={current}
            autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)} />
          <label style={fieldLabel} htmlFor="new">New password</label>
          <input id="new" style={field} type="password" value={next}
            autoComplete="new-password"
            onChange={(e) => setNext(e.target.value)} />
          <div style={{ fontSize: 11, color: T.faint, marginTop: -8, marginBottom: 10 }}>
            At least 8 characters.
          </div>
          <label style={fieldLabel} htmlFor="conf">Confirm new password</label>
          <input id="conf" style={field} type="password" value={confirm}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)} />
          <button type="submit" disabled={busy}
            style={{ ...btn.primary, padding: "10px 16px", fontSize: 14, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Saving…" : "Change password"}
          </button>
        </form>
      </div>

      <div style={{ ...card, padding: 16, maxWidth: 430 }}>
        <div style={{ ...label, marginBottom: 6 }}>Username</div>
        <div style={{ ...monoText, fontSize: 14, fontWeight: 700 }}>@{me?.username}</div>
        <div style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>
          Usernames cannot be changed. Ask an administrator if you need a different one.
        </div>
      </div>
    </div>
  );
}
