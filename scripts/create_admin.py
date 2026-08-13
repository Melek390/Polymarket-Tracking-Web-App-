"""Get the first administrator into the system, and recover a lost one.

Registration needs an invitation and issuing an invitation needs an admin, so
something has to break that loop from the console. Two ways:

  --link  (PREFERRED) mint a one-time setup link and send it to the person who
          should be the admin. THEY choose their own username and password, so
          it never passes through you, this terminal, or your shell history:

              python scripts/create_admin.py --link
              python scripts/create_admin.py --link --base-url https://example.org

  <name>  create the account yourself, entering a password at a no-echo
          prompt. Use this to recover when nobody can get in:

              python scripts/create_admin.py melek
              python scripts/create_admin.py melek --reset-password

On the VM:
    cd /opt/polymarket-tracker
    sudo -u tracker ./venv/bin/python3 scripts/create_admin.py --link

--link refuses once an active admin exists; after that, invitations come from
the Users page inside the app.
"""

import argparse
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.auth import security, store  # noqa: E402


def main():
    ap = argparse.ArgumentParser(
        description="Get the first admin in, or recover a lost one.")
    ap.add_argument("username", nargs="?",
                    help="create/repair this account directly (omit when using --link)")
    ap.add_argument("--link", action="store_true",
                    help="mint a one-time setup link so they choose their own credentials")
    ap.add_argument("--base-url", default="",
                    help="public URL, to print a clickable link (e.g. https://example.org)")
    ap.add_argument("--days", type=int, default=7, help="how long the link stays valid")
    ap.add_argument("--password", help="skip the prompt (ends up in shell history)")
    ap.add_argument("--display-name", default="")
    ap.add_argument("--reset-password", action="store_true",
                    help="user already exists: set a new password and promote to admin")
    args = ap.parse_args()

    store.init()

    if args.link:
        if args.username:
            sys.exit("--link takes no username: the person you send it to picks their own")
        try:
            token = store.bootstrap_invite(args.days)
        except RuntimeError as e:
            sys.exit(f"{e}")
        base = args.base_url.rstrip("/")
        print("\nOne-time ADMIN setup link — send this to the person who should")
        print(f"own the tracker. Single use, valid {args.days} days, grants admin.\n")
        if base:
            print(f"    {base}/register?token={token}\n")
        else:
            print(f"    open  https://<your-site>/register  and paste this code:\n")
            print(f"    {token}\n")
            print("    (or re-run with --base-url https://<your-site> for a full link)\n")
        print("They choose their own username and password — it never touches")
        print("this terminal. Once they finish, further invitations come from")
        print("the Users page in the app.\n")
        return

    if not args.username:
        sys.exit("give a username, or use --link to send a setup link instead")

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
