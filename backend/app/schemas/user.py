from pydantic import BaseModel, EmailStr, Field


class UserBase(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    surname: str = Field(min_length=1, max_length=80)
    email: EmailStr


class UserRegisterRequest(UserBase):
    password: str = Field(min_length=8, max_length=200)


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)

class UserRead(UserBase):
    id: int
    uid: str
    is_active: bool

    class Config:
        from_attributes = True


class UserTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead

