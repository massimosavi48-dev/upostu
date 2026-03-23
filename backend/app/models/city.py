from sqlalchemy import Column, Float, Integer, String, Boolean

from ..db.base import Base


class City(Base):
    __tablename__ = "cities"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)

    center_lat = Column(Float, nullable=False)
    center_lng = Column(Float, nullable=False)
    radius_m = Column(Float, nullable=False)

    is_active = Column(Boolean, default=True, nullable=False)

