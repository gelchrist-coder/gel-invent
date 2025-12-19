import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import Base, engine
from .routers import products, sales, inventory, revenue, creditors, reports, auth, employees, branches, data, settings
from . import models

app = FastAPI(title="Gel Invent API", version="0.1.0")

# Allow all origins in production (Railway), specific origins in development
allowed_origins = [
    "https://gel-invent.vercel.app",
    "https://*.vercel.app",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5174",
    "http://localhost:5174",
] if not os.getenv("RAILWAY_ENVIRONMENT") else ["*"]

# When using allow_origins=["*"], cannot use allow_credentials=True
allow_credentials = False if os.getenv("RAILWAY_ENVIRONMENT") else True

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    """Create database tables on startup (safe for Railway)."""
    print("🚀 Starting Gel Invent API...")
    print(f"Railway Environment: {os.getenv('RAILWAY_ENVIRONMENT', 'Not set')}")
    print(f"Database URL set: {'Yes' if os.getenv('DATABASE_URL') else 'No'}")
    
    try:
        print("Creating/verifying database tables...")
        Base.metadata.create_all(bind=engine)
        print("✅ Database tables created/verified successfully")

        # Lightweight schema patch for existing DBs (create_all won't add columns).
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS categories TEXT"))

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

        # Backfill branch IDs for existing rows into each tenant's Main Branch.
        with Session(engine) as db:
            admin_users = db.query(models.User).filter(models.User.role == "Admin").all()
            for admin in admin_users:
                main_branch = (
                    db.query(models.Branch)
                    .filter(
                        models.Branch.owner_user_id == admin.id,
                        models.Branch.name == "Main Branch",
                    )
                    .first()
                )
                if not main_branch:
                    main_branch = models.Branch(owner_user_id=admin.id, name="Main Branch", is_active=True)
                    db.add(main_branch)
                    db.flush()

            db.commit()

        # Use SQL for bulk backfills (idempotent).
        with engine.begin() as conn:
            # Employees without a branch_id get their admin's Main Branch.
            conn.execute(
                text(
                    """
                    UPDATE users u
                    SET branch_id = b.id
                    FROM branches b
                    WHERE u.role <> 'Admin'
                      AND u.branch_id IS NULL
                      AND b.owner_user_id = COALESCE(u.created_by, u.id)
                      AND b.name = 'Main Branch'
                    """
                )
            )

            # Products created before branches go to tenant Main Branch.
            conn.execute(
                text(
                    """
                    UPDATE products p
                    SET branch_id = b.id
                    FROM users u
                    JOIN branches b
                      ON b.owner_user_id = COALESCE(u.created_by, u.id)
                     AND b.name = 'Main Branch'
                    WHERE p.branch_id IS NULL
                      AND p.user_id = u.id
                    """
                )
            )

            # Stock movements inherit product/tenant Main Branch.
            conn.execute(
                text(
                    """
                    UPDATE stock_movements m
                    SET branch_id = b.id
                    FROM users u
                    JOIN branches b
                      ON b.owner_user_id = COALESCE(u.created_by, u.id)
                     AND b.name = 'Main Branch'
                    WHERE m.branch_id IS NULL
                      AND m.user_id = u.id
                    """
                )
            )

            # Sales go to tenant Main Branch.
            conn.execute(
                text(
                    """
                    UPDATE sales s
                    SET branch_id = b.id
                    FROM users u
                    JOIN branches b
                      ON b.owner_user_id = COALESCE(u.created_by, u.id)
                     AND b.name = 'Main Branch'
                    WHERE s.branch_id IS NULL
                      AND s.user_id = u.id
                    """
                )
            )

            # Creditors and credit transactions are scoped to branch.
            conn.execute(
                text(
                    """
                    UPDATE creditors c
                    SET branch_id = b.id
                    FROM users u
                    JOIN branches b
                      ON b.owner_user_id = COALESCE(u.created_by, u.id)
                     AND b.name = 'Main Branch'
                    WHERE c.branch_id IS NULL
                      AND c.user_id = u.id
                    """
                )
            )

            conn.execute(
                text(
                    """
                    UPDATE credit_transactions ct
                    SET branch_id = b.id
                    FROM users u
                    JOIN branches b
                      ON b.owner_user_id = COALESCE(u.created_by, u.id)
                     AND b.name = 'Main Branch'
                    WHERE ct.branch_id IS NULL
                      AND ct.user_id = u.id
                    """
                )
            )
    except Exception as e:
        print(f"⚠️ Warning: Could not create tables: {e}")
        print(f"Error details: {type(e).__name__}: {str(e)}")
        # Don't crash - tables might already exist or will be created later
    
    print("✅ Application started and ready to accept requests!")


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint - also serves as health check."""
    return {"message": "Gel Invent API", "status": "healthy"}


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Lightweight health probe endpoint."""
    return {"status": "healthy"}


app.include_router(auth.router)
app.include_router(employees.router)
app.include_router(branches.router)
app.include_router(settings.router)
app.include_router(products.router)
app.include_router(sales.router)
app.include_router(inventory.router)
app.include_router(revenue.router)
app.include_router(creditors.router)
app.include_router(reports.router)
app.include_router(data.router)
