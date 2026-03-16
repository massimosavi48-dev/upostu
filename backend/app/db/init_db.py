import asyncio

from .. import models  # noqa: F401
from .base import Base
from .session import engine


async def init_db() -> None:
    print("Tables registered:", Base.metadata.tables.keys())

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


if __name__ == "__main__":
    asyncio.run(init_db())
