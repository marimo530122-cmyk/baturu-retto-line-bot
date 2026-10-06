from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str | None = None
    realtime_model: str = "gpt-4o-realtime-preview"
    chat_model: str = "gpt-4o-mini"
    allowed_origins: str = "*"
    # 未設定なら監視機能自体を初期化しない（OPENAI_API_KEY同様、無くても動く設計を踏襲）
    sentry_dsn: str | None = None
    sentry_environment: str = "development"
    # 薬剤候補の提案(AI)。患者ごとの薬剤選択を支援する機能は、販売時に「医療機器プログラム」
    # (薬機法)に該当し得るため、該当性を専門家・PMDAに確認できるまで既定で「切」にしておく。
    enable_drug_suggestions: bool = False

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
