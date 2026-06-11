import os
import threading

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

# Load environment variables from .env file
load_dotenv()

# DATABASE_URL for PostgreSQL (Supabase/Vercel/Railway/local)
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is required")

# Ensure we're using the correct PostgreSQL driver
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif DATABASE_URL.startswith("postgresql://") and "+psycopg2" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

# Supabase requires SSL. If sslmode isn't specified, add it for supabase hosts.
if "supabase.co" in DATABASE_URL and "sslmode=" not in DATABASE_URL:
    separator = "&" if "?" in DATABASE_URL else "?"
    DATABASE_URL = f"{DATABASE_URL}{separator}sslmode=require"


class Base(DeclarativeBase):
    """Base declarative class for SQLAlchemy models."""


is_serverless_runtime = bool(os.getenv("VERCEL"))

connect_args = {
    "connect_timeout": 10,
    # TCP keepalive settings reduce idle SSL disconnects on managed Postgres.
    "keepalives": 1,
    "keepalives_idle": 30,
    "keepalives_interval": 10,
    "keepalives_count": 5,
    # Avoid overly aggressive DB-side defaults cancelling simple auth queries.
    "options": "-c statement_timeout=30000 -c lock_timeout=5000",
}


engine_kwargs = {
    "echo": False,
    "future": True,
    "pool_pre_ping": True,
    "pool_recycle": 300,
    "connect_args": connect_args,
}

if is_serverless_runtime:
    # Serverless functions are short-lived; avoid reusing stale pooled sockets.
    engine_kwargs["poolclass"] = NullPool
else:
    engine_kwargs["pool_size"] = 5
    engine_kwargs["max_overflow"] = 10

engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

_critical_schema_ready = False
_critical_schema_lock = threading.Lock()


def ensure_critical_schema() -> None:
    """Best-effort runtime schema guard for columns queried on every request.

    In serverless environments, startup hooks may be skipped or race with first
    requests. This guard runs once per process before sessions are served.
    """
    global _critical_schema_ready
    if _critical_schema_ready:
        return

    with _critical_schema_lock:
        if _critical_schema_ready:
            return

        try:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_user_id VARCHAR(64)"))
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20)"))
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'GHS'"))

                # Index creation is optional at runtime; do not block requests if
                # legacy duplicate data prevents creating a unique index.
                try:
                    conn.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase_user_id_unique "
                            "ON users (supabase_user_id) WHERE supabase_user_id IS NOT NULL"
                        )
                    )
                except Exception as exc:
                    print(f"⚠️ Could not ensure idx_users_supabase_user_id_unique: {exc}")

                try:
                    conn.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique "
                            "ON users (phone) WHERE phone IS NOT NULL"
                        )
                    )
                except Exception as exc:
                    print(f"⚠️ Could not ensure idx_users_phone_unique: {exc}")

            _critical_schema_ready = True
        except Exception as exc:
            # Keep requests flowing; retry on next request.
            print(f"⚠️ Critical schema guard failed: {type(exc).__name__}: {exc}")


def get_db():
    """Dependency that yields a database session."""
    ensure_critical_schema()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
