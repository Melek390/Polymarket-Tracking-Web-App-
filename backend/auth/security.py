"""Password hashing and opaque-token helpers.

Deliberately stdlib-only: hashlib.scrypt is a memory-hard KDF that ships with
CPython, so adding auth does NOT add a dependency and the VM's venv never has
to be rebuilt to deploy it. (bcrypt/argon2 would be equally fine, but a new
wheel on the box is a deploy risk we do not need to take for three users.)

Two different kinds of secret live here and they are hashed differently:
  - PASSWORDS are low-entropy and human-chosen, so they get scrypt with a
    per-password salt and a deliberately expensive cost.
  - TOKENS (session cookies, invite codes, reset links) are 192+ bits from
    secrets.token_urlsafe, so a plain SHA-256 is enough — there is nothing to
    brute-force. They are still hashed at rest so a leaked DB does not hand
    over live sessions.
"""

import hashlib
import hmac
import secrets

# ~64 MB and roughly 100ms per hash on the VM: slow enough to make offline
# cracking painful, fast enough that a login never feels laggy.
_N = 2 ** 14
_R = 8
_P = 1
_DKLEN = 32
_SALT_BYTES = 16


def hash_password(password: str) -> str:
    """-> "scrypt$n$r$p$salt_hex$key_hex", everything needed to re-verify."""
    salt = secrets.token_bytes(_SALT_BYTES)
    key = hashlib.scrypt(password.encode("utf-8"), salt=salt,
                         n=_N, r=_R, p=_P, dklen=_DKLEN)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check. Any malformed record verifies as False rather than
    raising, so a corrupt row locks that one account out instead of 500ing the
    login endpoint for everybody."""
    try:
        scheme, n, r, p, salt_hex, key_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        key = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex),
                             n=int(n), r=int(r), p=int(p), dklen=len(key_hex) // 2)
    except (ValueError, TypeError, MemoryError):
        return False
    return hmac.compare_digest(key.hex(), key_hex)


def new_token() -> str:
    """A fresh opaque secret to hand out (cookie / invite / reset link)."""
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    """What we actually store and look up by — never the token itself."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalize_username(name: str) -> str:
    """Usernames are matched case-insensitively and stored lowercase, so
    "Melek" and "melek" can never become two accounts."""
    return (name or "").strip().lower()
