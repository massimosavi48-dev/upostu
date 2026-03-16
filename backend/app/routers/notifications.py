from fastapi import APIRouter


router = APIRouter()


@router.post("/subscribe")
def subscribe():
    # Placeholder implementation
    return {"status": "subscribed"}


@router.post("/test")
def send_test_notification():
    # Placeholder implementation
    return {"status": "sent"}

