"""Auth / RBAC / tenant-isolation tests."""

import uuid

import pytest

from app.core.deps import RequestContext
from app.core.security import (
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.core.tenant import hospital_scoped_query
from app.domain.auth.models import Role, User
from tests.conftest import make_hospital_id

PASSWORD = "correct-horse-42"


def register(client, email, role, hospital_id=None):
    body = {"email": email, "password": PASSWORD, "role": role}
    if hospital_id is not None:
        body["hospital_id"] = hospital_id
    return client.post("/auth/register", json=body)


def login(client, email, password=PASSWORD):
    return client.post("/auth/login", json={"email": email, "password": password})


# --- registration + login for all four roles -------------------------------


@pytest.mark.parametrize(
    "role,needs_hospital",
    [
        ("doctor", True),
        ("patient", False),
    ],
)
def test_register_and_login_all_roles(client, role, needs_hospital):
    hospital_id = make_hospital_id() if needs_hospital else None
    email = f"{role}@example.com"

    reg = register(client, email, role, hospital_id)
    assert reg.status_code == 201, reg.text
    data = reg.json()
    assert data["email"] == email
    assert data["role"] == role
    assert data["hospital_id"] == hospital_id
    assert data["is_active"] is True
    assert "password_hash" not in data
    assert "password" not in data

    tokens = login(client, email)
    assert tokens.status_code == 200, tokens.text
    body = tokens.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]

    me = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200
    assert me.json()["email"] == email


def test_password_is_hashed_argon2(client, db):
    register(client, "hashcheck@example.com", "patient")
    user = db.query(User).filter(User.email == "hashcheck@example.com").one()
    assert user.password_hash != PASSWORD
    assert user.password_hash.startswith("$argon2")
    assert verify_password(PASSWORD, user.password_hash)
    assert not verify_password("wrong-password", user.password_hash)


def test_duplicate_email_rejected(client):
    assert register(client, "dup@example.com", "patient").status_code == 201
    dup = register(client, "DUP@example.com", "patient")
    assert dup.status_code == 400


def test_role_hospital_id_validation(client):
    # Hospital-bound roles require a hospital.
    assert register(client, "doc@example.com", "doctor").status_code == 422
    # Non-hospital roles must not carry one.
    assert (
        register(
            client, "pat@example.com", "patient", hospital_id=make_hospital_id()
        ).status_code
        == 422
    )
    assert (
        register(
            client,
            "root@example.com",
            "platform_admin",
            hospital_id=make_hospital_id(),
        ).status_code
        == 422
    )


def test_privileged_roles_cannot_self_register(client):
    # hospital_admin is never self-registered: provisioned via
    # POST /hospitals (first admin) or POST /hospitals/{id}/staff.
    assert (
        register(
            client,
            "sneaky-admin@example.com",
            "hospital_admin",
            hospital_id=make_hospital_id(),
        ).status_code
        == 403
    )
    assert (
        register(client, "sneaky-admin2@example.com", "hospital_admin").status_code
        == 403
    )


def test_platform_admin_bootstrap_only_when_none_exists(client):
    # First platform_admin (deployment bootstrap) is allowed.
    assert (
        register(client, "root@example.com", "platform_admin").status_code == 201
    )
    # A second one must not be self-registered once an admin exists.
    assert (
        register(client, "root2@example.com", "platform_admin").status_code == 403
    )
    # The bootstrapped admin can still log in.
    assert login(client, "root@example.com").status_code == 200


# --- login failures ----------------------------------------------------------


def test_login_wrong_password_rejected(client):
    register(client, "user@example.com", "patient")
    resp = login(client, "user@example.com", password="nope-nope-nope")
    assert resp.status_code == 401


def test_login_unknown_email_rejected(client):
    assert login(client, "ghost@example.com").status_code == 401


def test_login_inactive_user_rejected(client, db):
    register(client, "suspended@example.com", "patient")
    user = db.query(User).filter(User.email == "suspended@example.com").one()
    user.is_active = False
    db.commit()
    assert login(client, "suspended@example.com").status_code == 403


# --- protected routes: 401 / 403 ---------------------------------------------


def test_me_without_token_is_401(client):
    assert client.get("/auth/me").status_code == 401


def test_me_with_invalid_token_is_401(client):
    resp = client.get("/auth/me", headers={"Authorization": "Bearer garbage"})
    assert resp.status_code == 401


def test_me_with_refresh_token_is_401(client):
    register(client, "ref@example.com", "patient")
    tokens = login(client, "ref@example.com").json()
    resp = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {tokens['refresh_token']}"},
    )
    assert resp.status_code == 401


def test_platform_ping_role_gating(client):
    register(client, "root@example.com", "platform_admin")
    register(client, "pat@example.com", "patient")

    admin_token = login(client, "root@example.com").json()["access_token"]
    patient_token = login(client, "pat@example.com").json()["access_token"]

    ok = client.get(
        "/auth/platform-ping", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert ok.status_code == 200

    forbidden = client.get(
        "/auth/platform-ping", headers={"Authorization": f"Bearer {patient_token}"}
    )
    assert forbidden.status_code == 403

    assert client.get("/auth/platform-ping").status_code == 401


# --- refresh flow --------------------------------------------------------------


def test_refresh_issues_new_access_token(client):
    register(client, "fresh@example.com", "patient")
    tokens = login(client, "fresh@example.com").json()
    resp = client.post(
        "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert resp.status_code == 200, resp.text
    new_access = resp.json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {new_access}"})
    assert me.status_code == 200


def test_refresh_with_access_token_rejected(client):
    register(client, "mixed@example.com", "patient")
    tokens = login(client, "mixed@example.com").json()
    resp = client.post(
        "/auth/refresh", json={"refresh_token": tokens["access_token"]}
    )
    assert resp.status_code == 401


def test_refresh_after_deactivation_rejected(client, db):
    register(client, "doomed@example.com", "patient")
    tokens = login(client, "doomed@example.com").json()
    user = db.query(User).filter(User.email == "doomed@example.com").one()
    user.is_active = False
    db.commit()
    resp = client.post(
        "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert resp.status_code == 401


def test_access_token_claims_match_user(client):
    register(client, "claims@example.com", "patient")
    tokens = login(client, "claims@example.com").json()
    payload = decode_token(tokens["access_token"])
    assert payload["type"] == "access"
    assert payload["role"] == "patient"
    assert payload["hospital_id"] is None


# --- tenant isolation ------------------------------------------------------------


def _ctx_for(db, email) -> RequestContext:
    user = db.query(User).filter(User.email == email).one()
    return RequestContext(
        user_id=user.id, role=user.role, hospital_id=user.hospital_id
    )


def _make_user(db, email, role, hospital_id=None):
    """Create a user row directly (bypasses /auth/register, which forbids
    privileged self-registration by design)."""
    user = User(
        email=email,
        password_hash=hash_password(PASSWORD),
        role=role,
        hospital_id=uuid.UUID(hospital_id) if hospital_id is not None else None,
        is_active=True,
    )
    db.add(user)
    db.commit()
    return user


def test_hospital_scoped_query_isolates_tenants(client, db):
    hosp_a, hosp_b = make_hospital_id(), make_hospital_id()
    _make_user(db, "root@example.com", Role.platform_admin)
    _make_user(db, "admin-a@example.com", Role.hospital_admin, hosp_a)
    _make_user(db, "admin-b@example.com", Role.hospital_admin, hosp_b)

    rows_a = (
        hospital_scoped_query(User, _ctx_for(db, "admin-a@example.com"), db).all()
    )
    assert {u.email for u in rows_a} == {"admin-a@example.com"}

    rows_all = hospital_scoped_query(
        User, _ctx_for(db, "root@example.com"), db
    ).all()
    assert {u.email for u in rows_all} == {
        "root@example.com",
        "admin-a@example.com",
        "admin-b@example.com",
    }


def test_context_uses_db_hospital_id_not_stale_claim(client, db):
    """A token minted before a user changes hospitals must not leak the old scope."""
    hosp_a, hosp_b = make_hospital_id(), make_hospital_id()
    _make_user(db, "mover@example.com", Role.hospital_admin, hosp_a)
    stale_token = login(client, "mover@example.com").json()["access_token"]

    user = db.query(User).filter(User.email == "mover@example.com").one()
    user.hospital_id = uuid.UUID(hosp_b)
    db.commit()

    me = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {stale_token}"}
    )
    assert me.status_code == 200
    assert me.json()["hospital_id"] == hosp_b

    fresh_ctx = RequestContext(
        user_id=user.id, role=user.role, hospital_id=uuid.UUID(hosp_b)
    )
    rows = hospital_scoped_query(User, fresh_ctx, db).all()
    assert {u.email for u in rows} == {"mover@example.com"}
