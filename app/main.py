import os
import asyncio
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import Base, engine
from .auth import get_current_active_user
from .routers import products, sales, inventory, revenue, creditors, reports, auth, employees, branches, data, settings, returns
from . import models

app = FastAPI(title="Gel Invent API", version="0.1.0")

# Startup migrations can take time (ALTER/UPDATE backfills). Railway healthchecks will fail
# if we block application startup. Run them in the background instead.
_startup_migrations_done: bool = False
_startup_migrations_error: str | None = None


def _ensure_critical_auth_schema_sync() -> None:
    """Apply tiny, idempotent auth schema changes required for request safety.

    This runs on every startup (including serverless) and is intentionally
    minimal so endpoints that query User do not fail due to missing columns.
    """
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_user_id VARCHAR(64)"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20)"))
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase_user_id_unique "
                "ON users (supabase_user_id) WHERE supabase_user_id IS NOT NULL"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique "
                "ON users (phone) WHERE phone IS NOT NULL"
            )
        )


def _should_run_startup_migrations() -> bool:
    """Control runtime schema patches/backfills.

    In serverless/production, running ALTER/BACKFILL on every cold start can hit
    DB statement timeout and degrade request handling. Keep it opt-in there.
    """
    explicit = (os.getenv("RUN_STARTUP_MIGRATIONS") or "").strip().lower()
    is_serverless_or_prod = bool(os.getenv("VERCEL") or os.getenv("RAILWAY_ENVIRONMENT"))

    # Safety-first in production/serverless: require an explicit "force" to run
    # runtime DDL/backfills during request-serving startup.
    if is_serverless_or_prod:
        return explicit == "force"

    if explicit:
        return explicit in {"1", "true", "yes", "on"}
    return not is_serverless_or_prod


def _run_startup_migrations_sync() -> None:
    """Run idempotent schema patches/backfills.

    This is intentionally synchronous and is executed in a background thread so
    the ASGI lifespan startup can complete quickly.
    """
    print("Creating/verifying database tables...")
    Base.metadata.create_all(bind=engine)
    print("✅ Database tables created/verified successfully")

    # Lightweight schema patch for existing DBs (create_all won't add columns).
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_user_id VARCHAR(64)"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20)"))
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase_user_id_unique "
                "ON users (supabase_user_id) WHERE supabase_user_id IS NOT NULL"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique "
                "ON users (phone) WHERE phone IS NOT NULL"
            )
        )
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS categories TEXT"))
        conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'GHS'"))

        # Product columns added over time
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_size INTEGER"))
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(100)"))
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_date DATE"))
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2)"))
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_cost_price NUMERIC(10,2)"))
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS selling_price NUMERIC(10,2)"))
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_selling_price NUMERIC(10,2)"))

        # Batch/expiry tracking + sale linkage on movements
        conn.execute(text("ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS batch_number VARCHAR(100)"))
        conn.execute(text("ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS expiry_date DATE"))
        conn.execute(text("ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS location VARCHAR(100)"))
        conn.execute(text("ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS sale_id INTEGER"))

        # Option B: per-batch pricing stored on stock movements (create_all won't add columns).
        conn.execute(text("ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_cost_price NUMERIC(10,2)"))
        conn.execute(text("ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_selling_price NUMERIC(10,2)"))

        # How items were sold (pack vs piece)
        conn.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_unit_type VARCHAR(10)"))
        conn.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS pack_quantity INTEGER"))
        conn.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2)"))
        conn.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS partial_payment_method VARCHAR(50)"))

        # Email verification was removed. Clean up old schema objects if present.
        # Safe/idempotent for existing databases.
        conn.execute(text("DROP TABLE IF EXISTS pending_signups CASCADE"))
        conn.execute(text("DROP TABLE IF EXISTS email_verification_tokens CASCADE"))
        conn.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS email_verified"))

        # Branch support (multi-branch / separate product lists per branch)
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER"))
        conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS branch_id INTEGER"))
        conn.execute(text("ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS branch_id INTEGER"))
        conn.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS branch_id INTEGER"))
        conn.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_sale_id VARCHAR(80)"))
        conn.execute(text("ALTER TABLE creditors ADD COLUMN IF NOT EXISTS branch_id INTEGER"))
        conn.execute(text("ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS branch_id INTEGER"))

        # Offline/poor-network idempotency for sales
        try:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_branch_client_sale_id_unique "
                    "ON sales (branch_id, client_sale_id) "
                    "WHERE client_sale_id IS NOT NULL"
                )
            )
        except Exception as e:
            print(f"⚠️  Could not create unique index for offline sales idempotency: {e}")

        # Performance indexes for high-traffic read paths.
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_product_user_created_at "
                "ON stock_movements (branch_id, product_id, user_id, created_at DESC)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_user_created_at "
                "ON stock_movements (branch_id, user_id, created_at DESC)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_sales_branch_user_created_at "
                "ON sales (branch_id, user_id, created_at DESC)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_products_branch_user_created_at "
                "ON products (branch_id, user_id, created_at DESC)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_credit_transactions_branch_creditor_created_at "
                "ON credit_transactions (branch_id, creditor_id, created_at DESC)"
            )
        )

        # Prevent duplicate product names within a branch (case-insensitive)
        try:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_products_branch_lower_name_unique "
                    "ON products (branch_id, lower(trim(name)))"
                )
            )
        except Exception as e:
            # If existing duplicates are present, creating the unique index will fail.
            # Don't block startup; the API also enforces this rule at write-time.
            print(f"⚠️  Could not create unique index for product names: {e}")

    # Use SQL for branch-scoped bulk backfills (idempotent).
    with engine.begin() as conn:
                # Employees without a branch_id get their owner's first active branch.
        conn.execute(
            text(
                """
                UPDATE users u
                                SET branch_id = (
                                        SELECT b.id
                                        FROM branches b
                                        WHERE b.owner_user_id = COALESCE(u.created_by, u.id)
                                            AND b.is_active IS TRUE
                                        ORDER BY b.created_at ASC, b.id ASC
                                        LIMIT 1
                                )
                WHERE u.role <> 'Admin'
                  AND u.branch_id IS NULL
                                    AND EXISTS (
                                        SELECT 1
                                        FROM branches b2
                                        WHERE b2.owner_user_id = COALESCE(u.created_by, u.id)
                                            AND b2.is_active IS TRUE
                                    )
                """
            )
        )

                # Products created before branches go to tenant's first active branch.
        conn.execute(
            text(
                """
                UPDATE products p
                                SET branch_id = (
                                        SELECT b.id
                                        FROM branches b
                                        WHERE b.owner_user_id = COALESCE(u.created_by, u.id)
                                            AND b.is_active IS TRUE
                                        ORDER BY b.created_at ASC, b.id ASC
                                        LIMIT 1
                                )
                                FROM users u
                WHERE p.branch_id IS NULL
                  AND p.user_id = u.id
                                    AND EXISTS (
                                        SELECT 1
                                        FROM branches b2
                                        WHERE b2.owner_user_id = COALESCE(u.created_by, u.id)
                                            AND b2.is_active IS TRUE
                                    )
                """
            )
        )

                # Stock movements inherit product/tenant first active branch.
        conn.execute(
            text(
                """
                UPDATE stock_movements m
                                SET branch_id = (
                                        SELECT b.id
                                        FROM branches b
                                        WHERE b.owner_user_id = COALESCE(u.created_by, u.id)
                                            AND b.is_active IS TRUE
                                        ORDER BY b.created_at ASC, b.id ASC
                                        LIMIT 1
                                )
                                FROM users u
                WHERE m.branch_id IS NULL
                  AND m.user_id = u.id
                                    AND EXISTS (
                                        SELECT 1
                                        FROM branches b2
                                        WHERE b2.owner_user_id = COALESCE(u.created_by, u.id)
                                            AND b2.is_active IS TRUE
                                    )
                """
            )
        )

                # Sales go to tenant's first active branch.
        conn.execute(
            text(
                """
                UPDATE sales s
                                SET branch_id = (
                                        SELECT b.id
                                        FROM branches b
                                        WHERE b.owner_user_id = COALESCE(u.created_by, u.id)
                                            AND b.is_active IS TRUE
                                        ORDER BY b.created_at ASC, b.id ASC
                                        LIMIT 1
                                )
                                FROM users u
                WHERE s.branch_id IS NULL
                  AND s.user_id = u.id
                                    AND EXISTS (
                                        SELECT 1
                                        FROM branches b2
                                        WHERE b2.owner_user_id = COALESCE(u.created_by, u.id)
                                            AND b2.is_active IS TRUE
                                    )
                """
            )
        )

        # Creditors and credit transactions are scoped to branch.
        conn.execute(
            text(
                """
                UPDATE creditors c
                                SET branch_id = (
                                        SELECT b.id
                                        FROM branches b
                                        WHERE b.owner_user_id = COALESCE(u.created_by, u.id)
                                            AND b.is_active IS TRUE
                                        ORDER BY b.created_at ASC, b.id ASC
                                        LIMIT 1
                                )
                                FROM users u
                WHERE c.branch_id IS NULL
                  AND c.user_id = u.id
                                    AND EXISTS (
                                        SELECT 1
                                        FROM branches b2
                                        WHERE b2.owner_user_id = COALESCE(u.created_by, u.id)
                                            AND b2.is_active IS TRUE
                                    )
                """
            )
        )

        conn.execute(
            text(
                """
                UPDATE credit_transactions ct
                                SET branch_id = (
                                        SELECT b.id
                                        FROM branches b
                                        WHERE b.owner_user_id = COALESCE(u.created_by, u.id)
                                            AND b.is_active IS TRUE
                                        ORDER BY b.created_at ASC, b.id ASC
                                        LIMIT 1
                                )
                                FROM users u
                WHERE ct.branch_id IS NULL
                  AND ct.user_id = u.id
                                    AND EXISTS (
                                        SELECT 1
                                        FROM branches b2
                                        WHERE b2.owner_user_id = COALESCE(u.created_by, u.id)
                                            AND b2.is_active IS TRUE
                                    )
                """
            )
        )

env_allowed_origins = os.getenv("ALLOWED_ORIGINS")
if env_allowed_origins:
    allowed_origins = [o.strip() for o in env_allowed_origins.split(",") if o.strip()]
else:
    allowed_origins = [
        "https://gel-invent.vercel.app",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
    ]

# FastAPI CORS does not support wildcard domains in allow_origins (e.g. https://*.vercel.app).
# Use allow_origin_regex to support Vercel preview deployment URLs.
allow_origin_regex = os.getenv("ALLOWED_ORIGIN_REGEX") or r"^https://gel-invent(-[a-z0-9-]+)?\.vercel\.app$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    """Schedule database migrations/backfills without blocking readiness."""
    print("🚀 Starting Gel Invent API...")
    print(f"Railway Environment: {os.getenv('RAILWAY_ENVIRONMENT', 'Not set')}")
    print(f"Database URL set: {'Yes' if os.getenv('DATABASE_URL') else 'No'}")

    # Always apply critical auth schema changes first to avoid request-time
    # failures when background/full migrations are disabled or still running.
    try:
        await asyncio.to_thread(_ensure_critical_auth_schema_sync)
        print("✅ Critical auth schema verified")
    except Exception as e:
        print(f"⚠️ Could not verify critical auth schema: {type(e).__name__}: {e}")

    if not _should_run_startup_migrations():
        print("ℹ️ Startup migrations skipped (RUN_STARTUP_MIGRATIONS disabled)")
        return

    async def _runner() -> None:
        global _startup_migrations_done, _startup_migrations_error
        try:
            await asyncio.to_thread(_run_startup_migrations_sync)
            _startup_migrations_done = True
            print("✅ Startup migrations completed")
        except Exception as e:
            _startup_migrations_error = f"{type(e).__name__}: {e}"
            print(f"⚠️ Startup migrations failed: {_startup_migrations_error}")

    # Schedule migrations/backfills without blocking app readiness.
    asyncio.create_task(_runner())
    print("✅ Application started (migrations running in background)")


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint - also serves as health check."""
    return {"message": "Gel Invent API", "status": "healthy"}


@app.get("/health/db")
async def health_db() -> JSONResponse:
    """Database connectivity check."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return JSONResponse(status_code=200, content={"status": "ok"})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"status": "error", "detail": str(exc)})


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Lightweight health probe endpoint."""
    return {
        "status": "healthy",
        "migrations_done": "true" if _startup_migrations_done else "false",
        "migrations_error": _startup_migrations_error or "",
    }


@app.get("/health/runtime")
async def health_runtime(
    current_user: models.User = Depends(get_current_active_user),
) -> dict[str, object]:
    """Admin-only runtime health/status snapshot for production diagnostics."""
    if current_user.role != "Admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin can access runtime health")

    db_ok = True
    db_error = ""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:
        db_ok = False
        db_error = f"{type(exc).__name__}: {exc}"

    return {
        "status": "ok" if db_ok else "degraded",
        "runtime": {
            "vercel": bool(os.getenv("VERCEL")),
            "railway_environment": os.getenv("RAILWAY_ENVIRONMENT", ""),
            "startup_migrations_enabled": _should_run_startup_migrations(),
            "startup_migrations_done": _startup_migrations_done,
            "startup_migrations_error": _startup_migrations_error or "",
        },
        "database": {
            "connectivity": "ok" if db_ok else "error",
            "error": db_error,
        },
    }


app.include_router(auth.router)
app.include_router(employees.router)
app.include_router(branches.router)
app.include_router(settings.router)
app.include_router(products.router)
app.include_router(sales.router)
app.include_router(returns.router)
app.include_router(inventory.router)
app.include_router(revenue.router)
app.include_router(creditors.router)
app.include_router(reports.router)
app.include_router(data.router)
