from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str | None = None
    realtime_model: str = "gpt-4o-realtime-preview"
    chat_model: str = "gpt-4o-mini"
    allowed_origins: str = "http://localhost:3000"

    @property
    def mock_mode(self) -> bool:
        """OPENAI_API_KEY 未設定時は LLM/音声認識をモックで動作させる。"""
        return not self.openai_api_key

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
