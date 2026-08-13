import { useCallback, useEffect, useState } from "react";
import {
  adminResetLink, createInvite, fetchUsers, revokeInvite,
  setUserActive, setUserAdmin,
} from "../api/auth.js";
import { T, btn, card, label, monoText, page } from "../theme.js";

// A generated link is shown ONCE, here, with a copy button. It is never
// stored in plaintext server-side (only its hash is), so if the admin loses
// it the fix is to generate another — which is the correct property, not a
// missing feature.
function LinkBox({ title, link, note, onDone }) {
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  return (
    <div style={{
      border: `1px solid ${T.green}`, background: "#ECFDF5",
      borderRadius: 8, padding: 12, marginBottom: 14,
    }}>
      <div style={{ ...label, color: T.green, marginBottom: 4 }}>{title}</div>
      <div style={{
        ...monoText, fontSize: 12, wordBreak: "break-all", color: T.ink,
        background: "#fff", border: `1px solid ${T.border}`,
        borderRadius: 6, padding: "7px 9px", marginBottom: 8,
      }}>
        {link}
      </div>
      {note && <div style={{ fontSize: 11, color: T.sub, marginBottom: 8 }}>{note}</div>}
      <button
        style={{ ...btn.green, fontSize: 12, padding: "6px 12px", marginRight: 8 }}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
      <button style={{ ...btn.outline, fontSize: 12, padding: "6px 12px" }} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

export default function Admin({ me, navigate }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [fresh, setFresh] = useState(null);   // {title, link, note}
  const [inviteNote, setInviteNote] = useState("");
  const [inviteAdmin, setInviteAdmin] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchUsers());
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(fn) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!me?.is_admin) {
    return (
      <div style={page}>
        <div style={{ ...card, padding: 20, fontSize: 13, color: T.sub }}>
          This page is for administrators only.
        </div>
      </div>
    );
  }

  const th = {
    ...label, fontSize: 10, padding: "8px 10px", textAlign: "left",
    borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
  };
  const td = { padding: "8px 10px", fontSize: 13, borderTop: `1px solid ${T.border}` };
  const users = data?.users ?? [];
  const invites = data?.invites ?? [];
  const requests = data?.reset_requests ?? [];
  const liveInvites = invites.filter((i) => !i.used_at);

  return (
    <div style={page}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: T.ink }}>Users &amp; access</h1>
        <p style={{ fontSize: 13, color: T.sub, margin: "4px 0 0" }}>
          Registration is invitation-only — generate a link below and send it to the
          person who should get an account.
        </p>
      </div>

      {err && (
        <div style={{
          background: "#FEF2F2", border: `1px solid ${T.red}`, color: T.red,
          borderRadius: 8, padding: "9px 12px", fontSize: 13,
        }}>
          {err}
        </div>
      )}

      <LinkBox {...(fresh || {})} onDone={() => setFresh(null)} />

      {/* pending "I forgot my password" requests */}
      {requests.length > 0 && (
        <div style={{ ...card, padding: 16 }}>
          <div style={{ ...label, marginBottom: 8 }}>Password reset requests</div>
          {requests.map((q) => (
            <div key={q.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "7px 0", borderTop: `1px solid ${T.border}`,
            }}>
              <div style={{ flex: 1, fontSize: 13 }}>
                <b>{q.username}</b>
                <span style={{ color: T.sub }}> asked for a reset — {q.requested_at}</span>
              </div>
              <button
                style={{ ...btn.green, fontSize: 12, padding: "5px 11px" }}
                disabled={busy}
                onClick={() => act(async () => {
                  const r = await adminResetLink(q.user_id);
                  setFresh({
                    title: `Reset link for ${r.username}`,
                    link: r.link,
                    note: `Valid for ${r.expires_hours} hours and can only be used once. Send it to them directly.`,
                  });
                })}
              >
                Generate reset link
              </button>
            </div>
          ))}
        </div>
      )}

      {/* create an invitation */}
      <div style={{ ...card, padding: 16 }}>
        <div style={{ ...label, marginBottom: 10 }}>Invite someone</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={inviteNote}
            onChange={(e) => setInviteNote(e.target.value)}
            placeholder="Who is this for? (a note for you, e.g. 'brother')"
            style={{
              flex: 1, minWidth: 240, padding: "8px 11px", fontSize: 13,
              fontFamily: T.ui, border: `1px solid ${T.border}`, borderRadius: 8,
            }}
          />
          <label style={{ fontSize: 13, color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={inviteAdmin}
              onChange={(e) => setInviteAdmin(e.target.checked)} />
            Make them an admin
          </label>
          <button
            style={{ ...btn.primary, fontSize: 13, padding: "8px 14px" }}
            disabled={busy}
            onClick={() => act(async () => {
              const r = await createInvite({ grants_admin: inviteAdmin, note: inviteNote });
              setFresh({
                title: inviteAdmin ? "Admin invitation link" : "Invitation link",
                link: r.link,
                note: `Valid for ${r.expires_days} days and can only be used once. This is the only time it is shown.`,
              });
              setInviteNote("");
              setInviteAdmin(false);
            })}
          >
            Generate invitation link
          </button>
        </div>
      </div>

      {/* accounts */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}` }}>
          <span style={label}>Accounts</span>
          <span style={{ fontSize: 12, color: T.sub, marginLeft: 8 }}>{users.length}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>User</th>
                <th style={th}>Role</th>
                <th style={th}>Status</th>
                <th style={th}>Created</th>
                <th style={th}>Last sign-in</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={td}>
                    <b>{u.username}</b>
                    {u.id === me.id && <span style={{ color: T.sub }}> (you)</span>}
                    {u.display_name && u.display_name !== u.username && (
                      <div style={{ fontSize: 11, color: T.faint }}>{u.display_name}</div>
                    )}
                  </td>
                  <td style={td}>{u.is_admin ? <b>Admin</b> : "User"}</td>
                  <td style={{ ...td, color: u.is_active ? T.green : T.red }}>
                    {u.is_active ? "Active" : "Disabled"}
                  </td>
                  <td style={{ ...td, ...monoText, fontSize: 11, color: T.sub }}>{u.created_at}</td>
                  <td style={{ ...td, ...monoText, fontSize: 11, color: T.sub }}>
                    {u.last_login || "never"}
                  </td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      style={{ ...btn.outline, fontSize: 11, padding: "4px 9px", marginRight: 6 }}
                      disabled={busy}
                      onClick={() => act(async () => {
                        const r = await adminResetLink(u.id);
                        setFresh({
                          title: `Reset link for ${r.username}`,
                          link: r.link,
                          note: `Valid for ${r.expires_hours} hours, single use.`,
                        });
                      })}
                    >
                      Reset link
                    </button>
                    <button
                      style={{ ...btn.outline, fontSize: 11, padding: "4px 9px", marginRight: 6 }}
                      disabled={busy}
                      onClick={() => act(() => setUserAdmin(u.id, !u.is_admin))}
                    >
                      {u.is_admin ? "Remove admin" : "Make admin"}
                    </button>
                    <button
                      style={{
                        ...btn.outline, fontSize: 11, padding: "4px 9px",
                        color: u.is_active ? T.red : T.green,
                        borderColor: u.is_active ? T.red : T.green,
                      }}
                      disabled={busy}
                      onClick={() => act(() => setUserActive(u.id, !u.is_active))}
                    >
                      {u.is_active ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* outstanding invitations */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}` }}>
          <span style={label}>Invitations</span>
          <span style={{ fontSize: 12, color: T.sub, marginLeft: 8 }}>
            {liveInvites.length} outstanding
          </span>
        </div>
        {invites.length === 0 ? (
          <div style={{ padding: "18px 16px", fontSize: 13, color: T.faint }}>
            No invitations yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Note</th>
                  <th style={th}>Grants</th>
                  <th style={th}>Created</th>
                  <th style={th}>Expires</th>
                  <th style={th}>Status</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td style={td}>{i.note || <span style={{ color: T.faint }}>—</span>}</td>
                    <td style={td}>{i.grants_admin ? "Admin" : "User"}</td>
                    <td style={{ ...td, ...monoText, fontSize: 11, color: T.sub }}>{i.created_at}</td>
                    <td style={{ ...td, ...monoText, fontSize: 11, color: T.sub }}>{i.expires_at}</td>
                    <td style={td}>
                      {i.used_at
                        ? <span style={{ color: T.sub }}>used by {i.used_by_name}</span>
                        : <span style={{ color: T.green }}>open</span>}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {!i.used_at && (
                        <button
                          style={{
                            ...btn.outline, fontSize: 11, padding: "4px 9px",
                            color: T.red, borderColor: T.red,
                          }}
                          disabled={busy}
                          onClick={() => act(() => revokeInvite(i.id))}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
