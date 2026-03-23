import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Float, String, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from ..db.base import Base


class ParkingSpot(Base):
    __tablename__ = "parking_spots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    latitude = Column(Float, nullable=False)

    longitude = Column(Float, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Owner (public uid coming from frontend login).
    created_by_uid = Column(String, nullable=False, index=True)

    # City zone the spot belongs to.
    city_id = Column(Integer, ForeignKey("cities.id"), nullable=True, index=True)

    # Normalized category: "small" or "large"
    spot_size = Column(String, nullable=False)

    status = Column(String, nullable=False, default="active")