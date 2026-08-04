import os
import threading
from urllib.parse import urlparse

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

def _is_supabase_host(database_url: str) -> bool:
    hostname = (urlparse(database_url).hostname or "").lower()
    return hostname.endswith(".supabase.co") or hostname.endswith(".supabase.com") or hostname.endswith(".supabase.net")


# Ensure we're using the correct PostgreSQL driver
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif DATABASE_URL.startswith("postgresql://") and "+psycopg2" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

# Supabase requires SSL. Support direct and pooled hostnames.
if _is_supabase_host(DATABASE_URL) and "sslmode=" not in DATABASE_URL:
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

_WAREHOUSE_PURCHASE_COLUMNS: dict[str, dict[str, str]] = {
    "purchases": {
        "warehouse_id": "INTEGER REFERENCES warehouses(id) ON DELETE CASCADE",
        "warehouse_item_id": "INTEGER REFERENCES warehouse_stock_items(id) ON DELETE SET NULL",
        "warehouse_stock_movement_id": "INTEGER REFERENCES warehouse_stock_movements(id) ON DELETE SET NULL",
    },
    "supplier_payments": {
        "warehouse_id": "INTEGER REFERENCES warehouses(id) ON DELETE CASCADE",
    },
    "purchase_returns": {
        "warehouse_id": "INTEGER REFERENCES warehouses(id) ON DELETE CASCADE",
        "warehouse_item_id": "INTEGER REFERENCES warehouse_stock_items(id) ON DELETE SET NULL",
        "warehouse_stock_movement_id": "INTEGER REFERENCES warehouse_stock_movements(id) ON DELETE SET NULL",
    },
}


def ensure_warehouse_purchase_schema() -> None:
    """Synchronously install columns required by every procurement query.

    A fast information-schema check avoids taking table locks after rollout.
    This guard must complete before a serverless instance accepts requests;
    background startup work can be frozen before its DDL is committed.
    """
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name IN "
                "('purchases', 'supplier_payments', 'purchase_returns')"
            )
        ).all()
        present = {(str(row.table_name), str(row.column_name)) for row in rows}
        missing = [
            (table_name, column_name, column_type)
            for table_name, columns in _WAREHOUSE_PURCHASE_COLUMNS.items()
            for column_name, column_type in columns.items()
            if (table_name, column_name) not in present
        ]
        for table_name, column_name, column_type in missing:
            conn.execute(
                text(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {column_name} {column_type}")
            )


def ensure_sales_receipt_schema() -> None:
    """Install receipt-accounting columns before sales requests are served.

    Sale queries select the complete ORM model, so even a history GET fails if
    one of these columns is absent. The information-schema fast path avoids
    table locks once the deployment has been upgraded.
    """
    required_columns = {
        "discount_amount": "NUMERIC(10,2) DEFAULT 0",
        "tax_snapshot": "JSONB",
        "currency_code": "VARCHAR(3) DEFAULT 'GHS'",
    }
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = 'sales'"
            )
        ).all()
        present = {str(row.column_name) for row in rows}
        for column_name, column_type in required_columns.items():
            if column_name not in present:
                conn.execute(
                    text(f"ALTER TABLE sales ADD COLUMN IF NOT EXISTS {column_name} {column_type}")
                )


def ensure_sale_return_item_schema() -> None:
    """Install exact-item fields required by the customer return ledger."""
    required_columns = {
        "variant_id": "INTEGER REFERENCES product_variants(id) ON DELETE SET NULL",
        "item_condition": "VARCHAR(30) DEFAULT 'resellable'",
    }
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = 'sale_returns'"
            )
        ).all()
        present = {str(row.column_name) for row in rows}
        for column_name, column_type in required_columns.items():
            if column_name not in present:
                conn.execute(
                    text(f"ALTER TABLE sale_returns ADD COLUMN IF NOT EXISTS {column_name} {column_type}")
                )
        conn.execute(
            text(
                "UPDATE sale_returns AS sale_return SET variant_id = sale.variant_id "
                "FROM sales AS sale WHERE sale_return.sale_id = sale.id "
                "AND sale_return.variant_id IS NULL AND sale.variant_id IS NOT NULL"
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_sale_returns_variant_id ON sale_returns (variant_id)"))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_sale_returns_item_condition "
                "ON sale_returns (branch_id, item_condition, created_at DESC)"
            )
        )


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
            ensure_warehouse_purchase_schema()
            ensure_sales_receipt_schema()
            ensure_sale_return_item_schema()
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_user_id VARCHAR(64)"))
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20)"))
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS permission_overrides JSONB"))
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'GHS'"))
                conn.execute(text("ALTER TABLE system_settings ALTER COLUMN uses_expiry_tracking SET DEFAULT FALSE"))
            _critical_schema_ready = True
        except Exception as exc:
            # Keep requests flowing; retry on next request.
            print(f"⚠️ Critical schema guard failed: {type(exc).__name__}: {exc}")


def get_db():
    """Dependency that yields a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
