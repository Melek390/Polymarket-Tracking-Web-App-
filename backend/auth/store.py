"""Storage for accounts, sessions, invitations and password resets.

Same shape as backend/traders/store.py: the schema lives here, every query
that touches these tables lives here, and nothing above this file writes SQL.

Tokens are stored HASHED (see security.token_hash) — the plaintext exists
only in the response that hands it to the user and in the link they paste
back. A dump of this database therefore yields no usable session, invite or
reset link.
"""

from datetime import datetime, timedelta, timezone

from backend.auth import security
from backend.database.db import get_db

SCHEMA = """
CREATE TABLE IF NOT EXISTS auth_users (
    id            INTEGER PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,          -- lowercase, see normalize_username
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_login    TEXT
);

-- One row per signed-in browser. Deleting a row logs that browser out, which
-- is how "revoke" and "log out everywhere" both work.
CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at TEXT NOT NULL,
    user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

-- Registration is invite-only: no invite, no account. Single use.
-- created_by is NULLABLE: the very first invitation is minted from the
-- console before any account exists, so there is nobody to attribute it to.
CREATE TABLE IF NOT EXISTS auth_invites (
    token_hash  TEXT PRIMARY KEY,
    created_by  INTEGER REFERENCES auth_users(id),
    grants_admin INTEGER NOT NULL DEFAULT 0,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at  TEXT NOT NULL,
    used_at     TEXT,
    used_by     INTEGER REFERENCES auth_users(id)
);

-- Password resets. Single use, short-lived.
CREATE TABLE IF NOT EXISTS auth_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at TEXT NOT NULL,
    used_at    TEXT
);

-- A user asking for a reset when there is no mail server: the request is
-- queued here for an admin to action from the admin panel.
CREATE TABLE IF NOT EXISTS auth_reset_requests (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    handled_at   TEXT
);
"""


def init():
    """Create the auth tables; safe on every startup."""
    with get_db() as conn:
        conn.executescript(SCHEMA)
        # Migration: the first cut declared auth_invites.created_by NOT NULL,
        # which blocks the console-minted setup invitation (there is no user
        # to attribute it to yet). SQLite cannot drop NOT NULL in place, so
        # rebuild the table. Invitations are short-lived, so copying them is
        # cheap and losing none of them matters.
        cols = {r["name"]: r for r in conn.execute("PRAGMA table_info(auth_invites)")}
        if cols.get("created_by") and cols["created_by"]["notnull"]:
            conn.execute("ALTER TABLE auth_invites RENAME TO auth_invites_old")
            conn.executescript(SCHEMA)
            conn.execute("""INSERT INTO auth_invites
                (token_hash, created_by, grants_admin, note, created_at,
                 expires_at, used_at, used_by)
                SELECT token_hash, created_by, grants_admin, note, created_at,
                       expires_at, used_at, used_by FROM auth_invites_old""")
            conn.execute("DROP TABLE auth_invites_old")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _expired(row_value: str | None) -> bool:
    if not row_value:
        return True
    return row_value <= _stamp(_now())


# ---- users ---------------------------------------------------------------

def user_count() -> int:
    with get_db() as conn:
        return conn.execute("SELECT COUNT(*) c FROM auth_users").fetchone()["c"]


def get_user(user_id: int) -> dict | None:
    with get_db() as conn:
        r = conn.execute("SELECT * FROM auth_users WHERE id=?", (user_id,)).fetchone()
    return dict(r) if r else None


def get_user_by_name(username: str) -> dict | None:
    with get_db() as conn:
        r = conn.execute("SELECT * FROM auth_users WHERE username=?",
                         (security.normalize_username(username),)).fetchone()
    return dict(r) if r else None


def list_users() -> list[dict]:
    with get_db() as conn:
        return [dict(r) for r in conn.execute(
            """SELECT id, username, display_name, is_admin, is_active,
                      created_at, last_login
               FROM auth_users ORDER BY is_admin DESC, username""")]


def create_user(username: str, display_name: str, password: str,
                is_admin: bool = False) -> int:
    uname = security.normalize_username(username)
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO auth_users (username, display_name, password_hash, is_admin)
               VALUES (?, ?, ?, ?)""",
            (uname, (display_name or uname).strip(),
             security.hash_password(password), 1 if is_admin else 0))
        return cur.lastrowid


def set_password(user_id: int, password: str):
    with get_db() as conn:
        conn.execute("UPDATE auth_users SET password_hash=? WHERE id=?",
                     (security.hash_password(password), user_id))


def set_admin(user_id: int, is_admin: bool):
    with get_db() as conn:
        conn.execute("UPDATE auth_users SET is_admin=? WHERE id=?",
                     (1 if is_admin else 0, user_id))


def set_active(user_id: int, is_active: bool):
    with get_db() as conn:
        conn.execute("UPDATE auth_users SET is_active=? WHERE id=?",
                     (1 if is_active else 0, user_id))
    if not is_active:
        revoke_all_sessions(user_id)


def admin_count() -> int:
    with get_db() as conn:
        return conn.execute(
            "SELECT COUNT(*) c FROM auth_users WHERE is_admin=1 AND is_active=1"
        ).fetchone()["c"]


def touch_login(user_id: int):
    with get_db() as conn:
        conn.execute("UPDATE auth_users SET last_login=? WHERE id=?",
                     (_stamp(_now()), user_id))


# ---- sessions ------------------------------------------------------------

def create_session(user_id: int, days: int, user_agent: str = "") -> str:
    token = security.new_token()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO auth_sessions (token_hash, user_id, expires_at, user_agent)
               VALUES (?, ?, ?, ?)""",
            (security.token_hash(token), user_id,
             _stamp(_now() + timedelta(days=days)), (user_agent or "")[:200]))
    return token


def session_user(token: str) -> dict | None:
    """The live user behind a cookie, or None if the session is missing,
    expired, or the account has since been deactivated."""
    if not token:
        return None
    with get_db() as conn:
        r = conn.execute(
            """SELECT s.expires_at, u.*
               FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
               WHERE s.token_hash = ?""",
            (security.token_hash(token),)).fetchone()
    if not r or _expired(r["expires_at"]) or not r["is_active"]:
        return None
    return dict(r)


def revoke_session(token: str):
    with get_db() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE token_hash=?",
                     (security.token_hash(token),))


def revoke_all_sessions(user_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE user_id=?", (user_id,))


def purge_expired():
    """Housekeeping — expired sessions/invites/resets are dead weight."""
    now = _stamp(_now())
    with get_db() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (now,))
        conn.execute("DELETE FROM auth_resets WHERE expires_at <= ?", (now,))


# ---- invitations ---------------------------------------------------------

def bootstrap_invite(days: int) -> str:
    """The setup link for the very first administrator.

    Registration needs an invitation and minting an invitation needs an admin,
    so something has to break the loop from the console. Handing the operator
    a LINK rather than a password is the better half of that trade: the client
    picks his own username and password, and nobody else ever knows it.

    Refused once an active admin exists, so this can never become a standing
    console backdoor to admin — from then on invitations come from the panel.
    (If every admin is somehow lost, create_admin.py is still the way back in.)
    """
    if admin_count() > 0:
        raise RuntimeError(
            "an active admin already exists — issue invitations from the "
            "Users page in the app instead")
    return create_invite(None, days, grants_admin=True, note="initial setup")


def create_invite(created_by: int | None, days: int, grants_admin: bool = False,
                  note: str = "") -> str:
    token = security.new_token()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO auth_invites (token_hash, created_by, grants_admin, note, expires_at)
               VALUES (?, ?, ?, ?, ?)""",
            (security.token_hash(token), created_by, 1 if grants_admin else 0,
             (note or "").strip()[:200], _stamp(_now() + timedelta(days=days))))
    return token


def peek_invite(token: str) -> dict | None:
    """Validate an invite WITHOUT consuming it, so the register page can tell
    the user their link is bad before they fill the form in."""
    if not token:
        return None
    with get_db() as conn:
        r = conn.execute("SELECT * FROM auth_invites WHERE token_hash=?",
                         (security.token_hash(token),)).fetchone()
    if not r or r["used_at"] or _expired(r["expires_at"]):
        return None
    return dict(r)


def consume_invite(token: str, user_id: int) -> bool:
    """Mark an invite used. The UPDATE is guarded on used_at IS NULL so two
    simultaneous registrations on one link cannot both win."""
    with get_db() as conn:
        cur = conn.execute(
            """UPDATE auth_invites SET used_at=?, used_by=?
               WHERE token_hash=? AND used_at IS NULL AND expires_at > ?""",
            (_stamp(_now()), user_id, security.token_hash(token), _stamp(_now())))
        return cur.rowcount == 1


def list_invites() -> list[dict]:
    with get_db() as conn:
        return [dict(r) for r in conn.execute(
            """SELECT i.rowid AS id, i.grants_admin, i.note, i.created_at,
                      i.expires_at, i.used_at,
                      -- NULL creator = the console-minted setup invitation
                      COALESCE(c.username, 'setup') AS created_by_name,
                      u.username AS used_by_name
               FROM auth_invites i
               LEFT JOIN auth_users c ON c.id = i.created_by
               LEFT JOIN auth_users u ON u.id = i.used_by
               ORDER BY i.created_at DESC LIMIT 50""")]


def revoke_invite(invite_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM auth_invites WHERE rowid=? AND used_at IS NULL",
                     (invite_id,))


# ---- password resets -----------------------------------------------------

def create_reset(user_id: int, hours: int) -> str:
    token = security.new_token()
    with get_db() as conn:
        # only one live reset per user — issuing a new link kills the old one
        conn.execute("DELETE FROM auth_resets WHERE user_id=? AND used_at IS NULL",
                     (user_id,))
        conn.execute(
            """INSERT INTO auth_resets (token_hash, user_id, expires_at)
               VALUES (?, ?, ?)""",
            (security.token_hash(token), user_id,
             _stamp(_now() + timedelta(hours=hours))))
    return token


def peek_reset(token: str) -> dict | None:
    if not token:
        return None
    with get_db() as conn:
        r = conn.execute(
            """SELECT r.*, u.username, u.display_name
               FROM auth_resets r JOIN auth_users u ON u.id = r.user_id
               WHERE r.token_hash=?""", (security.token_hash(token),)).fetchone()
    if not r or r["used_at"] or _expired(r["expires_at"]):
        return None
    return dict(r)


def consume_reset(token: str) -> int | None:
    """-> user_id if this link was still live, else None. Guarded like the
    invite so a link can never be used twice."""
    with get_db() as conn:
        row = conn.execute("SELECT user_id FROM auth_resets WHERE token_hash=?",
                           (security.token_hash(token),)).fetchone()
        if not row:
            return None
        cur = conn.execute(
            """UPDATE auth_resets SET used_at=?
               WHERE token_hash=? AND used_at IS NULL AND expires_at > ?""",
            (_stamp(_now()), security.token_hash(token), _stamp(_now())))
        return row["user_id"] if cur.rowcount == 1 else None


def request_reset(user_id: int):
    """Queue a 'I forgot my password' for the admin. Collapses to one open
    request per user so a frustrated user cannot flood the panel."""
    with get_db() as conn:
        open_one = conn.execute(
            "SELECT id FROM auth_reset_requests WHERE user_id=? AND handled_at IS NULL",
            (user_id,)).fetchone()
        if not open_one:
            conn.execute("INSERT INTO auth_reset_requests (user_id) VALUES (?)",
                         (user_id,))


def list_reset_requests() -> list[dict]:
    with get_db() as conn:
        return [dict(r) for r in conn.execute(
            """SELECT q.id, q.requested_at, u.id AS user_id, u.username, u.display_name
               FROM auth_reset_requests q JOIN auth_users u ON u.id = q.user_id
               WHERE q.handled_at IS NULL ORDER BY q.requested_at""")]


def clear_reset_requests(user_id: int):
    with get_db() as conn:
        conn.execute(
            "UPDATE auth_reset_requests SET handled_at=? WHERE user_id=? AND handled_at IS NULL",
            (_stamp(_now()), user_id))
