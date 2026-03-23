from pydantic import BaseModel, Field


class CarCreate(BaseModel):
    brand: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=80)
    size: str = Field(description="small|medium|large")


class CarResponse(BaseModel):
    id: int
    brand: str
    model: str
    size: str

    class Config:
        from_attributes = True

