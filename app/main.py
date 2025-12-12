import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine
from .routers import products, sales, inventory, revenue, creditors, reports, auth, employees

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
    except Exception as e:
        print(f"⚠️ Warning: Could not create tables: {e}")
        # Don't crash - tables might already exist
    
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
app.include_router(products.router)
app.include_router(sales.router)
app.include_router(inventory.router)
app.include_router(revenue.router)
app.include_router(creditors.router)
app.include_router(reports.router)
