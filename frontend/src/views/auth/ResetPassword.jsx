import { useEffect, useState } from "react";
import { checkReset, resetPassword } from "../../api/auth.js";
import AuthShell, { ErrorNote, LinkButton, OkNote, field, fieldLabel, submitBtn } from "./AuthShell.jsx";
import { T } from "../../theme.js";

export default function ResetPassword({ navigate, params }) {
  const urlToken = params.get("token") || "";
  const [pasted, setPasted] = useState(urlToken);
  const [valid, setValid] = useState(null);   // null | true | reason string
  const [who, setWho] = useState("");
  const [checking, setChecking] = useState(!!urlToken);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const extract = (text) => {
    const t = (text || "").trim();
    const m = t.match(/[?&]token=([^&\s]+)/);
    return m ? m[1] : t;
  };

  async function verify(raw) {
    const token = extract(raw);
    if (!token) return;
    setChecking(true);
    setValid(null);
    try {
      const r = await checkReset(token);
      setWho(r.username);
      setValid(true);
      setPasted(token);
    } catch (e) {
      setValid(e.message);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (urlToken) verify(urlToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlToken]);

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setErr("the two passwords do not match");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await resetPassword(extract(pasted), password);
      setDone(true);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell title="Password changed">
        <OkNote>
          Your password has been changed and every other signed-in browser was
          signed out.
        </OkNote>
        <button style={submitBtn} onClick={() => navigate("/login")}>Sign in</button>
      </AuthShell>
    );
  }

  if (valid !== true) {
    return (
      <AuthShell
        title="Reset your password"
        subtitle="Paste the reset link you were sent."
        footer={<LinkButton onClick={() => navigate("/login")}>Back to sign in</LinkButton>}
      >
        <form onSubmit={(e) => { e.preventDefault(); verify(pasted); }}>
          {typeof valid === "string" && <ErrorNote>{valid}</ErrorNote>}
          <label style={fieldLabel} htmlFor="t">Reset link or code</label>
          <input id="t" style={field} value={pasted} autoFocus
            placeholder="https://…/reset?token=…"
            onChange={(e) => setPasted(e.target.value)} />
          <button type="submit" style={{ ...submitBtn, opacity: checking ? 0.6 : 1 }} disabled={checking}>
            {checking ? "Checking…" : "Continue"}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={`Setting a new password for ${who}.`}
      footer={<LinkButton onClick={() => navigate("/login")}>Back to sign in</LinkButton>}
    >
      <form onSubmit={submit}>
        <ErrorNote>{err}</ErrorNote>
        <label style={fieldLabel} htmlFor="p">New password</label>
        <input id="p" style={field} type="password" value={password} autoFocus autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)} />
        <div style={{ fontSize: 11, color: T.faint, marginTop: -8, marginBottom: 10 }}>
          At least 8 characters.
        </div>
        <label style={fieldLabel} htmlFor="c">Confirm new password</label>
        <input id="c" style={field} type="password" value={confirm} autoComplete="new-password"
          onChange={(e) => setConfirm(e.target.value)} />
        <button type="submit" style={{ ...submitBtn, opacity: busy ? 0.6 : 1 }} disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </AuthShell>
  );
}
