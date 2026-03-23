from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ParkingSpotCreate(BaseModel):
    latitude: float
    longitude: float
    created_by_uid: str
    city_id: int | None = None
    spot_size: str


class ParkingSpotResponse(BaseModel):
    id: UUID
    latitude: float
    longitude: float
    created_at: datetime

    class Config:
        from_attributes = True