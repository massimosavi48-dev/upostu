from fastapi import APIRouter


router = APIRouter()


@router.get("/location")
def get_location():
    # Placeholder implementation
    return {"lat": 0.0, "lng": 0.0, "accuracy": None}

