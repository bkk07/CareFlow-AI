# OpenCode Prompts

Implementation prompts used for each build phase, recorded verbatim so the
build can be reproduced or audited. Source of truth for phase scope is
`build-plan-deep-dive.md` (do not modify that file).

## Phase 0 â€” Scaffolding

> Read the `buildplan.md` file and find the phase I specify.
>
> For example: "Build Phase 1"
>
> Before implementing:
> 1. Read the complete Phase 1 requirements from `buildplan.md`.
> 2. Inspect the existing project structure and code.
> 3. Check what has already been implemented.
> 4. Implement ONLY Phase 1. Do not implement future phases.
> 5. Follow the architecture and tech stack defined in the project.
> 6. Add the required tests and run them.
> 7. Fix any errors found during testing.
> 8. Verify the phase against its completion/acceptance criteria.
>
> Also create or update:
>
> `docs/opencode-prompts.md`
>
> Add the exact prompt/instructions used for this phase under the correct phase heading so that the implementation prompt is documented.
>
> Do not modify `buildplan.md`.
>
> At the end, report:
> - What was implemented
> - Files created/modified
> - Tests added/run
> - Test results
> - Whether the phase acceptance criteria are satisfied

Notes on execution (Phase 0):

- No `buildplan.md` existed in the repo; `build-plan-deep-dive.md` was used
  as the phase plan, and `architecture-design.md` as the stack authority.
- Requested phase at runtime: **Phase 0 â€” Scaffolding**.
- Scope implemented: backend FastAPI skeleton (`app/main.py`,
  `app/core/config.py`, `app/core/db.py`, `app/api/health.py`, Alembic
  `env.py` wired to `core.db` metadata), patient Vite app shell
  (`frontend/apps/patient/src/main.tsx`), shared Axios client
  (`frontend/shared/api/client.ts`), shadcn placeholder
  (`frontend/shared/ui/`), infra compose with postgres/redis/backend/frontend
  plus `infra/.env.example` covering every required key.
- No Phase 1+ code (auth, models, routers) was added.

## Phase 1 â€” Auth, RBAC, Tenant Isolation

> after every phase commit changes okay . do not commit like phase 0 completed do like feat fix like that do not add phase okay first commit the changes and start phaase 1

Notes on execution (Phase 1):

- Committed the pending scaffolding first as
  `feat: scaffold FastAPI backend, patient web shell and container stack`
  (conventional style, no phase reference).
- Scope implemented exactly per `build-plan-deep-dive.md` Phase 1: `User`
  model with all four roles, Argon2 password hashing, short-lived access
  (15 min) + long-lived refresh (7 day) JWTs, `RequestContext` /
  `require_role` / `hospital_scoped_query`, and
  `POST /auth/register, /auth/login, /auth/refresh` plus `GET /auth/me`.
- `get_current_context()` re-loads the user row on every request and takes
  `hospital_id` from the DB, so stale JWT claims can never widen scope;
  deactivated users are rejected on login, authenticated calls, and refresh.
- No Phase 2+ code (hospitals, doctors, scheduling) was added.

## Hospital Onboarding

> next phase

Notes on execution (hospital onboarding):

- Scope implemented exactly per `build-plan-deep-dive.md` Phase 2:
  `Hospital` model with the full lifecycle enum, `AuditEvent` model +
  `write_audit_event()` helper in `app/core/audit.py` (single choke point
  for all later domains), service functions
  `register_hospital()/approve()/reject()/suspend()`, and endpoints
  `POST /hospitals`, `GET /hospitals/{id}`,
  `GET /platform/hospitals?status=`,
  `POST /platform/hospitals/{id}/{approve,reject,suspend}`.
- Registration creates Hospital(status=submitted) + first hospital-admin
  User in one transaction; duplicate contact email â†’ 409 pre-check plus
  unique constraint + IntegrityError fallback for races.
- `assert_hospital_approved()` is the go-live gate booking/configuration
  flows must call; the "un-approved hospital cannot create doctors" check
  is tested directly against it since the doctor domain does not exist yet.
- `X-Correlation-ID` header (or a generated UUID) is stored on every audit
  row; `rejection_reason` is returned by `GET /hospitals/{id}` so it is
  visible to the hospital admin.
- No Phase 3+ code (configuration, doctors, scheduling) was added.

## Hospital Configuration + Doctor Management

> Next Phase
>
> continue

Notes on execution (hospital configuration + doctor management):

- Scope implemented exactly per `build-plan-deep-dive.md` Phase 3:
  `Department` / `Specialty` / `AppointmentType` models plus full CRUD
  routers under `/hospitals/{id}/...`, and the `Doctor` domain
  (`models.py`, `service.py`, `router.py`) with CRUD plus
  `POST .../doctors/{id}/activate|deactivate`.
- Routers use `require_role(hospital_admin)` plus a shared
  `require_managed_hospital` dependency (404 unknown hospital, 403 other
  hospital, 403 un-approved hospital via the Phase 2 go-live gate), and
  list queries go through `hospital_scoped_query`.
- Activation requires specialty + department + at least one compatible
  appointment type (empty compatible list counts as universal);
  deleting a referenced specialty/department is blocked with 409;
  `external_provider_id` is unique per hospital.
- Minimal hospital-admin frontend (`frontend/apps/hospital-admin`, login +
  table+form screens for all four entities) builds cleanly; compose stack
  left untouched.
- No Phase 4+ code (scheduling, patients, EHR) was added.

## Calendar & Availability

> OKAY implemenet phase 4

Notes on execution (calendar & availability):

- Scope implemented exactly per `build-plan-deep-dive.md` Phase 4:
  `Calendar` / `AvailabilityRule` / `BlockedSlot` models, pure engine in
  `availability.py`, orchestration + locking in `service.py`, and router
  with calendar, rules, blocks, and slot lookup endpoints.
- `get_available_slots()` follows the specified five steps (active doctor
  + active calendar, rule expansion, blocked subtraction, booked
  subtraction via a `booked` parameter Phase 7 will feed, compatibility
  + duration filtering); `reserve_slot()` re-checks overlap then inserts,
  with UNIQUE(doctor_id, start, end) collapsing racers to one winner.
- Precedence documented in code: per date, covering one_off rules win
  over weekly rules; windows union within the tier; slots must fit
  entirely in one window; touching boundaries are not overlaps; all
  timestamps UTC, naive inputs rejected at the edges.
- No Phase 5+ code (patients, EHR, appointments) was added.

## Patient Management

> Next Phase 5

Notes on execution (patient management):

- Scope implemented exactly per `build-plan-deep-dive.md` Phase 5:
  `UserPreferences` model (nullable doctor/hospital/type refs plus
  time-of-day and consultation-mode enums), service layer, and router
  with `GET/PUT /patients/me` and `GET/PUT /patients/me/preferences`.
- All four endpoints are self-scoped by caller id and restricted to the
  patient role; nothing is filtered by hospital, keeping patient
  identity hospital-agnostic. Fresh patients get null-default
  preferences (auto-provisioned), never errors; reference ids are
  existence-checked on write (422 on unknown).
- Patient frontend gained routed `Home` / `Profile` / `Preferences`
  empty-state shells (react-router-dom); pages show sign-in, loading,
  and empty states gracefully.
- No Phase 6+ code (EHR, appointments, reliability) was added.

## Mock EHR + Integration Layer

> next phase

Notes on execution (mock EHR + integration layer):

- Scope implemented exactly per `build-plan-deep-dive.md` Phase 6:
  `EHRConnector` protocol + typed errors in `connector_interface.py`;
  mock vendor mini-app in `mock_ehr/` (models, vendor-shaped router with
  patient/provider/facility lookup-or-create and appointment
  create/retrieve/update/cancel plus idempotency-key lookup,
  `fault_injection.py` with all six modes behind a demo-env-gated
  `_debug` switch, HTTP `MockEHRConnector`); `ExternalIdentifierMapping`
  + `get_or_create_mapping()`; and `IntegrationService` as the only
  connector caller (vendor sync on first use, never hardcoded ids).
- Transports are pluggable: real HTTP in production, in-process calls in
  tests. `create_but_no_response` persists then answers 504 so recovery
  must go through idempotency-key lookup, never blind retry.
- No Phase 7+ code (appointments, reliability, agent) was added.

## Cross-cutting audit (all work to date)

> check are you implemented as it is upto the phase 6 any missing or not if missing fix

Notes on execution (audit):

- Audited every file, field, endpoint, rule, and test item against the
  phase plan and the architecture rules; ran the full suite plus
  migration, compose, and frontend build checks.
- Findings fixed: `reserve_slot` now takes the doctor calendar row lock
  (`FOR UPDATE` on supporting dialects) alongside the UNIQUE backstop,
  `get_or_create_calendar` handles creation races, and the env-example
  key test covers every current settings key.
- Everything else matched the plan; no scope was added or removed.

## Appointment Core

> okay now impleemnt next phase

Notes on execution (Phase 7 — Appointment Core):

- Implemented the plan's data model verbatim (`Appointment` with all ten
  states plus `external_id`/`idempotency_key`/`correlation_id`, and
  append-only `AppointmentHistory`), the explicit `ALLOWED_TRANSITIONS`
  map with `InvalidTransition` on any other write, and the
  create/reschedule/cancel service on top of the Phase 4 lock+reserve
  pattern and the Phase 6 `IntegrationService` (the only connector
  caller — no vendor calls from the booking code).
- Booking flow per plan: availability re-check (rules minus blocks minus
  live appointments) -> reserve -> `pending` row -> vendor create ->
  `confirmed`, else release the held slot and mark `failed`. Reschedule
  reserves the new slot first and releases the old one only after the
  vendor confirms; cancel releases the slot with the booking.
- Endpoints are exactly the plan's five (`POST /appointments`, `POST
  .../reschedule`, `POST .../cancel`, `GET .../{id}` with history,
  `GET /appointments` with `patient_id`/`doctor_id`/`hospital_id`
  filters), open to the owning patient and the hospital_admin of the
  appointment's hospital (+ platform_admin read-only). Idempotent replay
  answers 200 with the existing row; a fresh booking answers 201.
- One deployment fix outside the phase files: the backend image never
  ran migrations, so a fresh `compose up` served 500s on every DB
  write — `backend/Dockerfile` now runs `alembic upgrade head` before
  uvicorn (found via live smoke, verified with a from-scratch stack).
- No Phase 8+ code (verification loop, reconciliation sweeps, MCP/AI)
  was added; `requested`/`sync_pending`/`reconciliation_required` exist
  as states with transitions so Phase 8 can drive them.

## Verification, Synchronization, Reconciliation

> next phase

Notes on execution (Phase 8 — Verification, Synchronization, Reconciliation):

- New `app/reliability/` package: `failure_classifier.py` (typed errors
  to `TRANSIENT_RETRYABLE` / `NOT_RETRYABLE_VALIDATION` / `RATE_LIMITED`
  / `UNKNOWN`, cap of 2 attempts with 1s/2s backoff), `verification/`
  (re-reads the vendor record after every success and diffs times plus
  identifier linkage — never trusts a 200 blindly),
  `synchronization/` (single `diff_appointment` matcher plus
  query-then-confirm adoption from idempotency-key lookups), and
  `reconciliation/` (the unknown-outcome algorithm: validation dies
  fast, everything else queries before any same-key retry, then parks
  in a live state with the slot still held and an open work item).
- Booking now answers 201 confirmed, 202 parked (`sync_pending` /
  `reconciliation_required`), or 502 only for definitive failure.
  Operator API: list/detail/retry/resolve for reconciliation records,
  tenant-scoped, with `resolution_status` as an indexed column for the
  Phase 13 dashboard. Retry auto-closes the record when vendor and
  internal agree again.
- Supporting changes: `ExternalAppointment` gained vendor linkage ids
  (additive defaults; the mock connector populates them),
  `rescheduled` gained edges to/from `reconciliation_required`, and the
  appointment slot-release helper moved to scheduling for shared use.
- Live fault smoke on a from-scratch stack: blackhole create still
  books `confirmed` with one vendor row; vendor-dark books park 202
  with an open record (2 bounded attempts, slot held); clearing the
  fault and retrying resolves to `confirmed` with an empty queue.
- No frontend this phase (precedent: Phase 6) — the ops surface is the
  API the Phase 13 dashboard will consume. No Phase 9+ code was added.

## MCP Server + AI Agent (text)

> next phase

Notes on execution (Phase 9 — MCP Server + AI Agent):

- `app/mcp_server/` package: `mcp_tool` decorator (role allow-list,
  idempotency-key requirement, per-call `CapabilityExecution` audit
  row incl. denied calls, single retry of transient faults for
  read-only tools), 17 capability modules (the plan says "16" but
  lists 17 files — the file list wins), and `server.py` with the
  registry plus `GET /mcp/tools` / `POST /mcp/call`. Booking tools
  reuse the Phase 7/8 services unchanged, so reconciliation fires
  identically through chat and raw API. Phase 10/11 capabilities are
  registered but answer honest 501s.
- `app/ai/`: Redis-backed `AIContext` (in-memory fallback, 2h TTL;
  selections/offered slots/pending items — never durable prefs),
  orchestrator with the plan''s system prompt, a deterministic
  pre-check that declines purely clinical messages (scheduling intent
  still flows), an 8-iteration cap, and GROQ via httpx
  (OpenAI-compatible, no new SDK). `transfer_to_human` persists an
  `Escalation` row; migration `0009_mcp_agent` adds both tables.
- Live smoke on a from-scratch stack: 17 tools listed, real slots
  via tool, vendor-dark booking parks through the tool path and an
  operator retry resolves it to confirmed, clinical chat declines
  with zero iterations, keyless chat answers 503.
- Two live findings fixed: `backend/.env` (with a real GROQ key) was
  baked into the image by `COPY . .` — added `backend/.dockerignore`;
  the default model `llama-3.3-70b-versatile` is retired on GROQ
  (verified against /models) — default is now `openai/gpt-oss-20b`
  with a live hello-agent round-trip. Model-backend failures map to
  502 at `/chat`, mirroring the EHR path.
- `ChatDebug.tsx` (patient app, dev-only label) posts to `/chat`.
  No Phase 10+ logic was added.

## Cross-phase fix pass (Phases 0-9)

> check upto phase any fixes need or not

Findings and fixes (all verified, no new phases):

- `POST /mcp/call` returned 500 for malformed tool input
  (pydantic `ValidationError` escaped the registry) and for
  tool-level `ValueError`s (e.g. blank `conversation_id`).
  `execute_tool` now maps both to 422; regression tests added.
- Hospital-admin UI (port 5174) had no CORS origin: preflight from
  `:5174` failed while `:5173` passed. Default
  `BACKEND_CORS_ORIGINS` and `infra/.env.example` now include
  `http://localhost:5174`; preflight regression test added.
- `backend/.env` (with a live GROQ key) was baked into images by
  `COPY . .` — already fixed in Phase 9 with
  `backend/.dockerignore`; re-verified `/code/.env` absent in a
  rebuilt image.
- Removed 7 dead imports across `appointment/router`,
  `reconciliation/service`, `hospital_config/models`,
  `scheduling/models`, `doctor/models`, `hospital/models`
  (AST scan, suite-green after).
- `transfer_to_human` rejected blank `conversation_id`/`reason`
  with 422 instead of storing empty rows.
- `AIContext` store now reuses one Redis client (dropped and
  retried on ping failure) instead of connecting per call;
  `ai/router.py` imports `httpx` at top level.
- Left alone deliberately: untracked `backend/.env.example`
  (key material, pre-existing decision), Phase 10/11 501 stubs,
  patient-visible 200-with-outcome on tool booking (agent relays
  it; REST keeps strict 201/202/502).

## Fix-all sweep (Phases 0-9)

> fix all

Remaining findings and fixes:

- `backend/.env.example` sat untracked although `.gitignore`
  (`!.env.example`) explicitly keeps example files in the repo.
  Verified both values are empty (no secret), dropped the dead
  `GROQ_REASONING_MODEL` line (read by nothing in code), and
  committed it. Real `backend/.env` stays gitignored; a
  `git grep gsk_` sweep confirms no key material is tracked.
- `infra/.env.example` now documents `GROQ_API_KEY` as an accepted
  alias for `LLM_API_KEY`.
- Added a tool reschedule/cancel/synchronize round-trip test over
  `/mcp/call` — the last untested tool paths.
- No TODO/FIXME markers anywhere; unused-import scan clean.

## Workflow Engine + Notifications

> next phase

Notes on execution (Phase 10 — Workflow Engine + Notifications):

- New `app/workflow/` (Celery app on the existing Redis, `event_bus.publish_event`,
  one `handle_event` task with a handler registry, `acks_late` so a killed
  worker redelivers) plus `app/notification/` (real SMTP `send_email`,
  idempotent `create_in_app`/`deliver_email` on a unique `dedupe_key`).
  Migration `0010_workflow`. Compose gains `worker` + `beat` services;
  beat fires an hourly `sweep_tick` (reminders ~24h out, recovery sweep).
- Appointment service publishes `appointment.booked/rescheduled/cancelled`
  only on corroborated outcomes — parked/failed bookings notify nobody.
  Publish never breaks booking: enqueue failure marks the execution
  failed instead of raising.
- Recovery moves to Celery as the classifier comment foresaw: each sweep
  activation re-drives an open record once (`force=True`), capped at 10
  automatic attempts before it rests open for the operator. The operator
  retry endpoint stays synchronous `force=True` (unchanged responses).
  The vendor-consistency check moved from the router into
  `reconcile_service.consistency_note` for shared use.
- `send_notification`/`start_workflow` MCP tools are live (Phase 9 stub
  test narrowed to the questionnaire tools); `GET /notifications`
  serves the patient inbox.
- Verification: 154/154 tests (9 new: async notify via API and chat,
  redelivery dedupe, visible failed executions, email-failure rows,
  reminder + recovery sweeps, live tools). Live smoke on a 7-container
  stack: booking produced a worker-delivered `booking_confirmation`
  (`handle_event succeeded` in worker logs).
- No frontend this phase; no Phase 11+ logic added.

## Pre-Visit Questionnaire

> next phase

Notes on execution (Phase 11 — Pre-Visit Questionnaire):

- New `app/domain/questionnaire/` (models/service/router/schemas):
  sets scoped to hospital/specialty/doctor/appointment_type with
  doctor > type > specialty > hospital precedence, ordered typed
  questions (choice kinds must carry options), responses as drafts
  until all required are answered. Migration `0011_questionnaire`.
- Validation splits hard errors (unknown keys, wrong types -> 422)
  from missing-required (draft, `completed=false`), so partial saves
  work and the agent can iterate. The concern flag is a keyword rule
  over free text (`FLAG_PHRASES`) that opens an `Escalation` — no
  medical interpretation anywhere.
- `get/submit_questionnaire` tools are live with the completion and
  flag protocol; the doctor role can view responses (dashboard stub
  for Phase 13). Agent guard in three places: system prompt section,
  full tool description (the registry now ships whole docstrings to
  the model, not first lines), and `completed`/`missing_required`
  gating in the tool result.
- Verification: 165/165 tests (11 new: precedence, drafts, type
  errors, flag escalation, doctor view, conversational completion).
  Live smoke on postgres: resolve -> submit -> completed + flagged
  escalation. No frontend, no compose changes, no Phase 12+ code.

## Web Voice

> next phase

Notes on execution (Phase 12 — Web Voice):

- New `app/voice/`: energy-VAD over PCM16 (`vad.py`, no native deps —
  the gate matters because Whisper hallucinates on silence),
  STT/TTS provider pairs with test hooks, session manager bridging
  WS connections to Phase 9 AIContext, and `web_voice/ws_handler.py`
  serving `/voice/ws` (JSON frames: audio/partial/final/agent_text/
  audio_out/interrupt/state/ended).
- STT verified live on GROQ Whisper (`whisper-large-v3-turbo`, 200).
  TTS cannot go live: `playai-tts` is decommissioned and the current
  `canopylabs/orpheus-v1-english` needs org terms acceptance
  (400 verified). `GroqTTS` targets the documented endpoint so it
  works once accepted; stub stays default, failures surface as
  `error` frames, never silence.
- Plan edge cases, enforced in code: partials are display-only and
  never reach the orchestrator (no writes off guesses); barge-in is
  real — the turn runs as a task while the loop keeps pumping, so
  the interrupt flag aborts both the LLM loop (`should_stop`, new)
  and the per-sentence TTS stream (a queued-until-done design failed
  its own test and was replaced); silence re-prompts once, then
  ends with a human `Escalation`.
- Frontend: `useWebRTCAudio` hook (AudioWorklet capture, WAV
  playback queue, interrupt kills local audio AND signals server)
  plus a dev `VoiceChat` page. Deviation: the hook lives in the
  patient app, not `frontend/shared/voice` — no workspace root
  exists, so the shared path resolves neither `react` for tsc nor
  the bundle, and the app-only Docker context would break the
  image. Reverted the `fs.allow` tweak with it.
- Verification: 174/174 tests (9 new: VAD, auth, partials-run-
  nothing, full booking by voice, mid-turn barge-in with blocked
  TTS, silence->escalation, orchestrator stop). Live smoke over a
  real socket: ready -> reprompt spoken -> stub-TTS error frame ->
  ended(silence) with escalation id. No migration, no Phase 13+ code.
