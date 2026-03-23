from pydantic import BaseModel, Field


class CityResponse(BaseModel):
    id: int
    name: str = Field(min_length=1, max_length=80)
    center_lat: float
    center_lng: float
    radius_m: float

    class Config:
        from_attributes = True

