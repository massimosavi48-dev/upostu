from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.session import get_db
from ..models.parking_spot import ParkingSpot
from ..schemas import ParkingSpotCreate, ParkingSpotResponse
from ..services import parking_service


router = APIRouter(prefix="/parking", tags=["parking"])


@router.get("", response_model=list[ParkingSpotResponse])
async def get_parking_spots(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ParkingSpot))
    spots = result.scalars().all()
    return spots


@router.get("/nearby", response_model=list[ParkingSpotResponse])
async def get_nearby_parking(
    lat: float,
    lng: float,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ParkingSpot).where(
            ParkingSpot.latitude.between(lat - 0.01, lat + 0.01),
            ParkingSpot.longitude.between(lng - 0.01, lng + 0.01),
        )
    )
    spots = result.scalars().all()
    return spots


@router.post(
    "",
    response_model=ParkingSpotResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_parking(
    payload: ParkingSpotCreate,
    db: AsyncSession = Depends(get_db),
):

    spot = await parking_service.create_parking_spot(db, payload)

    # 🔴 REALTIME BROADCAST
    await parking_service.manager.broadcast(
        {
            "event": "parking_spot_created",
            "data": {
                "id": str(spot.id),
                "latitude": spot.latitude,
                "longitude": spot.longitude,
                "created_at": spot.created_at.isoformat(),
            },
        }
    )

    return spot


@router.post("/leave")
async def leave_parking(
    lat: float,
    lng: float,
):
    await parking_service.manager.broadcast(
        {
            "event": "parking_spot_left",
            "data": {
                "lat": lat,
                "lng": lng,
            },
        }
    )

    return {
        "message": "Parking spot left",
        "lat": lat,
        "lng": lng,
    }