import uuid

from sqlalchemy import Boolean, Column, Float, Integer, String

from ..db.base import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    # Public identifier used by the app/websocket.
    uid = Column(String, unique=True, index=True, nullable=False, default=lambda: str(uuid.uuid4()))

    name = Column(String, nullable=False)
    surname = Column(String, nullable=False)

    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    # Wallet balance (EUR); optional in-memory top-ups still merged in admin API.
    wallet = Column(Float, nullable=False, default=0.0)