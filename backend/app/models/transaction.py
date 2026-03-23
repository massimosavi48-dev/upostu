from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, String

from ..db.base import Base


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    amount = Column(Float, nullable=False, default=0.0)
    type = Column(String, nullable=False)  # earn | spend
    platform_fee = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
