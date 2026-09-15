"""SQLAlchemy engine + session factory (Phase 0 — Scaffolding).

Phase 1+ domain models will import `Base` from here so Alembic (see
`backend/alembic/env.py`) picks up their metadata automatically.
"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
