"""Create (or repair) an admin account. This is the ONLY way the first
account comes into existence — registration needs an invite, and issuing an
invite needs an admin, so something has to break the loop from the console.

Run from the project root, with the venv python:

    python scripts/create_admin.py melek
    python scripts/create_admin.py melek --password 'the-password'
    python scripts/create_admin.py melek --reset-password     # existing user

On the VM:
    cd /opt/polymarket-tracker
    sudo -u tracker ./venv/bin/python3 scripts/create_admin.py melek

The password is read from the terminal without echoing unless --password is
given (which leaves it in shell history — fine for a scripted setup, not for
a real one).
"""

import argparse
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.auth import security, store  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Create or promote an admin user.")
    ap.add_argument("username")
    ap.add_argument("--password", help="skip the prompt (ends up in shell history)")
    ap.add_argument("--display-name", default="")
    ap.add_argument("--reset-password", action="store_true",
                    help="user already exists: set a new password and promote to admin")
    args = ap.parse_args()

    store.init()
    uname = security.normalize_username(args.username)
    if not uname:
        sys.exit("username cannot be empty")

    existing = store.get_user_by_name(uname)
    if existing and not args.reset_password:
        sys.exit(f"user {uname!r} already exists — pass --reset-password to "
                 f"set a new password and make sure they are an active admin")

    password = args.password
    if not password:
        password = getpass.getpass("password: ")
        if password != getpass.getpass("confirm: "):
            sys.exit("passwords did not match")
    if len(password) < 8:
        sys.exit("password must be at least 8 characters")

    if existing:
        store.set_password(existing["id"], password)
        store.set_admin(existing["id"], True)
        store.set_active(existing["id"], True)
        store.revoke_all_sessions(existing["id"])  # old logins die with the password
        print(f"updated {uname!r}: new password, admin, active, all sessions revoked")
    else:
        uid = store.create_user(uname, args.display_name or uname, password, is_admin=True)
        print(f"created admin {uname!r} (id {uid})")

    print(f"admins now active: {store.admin_count()}   total users: {store.user_count()}")


if __name__ == "__main__":
    main()
