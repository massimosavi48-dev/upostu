import uuid

from sqlalchemy import Column, Integer, String

from ..db.base import Base


class Car(Base):
    __tablename__ = "cars"

    id = Column(Integer, primary_key=True, index=True)

    # Store the user's public uid. We intentionally do NOT enforce a foreign key
    # here to keep MVP bootstrapping simple without migrations.
    user_uid = Column(String, nullable=False, index=True)
    brand = Column(String, nullable=False)
    model = Column(String, nullable=False)
    # License plate (optional; fallback to "brand model" in APIs if empty)
    plate = Column(String, nullable=True)

    # small / medium / large
    size = Column(String, nullable=False)
