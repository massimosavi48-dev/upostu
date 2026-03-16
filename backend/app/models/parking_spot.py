import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Float
from sqlalchemy.dialects.postgresql import UUID

from ..db.base import Base


class ParkingSpot(Base):
    __tablename__ = "parking_spots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    latitude = Column(Float, nullable=False)

    longitude = Column(Float, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)