import base64
import hashlib
import hmac
import os
import time

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select

from ..core.config import settings
from ..db.session import get_db
from ..models.user import User
from ..schemas import UserLoginRequest, UserRead, UserRegisterRequest, UserTokenResponse


router = APIRouter()


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _b64url_decode(s: str) -> bytes:
    padding = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + padding)


def hash_password(password: str, *, iterations: int = 200_000) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${_b64url_encode(salt)}${_b64url_encode(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters_s, salt_b64, hash_b64 = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iters_s)
        salt = _b64url_decode(salt_b64)
        expected = _b64url_decode(hash_b64)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(expected, actual)
    except Exception:
        return False


def create_access_token(uid: str, *, expires_in_seconds: int = 60 * 60 * 24) -> str:
    exp = int(time.time()) + int(expires_in_seconds)
    payload_dict = {"sub": uid, "exp": exp}
    payload_json = str(payload_dict).encode("utf-8")
    payload_b64 = _b64url_encode(payload_json)
    sig = hmac.new(settings.jwt_secret_key.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    sig_b64 = _b64url_encode(sig)
    return f"{payload_b64}.{sig_b64}"


def verify_access_token(token: str) -> str:
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        expected_sig = hmac.new(
            settings.jwt_secret_key.encode("utf-8"),
            payload_b64.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(_b64url_encode(expected_sig), sig_b64):
            raise ValueError("bad signature")

        payload_json = _b64url_decode(payload_b64).decode("utf-8")
        sub_start = payload_json.find("'sub':") + len("'sub':")
        sub_quote_start = payload_json.find("'", sub_start) + 1
        sub_quote_end = payload_json.find("'", sub_quote_start)
        uid = payload_json[sub_quote_start:sub_quote_end]

        exp_start = payload_json.find("'exp':") + len("'exp':")
        exp_end = payload_json.find("}", exp_start)
        exp = int(payload_json[exp_start:exp_end].strip().strip(","))

        if not uid:
            raise ValueError("missing uid")
        if int(time.time()) > exp:
            raise ValueError("expired")
        return uid
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def get_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Authorization header")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Authorization header")
    return parts[1].strip()


async def require_current_uid(authorization: str | None = Header(default=None)) -> str:
    token = get_bearer_token(authorization)
    return verify_access_token(token)


@router.post("/register", response_model=UserTokenResponse)
async def register_user(payload: UserRegisterRequest, db=Depends(get_db)) -> UserTokenResponse:
    result = await db.execute(select(User).where(User.email == payload.email))
    if result.scalars().first() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        name=payload.name,
        surname=payload.surname,
        email=payload.email,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.uid)
    return UserTokenResponse(
        access_token=token,
        user=UserRead(
            id=user.id,
            uid=user.uid,
            name=user.name,
            surname=user.surname,
            email=user.email,
            is_active=user.is_active,
        ),
    )


@router.post("/login", response_model=UserTokenResponse)
async def login(payload: UserLoginRequest, db=Depends(get_db)) -> UserTokenResponse:
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalars().first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token(user.uid)
    return UserTokenResponse(
        access_token=token,
        user=UserRead(
            id=user.id,
            uid=user.uid,
            name=user.name,
            surname=user.surname,
            email=user.email,
            is_active=bool(user.is_active),
        ),
    )


@router.get("/me", response_model=UserRead)
async def me(uid: str = Depends(require_current_uid), db=Depends(get_db)) -> UserRead:
    result = await db.execute(User.__table__.select().where(User.uid == uid))
    row = result.first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return UserRead(
        id=row["id"],
        uid=row["uid"],
        name=row["name"],
        surname=row["surname"],
        email=row["email"],
        is_active=bool(row["is_active"]),
    )

