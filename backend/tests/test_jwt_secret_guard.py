"""JWT_SECRET production guard (pre-Azure hardening).

Local/test/dev keep working with the default secret. Any other
ENVIRONMENT fails fast at startup unless JWT_SECRET is explicitly set
to a non-placeholder value.
"""

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_local_allows_default_secret():
    settings = Settings(environment="local")
    assert settings.jwt_secret


def test_production_refuses_placeholder_default():
    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            JWT_SECRET="change-me-in-env-use-a-long-random-string",
        )


def test_production_refuses_missing_secret():
    with pytest.raises(ValidationError):
        Settings(environment="production", JWT_SECRET="")


def test_production_accepts_explicit_secret():
    settings = Settings(
        environment="production",
        JWT_SECRET="test-only-strong-random-value-not-a-real-secret",
    )
    assert (
        settings.jwt_secret == "test-only-strong-random-value-not-a-real-secret"
    )
