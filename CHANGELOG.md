# Changelog

No formal releases or tags exist in this repository (`git tag --list` is empty; 56 commits on `main`, 2026-09-16 to 2026-09-20). Entries below summarize verified history only. This file is an unreleased/current-development snapshot.

## Unreleased (current development snapshot, through `fa14263`)

### Backend

- FastAPI modular monolith (`backend/app/main.py`): 22 routers plus `GET /` and `GET /health`; default `/docs`, `/redoc`, `/openapi.json`.
- JWT auth with role-based access and tenant isolation (`4eff0b2`): Argon2 hashing, HS256 access (2 days) + refresh (2 days), per-request DB user reload, `require_role`, `hospital_scoped_query`.
- Hospital onboarding with review workflow and audit trail (`cd00a8e`, `9124103`): draft → submitted → under_review → approved (↔ suspended), rejected → resubmitted, corrections loop, reinstate.
- Hospital catalog CRUD and doctor lifecycle (`e1fda14`, `0a23dde`): departments, specialties, appointment types, invite/activate/deactivate/suspend, login-as support.
- Scheduling engine (`7225bfa`, `dc0560b`): calendars, weekly availability rules, blocked slots, slot computation (62-day window per docs), `FOR UPDATE` reservation lock + unique backstop (409 on conflict).
- Patient profile and preferences (`88980ff`, `aa2eb28`, `70860ab` follow-ups): profile incl. `photo_url` (migration `0023_patient_photo_url`), preferences, contact/phone for telephony verification, hospital cover photos.
- Mock EHR vendor API + integration layer (`1a01036`): connector protocol, fault injection, `trust-but-verify` writes.
- Appointment booking with state machine and vendor sync (`a9c09b8`): 10-state lifecycle with history, idempotency keys.
- Verification, sync, reconciliation (`351acd7`): unknown/divergent outcomes park in `sync_pending` / reconciliation queue with operator retry/resolve.
- MCP capability tools + text scheduling agent (`19c9580`, `cddd3cd`, `88de709`): 20 audited tools, hand-rolled OpenAI-compatible tool loop (`MAX_ITERATIONS=8`), deterministic guards, Redis `AIContext` (TTL 2h).
- Workflow engine with Celery tasks and notifications (`c35fee4`): event bus → Celery worker + beat, SMTP + in-app notifications with dedupe keys.
- Pre-visit questionnaires (`41620f8`, `1253fb6`, `72306ab`): scoped definitions, appointment responses, concern-flag escalation, multi-duration visit lengths.
- Web voice loop (`98432a9`, `69b2c39`, `3230cd6`): `WS /voice/ws` with VAD, barge-in, silence handling; STT via stub (default) or Groq Whisper; TTS moved to browser `speechSynthesis` (`fa14263`, server Orpheus removed).
- Telephone channel (`b43f10c`): Twilio TwiML + media streams, spoken name+DOB verification (3 attempts then human transfer), unverified-call tool allowlist.
- Observability (`e4b7fb0`): correlation IDs, tracing spans, capability metrics, audit events.
- Role dashboards (`f92cdf1`, `8790c1a`): hospital overview/AI-activity/integration/analytics, platform cross-tenant browsers, doctor calendar scope.
- Live-backend frontends + geo + JWT hardening (`8de49e0`, `94b75e4`, `cbab1a7`, `59a9051`, `8f6071a`, `66c94b1`, `4775445`): real-availability booking, location-aware search, silent refresh, IST scheduling, conflict refresh.

### Frontend

- Patient portal (`9f83e76`, `a065c4a`, `e292354`): discovery, 3-step booking wizard, visits, inbox, AI chat, voice, preferences, profile.
- Doctor portal (`c69da91`, `39bdee8`, `8f6071a`): overview, today/upcoming agendas, calendar, availability rules, appointment detail, questionnaires.
- Hospital console (`8902621`, `b68671d`): setup, catalog, doctors, appointments, questionnaires, AI activity, integration, workflows, analytics, staff, ops/recovery.
- Platform console (`2db284d`): applications/onboarding review, cross-hospital browsers, AI/integrations/workflows/analytics/audit/health.
- Operations console (`5bb7cbc`): `/ops/*` recovery views.
- UI system (`e812431`, `e22f010`, `10ada3a`): design-system v2, Framer Motion, Inter typography, stroke icon set.
- Ports: patient 5173, hospital-admin 5174, operations-admin 5176, doctor 5177 (moved in `7a90f99`), platform-admin 5178.
- Deploy config (`7fc4354`, `46000ce`, `70860ab`): `vercel.json` SPA fallback per app, production Railway API fallback, hospital cover photos.

### Infra / deploy

- Local compose (`a640a19`, `1c781ef`): `postgres:16-alpine`, `redis:7-alpine`, backend (API-only), hospital-admin, doctor, worker (`concurrency=2`), beat.
- All-in-one Railway image (`7b58827`): `python:3.13-slim` + embedded redis + supervisor (`start.sh`: DB normalize → wait → migrate → supervisord), `railway.toml` Dockerfile builder with `/health` check.
- Alt-ports override (`infra/docker-compose.alt-ports.yml`): `8001/6380/5179+` for port clashes.

### Testing

- Phase 16 pass (`be43a83`): 28 top-level pytest files plus `unit/` (7), `integration/` (7), `ai/` (5), `ehr/` (10); SQLite + `TestClient` + `TASK_EAGER`; booking-state determinism suite; Playwright `happy_path_spec` + `failure_recovery_spec` (`backend/tests/e2e/`); per-app `tsc --noEmit && vite build`.

### Docs

- `Architecture.md`, `AI_USAGE_AND_TOOLS.md`, `docs/opencode-prompts.md`, `docs/appointment-ai-current-state.md`, `architecture-design.md`, `build-plan-deep-dive.md`, `prompt.txt` (Figma brief), `submission-docs/` PDF exports, `docs/images/` patient/doctor screenshots.
