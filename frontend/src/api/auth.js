// Auth API layer. Same rule as api/client.js: every fetch for /api/auth lives
// here, components never build a request themselves.
//
// The session is an HttpOnly cookie, so there is no token for JS to hold or
// forget — the browser attaches it and `credentials: "same-origin"` (the
// default for same-origin fetches) is all that is needed.

async function call(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let data = null;
  try {
    data = await r.json();
  } catch {
    /* empty body */
  }
  if (!r.ok) {
    // FastAPI validation errors arrive as a list of objects; flatten to a
    // sentence rather than rendering "[object Object]" at the user.
    const d = data?.detail;
    const msg = Array.isArray(d) ? d.map((e) => e.msg).join(", ") : d;
    throw new Error(msg || `HTTP ${r.status}`);
  }
  return data;
}

export async function fetchMe() {
  const r = await fetch("/api/auth/me");
  if (!r.ok) return { user: null, auth_enabled: true };
  return r.json();
}

export const login = (username, password) => call("/api/auth/login", { username, password });
export const logout = () => call("/api/auth/logout");

export const checkInvite = (token) => call("/api/auth/invite/check", { token });
export const register = (payload) => call("/api/auth/register", payload);

export const forgotPassword = (username) => call("/api/auth/forgot", { username });
export const checkReset = (token) => call("/api/auth/reset/check", { token });
export const resetPassword = (token, password) => call("/api/auth/reset", { token, password });
export const changePassword = (current_password, new_password) =>
  call("/api/auth/password", { current_password, new_password });

// admin
export async function fetchUsers() {
  const r = await fetch("/api/auth/users");
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return r.json();
}
export const createInvite = (opts) => call("/api/auth/invite", opts ?? {});
export const revokeInvite = (invite_id) => call("/api/auth/invite/revoke", { invite_id });
export const adminResetLink = (user_id) => call("/api/auth/users/reset-link", { user_id });
export const setUserAdmin = (user_id, is_admin) => call("/api/auth/users/admin", { user_id, is_admin });
export const setUserActive = (user_id, is_active) => call("/api/auth/users/active", { user_id, is_active });
