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

## Cross-phase fix pass (Phases 0-12)

> check is there you missed anything upto now

Findings and fixes (suite 175/175, tree clean):

- Removed 3 more dead imports (`AppointmentState` in the
  reconciliation router, `struct` in the STT provider, `Any` in the
  task base) — AST scan is otherwise clean.
- `STOPPED` was missing from the orchestrator `__all__`; added.
- Voice `_pump_turn` could orphan the agent task on client
  disconnect (task keeps talking to a dead socket) — now cancelled
  in a `finally`.
- Covered two untested paths: submitting answers with no form
  assigned (422) and hospital-admin voice access (allowed).
- Verified clean and left alone: no tracked secrets (`gsk_` grep),
  no TODO/console markers, history order, single migration head,
  questionnaire-returns-null shape, partials/tools separation.

## Dashboards

> next phase (Phase 13 — Dashboards per the plan)

Notes on execution:

- Backend: `/doctors/me/*` (profile, appointments today/upcoming,
  calendar with rules/blocks/live, questionnaire responses) behind a
  new `Doctor.user_id` link admins set on create/update (validated:
  doctor-role login of the same hospital); hospital overview /
  AI activity (new `capability_executions.hospital_id`) /
  integration status / analytics aggregates; platform
  cross-hospital doctors/patients/appointments (new state filter),
  AI evaluation over the Phase 9 log, audit-event viewer.
  Migration `0012_dashboards`.
- HITL gap closed: `resolve` accepts `final_state`, moving the
  booking through the state machine (invalid edges and
  escalate+final_state rejected) — resolving from the UI now
  changes real appointment state, as the plan demands. The
  `/operations/*` paths were not duplicated; the Phase 8
  `/reconciliation/records*` routes are that UI surface.
- Scheduling endpoints now admit doctors scoped to their own
  linked calendar (hospital scoping preserved; patients and
  platform still 403) so the doctor Calendar editor works.
- Frontend: new doctor app on :5176 (login, Today, Upcoming,
  Calendar editor, detail + responses) + compose service; admin app
  admits platform_admin with platform-only tabs and gains
  Overview, AI Activity, Integration, Analytics, and Operations
  (retry / resolve-with-transition / escalate) tabs. CORS += 5176.
- Verification: 185/185 tests (10 new: link validation, ranges,
  calendar scope, doctor response view, overview, AI-activity
  scoping, platform views, AI eval aggregates, resolve-moves-
  state). Live smoke on postgres: doctor upcoming/calendar,
  overview counts, park -> resolve(cancelled) -> booking
  cancelled, doctor UI 200.
- No Phase 14+ code.

## Frontend UX rebuild (all apps)

> research similar applications, rebuild frontend like that, best styles, better UX

Research (Zocdoc pattern, verified via Wikipedia when the live sites
bot-walled): search by specialty/doctor + location first, doctor cards
with photos/specialty/office info, visible free slots per doctor,
one-tap booking for a specific time, online pre-visit forms, provider
agenda SaaS on the other side. Rebuilt toward exactly that:

- Mirrored design system (`src/theme.css` in each app — per-app
  Docker contexts and missing workspace root forbid a real shared
  import): clinical teal + slate, cards, status pills, slot grids,
  step wizard, sidebar shells for staff apps.
- Patient: login page (none existed — tokens were manual), hero
  search with next-available hints, doctor cards with Book buttons,
  3-step booking wizard (type -> week slot grid -> confirm),
  upcoming/past visits with history + reschedule/cancel, inline
  pre-visit questionnaire answering, notifications inbox, profile
  email editing, and a real preferences editor (was read-only).
- New `GET /directory/specialties|appointment-types` (approved
  hospitals only, all signed-in roles) so the UI never asks for raw
  ids; tests in `test_directory.py`.
- Admin + doctor apps: sidebar layout, login cards, themed tables;
  admin keeps every manager, gains nothing removed.
- Verification: 187/187 tests, all three apps `tsc + vite build`
  green, live wizard-chain smoke on postgres (search -> directory
  -> 16 slots -> book confirmed -> visits/inbox/preferences).

## Professional UI pass (all apps)

> build professional UI for this

- Design system v2 (`src/theme.css`, mirrored x3): token scale
  (palette/shadows/radii/focus ring), focus-visible rings,
  button sizes (sm/lg/ghost/danger) with press states, toolbar +
  form-row layouts, row-list rows, skeleton shimmer + spinner +
  typing/mic animations, empty states, banner variants, card tables
  with row hover, dotted status pills, split-card login, floating
  search card over a layered-gradient hero, sticky blur topbar,
  footer, responsive breakpoints (sidebar collapses to top nav),
  prefers-reduced-motion support.
- Patient: hero trust row, search card, skeleton results, upcoming
  rows with Manage links, next-available badges, guided booking
  with skeleton slot grid + sticky confirm summary, visits with
  skeleton/empty states + history timeline rows, inbox with refresh
  + row layout, branded split login, app footer.
- Admin: 142 inline styles -> design-system classes, grouped
  sidebar (Workspace/Catalog/Scheduling/Insights + Platform) with
  human labels, split-card login, danger styling on destructive
  actions. Doctor: same conversion, labeled Schedule sidebar,
  split-card login.
- Verification: tsc+vite builds x3 green, dist asset integrity +
  new-system CSS/hero copy confirmed in all bundles.

## Framer Motion UI redo (all apps)

> use framer motion and do once again whole UI

- Installed `framer-motion` in patient, hospital-admin, doctor.
- New mirrored `src/motion.tsx` per app: shared easing, page /
  list / item / pop variants, <Page> screen wrapper, <Stagger> /
  <Item> lists, <Press> tappable cards; <MotionConfig
  reducedMotion="user"> in every root.
- Patient redone: animated topbar entrance + spinning badge hover,
  AnimatePresence route transitions, staggered hero + search card,
  staggered doctor cards with animated next-slot swap, booking step
  pulse + animated slot grid per week + spring confirm card, visits
  rows/detail/history stagger with expanding reschedule form,
  inbox stagger + spinning refresh, chat bubbles + typing indicator
  with auto-scroll, voice mic swap + pulsing live state, staggered
  preferences, profile edit crossfade, split-login choreography.
- Admin: sliding sidebar, hovering nav buttons, animated tab
  transitions, spring detail panels, motion login + resolve /
  escalate actions. Doctor: same shell treatment + animated detail
  panel and login.
- Verification: builds x3 green, preview serves 200 with bundle
  intact, whileTap/reducedMotion props confirmed in all bundles.

## Dev port allocation

> patient 5173, doctor 5177, hospital-admin 5174

Patient (5173) and hospital-admin (5174) already matched; moved the
doctor app 5176 -> 5177 everywhere it was pinned: vite.config.ts
(server + preview), Dockerfile (EXPOSE + CMD), compose ports +
healthcheck, backend default CORS origins, .env.example. Verified
doctor dev serves HTTP 200 on :5177 and compose config is valid.

## Phase 14 — Telephone

> implement next phase (plan Phase 14, telephone)

- `PatientProfile` (`patient_profiles`, migration `0013_telephony`):
  digit-normalized phone + full name + DOB; `PUT /patients/me/contact`
  registers them, `GET` reads them back.
- `app/voice/telephony/`: `audio.py` (G.711 mu-law both ways, 8k<->16k
  resample, WAV->mulaw, no new deps), `identity.py` (exact + 10-digit
  suffix phone lookup, normalized name/DOB check that never reveals
  stored values), `twilio_webhook.py` (`POST /voice/telephony/inbound`
  -> patient lookup -> TwiML `<Stream>` with caller/patient/
  conversation params, HMAC-SHA1 signature enforced when
  TWILIO_AUTH_TOKEN is set, 503 fail-closed without
  TELEPHONY_STREAM_URL; `/status` logs drops), `media_stream_handler.py`
  (Twilio WS protocol on `/voice/telephony/media`: mulaw decode ->
  upsample -> VAD -> STT -> agent -> per-sentence TTS -> mulaw chunks +
  marks, `clear` on spoken "stop", one silence re-prompt then human
  escalation; unknown-outcome drops fall through to Phase 8 logic).
- Trust: sessions start UNVERIFIED; new `verify_caller_identity` tool
  (name+DOB, 3 attempts then transfer_to_human) flips the flag in
  AIContext; the orchestrator additionally refuses every patient-data
  tool on unverified calls via an allowlist (open reads + verify +
  transfer only) and refreshes the flag mid-turn so the same turn can
  proceed. Registry grows 17 -> 18 tools.
- Verification: 209/209 tests (22 new in `test_telephony.py`: audio
  roundtrip, signature vectors, webhook match/unknown/signature/503,
  contact normalization, suffix lookup, verify success/lockout/
  channel check, gate block + unlock, full call verify->book over a
  real stream socket with a confirmed DB booking, decline path with
  zero capability rows, clean hangup), migration head SQL checked,
  live postgres smoke (contact, TwiML match, fail-closed verify,
  18-tool registry, unknown caller) green. Added `python-multipart`
  (Twilio posts form-encoded; caught by the live smoke).

## Phase 15 — Observability & Audit Polish

> implement next phase (plan Phase 15, observability & audit polish)

- New `app/observability/` package: `correlation.py` (contextvar +
  `CorrelationIdMiddleware`: read/validate/echo `X-Correlation-ID` on
  every request), `tracing.py` (`span()` records timed blocks as audit
  rows under the ambient id — no collector, no new table),
  `metrics.py` (booking success rate, reconciliation depth, chat-turn
  p50/p95 + per-tool latency, workflow/notification/escalation health),
  `router.py` (`GET /observability/trace/{id}` full timeline across
  conversation -> AI decision -> scheduling -> EHR -> workflow ->
  notification, with `?appointment_id=` pivot; `GET /metrics`).
- Audit result: almost everything already carried `correlation_id`,
  but the MCP wrapper minted a fresh one PER TOOL and
  `start_workflow`/`create_appointment` minted their own — the
  conversation->booking link was broken. Fixed: `RequestContext`
  carries the id (middleware fills it), the wrapper reuses + stamps it
  sticky, tools pass it into booking/workflow/notification rows.
- Voice/websocket paths skip middleware, so web voice pins a fresh id
  at connect and telephony derives it (`uuid5`) from the call's
  conversation — the webhook writes a `telephony.inbound` audit row
  with the same id, no shared state needed.
- Notifications gain `correlation_id` (migration `0014_observability`);
  workflow tasks stamp the execution's id; `/chat` wraps each turn in
  a span (the AI-latency signal).
- Verification: 220/209+11 tests (middleware echo/generate, header ->
  execution row, full booking chain sharing one id incl. EHR ops,
  workflow + chat-span + notification stamping, trace layers/order/
  appointment pivot/404, metrics math, stable call correlation),
  single alembic head, live postgres smoke (header echo on every
  call, confirmed booking, trace layers incl. workflow row,
  success_rate 1.0) green.

## Phase 16 — Testing Pass

> implement next phase (plan Phase 16, testing pass)

- New layout, literal per plan: `tests/unit/` (availability,
  slot_validation, state_transitions, context_resolution,
  capability_validation, idempotency, reconciliation),
  `tests/integration/` (ai_to_scheduling, scheduling_to_appointment,
  appointment_to_ehr, ehr_to_verification, verification_to_sync,
  booking_to_workflow, workflow_to_notification), `tests/ai/` (intent,
  context, clarification, tool_selection, safety_boundary),
  `tests/ehr/` (patient_mapping, provider_mapping, create,
  reschedule, cancel, timeout, duplicate, unknown_outcome,
  verification, reconciliation) — 29 files, 43 real tests, no stubs.
  Shared `ehr_stub` fixture (deterministic StubConnector + REST
  override) added to `tests/conftest.py`.
- The pass caught real assumptions: bookings write verify-but-no-create
  operation rows, verification rows accumulate (pipeline verifies at
  booking AND on re-read), `db.get` needs UUID objects on sqlite,
  AIContext needs explicit save, and the clinical classifier is
  keyword-based — tests now assert the actual behavior.
- E2E (`tests/e2e/`, Playwright + Chromium headless, own package.json):
  `happy_path_spec` (sign in -> search -> book -> confirmed visit) and
  `failure_recovery_spec` (fault-mode timeout -> visibly parked ->
  heal -> operator retry -> confirmed) both pass headless (15s) against
  a scratch postgres stack + patient vite dev. Debugging notes: port
  5175 was taken by another project (moved to 5179), the compose CORS
  var is BACKEND_CORS_ORIGINS, and `set VAR=x &&` in cmd leaves a
  trailing space — all fixed in the scratch setup, seeds use
  per-run-unique specialties so reruns never match stale rows.
- Verification: 263/263 pytest green (220 existing + 43 new), both
  Playwright specs green headless, scratch stack torn down.
