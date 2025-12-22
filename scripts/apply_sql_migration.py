from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import create_engine


def _split_sql(script: str) -> list[str]:
    """Split SQL into statements, respecting quotes and Postgres dollar-quoted blocks."""
    stmts: list[str] = []
    buf: list[str] = []
    in_single = False
    in_double = False
    dollar_tag: str | None = None

    def startswith_dollar_tag(s: str, pos: int) -> str | None:
        if pos >= len(s) or s[pos] != "$":
            return None
        j = pos + 1
        while j < len(s) and (s[j].isalnum() or s[j] == "_"):
            j += 1
        if j < len(s) and s[j] == "$":
            return s[pos : j + 1]
        return None

    i = 0
    n = len(script)
    while i < n:
        ch = script[i]

        if not in_single and not in_double:
            tag = startswith_dollar_tag(script, i)
            if tag is not None:
                buf.append(tag)
                i += len(tag)
                if dollar_tag is None:
                    dollar_tag = tag
                elif dollar_tag == tag:
                    dollar_tag = None
                continue

        if dollar_tag is None:
            if ch == "'" and not in_double:
                if in_single and i + 1 < n and script[i + 1] == "'":
                    buf.append("''")
                    i += 2
                    continue
                in_single = not in_single
            elif ch == '"' and not in_single:
                in_double = not in_double

            if ch == ";" and not in_single and not in_double:
                stmt = "".join(buf).strip()
                if stmt:
                    stmts.append(stmt)
                buf = []
                i += 1
                continue

        buf.append(ch)
        i += 1

    tail = "".join(buf).strip()
    if tail:
        stmts.append(tail)

    cleaned: list[str] = []
    for s in stmts:
        s2 = s.strip()
        if not s2:
            continue
        cleaned.append(s2)
    return cleaned


def _strip_full_line_comments(sql: str) -> str:
    lines: list[str] = []
    for line in sql.splitlines():
        if line.strip().startswith("--"):
            continue
        lines.append(line)
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: python3 scripts/apply_sql_migration.py <path/to/migration.sql>")
        print("Requires DATABASE_URL in env.")
        return 2

    path = Path(argv[1])
    if not path.exists():
        print(f"Migration file not found: {path}")
        return 2

    import os

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL is not set")
        return 2

    # Normalize postgres:// -> postgresql+psycopg2:// like app.database
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+psycopg2://", 1)
    elif db_url.startswith("postgresql://") and "+psycopg2" not in db_url:
        db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

    sql = path.read_text(encoding="utf-8")
    sql = _strip_full_line_comments(sql)
    statements = _split_sql(sql)

    engine = create_engine(db_url, future=True, pool_pre_ping=True)
    try:
        with engine.begin() as conn:
            for stmt in statements:
                conn.exec_driver_sql(stmt)
        print(f"Applied migration: {path}")
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
