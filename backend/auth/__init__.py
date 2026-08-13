"""Authentication: accounts, sessions, invite-only registration, resets.

  security.py  password hashing (stdlib scrypt) + opaque token helpers
  store.py     schema and every query touching the auth_* tables
  sessions.py  cookie set/clear, login/logout, login throttling
  deps.py      require_user / require_admin + the public-path allow-list
  api.py       the /api/auth router

Wired in backend/main.py: store.init() at startup, the router mounted, and a
fail-closed middleware that rejects any /api/ path not on deps.is_public().
"""
