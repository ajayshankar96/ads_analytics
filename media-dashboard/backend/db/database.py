"""
Async Postgres setup for the RMN workflow tables.

Pattern follows razorpay/python-foundation (async SQLAlchemy 2.0 + Alembic),
adapted to media-dashboard:
  * plain DeclarativeBase (not MappedAsDataclass) to avoid dataclass field-order
    constraints — simpler and equally valid SQLAlchemy 2.0.
  * config read straight from env vars (no pydantic-settings dependency).

Connection is configured via env (set these in the pod / .env):
  POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_SERVER, POSTGRES_PORT, POSTGRES_DB
or a single DATABASE_URL (must use the asyncpg driver).
"""

import os
from collections.abc import AsyncGenerator
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

POSTGRES_USER = os.getenv("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "postgres")
POSTGRES_SERVER = os.getenv("POSTGRES_SERVER", "localhost")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")
POSTGRES_DB = os.getenv("POSTGRES_DB", "rmn")
POSTGRES_ASYNC_PREFIX = os.getenv("POSTGRES_ASYNC_PREFIX", "postgresql+asyncpg://")

DATABASE_URL = os.getenv("DATABASE_URL") or (
    f"{POSTGRES_ASYNC_PREFIX}{POSTGRES_USER}:{POSTGRES_PASSWORD}"
    f"@{POSTGRES_SERVER}:{POSTGRES_PORT}/{POSTGRES_DB}"
)

# The provisioned secret supplies a sync-style URL (postgresql://); the async
# engine requires the asyncpg driver, so normalize the scheme.
if DATABASE_URL.startswith("postgresql+asyncpg://"):
    pass
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+asyncpg://" + DATABASE_URL[len("postgresql://"):]
elif DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+asyncpg://" + DATABASE_URL[len("postgres://"):]


class Base(DeclarativeBase):
    pass


engine = create_async_engine(DATABASE_URL, echo=False, future=True, pool_pre_ping=True)
async_session = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — yields a session and closes it after the request."""
    async with async_session() as session:
        yield session


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
