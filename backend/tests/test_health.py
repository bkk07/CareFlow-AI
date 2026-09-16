"""Phase 0 tests: health endpoint, CORS, and env-example completeness."""

import pathlib

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_root_returns_ok():
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_cors_allows_local_frontend_origin():
    resp = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    # Starlette CORS middleware answers the preflight itself.
    assert resp.status_code == 200
    assert "access-control-allow-origin" in {k.lower() for k in resp.headers}


def test_env_example_has_every_required_key():
    text = pathlib.Path(__file__).resolve().parents[2].joinpath(
        "infra", ".env.example"
    ).read_text()
    for key in (
        "DATABASE_URL",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_DB",
        "REDIS_URL",
        "JWT_SECRET",
        "JWT_ALGORITHM",
        "ACCESS_TOKEN_EXPIRE_MINUTES",
        "REFRESH_TOKEN_EXPIRE_DAYS",
        "EHR_MOCK_BASE_URL",
        "EHR_HTTP_TIMEOUT_S",
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_FROM",
        "TASK_EAGER",
        "STT_PROVIDER",
        "STT_MODEL",
        "TTS_PROVIDER",
        "TTS_MODEL",
        "TTS_VOICE",
        "VOICE_SILENCE_S",
        "LLM_API_KEY",
        "LLM_MODEL",
        "LLM_BASE_URL",
        "AI_CONTEXT_TTL_S",
        "TWILIO_ACCOUNT_SID",
        "TWILIO_AUTH_TOKEN",
        "TWILIO_PHONE_NUMBER",
        "BACKEND_CORS_ORIGINS",
        "VITE_API_URL",
    ):
        assert key in text, f"missing {key} in infra/.env.example"
