# CareFlow AI — API Reference

Source-grounded reference. Verified against `backend/app/main.py` (22 `include_router` calls, no extra prefixes at include time), per-router `APIRouter(prefix=...)` definitions, `backend/app/core/deps.py`, `backend/app/core/tenant.py`, and `backend/app/core/config.py`.

Machine-readable source: run the backend and open `/openapi.json` (also `/docs` Swagger UI, `/redoc`). `FastAPI(title="CareFlow AI", version="0.1.0")` is constructed in `backend/app/main.py:31` with no custom `docs_url`/`openapi_url`, so the default OpenAPI endpoints are available.

Base URL locally: `http://localhost:8000`. Production fallback compiled into frontends: `https://careflow-ai-production.up.railway.app` (see `frontend/apps/*/src/api.ts`).

## Conventions

- Auth: `Authorization: Bearer <access_token>` unless marked public. Token scheme is `OAuth2PasswordBearer(tokenUrl="/auth/login")` (`backend/app/core/deps.py:16`).
- `get_current_context()` (`backend/app/core/deps.py:29-57`): requires a JWT with `type == "access"`, reloads the `User` row from the database, rejects inactive users. The database row is authoritative for `role`/`hospital_id`; the token's `hospital_id` claim is not trusted.
- `require_role(*roles)` (`backend/app/core/deps.py:60-69`): returns 403 on role mismatch.
- `hospital_scoped_query()` (`backend/app/core/tenant.py:9-19`): non-`platform_admin` queries are filtered to `model.hospital_id == ctx.hospital_id`. Only `platform_admin` bypasses scoping.
- Correlation IDs: `CorrelationIdMiddleware` (`backend/app/observability/correlation.py`, wired in `backend/app/main.py:42`) pins an ID per request and echoes it back; appointment writes store it in history.
- Roles: `platform_admin | hospital_admin | doctor | patient` (see `users.role`).

## Health / root

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/` | public | `backend/app/main.py:68`, `{"service":"careflow-ai","status":"ok"}` |
| `GET` | `/health` | public | `backend/app/api/health.py:8`, `{"status":"ok"}` |

## Auth (`backend/app/domain/auth/router.py`, `prefix="/auth"`, `tags=["auth"]`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/auth/register` | public | `201`. Requires `hospital_id` for hospital-scoped roles (`hospital_admin`, `doctor`); forbidden otherwise |
| `POST` | `/auth/login` | public | OAuth2 password flow, returns access + refresh tokens |
| `POST` | `/auth/refresh` | public + refresh token in body | Rejects non-`refresh` token types and inactive users |
| `GET` | `/auth/me` | `get_current_context` | Session restore / boot |
| `GET` | `/auth/platform-ping` | `require_role(platform_admin)` | Platform-only check |

Token lifetimes (see `backend/app/core/config.py`): access `ACCESS_TOKEN_EXPIRE_MINUTES` (default 2880 = 2 days), refresh `REFRESH_TOKEN_EXPIRE_DAYS` (default 2). Algorithm `HS256` (`backend/app/core/security.py`).

## Appointments (`backend/app/domain/appointment/router.py`, `tags=["appointments"]`)

Reader/writer splits are defined in-module: booker = `patient, hospital_admin`; reader adds `platform_admin, doctor`; close-reader = `doctor, hospital_admin, platform_admin`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/appointments` | booker | Booking + EHR sync. Documented outcomes: `201` created, `200` idempotency replay, `202` `sync_pending`, `502` failed |
| `GET` | `/appointments` | reader | Role-forced filters (patient → self, doctor → linked doctor, hospital admin → own hospital) |
| `GET` | `/appointments/{appointment_id}` | reader + ownership check | |
| `POST` | `/appointments/{appointment_id}/reschedule` | booker + access check | |
| `POST` | `/appointments/{appointment_id}/cancel` | booker + access check | |
| `POST` | `/appointments/{appointment_id}/complete` | close-reader | Doctor completion path |
| `POST` | `/appointments/{appointment_id}/no-show` | close-reader | |
| `POST` | `/appointments/{appointment_id}/confirm` | close-reader | Confirm after EHR verification |

Booking writes require an `idempotency_key` and are race-guarded (unique backstop → HTTP 409 on slot conflict).

## Hospitals + onboarding (`backend/app/domain/hospital/router.py`, `tags=["hospitals"]`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/hospitals` | public | Hospital registration → `submitted` |
| `GET` | `/hospitals/{hospital_id}` | authenticated + manual check (`platform_admin` or owning `hospital_admin`) | |
| `PUT` | `/hospitals/{hospital_id}` | `hospital_admin` + own hospital | |
| `GET` | `/hospitals/{hospital_id}/staff` | `hospital_admin` + own | |
| `POST` | `/hospitals/{hospital_id}/staff` | `hospital_admin` + own | Invite `hospital_admin` |
| `DELETE` | `/hospitals/{hospital_id}/staff/{user_id}` | `hospital_admin` + own | Soft-deactivate (`204`); no self-delete |
| `GET` | `/platform/hospitals?status=` | `platform_admin` | Application queue |
| `POST` | `/platform/hospitals/{hospital_id}/approve` | `platform_admin` | |
| `POST` | `/platform/hospitals/{hospital_id}/reject` | `platform_admin` | Body: review reason |
| `POST` | `/platform/hospitals/{hospital_id}/suspend` | `platform_admin` | |
| `POST` | `/platform/hospitals/{hospital_id}/reinstate` | `platform_admin` | |
| `POST` | `/platform/hospitals/{hospital_id}/start-review` | `platform_admin` | |
| `POST` | `/platform/hospitals/{hospital_id}/request-corrections` | `platform_admin` | Body: corrections payload |
| `POST` | `/hospitals/{hospital_id}/resubmit` | `hospital_admin` + own | After corrections |

## Hospital dashboard (`backend/app/domain/hospital/dashboard.py`, `tags=["hospital-dashboard"]`)

All require `hospital_admin` + managed (approved + own) hospital.

| Method | Path | Auth |
|---|---|---|
| `GET` | `/hospitals/{hospital_id}/overview` | hospital admin |
| `GET` | `/hospitals/{hospital_id}/ai-activity?tool=&status=&limit=` | hospital admin |
| `GET` | `/hospitals/{hospital_id}/integration-status` | hospital admin |
| `GET` | `/hospitals/{hospital_id}/analytics` | hospital admin |

## Platform (`backend/app/domain/hospital/platform.py`, `tags=["platform"]`)

All require `platform_admin`.

| Method | Path | Query |
|---|---|---|
| `GET` | `/platform/doctors` | `?hospital_id=` |
| `GET` | `/platform/patients` | `?limit=` |
| `GET` | `/platform/appointments` | `?hospital_id=&state=` |
| `GET` | `/platform/ai-evaluation` | |
| `GET` | `/platform/audit-events` | `?action=&hospital_id=&limit=` |
| `GET` | `/platform/overview` | |
| `GET` | `/platform/integrations` | |
| `GET` | `/platform/analytics` | |

## Hospital catalog (`backend/app/domain/hospital_config/router.py`, `tags=["hospital-config"]`)

Writes require a managed hospital; lists additionally require `hospital_admin` + `hospital_scoped_query`.

| Method | Path |
|---|---|
| `GET` / `POST` | `/hospitals/{hospital_id}/departments` |
| `GET` / `PUT` / `DELETE` | `/hospitals/{hospital_id}/departments/{department_id}` |
| `GET` / `POST` | `/hospitals/{hospital_id}/specialties` |
| `GET` / `PUT` / `DELETE` | `/hospitals/{hospital_id}/specialties/{specialty_id}` |
| `GET` / `POST` | `/hospitals/{hospital_id}/appointment-types` |
| `GET` / `PUT` / `DELETE` | `/hospitals/{hospital_id}/appointment-types/{appointment_type_id}` |

## Doctors (`backend/app/domain/doctor/router.py`, `tags=["doctors"]`)

| Method | Path | Auth |
|---|---|---|
| `GET` / `POST` | `/hospitals/{hospital_id}/doctors` | admin-scoped (see module) |
| `GET` / `PUT` / `DELETE` | `/hospitals/{hospital_id}/doctors/{doctor_id}` | managed hospital |
| `POST` | `/hospitals/{hospital_id}/doctors/{doctor_id}/activate` | managed hospital |
| `POST` | `/hospitals/{hospital_id}/doctors/{doctor_id}/deactivate` | managed hospital |
| `POST` | `/hospitals/{hospital_id}/doctors/{doctor_id}/suspend` | managed hospital |
| `POST` | `/hospitals/{hospital_id}/doctors/{doctor_id}/invite` (`201`) | `hospital_admin` + managed |
| `DELETE` | `/hospitals/{hospital_id}/doctors/{doctor_id}/login` | `hospital_admin` + managed |
| `GET` / `PUT` | `/doctors/me` | `doctor` (linked doctor) |
| `GET` | `/doctors/me/appointments?range=today\|upcoming` | `doctor` |
| `GET` | `/doctors/me/questionnaire-responses` | `doctor` |
| `GET` | `/doctors/me/calendar` | `doctor` |
| `GET` | `/doctors/me/questionnaire-responses/{appointment_id}` | `doctor` |

## Directory (`backend/app/domain/directory/router.py`, `tags=["directory"]`)

Reader: `patient, hospital_admin, platform_admin`. Only approved hospitals are returned.

| Method | Path |
|---|---|
| `GET` | `/directory/specialties?hospital_id=` |
| `GET` | `/directory/appointment-types?hospital_id=` |

## Patients (`backend/app/domain/patient/router.py`, `prefix="/patients"`, `tags=["patients"]`)

All require `patient`.

| Method | Path |
|---|---|
| `GET` / `PUT` | `/patients/me` |
| `GET` / `PUT` | `/patients/me/preferences` |
| `GET` / `PUT` | `/patients/me/contact` (phone used by telephony verification) |
| `GET` | `/patients/me/appointments` |
| `GET` | `/patients/me/appointments/{appointment_id}` |

## Questionnaires (`backend/app/domain/questionnaire/router.py`, `tags=["questionnaires"]`)

Admin = `hospital_admin`; answerer = `patient, hospital_admin, doctor`; viewer adds `platform_admin`.

| Method | Path | Auth |
|---|---|---|
| `POST` (`201`) / `GET` | `/hospitals/{hospital_id}/questionnaires` | admin + managed |
| `POST` (`201`) | `/hospitals/{hospital_id}/questionnaires/{questionnaire_id}/questions` | admin + managed |
| `GET` / `PUT` / `DELETE` (`204`) | `/hospitals/{hospital_id}/questionnaires/{questionnaire_id}` | admin + managed |
| `PUT` / `DELETE` (`204`) | `/hospitals/{hospital_id}/questionnaires/questions/{question_id}` | admin + managed |
| `GET` | `/appointments/{appointment_id}/questionnaire` | answerer |
| `POST` | `/appointments/{appointment_id}/questionnaire/responses` | answerer |
| `GET` | `/appointments/{appointment_id}/questionnaire/responses` | viewer |

## Scheduling (`backend/app/domain/scheduling/router.py`, `tags=["scheduling"]`)

All require `hospital_admin` or `doctor` + own/approved hospital; doctors are pinned to their linked record.

| Method | Path |
|---|---|
| `GET` / `PUT` | `/hospitals/{hospital_id}/doctors/{doctor_id}/calendar` |
| `GET` / `POST` (`201`) | `/hospitals/{hospital_id}/doctors/{doctor_id}/availability-rules` |
| `DELETE` (`204`) | `/hospitals/{hospital_id}/doctors/{doctor_id}/availability-rules/{rule_id}` |
| `GET` / `POST` (`201`) | `/hospitals/{hospital_id}/doctors/{doctor_id}/blocked-slots` |
| `DELETE` (`204`) | `/hospitals/{hospital_id}/doctors/{doctor_id}/blocked-slots/{block_id}` |
| `GET` | `/hospitals/{hospital_id}/doctors/{doctor_id}/slots?date_from=&date_to=&appointment_type_id=` |

## Mock EHR (`backend/app/integration/mock_ehr/router.py`, `prefix="/mock-ehr"`, `tags=["mock-ehr"]`)

Unauthenticated by design (vendor boundary). Debug fault-mode routes are additionally gated to local/test/dev environments.

| Method | Path |
|---|---|
| `GET` / `POST` | `/mock-ehr/_debug/fault-mode` |
| `POST` | `/mock-ehr/patients/lookup` |
| `POST` | `/mock-ehr/providers/lookup` |
| `POST` | `/mock-ehr/facilities/lookup` |
| `GET` | `/mock-ehr/appointments/by-key/{idempotency_key}` |
| `POST` (`201`) | `/mock-ehr/appointments` |
| `GET` | `/mock-ehr/appointments/{appointment_id}` |
| `PUT` | `/mock-ehr/appointments/{appointment_id}` |
| `DELETE` | `/mock-ehr/appointments/{appointment_id}` |

## Chat / AI (`backend/app/ai/router.py`, `tags=["chat"]`)

| Method | Path | Auth | Body |
|---|---|---|---|
| `POST` | `/chat` | `require_role(patient, hospital_admin)` | `ChatIn{message, conversation_id, latitude, longitude, selection}` |

Response is `ChatOut` with a conversational `reply` plus structured UI fields (doctors, slots, appointment types, day schedule, pending booking, booking stage). Requires an LLM key; without one the call fails closed (see `docs/AI_EVAL.md`).

## MCP (`backend/app/mcp_server/server.py`, `tags=["mcp"]`)

Custom in-process capability layer (not the MCP protocol SDK). 20 tools asserted in `server.py:82`.

| Method | Path | Auth | Body |
|---|---|---|---|
| `GET` | `/mcp/tools` | `get_current_context` | — |
| `POST` | `/mcp/call` | `get_current_context` | `{tool, input}` |

Tool-level `allowed_roles` are enforced per tool, and denied calls are still audited. See `docs/AI_EVAL.md` for the tool list.

## Escalations (`backend/app/mcp_server/escalations.py`, `tags=["escalations"]`)

Operator: `hospital_admin, platform_admin` (hospital admins forced to their own hospital).

| Method | Path |
|---|---|
| `GET` | `/escalations?status=&hospital_id=` |
| `POST` | `/escalations/{escalation_id}/resolve` |

## Notifications (`backend/app/notification/router.py`, `tags=["notifications"]`)

Reader: `patient, doctor`; users can only see their own inbox (otherwise 404).

| Method | Path |
|---|---|
| `GET` | `/notifications` |
| `POST` | `/notifications/read-all` |
| `GET` | `/notifications/{notification_id}` |
| `POST` | `/notifications/{notification_id}/read` |
| `DELETE` (`204`) | `/notifications/{notification_id}` |

## Workflows (`backend/app/workflow/router.py`, `tags=["workflows"]`)

Requires `hospital_admin` or `platform_admin`; hospital admins are forced to their own hospital via the linked appointment.

| Method | Path |
|---|---|
| `GET` | `/workflows?event_type=&status=&hospital_id=&limit=` |

## Observability (`backend/app/observability/router.py`, `prefix="/observability"`, `tags=["observability"]`)

Any authenticated user (`get_current_context`).

| Method | Path |
|---|---|
| `GET` | `/observability/trace/{correlation_id}?appointment_id=` |
| `GET` | `/observability/metrics` |

## Reliability / reconciliation (`backend/app/reliability/router.py`, `tags=["reconciliation"]`)

Operator: `hospital_admin, platform_admin`.

| Method | Path |
|---|---|
| `GET` | `/reconciliation/records` |
| `GET` | `/reconciliation/records/{record_id}` |
| `POST` | `/reconciliation/records/{record_id}/retry` |
| `POST` | `/reconciliation/records/{record_id}/resolve` |
| `GET` | `/operations` |
| `POST` | `/operations/{operation_id}/retry` |

## Voice + telephony

WebSocket routes (`backend/app/voice/router.py`):

| Protocol | Path | Auth |
|---|---|---|
| `WS` | `/voice/ws?token=&resume=` | Custom JWT check (`decode_token`, `type == access`, active user, roles `patient, hospital_admin`; closes `4401` on failure) |
| `WS` | `/voice/telephony/media` | Twilio media-stream params; no end-user JWT (session comes from the webhook-issued `conversation_id`) |

HTTP telephony webhook (`backend/app/voice/telephony/twilio_webhook.py`, `prefix="/voice/telephony"`, `tags=["telephony"]`):

| Method | Path | Auth |
|---|---|---|
| `POST` | `/voice/telephony/inbound` | Public + Twilio HMAC-SHA1 (`X-Twilio-Signature`; skipped only when no `TWILIO_AUTH_TOKEN`). `503` when `TELEPHONY_STREAM_URL` is empty |
| `POST` (`204`) | `/voice/telephony/status` | Public, log-only |
