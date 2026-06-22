"""One-time backfill: mirror every existing app user into Supabase Authentication.

Why this exists
---------------
The app stores its own password hash and logs users in itself; Supabase Auth is
only a *mirror* so users appear under Authentication -> Users in the dashboard.
A database migration (pg_dump of the public schema) does NOT carry over Supabase's
auth.users table, so after moving projects the Authentication tab is empty. This
script recreates an Auth user for each app user and records the new id.

Passwords are NOT recoverable (only the bcrypt hash is stored), so each mirrored
Auth user is given a fresh random password. That's harmless: real login still
uses the app's own hash. The mirror is for visibility/management only.

Usage (run locally, pointing at the NEW project)
------------------------------------------------
    export DATABASE_URL='...London transaction pooler...'   # already in your .env
    export SUPABASE_URL='https://<new-project-ref>.supabase.co'
    export SUPABASE_SERVICE_ROLE_KEY='<service_role secret from Settings -> API>'

    python -m scripts.backfill_supabase_auth            # dry run, shows what it would do
    python -m scripts.backfill_supabase_auth --apply    # actually create + link

Safe to re-run: users already in Auth are linked by email rather than duplicated.
"""

from __future__ import annotations

import argparse
import os
import secrets

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

from app.utils.supabase_auth import (
    SupabaseAuthError,
    create_auth_user,
    find_auth_user_id_by_email,
    is_supabase_auth_sync_enabled,
)


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually create/link Auth users. Without it, only a dry run is printed.",
    )
    args = parser.parse_args()

    if not is_supabase_auth_sync_enabled():
        raise SystemExit(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to the NEW project first."
        )

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is not set (point it at the London database).")

    engine = create_engine(database_url)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT id, email, name, supabase_user_id FROM users "
                "WHERE email IS NOT NULL AND TRIM(email) <> '' ORDER BY id"
            )
        ).all()

    print(f"Found {len(rows)} app user(s) with an email.")
    if not args.apply:
        for row in rows:
            print(f"  [dry-run] would sync {row.email}")
        print("\nDry run only. Re-run with --apply to make changes.")
        return

    created = linked = failed = 0
    for row in rows:
        email = (row.email or "").strip()
        # Phone is intentionally omitted: a malformed/duplicate phone would make
        # Auth reject the whole user. Email is all we need for them to show up.
        try:
            result = create_auth_user(
                email=email,
                password=secrets.token_urlsafe(18),
                name=row.name,
            )
            new_id, action = result.user_id, "created"
            created += 1
        except SupabaseAuthError as exc:
            if exc.status_code in {400, 409, 422}:
                existing = find_auth_user_id_by_email(email)
                if not existing:
                    print(f"  ! {email}: already exists but could not be found; skipped")
                    failed += 1
                    continue
                new_id, action = existing, "linked"
                linked += 1
            else:
                print(f"  ! {email}: {exc}")
                failed += 1
                continue

        with engine.begin() as conn:
            conn.execute(
                text("UPDATE users SET supabase_user_id = :sid WHERE id = :uid"),
                {"sid": new_id, "uid": row.id},
            )
        print(f"  {action}: {email} -> {new_id}")

    print(f"\nDone. created={created} linked={linked} failed={failed}")


if __name__ == "__main__":
    main()
