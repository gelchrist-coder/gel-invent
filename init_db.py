"""
Initialize Railway PostgreSQL database with schema
Run this once after deployment to create tables
"""
import os
from app.database import engine, Base
from app.models import User, Product, StockMovement, Sale, Creditor, CreditTransaction

def init_db():
    """Create all database tables"""
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("✅ Database tables created successfully!")

if __name__ == "__main__":
    init_db()
