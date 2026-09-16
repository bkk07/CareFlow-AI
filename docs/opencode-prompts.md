# OpenCode Prompts

Implementation prompts used for each build phase, recorded verbatim so the
build can be reproduced or audited. Source of truth for phase scope is
`build-plan-deep-dive.md` (do not modify that file).

## Phase 0 — Scaffolding

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
- Requested phase at runtime: **Phase 0 — Scaffolding**.
- Scope implemented: backend FastAPI skeleton (`app/main.py`,
  `app/core/config.py`, `app/core/db.py`, `app/api/health.py`, Alembic
  `env.py` wired to `core.db` metadata), patient Vite app shell
  (`frontend/apps/patient/src/main.tsx`), shared Axios client
  (`frontend/shared/api/client.ts`), shadcn placeholder
  (`frontend/shared/ui/`), infra compose with postgres/redis/backend/frontend
  plus `infra/.env.example` covering every required key.
- No Phase 1+ code (auth, models, routers) was added.

## Phase 1 — Auth, RBAC, Tenant Isolation

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
  User in one transaction; duplicate contact email → 409 pre-check plus
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
