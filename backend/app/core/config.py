from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "UPOSTU"
    environment: str = "development"

    # Host-side default for the Dockerized local Postgres instance.
    # The backend container overrides this via its own DATABASE_URL env var.
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5433/upostu"

    jwt_secret_key: str = "CHANGE_ME"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

