import { useState } from "react";
import { forgotPassword } from "../../api/auth.js";
import AuthShell, { ErrorNote, LinkButton, OkNote, field, fieldLabel, submitBtn } from "./AuthShell.jsx";

// There is no mail server on this box, so a reset cannot be emailed. The
// request is queued for an administrator, who generates the link from the
// admin panel and passes it on. The wording says exactly that rather than
// implying an email is on its way.
export default function ForgotPassword({ navigate }) {
  const [username, setUsername] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await forgotPassword(username);
      setSent(true);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle={sent ? "" : "Tell us your username and an administrator will send you a reset link."}
      footer={<LinkButton onClick={() => navigate("/login")}>Back to sign in</LinkButton>}
    >
      {sent ? (
        <OkNote>
          Request received. An administrator will send you a reset link — once you
          have it, open the link and choose a new password.
        </OkNote>
      ) : (
        <form onSubmit={submit}>
          <ErrorNote>{err}</ErrorNote>
          <label style={fieldLabel} htmlFor="u">Username</label>
          <input id="u" style={field} value={username} autoFocus autoComplete="username"
            onChange={(e) => setUsername(e.target.value)} />
          <button type="submit" style={{ ...submitBtn, opacity: busy ? 0.6 : 1 }} disabled={busy}>
            {busy ? "Sending…" : "Request a reset link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
