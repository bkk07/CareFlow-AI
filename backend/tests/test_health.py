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
        "REDIS_URL",
        "JWT_SECRET",
        "LLM_API_KEY",
        "TWILIO_ACCOUNT_SID",
        "TWILIO_AUTH_TOKEN",
        "TWILIO_PHONE_NUMBER",
    ):
        assert key in text, f"missing {key} in infra/.env.example"
