# Security Policy

Grounded in `backend/app/core/security.py`, `backend/app/core/deps.py`, `backend/app/core/tenant.py`, `backend/app/core/config.py`, `backend/app/ai/agent/orchestrator.py`, and `backend/app/voice/telephony/twilio_webhook.py`. This describes the implemented model, not a production-hardening claim.

## Authentication

- Passwords hashed with Argon2 (`argon2.PasswordHasher` in `backend/app/core/security.py:17`).
- JWT via PyJWT, HS256 (`backend/app/core/security.py:40-60`). Access tokens carry `{sub, role, hospital_id, type: access}` and expire after `ACCESS_TOKEN_EXPIRE_MINUTES` (default 2880 = 2 days); refresh tokens carry `{sub, type: refresh}` and expire after `REFRESH_TOKEN_EXPIRE_DAYS` (default 2). See `backend/app/core/config.py`.
- Scheme is `OAuth2PasswordBearer(tokenUrl="/auth/login")` (`backend/app/core/deps.py:16`).
- `get_current_context()` (`backend/app/core/deps.py:29-57`) rejects non-`access` tokens, reloads the `User` row on every request, and rejects inactive users. There are no server sessions and no SSO.
- Frontend behavior: per-app `localStorage` token keys, `Authorization: Bearer` header, single silent refresh on 401 via `POST /auth/refresh`, boot restore via `GET /auth/me`.

## Authorization (RBAC)

- `require_role(*roles)` (`backend/app/core/deps.py:60-69`) returns 403 on mismatch; routers declare their roles per route (see `docs/API.md`).
- All 20 MCP capability tools declare `allowed_roles`; denied calls are still audited (`backend/app/mcp_server/tools/_base.py`, `backend/app/mcp_server/middleware/`).
- Patients may only book for their own `user_id` (enforced inside the write tools).

## Multi-tenancy

- The reloaded database user row is authoritative; the token's `hospital_id` claim is treated as a hint only.
- `hospital_scoped_query()` (`backend/app/core/tenant.py:9-19`) filters tenant queries; only `platform_admin` bypasses scoping.
- Registration enforces `hospital_id` required for `hospital_admin`/`doctor` and forbidden for other roles (`backend/app/domain/auth/router.py`).

## AI / voice safety boundaries

- Booking writes require explicit user confirmation (`_booking_confirmation_gate` in `backend/app/ai/agent/orchestrator.py`) and an `idempotency_key`; slot reservation uses a `FOR UPDATE` lock plus a unique backstop (409 on conflict).
- Telephone calls start `UNVERIFIED`; only 6 tools are callable before identity verification (`verify_caller_identity`, `transfer_to_human`, `search_hospitals`, `search_doctors`, `check_availability`, `get_context` in `backend/app/ai/agent/orchestrator.py:281-290`). `verify_caller_identity` allows 3 attempts, then human transfer.
- Twilio webhook validates HMAC-SHA1 (`X-Twilio-Signature`) when `TWILIO_AUTH_TOKEN` is set and returns 503 when `TELEPHONY_STREAM_URL` is empty (`backend/app/voice/telephony/twilio_webhook.py`).
- EHR writes are verified before confirmation; unknown/divergent outcomes park in reconciliation for operators.

## Secrets handling

- Secrets come from environment only (`pydantic-settings`; see `backend/app/core/config.py`, `infra/.env.example`, `backend/.env.example`).
- `.env` files are gitignored (`.gitignore`); only `.env.example` files are committed. Never commit `.env`, `*.pem`, `*.key`, `*.p12`, or `.env.vault` (all ignored).
- LLM/STT/Twilio keys are optional for local runs: chat fails closed without LLM keys, STT defaults to `stub`, telephony webhook returns 503 without a stream URL.

## Logging / audit

- `CorrelationIdMiddleware` plus `tracing.span` for request tracing; audit and capability-execution tables record auth, tool use, appointment history, and audit events (surfaced via `/observability/*`, `/platform/audit-events`, hospital AI-activity views).

## Reporting a vulnerability

Do not open a public issue for sensitive reports. Contact the repository maintainer privately with: affected component, reproduction steps, and impact. Do not include real credentials, tokens, or patient data in the report. Unsupported guarantees are not made; fixes are prioritized by severity and exposure.
