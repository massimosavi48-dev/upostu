from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ParkingSpotCreate(BaseModel):
    latitude: float
    longitude: float


class ParkingSpotResponse(BaseModel):
    id: UUID
    latitude: float
    longitude: float
    created_at: datetime

    class Config:
        from_attributes = True