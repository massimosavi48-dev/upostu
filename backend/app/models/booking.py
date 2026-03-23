from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, String

from ..db.base import Base


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    spot_id = Column(String, nullable=False, index=True)
    start_time = Column(DateTime, nullable=False, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    price = Column(Float, nullable=False, default=0.0)
    status = Column(String, nullable=False, default="active")
