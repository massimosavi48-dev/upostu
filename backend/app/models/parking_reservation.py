from sqlalchemy import Column, Integer, ForeignKey, DateTime, Text
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base


class ParkingReservation(Base):

    __tablename__ = "parking_reservations"

    id = Column(Integer, primary_key=True, index=True)

    spot_id = Column(UUID, ForeignKey("parking_spots.id"))

    user_id = Column(Integer, ForeignKey("users.id"))

    reserved_at = Column(DateTime(timezone=True), server_default=func.now())

    status = Column(Text, default="reserved")