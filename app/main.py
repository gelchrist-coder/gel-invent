import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine
from .routers import products, sales, inventory, revenue, creditors, reports, auth, employees

app = FastAPI(title="Gel Invent API", version="0.1.0")

# Allow all origins in production (Railway), specific origins in development
allowed_origins = ["*"] if os.getenv("RAILWAY_ENVIRONMENT") else [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5174",
    "http://localhost:5174",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health_check() -> dict[str, str]:
    """Lightweight health probe endpoint."""
    return {"status": "ok"}


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Gel Invent API"}


app.include_router(auth.router)
app.include_router(employees.router)
app.include_router(products.router)
app.include_router(sales.router)
app.include_router(inventory.router)
app.include_router(revenue.router)
app.include_router(creditors.router)
app.include_router(reports.router)
