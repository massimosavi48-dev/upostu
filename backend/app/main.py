from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import relativi corretti
from . import models  # noqa: F401
from .db.init_db import init_db
from .routers import auth
from .routers import parking
from .routers import gps
from .routers import ai
from .routers import notifications
from .routers import realtime


def create_app() -> FastAPI:
    app = FastAPI(
        title="UPOSTU",
        version="0.1.0",
        description="UPOSTU parking sharing backend"
    )

    # CORS per permettere al frontend PWA di parlare con il backend
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ========================
    # ROUTERS
    # ========================

    app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
    app.include_router(gps.router, prefix="/api/gps", tags=["gps"])
    app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
    app.include_router(
        notifications.router,
        prefix="/api/notifications",
        tags=["notifications"],
    )

    # router parcheggi
    app.include_router(parking.router)

    # websocket realtime
    app.include_router(realtime.router, tags=["realtime"])

    # ========================
    # STARTUP
    # ========================

    @app.on_event("startup")
    async def on_startup() -> None:
        await init_db()

    # ========================
    # ROOT TEST
    # ========================

    @app.get("/")
    def root():
        return {"message": "UPOSTU backend running"}

    return app


# Creazione applicazione
app = create_app()