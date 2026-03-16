from fastapi import APIRouter


router = APIRouter()


@router.get("/predict")
def predict_parking_availability():
    # Placeholder implementation
    return {"prediction": "unknown"}

