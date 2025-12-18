#!/usr/bin/env python3
"""Postgres -> Supabase Postgres migration (Railway -> Supabase).

This script copies table data from a source PostgreSQL database into a target
PostgreSQL database using SQLAlchemy.

It is intentionally schema-agnostic: it expects the destination schema to
already exist (run your backend against Supabase once, or run migrations).

Required env vars:
- SOURCE_DATABASE_URL
- DEST_DATABASE_URL

Optional env vars:
- MIGRATE_SCHEMA=1           (default: 0) create tables in DEST via SQLAlchemy Base
- MIGRATE_TRUNCATE=1         (default: 0) truncate destination tables before copy

Notes
- This app's `DATABASE_URL` format is supported (postgres:// or postgresql://).
- DEST should include sslmode=require for Supabase.
"""

from __future__ import annotations

import os
from typing import Iterable

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine


def _env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None or str(value).strip() == "":
        raise RuntimeError(f"Missing required environment variable: {name}")
    return str(value)


def _normalize_pg_url(url: str) -> str:
    # SQLAlchemy wants postgresql+psycopg2://
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg2://", 1)
    elif url.startswith("postgresql://") and "+psycopg2" not in url:
        url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url


def _chunk_size() -> int:
    try:
        value = int(os.getenv("MIGRATE_CHUNK_SIZE", "5000"))
        return max(100, value)
    except Exception:
        return 5000


def _connect_timeout_s() -> int:
    try:
        value = int(os.getenv("MIGRATE_CONNECT_TIMEOUT_S", "10"))
        return max(1, value)
    except Exception:
        return 10


def _statement_timeout_ms() -> int | None:
    raw = os.getenv("MIGRATE_STATEMENT_TIMEOUT_MS")
    if raw is None or raw.strip() == "":
        return None
    try:
        value = int(raw)
        return value if value > 0 else None
    except Exception:
        return None


def _ping(engine: Engine, label: str) -> None:
    print(f"🔌 Connecting to {label}...", flush=True)
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    print(f"✅ Connected to {label}", flush=True)


def _apply_session_timeouts(engine: Engine) -> None:
    timeout_ms = _statement_timeout_ms()
    if not timeout_ms:
        return
    with engine.begin() as conn:
        conn.execute(text("SET statement_timeout = :ms"), {"ms": timeout_ms})


TABLES_IN_ORDER: list[str] = [
    # core
    "users",
    "branches",
    "products",
    "stock_movements",
    "sales",
    "creditors",
    "credit_transactions",
    # tokens
    "password_reset_tokens",
    "email_verification_tokens",
]


def _existing_tables(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT tablename
                FROM pg_catalog.pg_tables
                WHERE schemaname = 'public'
                """
            )
        ).fetchall()
    return {r[0] for r in rows}


def _truncate_tables(dest: Engine, tables: Iterable[str]) -> None:
    # Use CASCADE to satisfy FKs; RESTART IDENTITY resets sequences.
    with dest.begin() as conn:
        joined = ", ".join([f'"{t}"' for t in tables])
        conn.execute(text(f"TRUNCATE {joined} RESTART IDENTITY CASCADE"))


def _copy_table(*, source: Engine, dest: Engine, table: str) -> int:
    chunk_size = _chunk_size()
    inserted_total = 0

    print(f"➡️  {table}: querying source...", flush=True)

    with source.connect() as src:
        # Stream results so big tables don't load into RAM at once.
        result = (
            src.execution_options(stream_results=True)
            .execute(text(f'SELECT * FROM "{table}"'))
            .mappings()
        )

        first = result.fetchone()
        if first is None:
            return 0

        cols = list(first.keys())
        col_list = ", ".join([f'"{c}"' for c in cols])
        values_list = ", ".join([f":{c}" for c in cols])

        # Use ON CONFLICT DO NOTHING to keep reruns safe (relies on PK/unique constraints).
        sql = text(
            f"""
            INSERT INTO "{table}" ({col_list})
            VALUES ({values_list})
            ON CONFLICT DO NOTHING
            """
        )

        batch: list[dict] = [dict(first)]
        while True:
            remaining = chunk_size - len(batch)
            if remaining > 0:
                batch.extend([dict(r) for r in result.fetchmany(remaining)])

            if not batch:
                break

            with dest.begin() as conn:
                conn.execute(sql, batch)

            inserted_total += len(batch)

            if inserted_total % (chunk_size * 5) == 0:
                print(f"   ... {table}: copied {inserted_total} rows so far", flush=True)

            batch = []

            # If fetchmany returned nothing, we're done.
            peek = result.fetchmany(1)
            if not peek:
                break
            batch.append(dict(peek[0]))

    # Best-effort sequence bump
    if "id" in cols:
        with dest.begin() as conn:
            conn.execute(
                text(
                    """
                    DO $$
                    DECLARE
                        seq_name text;
                    BEGIN
                        SELECT pg_get_serial_sequence(:tname, 'id') INTO seq_name;
                        IF seq_name IS NOT NULL THEN
                            EXECUTE format(
                                'SELECT setval(%L, (SELECT COALESCE(MAX(id), 1) FROM %I))',
                                seq_name, :tname
                            );
                        END IF;
                    END$$;
                    """
                ),
                {"tname": table},
            )

    return inserted_total


def main() -> None:
    source_url = _normalize_pg_url(_env("SOURCE_DATABASE_URL"))
    dest_url = _normalize_pg_url(_env("DEST_DATABASE_URL"))

    connect_timeout = _connect_timeout_s()
    source = create_engine(
        source_url,
        pool_pre_ping=True,
        future=True,
        connect_args={"connect_timeout": connect_timeout},
    )
    dest = create_engine(
        dest_url,
        pool_pre_ping=True,
        future=True,
        connect_args={"connect_timeout": connect_timeout},
    )

    _ping(source, "SOURCE")
    _ping(dest, "DEST")
    _apply_session_timeouts(source)
    _apply_session_timeouts(dest)

    migrate_schema = os.getenv("MIGRATE_SCHEMA") == "1"
    truncate = os.getenv("MIGRATE_TRUNCATE") == "1"

    if migrate_schema:
        print("🧱 Ensuring destination schema exists...", flush=True)
        # Import inside to avoid side effects unless explicitly requested.
        from app.database import Base
        from app import models  # noqa: F401

        Base.metadata.create_all(bind=dest)

    existing_src = _existing_tables(source)
    existing_dest = _existing_tables(dest)

    tables = [t for t in TABLES_IN_ORDER if t in existing_src and t in existing_dest]
    missing = [t for t in TABLES_IN_ORDER if t not in existing_src or t not in existing_dest]

    if missing:
        print("⚠️  Skipping missing tables:")
        for t in missing:
            print(f"   - {t} (src={'yes' if t in existing_src else 'no'}, dest={'yes' if t in existing_dest else 'no'})")

    if not tables:
        raise RuntimeError("No matching tables found to migrate. Create schema in Supabase first.")

    if truncate:
        print("🧹 Truncating destination tables...", flush=True)
        _truncate_tables(dest, tables)

    print("🔄 Migrating tables...", flush=True)
    for t in tables:
        print(f"➡️  Starting {t}...", flush=True)
        count = _copy_table(source=source, dest=dest, table=t)
        print(f"✅ {t}: {count} rows")

    print("🎉 Migration complete", flush=True)


if __name__ == "__main__":
    main()
