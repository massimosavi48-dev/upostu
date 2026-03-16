from fastapi import APIRouter, Depends

from ..db.session import get_db
from ..schemas import UserCreate, UserRead


router = APIRouter()


@router.post("/register", response_model=UserRead)
def register_user(payload: UserCreate, db=Depends(get_db)):
    # Placeholder implementation
    return UserRead(id=1, email=payload.email, is_active=True)


@router.post("/login")
def login():
    # Placeholder implementation
    return {"access_token": "dummy-token", "token_type": "bearer"}

