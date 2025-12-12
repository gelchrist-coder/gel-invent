"""Initial schema for products and stock movements."""
from app.database import Base, engine


def main():
    """Create all tables defined in models."""
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("✓ Tables created successfully!")


if __name__ == "__main__":
    main()
