from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..db.session import get_db
from ..models.city import City
from ..schemas import CityResponse


router = APIRouter(prefix="/cities", tags=["cities"])


@router.get("", response_model=list[CityResponse])
async def list_cities(db: AsyncSession = Depends(get_db)) -> list[CityResponse]:
    res = await db.execute(select(City).where(City.is_active.is_(True)).order_by(City.name.asc()))
    return res.scalars().all()

