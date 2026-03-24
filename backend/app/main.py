from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import logging
import json
import asyncio
import time
import os
from datetime import datetime
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
try:
    import stripe
except ImportError:  # pragma: no cover
    stripe = None

from . import models  # noqa: F401

from .db.init_db import init_db
from .db.session import AsyncSessionLocal, get_db
from .models.parking_spot import ParkingSpot
from .models.car import Car
from .models.city import City
from .models.user import User
from .models.booking import Booking
from .models.transaction import Transaction
from .routers.auth import get_bearer_token, verify_access_token, hash_password
from .routers import auth
from .routers import parking
from .routers import gps
from .routers import cars
from .routers import cities
from .routers import ai
from .routers import notifications
from .routers import admin_dashboard
from .schemas import UserLoginRequest, UserRegisterRequest

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("upostu.ws")
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
ASSETS_DIR = os.path.join(BASE_DIR, "frontend", "pwa", "public", "assets")

# MVP admin identification: a fixed websocket `userId` marks the connection as admin.
# This is temporary but validated server-side.
ADMIN_ID = "massimo_admin_001"

# Global set of connected clients
connected_clients = set()
connected_spot_clients = set()

# Per-connection known websocket userId (set when the client sends update_position/new_spot/etc).
# Used to server-side validate which reserved spots each client should receive.
client_user_ids: dict = {}

# Active spots created by users leaving a parking space.
# Each spot:
# { "userId": str, "lat": float, "lng": float, "timestamp": int(ms), "claimedBy": Optional[str], "spotSize": "small"|"large", "cityId": Optional[int] }
active_spots: list[dict] = []
active_spots_lock = asyncio.Lock()
SPOT_TTL_SECONDS = 120  # 2 minutes

#
# Active users seen via WebSocket updates.
# Each user:
# { "userId": str, "lat": float, "lng": float, "status": str, "timestamp": int(ms) }
#
active_users: dict[str, dict] = {}
active_users_lock = asyncio.Lock()
USER_TTL_SECONDS = 5  # matches the admin client "active within last 5s"

# Wallet rewards / unlock pricing
UNLOCK_PRICE_EUR = Decimal("0.50")
SHARE_REWARD_EUR = Decimal("0.20")
PLATFORM_FEE = Decimal("0.20")

# Per-user unlocked spot state (in-memory)
unlocked_spots: dict[str, set[str]] = {}  # userId -> set(spotUserId)
unlocked_spots_lock = asyncio.Lock()

# Stripe webhook de-duplication (in-memory)
processed_stripe_event_ids: set[str] = set()
processed_stripe_event_ids_lock = asyncio.Lock()


def _prune_spots(now_ms: int) -> None:
    cutoff_ms = now_ms - (SPOT_TTL_SECONDS * 1000)
    global active_spots
    active_spots = [s for s in active_spots if int(s.get("timestamp", 0)) >= cutoff_ms]

def _prune_users(now_ms: int) -> None:
    cutoff_ms = now_ms - (USER_TTL_SECONDS * 1000)
    global active_users
    active_users = {
        user_id: u
        for user_id, u in active_users.items()
        if int(u.get("timestamp", 0)) >= cutoff_ms
    }

async def _user_by_uid(db: AsyncSession, user_uid: str) -> User | None:
    uid = str(user_uid or "").strip()
    if not uid:
        return None
    res = await db.execute(select(User).where(User.uid == uid))
    return res.scalars().first()


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    # Haversine distance in meters.
    import math

    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


async def _find_city_id_for_coords(db, lat: float, lng: float) -> int | None:
    # Small dataset (predefined MVP cities). Brute force is OK.
    res = await db.execute(select(City).where(City.is_active.is_(True)))
    cities_list = res.scalars().all()
    for c in cities_list:
        if _haversine_m(lat, lng, c.center_lat, c.center_lng) <= float(c.radius_m):
            return int(c.id)
    return None


async def _broadcast(payload: dict) -> None:
    dead_clients = set()
    payload_type = payload.get("type")

    # For spots we need per-client filtering.
    if payload_type == "spots" and isinstance(payload.get("spots"), list):
        spots = payload.get("spots") or []

        def filter_spots_for_user(user_id: str | None):
            # When userId is unknown (admin.js may not send updates),
            # only send unreserved spots to minimize information leakage.
            if not user_id:
                return [s for s in spots if s.get("claimedBy") is None]

            user_id = str(user_id)
            is_admin = user_id == ADMIN_ID
            if is_admin:
                return list(spots)

            filtered = []
            for s in spots:
                claimed_by = s.get("claimedBy")
                # Unreserved spot -> always visible.
                if claimed_by is None:
                    filtered.append(s)
                    continue

                # Reserved spot -> visible only to the spot owner or the buyer.
                if str(s.get("userId")) == user_id or str(claimed_by) == user_id:
                    filtered.append(s)
            return filtered

        for client in connected_clients:
            try:
                user_id = client_user_ids.get(client)
                client_payload = {"type": "spots", "spots": filter_spots_for_user(user_id)}
                await client.send_text(json.dumps(client_payload))
            except Exception as e:
                dead_clients.add(client)
                logger.warning(f"Failed to send to client {id(client)}: {e}")

        connected_clients.difference_update(dead_clients)
        return

    # Default: broadcast as-is.
    data = json.dumps(payload)
    for client in connected_clients:
        try:
            await client.send_text(data)
        except Exception as e:
            dead_clients.add(client)
            logger.warning(f"Failed to send to client {id(client)}: {e}")
    connected_clients.difference_update(dead_clients)


async def broadcast_spots(spots: list[dict]) -> None:
    dead_clients = set()
    for client in connected_spot_clients:
        try:
            await client.send_json(spots)
        except Exception:
            dead_clients.add(client)
    connected_spot_clients.difference_update(dead_clients)


# Admin dashboard real-time (transactions, bookings).
admin_ws_connections: list[WebSocket] = []
admin_ws_connections_lock = asyncio.Lock()


async def broadcast_to_admin(message: dict) -> None:
    """Push JSON to all /ws/admin clients; drop broken connections."""
    async with admin_ws_connections_lock:
        conns = list(admin_ws_connections)
    if not conns:
        return
    dead: list[WebSocket] = []
    for conn in conns:
        try:
            await conn.send_json(message)
        except Exception:
            dead.append(conn)
    if dead:
        async with admin_ws_connections_lock:
            for c in dead:
                try:
                    admin_ws_connections.remove(c)
                except ValueError:
                    pass


def create_app() -> FastAPI:
    app = FastAPI(
        title="UPOSTU",
        version="0.1.0",
        description="UPOSTU parking sharing backend",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
    app.include_router(gps.router, prefix="/api/gps", tags=["gps"])
    app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
    app.include_router(
        notifications.router,
        prefix="/api/notifications",
        tags=["notifications"],
    )
    app.include_router(cars.router, prefix="/api", tags=["cars"])
    app.include_router(cities.router, prefix="/api", tags=["cities"])
    # Keep existing parking router (e.g. /parking) intact.
    app.include_router(parking.router)
    app.include_router(admin_dashboard.router)

    # ========================
    # REALTIME WEBSOCKET BROADCAST
    # ========================

    async def _spots_websocket_handler(ws: WebSocket):
        await ws.accept()
        connected_spot_clients.add(ws)
        try:
            now_ms = int(time.time() * 1000)
            async with active_spots_lock:
                _prune_spots(now_ms)
                await ws.send_json(list(active_spots))
            while True:
                await ws.receive_text()
        except Exception:
            pass
        finally:
            connected_spot_clients.discard(ws)

    @app.websocket("/ws/spots")
    async def spots_websocket(ws: WebSocket):
        await _spots_websocket_handler(ws)

    @app.websocket("/api/ws/spots")
    async def spots_websocket_api(ws: WebSocket):
        await _spots_websocket_handler(ws)

    async def _admin_dashboard_websocket_handler(ws: WebSocket):
        await ws.accept()
        async with admin_ws_connections_lock:
            admin_ws_connections.append(ws)
        try:
            while True:
                await ws.receive_text()
        except Exception:
            pass
        finally:
            async with admin_ws_connections_lock:
                try:
                    admin_ws_connections.remove(ws)
                except ValueError:
                    pass

    @app.websocket("/ws/admin")
    async def admin_dashboard_websocket(ws: WebSocket):
        await _admin_dashboard_websocket_handler(ws)

    @app.websocket("/api/ws/admin")
    async def admin_dashboard_websocket_api(ws: WebSocket):
        await _admin_dashboard_websocket_handler(ws)

    async def _client_websocket_handler(websocket: WebSocket):
        await websocket.accept()
        connected_clients.add(websocket)
        # Unknown user until the client sends its first "update_position"/"new_spot"/etc.
        client_user_ids[websocket] = None
        logger.info(f"🔌 WebSocket connected: {id(websocket)} ({len(connected_clients)} clients)")

        # Send current active users/spots immediately on connect.
        try:
            now_ms = int(time.time() * 1000)
            async with active_users_lock:
                _prune_users(now_ms)
                users_payload = list(active_users.values())
            async with active_spots_lock:
                _prune_spots(now_ms)
                spots_payload = list(active_spots)

            await websocket.send_text(json.dumps({"type": "users", "users": users_payload}))
            # Server-side privacy: before we know the user's userId, only send unreserved spots.
            unreserved_spots = [s for s in spots_payload if s.get("claimedBy") is None]
            await websocket.send_text(json.dumps({"type": "spots", "spots": unreserved_spots}))
        except Exception:
            pass

        try:
            while True:
                raw = await websocket.receive_text()
                logger.info(f"📩 Received data: {raw}")

                # Try to parse JSON so we can handle parking spot flows.
                try:
                    msg = json.loads(raw)
                except Exception:
                    msg = None

                # ==========================
                # USER POSITION UPDATE
                # ==========================
                if isinstance(msg, dict) and msg.get("type") in ("update_position", "update"):
                    user_id = str(msg.get("userId") or "")
                    lat = msg.get("lat")
                    lng = msg.get("lng")
                    status = msg.get("status") or "searching"
                    if user_id and isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
                        now_ms = int(time.time() * 1000)
                        client_user_ids[websocket] = str(user_id)
                        is_admin = str(user_id) == str(ADMIN_ID)
                        async with active_users_lock:
                            active_users[str(user_id)] = {
                                "userId": str(user_id),
                                "lat": float(lat),
                                "lng": float(lng),
                                "status": str(status),
                                "isAdmin": bool(is_admin),
                                "timestamp": now_ms,
                            }
                            _prune_users(now_ms)
                        # Broadcast normalized event so existing clients keep working.
                        await _broadcast(
                            {
                                "type": "update",
                                "userId": str(user_id),
                                "lat": float(lat),
                                "lng": float(lng),
                                "status": str(status),
                                "isAdmin": bool(is_admin),
                                "timestamp": now_ms,
                            }
                        )
                    continue

                # ==========================
                # NEW SPOT (USER LEAVES)
                # ==========================
                if isinstance(msg, dict) and msg.get("type") in ("new_spot", "leave"):
                    user_id = str(msg.get("userId") or "")
                    lat = msg.get("lat")
                    lng = msg.get("lng")
                    spot_size_raw = msg.get("spotSize") or "large"
                    if user_id and isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
                        client_user_ids[websocket] = str(user_id)
                        # Normalize car/spot size to MVP buckets.
                        spot_size = "small" if str(spot_size_raw) == "small" else "large"

                        # City-zone enforcement: ignore spots outside active cities.
                        async with AsyncSessionLocal() as db:
                            city_id = await _find_city_id_for_coords(db, float(lat), float(lng))
                        if city_id is None:
                            continue

                        now_ms = int(time.time() * 1000)
                        already_had_active_spot = False
                        async with active_spots_lock:
                            already_had_active_spot = any(
                                str(s.get("userId")) == user_id for s in active_spots
                            )
                            _prune_spots(now_ms)
                            # Replace existing spot for same userId (latest wins).
                            active_spots[:] = [s for s in active_spots if str(s.get("userId")) != user_id]
                            active_spots.append(
                                {
                                    "userId": user_id,
                                    "lat": float(lat),
                                    "lng": float(lng),
                                    "timestamp": now_ms,
                                    "claimedBy": None,
                                    "spotSize": spot_size,
                                    "cityId": city_id,
                                }
                            )
                            await _broadcast({"type": "spots", "spots": active_spots})
                            await broadcast_spots(active_spots)

                        # Wallet reward when sharing a spot (first active spot for that user).
                        if not already_had_active_spot:
                            try:
                                async with AsyncSessionLocal() as db:
                                    u = await _user_by_uid(db, user_id)
                                    if u is not None:
                                        amt = float(
                                            SHARE_REWARD_EUR.quantize(
                                                Decimal("0.01"), rounding=ROUND_HALF_UP
                                            )
                                        )
                                        u.wallet = round(float(u.wallet or 0) + amt, 2)
                                        db.add(
                                            Transaction(
                                                user_id=u.uid,
                                                amount=amt,
                                                type="earn",
                                                platform_fee=0.0,
                                            )
                                        )
                                        await db.commit()
                                        await broadcast_to_admin(
                                            {
                                                "type": "transaction",
                                                "user_id": u.uid,
                                                "amount": amt,
                                                "platform_fee": 0.0,
                                            }
                                        )
                            except Exception as e:
                                logger.warning("Wallet reward failed for %s: %s", user_id, e)
                    continue

                if isinstance(msg, dict) and msg.get("type") == "claim":
                    spot_user_id = str(msg.get("spotUserId") or "")
                    claimed_by = str(msg.get("userId") or "")
                    if spot_user_id and claimed_by:
                        client_user_ids[websocket] = str(claimed_by)
                        # Security: a user can only claim (unlock exact location) after
                        # successful Stripe payment / server-side unlock confirmation.
                        async with unlocked_spots_lock:
                            unlocked_for_spot = spot_user_id in unlocked_spots.get(claimed_by, set())
                        if not unlocked_for_spot:
                            continue

                        now_ms = int(time.time() * 1000)
                        async with active_spots_lock:
                            _prune_spots(now_ms)
                            changed = False
                            for s in active_spots:
                                if str(s.get("userId")) != spot_user_id:
                                    continue
                                existing_claim = s.get("claimedBy")
                                # First claimer wins; same claimer can re-claim idempotently.
                                if existing_claim is None or str(existing_claim) == claimed_by:
                                    s["claimedBy"] = claimed_by
                                    changed = True
                                break
                            if changed:
                                await _broadcast({"type": "spots", "spots": active_spots})
                                await broadcast_spots(active_spots)
                    continue

                if isinstance(msg, dict) and msg.get("type") == "spot_remove":
                    spot_user_id = str(msg.get("spotUserId") or msg.get("userId") or "")
                    if spot_user_id:
                        now_ms = int(time.time() * 1000)
                        async with active_spots_lock:
                            _prune_spots(now_ms)
                            active_spots[:] = [s for s in active_spots if str(s.get("userId")) != spot_user_id]
                            await _broadcast({"type": "spots", "spots": active_spots})
                            await broadcast_spots(active_spots)
                    continue

                # Default behavior: broadcast message as-is (keeps existing realtime behavior).
                await _broadcast(msg if isinstance(msg, dict) else {"type": "raw", "data": raw})
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
        finally:
            if websocket in connected_clients:
                connected_clients.remove(websocket)
            if websocket in client_user_ids:
                client_user_ids.pop(websocket, None)
            logger.info(f"❌ WebSocket disconnected: {id(websocket)} ({len(connected_clients)} clients left)")

    @app.websocket("/api/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await _client_websocket_handler(websocket)

    @app.websocket("/ws")
    async def websocket_endpoint_compat(websocket: WebSocket):
        await _client_websocket_handler(websocket)

    # ========================
    # STARTUP
    # ========================

    @app.on_event("startup")
    async def on_startup() -> None:
        await init_db()

        # Seed MVP city zones (predefined).
        # The websocket spot creation is rejected if the coordinates are outside these zones.
        async with AsyncSessionLocal() as db:
            predefined = [
                {"name": "Rome", "center_lat": 41.9028, "center_lng": 12.4964, "radius_m": 15000.0},
                {"name": "Milan", "center_lat": 45.4642, "center_lng": 9.19, "radius_m": 15000.0},
                {"name": "Palermo", "center_lat": 38.1157, "center_lng": 13.3615, "radius_m": 15000.0},
                {"name": "Catania", "center_lat": 37.5079, "center_lng": 15.0830, "radius_m": 15000.0},
                {"name": "Madrid", "center_lat": 40.4168, "center_lng": -3.7038, "radius_m": 15000.0},
                {"name": "Barcelona", "center_lat": 41.3851, "center_lng": 2.1734, "radius_m": 15000.0},
                {"name": "Paris", "center_lat": 48.8566, "center_lng": 2.3522, "radius_m": 15000.0},
            ]
            for c in predefined:
                existing_res = await db.execute(select(City).where(City.name == c["name"]))
                existing = existing_res.scalars().first()
                if existing is None:
                    db.add(
                        City(
                            name=c["name"],
                            center_lat=float(c["center_lat"]),
                            center_lng=float(c["center_lng"]),
                            radius_m=float(c["radius_m"]),
                            is_active=True,
                        )
                    )
            await db.commit()

            # Seed MVP admin user (so it can login and obtain a valid token).
            # Admin access is still enforced by websocket `userId == ADMIN_ID`.
            admin_email = os.getenv("ADMIN_EMAIL", "admin@local")
            admin_password = os.getenv("ADMIN_PASSWORD", "admin123")
            existing_admin_res = await db.execute(select(User).where(User.uid == ADMIN_ID))
            existing_admin = existing_admin_res.scalars().first()
            if existing_admin is None:
                db.add(
                    User(
                        uid=ADMIN_ID,
                        name="Admin",
                        surname="Admin",
                        email=admin_email,
                        hashed_password=hash_password(admin_password),
                        is_active=True,
                    )
                )
                await db.commit()

        async def spot_cleanup_loop() -> None:
            while True:
                await asyncio.sleep(10)
                now_ms = int(time.time() * 1000)

                # Prune users and broadcast if list changed.
                async with active_users_lock:
                    before_users = len(active_users)
                    _prune_users(now_ms)
                    after_users = len(active_users)
                    users_changed = after_users != before_users
                    users_snapshot = list(active_users.values())

                if users_changed:
                    await _broadcast({"type": "users", "users": users_snapshot})

                # Prune spots and broadcast if list changed.
                async with active_spots_lock:
                    before = len(active_spots)
                    _prune_spots(now_ms)
                    after = len(active_spots)
                    if after != before:
                        await _broadcast({"type": "spots", "spots": active_spots})
                        await broadcast_spots(active_spots)

        asyncio.create_task(spot_cleanup_loop())

    # ========================
    # ROOT TEST
    # ========================

    @app.get("/")
    def root():
        return {"message": "UPOSTU backend running"}

    # ========================
    # ADMIN DASHBOARD (MVP: direct access, no auth)
    # ========================
    public_dir = Path(__file__).resolve().parents[2] / "frontend" / "pwa" / "public"

    @app.get("/admin")
    async def admin_page():
        return FileResponse(public_dir / "admin.html")

    @app.get("/admin/")
    async def admin_page_slash():
        return FileResponse(public_dir / "admin.html")

    @app.get("/admin/index.html")
    async def admin_page_index():
        return FileResponse(public_dir / "admin.html")

    @app.get("/admin.css")
    async def admin_css():
        return FileResponse(public_dir / "admin.css")

    @app.get("/admin.js")
    async def admin_js():
        return FileResponse(public_dir / "admin.js")

    @app.get("/admin-login")
    async def admin_login_page():
        return FileResponse(public_dir / "admin-login.html")

    @app.get("/admin-login/")
    async def admin_login_page_slash():
        return FileResponse(public_dir / "admin-login.html")

    markers_dir = public_dir / "markers"
    markers_dir.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/markers",
        StaticFiles(directory=str(markers_dir.resolve())),
        name="markers",
    )
    app.mount(
        "/assets",
        StaticFiles(directory=ASSETS_DIR),
        name="assets",
    )

    # ========================
    # FRONTEND COMPAT: /api/register
    # ========================
    @app.post("/api/register")
    async def api_register(payload: UserRegisterRequest, db: AsyncSession = Depends(get_db)):
        """
        Compatibility alias for older frontend code.

        Delegates to the real auth registration endpoint at `/api/auth/register`.
        """
        req_payload = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        logger.info("REGISTER HIT: %s", req_payload)
        token_resp = await auth.register_user(payload, db=db)
        # Pydantic v1/v2 compatibility: `.dict()` vs `.model_dump()`.
        data = token_resp.model_dump() if hasattr(token_resp, "model_dump") else token_resp.dict()
        data["success"] = True
        data["message"] = "User registered"
        return data

    @app.post("/api/login")
    async def api_login(payload: UserLoginRequest, db: AsyncSession = Depends(get_db)):
        """
        Simple login endpoint for MVP frontend session flow.
        """
        req_payload = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        logger.info("LOGIN HIT: %s", {"email": req_payload.get("email")})
        token_resp = await auth.login(payload, db=db)
        data = token_resp.model_dump() if hasattr(token_resp, "model_dump") else token_resp.dict()
        data["success"] = True
        data["message"] = "Login successful"
        return data

    @app.post("/login")
    async def login_compat(payload: UserLoginRequest, db: AsyncSession = Depends(get_db)):
        """
        Compatibility alias for deployments where reverse proxy strips `/api`.
        """
        req_payload = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        logger.info("LOGIN HIT (compat): %s", {"email": req_payload.get("email")})
        token_resp = await auth.login(payload, db=db)
        data = token_resp.model_dump() if hasattr(token_resp, "model_dump") else token_resp.dict()
        data["success"] = True
        data["message"] = "Login successful"
        return data

    class TopUpRequest(BaseModel):
        userId: str = Field(min_length=1)
        amount: Decimal

    class AddCarRequest(BaseModel):
        userId: str = Field(min_length=1)
        brand: str = Field(min_length=1)
        model: str = Field(min_length=1)
        size: str = Field(min_length=1)

    class UpdatePositionRequest(BaseModel):
        userId: str = Field(min_length=1)
        lat: float
        lng: float
        status: str = "searching"

    class CreateSpotRequest(BaseModel):
        userId: str = Field(min_length=1)
        lat: float
        lng: float
        spotSize: str = "large"

    class BookSpotRequest(BaseModel):
        spot_id: str = Field(min_length=1)
        user_id: str = Field(min_length=1)

    class EndBookingRequest(BaseModel):
        booking_id: int

    def _compute_dynamic_price(spots_snapshot: list[dict], users_snapshot: dict[str, dict]) -> Decimal:
        base = Decimal("1.50")
        demand = len(users_snapshot)
        supply = max(1, len([s for s in spots_snapshot if s.get("claimedBy") is None]))
        ratio = demand / supply
        if ratio > 1.5:
            return (base * Decimal("1.50")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if ratio < 0.7:
            return (base * Decimal("0.80")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return base

    @app.get("/api/wallet")
    async def api_wallet(userId: str, db: AsyncSession = Depends(get_db)):
        u = await _user_by_uid(db, userId)
        bal = Decimal(str(u.wallet if u is not None else 0)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        return {"userId": userId, "balance": float(bal)}

    @app.get("/api/unlocks")
    async def api_unlocks(userId: str):
        async with unlocked_spots_lock:
            unlocked_list = list(unlocked_spots.get(userId, set()))
        return {"userId": userId, "unlocked": unlocked_list}

    @app.get("/api/users")
    async def api_users(db: AsyncSession = Depends(get_db)):
        now_ms = int(time.time() * 1000)
        async with active_users_lock:
            _prune_users(now_ms)
            users_payload = list(active_users.values())
        users_res = await db.execute(select(User))
        users_rows = users_res.scalars().all()
        cars_res = await db.execute(select(Car).order_by(Car.id.desc()))
        cars_rows = cars_res.scalars().all()
        bookings_res = await db.execute(select(Booking))
        bookings_rows = bookings_res.scalars().all()

        car_by_uid: dict[str, str] = {}
        for c in cars_rows:
            uid = str(c.user_uid or "")
            if not uid or uid in car_by_uid:
                continue
            car_by_uid[uid] = f"{c.brand} {c.model}".strip()

        spent_by_uid: dict[str, Decimal] = {}
        earned_by_uid: dict[str, Decimal] = {}
        for b in bookings_rows:
            uid = str(b.user_id or "")
            if not uid:
                continue
            price = Decimal(str(b.price or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            spent_by_uid[uid] = spent_by_uid.get(uid, Decimal("0.00")) + price
            earned_by_uid[uid] = earned_by_uid.get(uid, Decimal("0.00")) + (
                price * (Decimal("1.00") - PLATFORM_FEE)
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        admin_users = []
        for u in users_rows:
            uid = str(u.uid or "")
            admin_users.append(
                {
                    "name": u.name,
                    "surname": u.surname,
                    "email": u.email,
                    "car": car_by_uid.get(uid, "-"),
                    "total_earned": float(earned_by_uid.get(uid, Decimal("0.00"))),
                    "total_spent": float(spent_by_uid.get(uid, Decimal("0.00"))),
                }
            )

        return {"success": True, "users": users_payload, "adminUsers": admin_users}

    @app.get("/api/spots")
    async def api_spots():
        now_ms = int(time.time() * 1000)
        async with active_spots_lock:
            _prune_spots(now_ms)
            spots_payload = list(active_spots)
        active_only = [s for s in spots_payload if s.get("claimedBy") is None]
        reserved_only = [s for s in spots_payload if s.get("claimedBy") is not None]
        return {
            "success": True,
            "spots": spots_payload,
            "activeSpots": active_only,
            "reservedSpots": reserved_only,
        }

    @app.post("/api/book")
    async def api_book(payload: BookSpotRequest, db: AsyncSession = Depends(get_db)):
        user_id = str(payload.user_id).strip()
        spot_id = str(payload.spot_id).strip()
        if not user_id or not spot_id:
            raise HTTPException(status_code=422, detail="Missing user_id or spot_id")

        async with active_spots_lock:
            now_ms = int(time.time() * 1000)
            _prune_spots(now_ms)
            target = next(
                (
                    s
                    for s in active_spots
                    if str(s.get("userId")) == spot_id or str(s.get("id", "")) == spot_id
                ),
                None,
            )
            if target is None:
                raise HTTPException(status_code=404, detail="Spot not found")
            claimed_by = target.get("claimedBy")
            if claimed_by is not None and str(claimed_by) != user_id:
                raise HTTPException(status_code=409, detail="Spot already booked")

            price = _compute_dynamic_price(active_spots, active_users)
            target["claimedBy"] = user_id
            target["status"] = "occupied"
            booking = Booking(
                user_id=user_id,
                spot_id=str(target.get("userId") or spot_id),
                start_time=datetime.utcnow(),
                price=float(price),
                status="active",
            )
            db.add(booking)
            await db.commit()
            await db.refresh(booking)

            await broadcast_to_admin(
                {
                    "type": "booking",
                    "spot_id": booking.spot_id,
                    "user_id": booking.user_id,
                }
            )

            await _broadcast({"type": "spots", "spots": active_spots})
            await broadcast_spots(active_spots)

            return {
                "success": True,
                "booking": {
                    "id": booking.id,
                    "user_id": booking.user_id,
                    "spot_id": booking.spot_id,
                    "price": booking.price,
                    "status": booking.status,
                },
            }

    @app.post("/api/book/end")
    async def api_end_booking(payload: EndBookingRequest, db: AsyncSession = Depends(get_db)):
        res = await db.execute(select(Booking).where(Booking.id == int(payload.booking_id)))
        booking = res.scalars().first()
        if booking is None:
            raise HTTPException(status_code=404, detail="Booking not found")
        if booking.status == "ended":
            return {"success": True, "booking_id": booking.id, "already_ended": True}

        booking.status = "ended"
        booking.end_time = datetime.utcnow()
        gross = Decimal(str(booking.price or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        user_earn = (gross * (Decimal("1.00") - PLATFORM_FEE)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        platform_earn = (gross * PLATFORM_FEE).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        await db.commit()

        return {
            "success": True,
            "booking_id": booking.id,
            "price": float(gross),
            "user_earn": float(user_earn),
            "platform_earn": float(platform_earn),
            "platform_fee": float(PLATFORM_FEE),
        }

    @app.get("/admin/revenue")
    async def admin_revenue(db: AsyncSession = Depends(get_db)):
        res = await db.execute(select(Booking))
        bookings = res.scalars().all()
        total = Decimal("0.00")
        platform = Decimal("0.00")
        user_total = Decimal("0.00")
        zone_profit: dict[str, Decimal] = {}
        hour_profit: dict[int, Decimal] = {}
        for b in bookings:
            p = Decimal(str(b.price or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            total += p
            pf = (p * PLATFORM_FEE).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            ue = (p - pf).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            platform += pf
            user_total += ue
            zone = str(b.spot_id or "unknown")
            zone_profit[zone] = zone_profit.get(zone, Decimal("0.00")) + p
            if b.start_time is not None:
                hour = int(getattr(b.start_time, "hour", 0))
                hour_profit[hour] = hour_profit.get(hour, Decimal("0.00")) + p

        avg_price = float((total / Decimal(max(1, len(bookings)))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        most_profitable_zones = sorted(
            [{"zone": z, "revenue": float(v)} for z, v in zone_profit.items()],
            key=lambda x: x["revenue"],
            reverse=True,
        )[:5]
        best_hours = sorted(
            [{"hour": h, "revenue": float(v)} for h, v in hour_profit.items()],
            key=lambda x: x["revenue"],
            reverse=True,
        )[:5]
        return {
            "success": True,
            "total_revenue": float(total),
            "platform_earnings": float(platform),
            "user_earnings": float(user_total),
            "total_platform": float(platform),
            "total_users_earned": float(user_total),
            "total_users_spent": float(total),
            "average_price": avg_price,
            "most_profitable_zones": most_profitable_zones,
            "best_hours": best_hours,
        }

    @app.get("/user/history")
    async def user_history(userId: str, db: AsyncSession = Depends(get_db)):
        uid = str(userId).strip()
        res = await db.execute(select(Booking).where(Booking.user_id == uid).order_by(Booking.id.desc()))
        rows = res.scalars().all()
        total_spent = Decimal("0.00")
        total_earned = Decimal("0.00")
        payload = []
        for b in rows:
            p = Decimal(str(b.price or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            total_spent += p
            total_earned += (p * (Decimal("1.00") - PLATFORM_FEE)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            payload.append(
                {
                    "id": b.id,
                    "user_id": b.user_id,
                    "spot_id": b.spot_id,
                    "start_time": b.start_time.isoformat() if b.start_time else None,
                    "end_time": b.end_time.isoformat() if b.end_time else None,
                    "price": float(p),
                    "status": b.status,
                }
            )
        return {
            "success": True,
            "bookings": payload,
            "total_spent": float(total_spent),
            "total_earned": float(total_earned),
        }

    @app.post("/api/update-position")
    async def api_update_position(payload: UpdatePositionRequest):
        user_id = str(payload.userId).strip()
        if not user_id:
            raise HTTPException(status_code=422, detail="Missing userId")

        now_ms = int(time.time() * 1000)
        async with active_users_lock:
            active_users[user_id] = {
                "userId": user_id,
                "lat": float(payload.lat),
                "lng": float(payload.lng),
                "status": str(payload.status or "searching"),
                "isAdmin": bool(user_id == ADMIN_ID),
                "timestamp": now_ms,
            }
            _prune_users(now_ms)
            users_payload = list(active_users.values())

        await _broadcast(
            {
                "type": "update",
                "userId": user_id,
                "lat": float(payload.lat),
                "lng": float(payload.lng),
                "status": str(payload.status or "searching"),
                "isAdmin": bool(user_id == ADMIN_ID),
                "timestamp": now_ms,
            }
        )
        return {"success": True, "user": active_users.get(user_id), "users": users_payload}

    @app.post("/api/create-spot")
    async def api_create_spot(payload: CreateSpotRequest):
        user_id = str(payload.userId).strip()
        if not user_id:
            raise HTTPException(status_code=422, detail="Missing userId")

        spot_size = "small" if str(payload.spotSize) == "small" else "large"
        now_ms = int(time.time() * 1000)
        async with active_spots_lock:
            _prune_spots(now_ms)
            active_spots[:] = [s for s in active_spots if str(s.get("userId")) != user_id]
            active_spots.append(
                {
                    "userId": user_id,
                    "lat": float(payload.lat),
                    "lng": float(payload.lng),
                    "timestamp": now_ms,
                    "claimedBy": None,
                    "spotSize": spot_size,
                    "cityId": None,
                }
            )
            spots_payload = list(active_spots)

        await _broadcast({"type": "spots", "spots": spots_payload})
        await broadcast_spots(spots_payload)
        return {"success": True, "spot": spots_payload[-1], "spots": spots_payload}

    @app.post("/api/add-car")
    async def api_add_car(payload: AddCarRequest, db: AsyncSession = Depends(get_db)):
        allowed = {"small", "medium", "large"}
        if payload.size not in allowed:
            raise HTTPException(status_code=422, detail="Invalid car size")
        user_id = str(payload.userId).strip()
        if not user_id:
            raise HTTPException(status_code=422, detail="Missing userId")

        car = Car(
            user_uid=user_id,
            brand=str(payload.brand).strip(),
            model=str(payload.model).strip(),
            size=str(payload.size).strip(),
        )
        db.add(car)
        await db.commit()
        await db.refresh(car)
        return {
            "success": True,
            "car": {
                "id": car.id,
                "userId": car.user_uid,
                "user_uid": car.user_uid,
                "brand": car.brand,
                "model": car.model,
                "size": car.size,
            },
        }

    @app.get("/api/user-cars")
    async def api_user_cars(userId: str, db: AsyncSession = Depends(get_db)):
        normalized_user_id = str(userId).strip()
        res = await db.execute(
            select(Car).where(Car.user_uid == normalized_user_id).order_by(Car.id.desc())
        )
        cars = res.scalars().all()
        return {
            "success": True,
            "cars": [
                {
                    "id": c.id,
                    "userId": c.user_uid,
                    "user_uid": c.user_uid,
                    "brand": c.brand,
                    "model": c.model,
                    "size": c.size,
                }
                for c in cars
            ],
        }

    @app.get("/api/user-car")
    async def api_user_car(userId: str, db: AsyncSession = Depends(get_db)):
        normalized_user_id = str(userId).strip()
        res = await db.execute(
            select(Car).where(Car.user_uid == normalized_user_id).order_by(Car.id.desc())
        )
        car = res.scalars().first()
        if car is None:
            return {"success": True, "car": None}
        return {
            "success": True,
            "car": {
                "id": car.id,
                "userId": car.user_uid,
                "user_uid": car.user_uid,
                "brand": car.brand,
                "model": car.model,
                "size": car.size,
            },
        }

    @app.post("/api/topup")
    async def api_topup(payload: TopUpRequest, db: AsyncSession = Depends(get_db)):
        # Fixed top-up amounts.
        allowed = {Decimal("5"), Decimal("10"), Decimal("20")}
        amt = payload.amount
        if amt not in allowed:
            return {"error": "invalid_amount", "allowed": [5, 10, 20]}

        u = await _user_by_uid(db, payload.userId)
        if u is None:
            return {"error": "user_not_found"}

        add = float(amt.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        u.wallet = round(float(u.wallet or 0) + add, 2)
        db.add(
            Transaction(
                user_id=u.uid,
                amount=add,
                type="earn",
                platform_fee=0.0,
            )
        )
        await db.commit()

        await broadcast_to_admin(
            {
                "type": "transaction",
                "user_id": u.uid,
                "amount": add,
                "platform_fee": 0.0,
            }
        )

        new_bal = Decimal(str(u.wallet)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return {"userId": payload.userId, "balance": float(new_bal)}

    # ========================
    # STRIPE UNLOCK FLOW
    # ========================
    class UnlockSessionRequest(BaseModel):
        spotUserId: str = Field(min_length=1)

    def _stripe_env_or_raise():
        if stripe is None:
            raise HTTPException(
                status_code=500,
                detail="Stripe SDK not installed. Add `stripe` to backend dependencies.",
            )
        secret_key = os.getenv("STRIPE_SECRET_KEY", "").strip()
        webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
        if not secret_key or not webhook_secret:
            raise HTTPException(
                status_code=500,
                detail="Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
            )
        return secret_key, webhook_secret

    @app.post("/api/stripe/create-unlock-session")
    async def create_unlock_session(
        payload: UnlockSessionRequest,
        authorization: str | None = Header(default=None),
        db: AsyncSession = Depends(get_db),
    ):
        """
        Creates a Stripe Checkout Session for unlocking exact coordinates.

        Security note:
        - The frontend only triggers payment creation.
        - The actual unlock is applied only after webhook confirmation.
        """
        buyer_uid = verify_access_token(get_bearer_token(authorization))
        secret_key, _webhook_secret = _stripe_env_or_raise()
        stripe.api_key = secret_key

        # Basic validation: the spot must exist among active spots.
        # Also enforce reservation ownership: if another user already reserved it
        # (claimedBy), block unlock creation.
        async with active_spots_lock:
            spot_row = next(
                (s for s in active_spots if str(s.get("userId")) == str(payload.spotUserId)),
                None,
            )

        if not spot_row:
            raise HTTPException(status_code=400, detail="Spot not available anymore.")

        claimed_by = spot_row.get("claimedBy")
        if claimed_by is not None and str(claimed_by) != str(buyer_uid):
            raise HTTPException(status_code=403, detail="Spot reserved by another user.")

        # City + car size checks (MVP):
        # - spot_size is normalized as "small" or "large" (backend stores it when spot is created)
        # - small cars can park everywhere; otherwise spot_size must be != "small"
        spot_size = spot_row.get("spotSize") or "large"

        # If buyer has at least one small car, they can park in any spot.
        buyer_has_small = False
        res = await db.execute(select(Car.size).where(Car.user_uid == str(buyer_uid)))
        sizes = [r[0] for r in res.all()]
        if "small" in sizes:
            buyer_has_small = True

        if not buyer_has_small and str(spot_size) == "small":
            raise HTTPException(status_code=403, detail="Spot not compatible with your car size.")

        success_url = os.getenv("STRIPE_SUCCESS_URL", "http://localhost:3000")
        cancel_url = os.getenv("STRIPE_CANCEL_URL", "http://localhost:3000")

        unlock_price_cents = 50  # €0.50 fixed

        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[
                {
                    "price_data": {
                        "currency": "eur",
                        "product_data": {"name": "Unlock parking spot"},
                        "unit_amount": unlock_price_cents,
                    },
                    "quantity": 1,
                }
            ],
            success_url=f"{success_url}?unlocked=1&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=cancel_url,
            metadata={
                "purpose": "unlock_spot",
                "buyerUid": str(buyer_uid),
                "spotUserId": str(payload.spotUserId),
                "unlockPriceEur": str(UNLOCK_PRICE_EUR),
            },
        )

        return {"url": session.url, "id": session.id}

    @app.post("/api/stripe/webhook")
    async def stripe_webhook(request: Request):
        _secret_key, webhook_secret = _stripe_env_or_raise()

        payload = await request.body()
        sig_header = request.headers.get("stripe-signature")
        if not sig_header:
            raise HTTPException(status_code=400, detail="Missing stripe-signature header.")

        try:
            event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid Stripe webhook: {e}")

        # Idempotency: ignore already-processed webhook events.
        async with processed_stripe_event_ids_lock:
            if event.id in processed_stripe_event_ids:
                return {"received": True}
            processed_stripe_event_ids.add(event.id)

        if event.type == "checkout.session.completed":
            session = event.data.get("object", {}) if hasattr(event, "data") else {}
            payment_status = session.get("payment_status") if hasattr(session, "get") else None
            if payment_status and payment_status != "paid":
                return {"received": True}
            metadata = session.get("metadata") or {}
            purpose = metadata.get("purpose")
            buyer_uid = metadata.get("buyerUid")
            spot_user_id = metadata.get("spotUserId")

            if purpose != "unlock_spot" or not buyer_uid or not spot_user_id:
                # Not our flow.
                return {"received": True}

            # Extra safety: if someone else already reserved this spot, ignore
            # this webhook (unlock creation should have been blocked already).
            async with active_spots_lock:
                spot_row = next(
                    (s for s in active_spots if str(s.get("userId")) == str(spot_user_id)),
                    None,
                )
                if (
                    spot_row
                    and spot_row.get("claimedBy") is not None
                    and str(spot_row.get("claimedBy")) != str(buyer_uid)
                ):
                    return {"received": True}

            # Apply unlock + wallet changes (server-side only).
            async with unlocked_spots_lock:
                unlocked_spots.setdefault(buyer_uid, set()).add(spot_user_id)

            # Reservation on payment:
            # - mark the active spot as reserved by setting `claimedBy`
            # - assign it to this user only
            # - broadcast updated spot list so other clients can hide it immediately
            claimed_spot_changed = False
            async with active_spots_lock:
                _prune_spots(int(time.time() * 1000))
                for s in active_spots:
                    if str(s.get("userId")) == str(spot_user_id):
                        existing_claim = s.get("claimedBy")
                        if existing_claim is None:
                            s["claimedBy"] = str(buyer_uid)
                            claimed_spot_changed = True
                        break

            try:
                async with AsyncSessionLocal() as db:
                    buyer = await _user_by_uid(db, str(buyer_uid))
                    if buyer is not None:
                        price = float(
                            UNLOCK_PRICE_EUR.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                        )
                        fee = float(
                            PLATFORM_FEE.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                        )
                        buyer.wallet = round(float(buyer.wallet or 0) - price, 2)
                        db.add(
                            Transaction(
                                user_id=buyer.uid,
                                amount=price,
                                type="spend",
                                platform_fee=fee,
                            )
                        )
                        await db.commit()
                        await broadcast_to_admin(
                            {
                                "type": "transaction",
                                "user_id": buyer.uid,
                                "amount": price,
                                "platform_fee": fee,
                            }
                        )
            except Exception as e:
                logger.warning("Stripe unlock wallet update failed for %s: %s", buyer_uid, e)

            # Notify all clients; frontend will filter by userId.
            await _broadcast({"type": "spot_unlocked", "userId": buyer_uid, "spotUserId": spot_user_id})
            if claimed_spot_changed:
                await _broadcast({"type": "spots", "spots": active_spots})
                await broadcast_spots(active_spots)

        return {"received": True}

    # ========================
    # FRONTEND COMPAT: /api/parking
    # ========================

    @app.get("/api/parking")
    async def api_parking(db: AsyncSession = Depends(get_db)):
        """
        Frontend expects: GET /api/parking
        Returns: [{id, lat, lng}]
        """
        try:
            result = await db.execute(select(ParkingSpot))
            spots = result.scalars().all()
            payload = []
            for s in spots:
                item = {
                    "id": str(s.id),
                    "lat": float(s.latitude),
                    "lng": float(s.longitude),
                }
                # Keep other fields if present (frontend can ignore extras).
                if hasattr(s, "created_at") and s.created_at is not None:
                    item["created_at"] = s.created_at.isoformat()
                payload.append(item)
            return payload
        except Exception as e:
            logger.warning("Falling back to mock /api/parking data: %s", e)
            return [{"id": 1, "lat": 38.15, "lng": 13.33, "created_at": None}]

    return app


app = create_app()