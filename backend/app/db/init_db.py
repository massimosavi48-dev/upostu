import asyncio

from .. import models  # noqa: F401
from .base import Base
from .session import engine
from sqlalchemy import text


async def _column_exists(conn, table_name: str, column_name: str) -> bool:
    res = await conn.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = :table_name AND column_name = :column_name
            """
        ),
        {"table_name": table_name, "column_name": column_name},
    )
    return res.first() is not None


async def _bootstrap_missing_columns() -> None:
    async with engine.begin() as conn:
        # ---- users(uid, name, surname) ----
        if not await _column_exists(conn, "users", "uid"):
            await conn.execute(text("ALTER TABLE users ADD COLUMN uid VARCHAR;"))

        if not await _column_exists(conn, "users", "name"):
            await conn.execute(text("ALTER TABLE users ADD COLUMN name VARCHAR;"))

        if not await _column_exists(conn, "users", "surname"):
            await conn.execute(text("ALTER TABLE users ADD COLUMN surname VARCHAR;"))

        # Populate uid if missing/empty.
        if await _column_exists(conn, "users", "uid"):
            rows = await conn.execute(
                text("SELECT id FROM users WHERE uid IS NULL OR uid = ''")
            )
            ids = [r[0] for r in rows.fetchall()]
            if ids:
                import uuid

                for _id in ids:
                    await conn.execute(
                        text("UPDATE users SET uid = :uid WHERE id = :id"),
                        {"uid": str(uuid.uuid4()), "id": int(_id)},
                    )

        # ---- parking_spots(created_by_uid, city_id, spot_size) ----
        if not await _column_exists(conn, "parking_spots", "created_by_uid"):
            await conn.execute(text("ALTER TABLE parking_spots ADD COLUMN created_by_uid VARCHAR;"))
        if not await _column_exists(conn, "parking_spots", "city_id"):
            await conn.execute(text("ALTER TABLE parking_spots ADD COLUMN city_id INTEGER;"))
        if not await _column_exists(conn, "parking_spots", "spot_size"):
            await conn.execute(text("ALTER TABLE parking_spots ADD COLUMN spot_size VARCHAR;"))

        # ---- users.wallet ----
        if not await _column_exists(conn, "users", "wallet"):
            await conn.execute(
                text("ALTER TABLE users ADD COLUMN wallet DOUBLE PRECISION NOT NULL DEFAULT 0;")
            )

        # ---- cars.plate ----
        if not await _column_exists(conn, "cars", "plate"):
            await conn.execute(text("ALTER TABLE cars ADD COLUMN plate VARCHAR;"))

        # ---- parking_spots.status ----
        if not await _column_exists(conn, "parking_spots", "status"):
            await conn.execute(
                text(
                    "ALTER TABLE parking_spots ADD COLUMN status VARCHAR NOT NULL DEFAULT 'active';"
                )
            )


async def init_db() -> None:
    print("Tables registered:", Base.metadata.tables.keys())

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # If you previously ran an older schema without migrations, ensure
    # the minimum columns exist so the new MVP models can boot.
    await _bootstrap_missing_columns()


if __name__ == "__main__":
    asyncio.run(init_db())
