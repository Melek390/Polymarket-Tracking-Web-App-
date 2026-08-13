import { useState } from "react";
import { login } from "../../api/auth.js";
import AuthShell, { ErrorNote, LinkButton, field, fieldLabel, submitBtn } from "./AuthShell.jsx";

export default function Login({ onSignedIn, navigate }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await login(username, password);
      onSignedIn(r.user);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="This tracker is private. Accounts are created by invitation only."
      footer={
        <>
          Have an invitation?{" "}
          <LinkButton onClick={() => navigate("/register")}>Register</LinkButton>
        </>
      }
    >
      <form onSubmit={submit}>
        <ErrorNote>{err}</ErrorNote>
        <label style={fieldLabel} htmlFor="u">Username</label>
        <input id="u" style={field} value={username} autoFocus autoComplete="username"
          onChange={(e) => setUsername(e.target.value)} />
        <label style={fieldLabel} htmlFor="p">Password</label>
        <input id="p" style={field} type="password" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" style={{ ...submitBtn, opacity: busy ? 0.6 : 1 }} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <LinkButton onClick={() => navigate("/forgot")}>Forgot your password?</LinkButton>
      </div>
    </AuthShell>
  );
}
