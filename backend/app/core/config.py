"""Application settings (Phase 0 — Scaffolding).

All secrets / environment-specific values come from environment variables
or a local `.env` file (never committed). See `infra/.env.example` for the
full list of keys with placeholder values.
"""

from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = Field(default="local")
    database_url: str = Field(
        default="postgresql+psycopg2://careflow:careflow@localhost:5432/careflow",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    jwt_secret: str = Field(
        default="change-me-in-env-use-a-long-random-string", alias="JWT_SECRET"
    )
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(
        default=15, alias="ACCESS_TOKEN_EXPIRE_MINUTES"
    )
    refresh_token_expire_days: int = Field(
        default=7, alias="REFRESH_TOKEN_EXPIRE_DAYS"
    )
    ehr_mock_base_url: str = Field(
        default="http://localhost:8000", alias="EHR_MOCK_BASE_URL"
    )
    ehr_http_timeout_s: float = Field(default=10.0, alias="EHR_HTTP_TIMEOUT_S")

    llm_api_key: str = Field(
        default="", validation_alias=AliasChoices("LLM_API_KEY", "GROQ_API_KEY")
    )
    llm_model: str = Field(default="openai/gpt-oss-20b", alias="LLM_MODEL")
    llm_base_url: str = Field(
        default="https://api.groq.com/openai/v1", alias="LLM_BASE_URL"
    )
    # AIContext (Phase 9) Redis TTL, e.g. 2h of conversation memory.
    ai_context_ttl_s: int = Field(default=7200, alias="AI_CONTEXT_TTL_S")
    # Phase 10 workflow/notifications.
    smtp_host: str = Field(default="localhost", alias="SMTP_HOST")
    smtp_port: int = Field(default=1025, alias="SMTP_PORT")
    smtp_from: str = Field(default="careflow@example.com", alias="SMTP_FROM")
    task_eager: bool = Field(default=False, alias="TASK_EAGER")
    # Phase 12 voice: providers are "stub" (no-op) or "groq".
    # TTS needs extra terms acceptance on the GROQ org; until then the
    # GroqTTS class is correct but unusable — stub stays the default.
    stt_provider: str = Field(default="stub", alias="STT_PROVIDER")
    stt_model: str = Field(default="whisper-large-v3-turbo", alias="STT_MODEL")
    tts_provider: str = Field(default="stub", alias="TTS_PROVIDER")
    tts_model: str = Field(
        default="canopylabs/orpheus-v1-english", alias="TTS_MODEL"
    )
    tts_voice: str = Field(default="troy", alias="TTS_VOICE")
    voice_silence_s: float = Field(default=20.0, alias="VOICE_SILENCE_S")
    twilio_account_sid: str = Field(default="", alias="TWILIO_ACCOUNT_SID")
    twilio_auth_token: str = Field(default="", alias="TWILIO_AUTH_TOKEN")
    twilio_phone_number: str = Field(default="", alias="TWILIO_PHONE_NUMBER")

    backend_cors_origins: str = Field(
        default="http://localhost:5173,http://localhost:5174,http://localhost:3000",
        alias="BACKEND_CORS_ORIGINS",
    )

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.backend_cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
