"""Admin JSON API: users, cars, bookings, stats, transactions."""

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.session import get_db
from ..models.booking import Booking
from ..models.car import Car
from ..models.parking_spot import ParkingSpot
from ..models.transaction import Transaction
from ..models.user import User

router = APIRouter(prefix="/admin", tags=["admin-dashboard"])


def _car_label(c: Car) -> str:
    if c.plate and str(c.plate).strip():
        return str(c.plate).strip()
    return f"{c.brand} {c.model}".strip()


@router.get("/users-full")
async def admin_users_full(db: AsyncSession = Depends(get_db)) -> list[dict]:
    users = (await db.execute(select(User))).scalars().all()
    cars = (await db.execute(select(Car))).scalars().all()
    plates_by_uid: dict[str, list[str]] = defaultdict(list)
    for c in cars:
        plates_by_uid[c.user_uid].append(_car_label(c))

    out: list[dict] = []
    for u in users:
        db_w = float(u.wallet) if u.wallet is not None else 0.0
        out.append(
            {
                "id": u.id,
                "uid": u.uid,
                "email": u.email,
                "wallet": round(db_w, 2),
                "cars": plates_by_uid.get(u.uid, []),
            }
        )
    return out


@router.get("/user/{user_id}")
async def admin_user_detail(user_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="User not found")

    cars = (
        await db.execute(select(Car).where(Car.user_uid == u.uid).order_by(Car.id.desc()))
    ).scalars().all()
    tx_rows = (
        await db.execute(
            select(Transaction)
            .where(Transaction.user_id == u.uid)
            .order_by(Transaction.id.desc())
            .limit(200)
        )
    ).scalars().all()
    booking_rows = (
        await db.execute(
            select(Booking)
            .where(Booking.user_id == u.uid)
            .order_by(Booking.id.desc())
            .limit(100)
        )
    ).scalars().all()

    return {
        "user": {
            "id": u.id,
            "uid": u.uid,
            "email": u.email,
            "name": u.name,
            "surname": u.surname,
            "wallet": round(float(u.wallet or 0), 2),
        },
        "cars": [
            {
                "id": c.id,
                "plate": _car_label(c),
                "brand": c.brand,
                "model": c.model,
                "user_id": c.user_uid,
            }
            for c in cars
        ],
        "transactions": [
            {
                "id": t.id,
                "user_id": t.user_id,
                "amount": t.amount,
                "type": t.type,
                "platform_fee": t.platform_fee,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in tx_rows
        ],
        "bookings": [
            {
                "id": b.id,
                "user_id": b.user_id,
                "spot_id": b.spot_id,
                "start_time": b.start_time.isoformat() if b.start_time else None,
                "end_time": b.end_time.isoformat() if b.end_time else None,
                "price": b.price,
                "status": b.status,
            }
            for b in booking_rows
        ],
    }


@router.get("/cars")
async def admin_cars(db: AsyncSession = Depends(get_db)) -> list[dict]:
    cars = (await db.execute(select(Car))).scalars().all()
    return [
        {
            "id": c.id,
            "plate": c.plate or _car_label(c),
            "user_id": c.user_uid,
            "brand": c.brand,
            "model": c.model,
            "size": c.size,
        }
        for c in cars
    ]


@router.get("/bookings")
async def admin_bookings(db: AsyncSession = Depends(get_db)) -> list[dict]:
    rows = (
        await db.execute(select(Booking).order_by(Booking.id.desc()))
    ).scalars().all()
    return [
        {
            "id": b.id,
            "user_id": b.user_id,
            "spot_id": b.spot_id,
            "start_time": b.start_time.isoformat() if b.start_time else None,
            "end_time": b.end_time.isoformat() if b.end_time else None,
            "price": b.price,
            "status": b.status,
        }
        for b in rows
    ]


@router.get("/stats")
async def admin_stats(db: AsyncSession = Depends(get_db)) -> dict:
    nu = await db.scalar(select(func.count()).select_from(User))
    ns = await db.scalar(select(func.count()).select_from(ParkingSpot))
    nb = await db.scalar(select(func.count()).select_from(Booking))
    return {
        "total_users": int(nu or 0),
        "total_spots": int(ns or 0),
        "total_bookings": int(nb or 0),
    }


@router.get("/transactions")
async def admin_transactions(db: AsyncSession = Depends(get_db)) -> list[dict]:
    rows = (
        await db.execute(
            select(Transaction).order_by(Transaction.id.desc()).limit(500)
        )
    ).scalars().all()
    return [
        {
            "id": t.id,
            "user_id": t.user_id,
            "amount": t.amount,
            "type": t.type,
            "platform_fee": t.platform_fee,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in rows
    ]
