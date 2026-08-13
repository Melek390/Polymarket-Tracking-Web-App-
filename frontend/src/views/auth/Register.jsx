import { useEffect, useState } from "react";
import { checkInvite, register } from "../../api/auth.js";
import AuthShell, { ErrorNote, LinkButton, field, fieldLabel, submitBtn } from "./AuthShell.jsx";
import { T } from "../../theme.js";

// Registration is invite-only. If someone lands here without a token in the
// URL we ask them to paste the link they were sent — the client's explicit
// requirement: the Register button leads to a page that asks for the invite.
export default function Register({ onSignedIn, navigate, params }) {
  const urlToken = params.get("token") || "";
  const [pasted, setPasted] = useState(urlToken);
  // null = not checked yet, true = good, string = the reason it is not
  const [valid, setValid] = useState(null);
  const [grantsAdmin, setGrantsAdmin] = useState(false);
  const [checking, setChecking] = useState(!!urlToken);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Accept either a raw code or the whole link — people paste the whole thing.
  function extract(text) {
    const t = (text || "").trim();
    const m = t.match(/[?&]token=([^&\s]+)/);
    return m ? m[1] : t;
  }

  async function verify(raw) {
    const token = extract(raw);
    if (!token) return;
    setChecking(true);
    setValid(null);
    try {
      const r = await checkInvite(token);
      setGrantsAdmin(!!r.grants_admin);
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
      const r = await register({
        invite: extract(pasted),
        username,
        display_name: displayName,
        password,
      });
      onSignedIn(r.user);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  // Step 1 — no valid invite yet: ask for the link.
  if (valid !== true) {
    return (
      <AuthShell
        title="Enter your invitation"
        subtitle="Accounts on this tracker are created by invitation only. Paste the invitation link you were sent."
        footer={<>Already have an account? <LinkButton onClick={() => navigate("/login")}>Sign in</LinkButton></>}
      >
        <form onSubmit={(e) => { e.preventDefault(); verify(pasted); }}>
          {typeof valid === "string" && <ErrorNote>{valid}</ErrorNote>}
          <label style={fieldLabel} htmlFor="inv">Invitation link or code</label>
          <input id="inv" style={field} value={pasted} autoFocus
            placeholder="https://…/register?token=…"
            onChange={(e) => setPasted(e.target.value)} />
          <button type="submit" style={{ ...submitBtn, opacity: checking ? 0.6 : 1 }} disabled={checking}>
            {checking ? "Checking…" : "Continue"}
          </button>
        </form>
      </AuthShell>
    );
  }

  // Step 2 — invite accepted: create the account.
  return (
    <AuthShell
      title="Create your account"
      subtitle={grantsAdmin
        ? "This invitation grants administrator access."
        : "Your invitation has been accepted — choose a username and password."}
      footer={<>Already have an account? <LinkButton onClick={() => navigate("/login")}>Sign in</LinkButton></>}
    >
      <form onSubmit={submit}>
        <ErrorNote>{err}</ErrorNote>
        <label style={fieldLabel} htmlFor="u">Username</label>
        <input id="u" style={field} value={username} autoFocus autoComplete="username"
          onChange={(e) => setUsername(e.target.value)} />
        <label style={fieldLabel} htmlFor="d">Display name (optional)</label>
        <input id="d" style={field} value={displayName} autoComplete="name"
          onChange={(e) => setDisplayName(e.target.value)} />
        <label style={fieldLabel} htmlFor="p">Password</label>
        <input id="p" style={field} type="password" value={password} autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)} />
        <div style={{ fontSize: 11, color: T.faint, marginTop: -8, marginBottom: 10 }}>
          At least 8 characters.
        </div>
        <label style={fieldLabel} htmlFor="c">Confirm password</label>
        <input id="c" style={field} type="password" value={confirm} autoComplete="new-password"
          onChange={(e) => setConfirm(e.target.value)} />
        <button type="submit" style={{ ...submitBtn, opacity: busy ? 0.6 : 1 }} disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
