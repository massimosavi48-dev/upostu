from collections.abc import Sequence
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.parking_spot import ParkingSpot
from ..schemas.parking import ParkingSpotCreate

from fastapi import WebSocket, WebSocketDisconnect


async def create_parking_spot(
    db: AsyncSession,
    payload: ParkingSpotCreate,
) -> ParkingSpot:

    spot = ParkingSpot(
        latitude=payload.latitude,
        longitude=payload.longitude,
        created_at=datetime.utcnow(),
        created_by_uid=payload.created_by_uid,
        city_id=payload.city_id,
        spot_size=payload.spot_size,
    )

    db.add(spot)

    await db.commit()

    await db.refresh(spot)

    return spot


async def list_parking_spots(db: AsyncSession) -> Sequence[ParkingSpot]:

    # Mostra solo parcheggi degli ultimi 5 minuti
    expiration_time = datetime.utcnow() - timedelta(minutes=5)

    result = await db.execute(
        select(ParkingSpot).where(
            ParkingSpot.created_at >= expiration_time
        )
    )

    return result.scalars().all()


class ConnectionManager:

    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict) -> None:
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except WebSocketDisconnect:
                self.disconnect(connection)


manager = ConnectionManager()