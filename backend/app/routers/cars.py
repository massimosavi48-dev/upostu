from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..db.session import get_db
from ..models.car import Car
from ..schemas import CarCreate, CarResponse
from .auth import get_bearer_token, verify_access_token


router = APIRouter(prefix="/cars", tags=["cars"])


async def require_current_uid(authorization: str | None = Header(default=None)) -> str:
    token = get_bearer_token(authorization)
    return verify_access_token(token)


@router.get("", response_model=list[CarResponse])
async def list_cars(db: AsyncSession = Depends(get_db), uid: str = Depends(require_current_uid)) -> list[CarResponse]:
    res = await db.execute(select(Car).where(Car.user_uid == uid).order_by(Car.id.desc()))
    cars = res.scalars().all()
    return cars


@router.post("", response_model=CarResponse)
async def create_car(
    payload: CarCreate,
    db: AsyncSession = Depends(get_db),
    uid: str = Depends(require_current_uid),
) -> CarResponse:
    allowed = {"small", "medium", "large"}
    if payload.size not in allowed:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid car size")

    car = Car(user_uid=uid, brand=payload.brand, model=payload.model, size=payload.size)
    db.add(car)
    await db.commit()
    await db.refresh(car)
    return car

