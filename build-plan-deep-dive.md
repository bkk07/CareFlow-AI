# Build Plan — Deep Dive (Phase by Phase)

This expands each phase from the phase plan into: files/modules to create, concrete data
model fields, endpoints, business-logic details, edge cases to handle, and a testing
checklist. Use this as your working checklist while coding — check items off in order.

---

## Phase 0 — Scaffolding

**Backend files**
```
backend/app/main.py                # FastAPI() instance, mounts routers, CORS
backend/app/core/config.py         # Pydantic Settings (env vars)
backend/app/core/db.py             # SQLAlchemy engine + session factory
backend/alembic/env.py             # Alembic wired to core.db metadata
backend/app/api/health.py          # GET /health -> {"status": "ok"}
```

**Frontend files**
```
frontend/apps/patient/src/main.tsx
frontend/shared/api/client.ts      # Axios instance, baseURL from env, interceptor stub
frontend/shared/ui/                # shadcn init output
```

**Infra**
```
infra/docker-compose.yml           # services: postgres, redis, backend, frontend
infra/.env.example                 # DATABASE_URL, REDIS_URL, JWT_SECRET, LLM_API_KEY, TWILIO_*
```

**Edge cases to handle now**
- CORS configured for local frontend origin — you'll fight this later if not.
- `.env` never committed; `.env.example` has every key name with placeholder values.

**Testing checklist**
- [ ] `docker-compose up` — all 4 containers healthy
- [ ] `curl localhost:8000/health` returns 200
- [ ] Frontend loads a blank page with no console errors

---

## Phase 1 — Auth, RBAC, Tenant Isolation

**Data model**
```python
class User(Base):
    id: UUID (pk)
    email: str (unique)
    password_hash: str          # Argon2
    role: Enum(platform_admin, hospital_admin, doctor, patient)
    hospital_id: UUID | None    # null for platform_admin and patient
    is_active: bool
    created_at, updated_at
```

**Files**
```
backend/app/core/security.py       # hash_password, verify_password (argon2-cffi),
                                    # create_access_token, create_refresh_token, decode_token
backend/app/core/deps.py           # get_current_context() -> RequestContext
backend/app/domain/auth/router.py  # POST /auth/register, /auth/login, /auth/refresh
backend/app/domain/auth/schemas.py # RegisterIn, LoginIn, TokenOut
```

**RequestContext pattern (reused everywhere downstream)**
```python
class RequestContext(BaseModel):
    user_id: UUID
    role: Role
    hospital_id: UUID | None

def get_current_context(token: str = Depends(oauth2_scheme)) -> RequestContext: ...

def require_role(*roles: Role):
    def checker(ctx: RequestContext = Depends(get_current_context)):
        if ctx.role not in roles: raise HTTPException(403)
        return ctx
    return checker
```

**Repository tenant-filter pattern — write this once, reuse everywhere**
```python
def hospital_scoped_query(model, ctx: RequestContext, session):
    q = session.query(model)
    if ctx.role != Role.platform_admin:
        q = q.filter(model.hospital_id == ctx.hospital_id)
    return q
```

**Edge cases**
- Token expiry / refresh flow (access token short-lived, e.g. 15 min; refresh 7 days)
- Inactive/suspended user cannot get a new token even with valid refresh token
- `hospital_id` in JWT must be re-validated against DB on sensitive ops (don't fully trust stale claims for long-lived tokens)

**Testing checklist**
- [ ] Register + login for all 4 roles
- [ ] Protected route rejects missing/invalid token (401) and wrong role (403)
- [ ] `hospital_scoped_query` unit test: hospital admin never sees another hospital's rows

---

## Phase 2 — Hospital Onboarding

**Data model**
```python
class Hospital(Base):
    id: UUID
    name: str
    address, contact_email, contact_phone: str
    status: Enum(draft, submitted, under_review, approved, rejected, suspended)
    submitted_at, reviewed_at, reviewed_by: nullable
    rejection_reason: str | None

class AuditEvent(Base):
    id: UUID
    actor_user_id: UUID
    action: str            # "hospital.approved"
    entity_type: str
    entity_id: UUID
    hospital_id: UUID | None
    correlation_id: UUID
    metadata: JSONB
    created_at
```

**Files**
```
backend/app/domain/hospital/models.py
backend/app/domain/hospital/schemas.py     # HospitalCreateIn, HospitalOut, ReviewDecisionIn
backend/app/domain/hospital/service.py     # submit(), approve(), reject(), suspend()
backend/app/domain/hospital/router.py
backend/app/core/audit.py                  # write_audit_event(...) helper — use everywhere from here on
```

**Endpoints**
```
POST   /hospitals                  (public/self-service registration -> status=submitted)
GET    /hospitals/{id}             (owner admin or platform_admin)
GET    /platform/hospitals?status= (platform_admin only)
POST   /platform/hospitals/{id}/approve
POST   /platform/hospitals/{id}/reject   {reason}
POST   /platform/hospitals/{id}/suspend
```

**Business logic**
- On registration: creates Hospital(status=submitted) + first HospitalAdmin User in one transaction.
- Only `approved` hospitals pass the "can configure/go live" check used by Phases 3+.
- Every status transition calls `write_audit_event`.

**Edge cases**
- Duplicate hospital registration (same email) — reject with clear error, don't silently overwrite.
- Reject-with-reason must be visible to the hospital admin (surface in their dashboard, not just DB).
- Suspend must immediately block new bookings for that hospital (checked at booking time, not just onboarding time).

**Testing checklist**
- [ ] Register → submitted → approve → status flips, audit event written
- [ ] Reject with reason is retrievable by the hospital
- [ ] Un-approved hospital cannot create doctors (enforced server-side, test it directly even before Phase 3 UI exists)

---

## Phase 3 — Hospital Configuration + Doctor Management

**Data model**
```python
class Department(Base): id, hospital_id, name
class Specialty(Base): id, hospital_id, name
class AppointmentType(Base): id, hospital_id, name, duration_minutes, compatible_specialty_ids: JSONB

class Doctor(Base):
    id, hospital_id, name, photo_url, specialty_id, department_id
    qualifications: JSONB, experience_years, languages: JSONB
    consultation_types: JSONB, default_duration_minutes
    external_provider_id: str | None
    status: Enum(invited, active, inactive, suspended)
```

**Files**
```
backend/app/domain/hospital_config/ (department, specialty, appointment_type — CRUD routers)
backend/app/domain/doctor/models.py, service.py, router.py
```

**Endpoints**
```
CRUD  /hospitals/{id}/departments
CRUD  /hospitals/{id}/specialties
CRUD  /hospitals/{id}/appointment-types
CRUD  /hospitals/{id}/doctors
POST  /hospitals/{id}/doctors/{doctor_id}/activate | /deactivate
```

**Business logic**
- All these routers use `require_role(hospital_admin)` + `hospital_scoped_query` from Phase 1 — no new pattern, just apply it.
- Doctor `active` requires: specialty set, department set, at least one appointment type compatible — validate before allowing status=active.

**Edge cases**
- Deleting a specialty/department that's referenced by an active doctor — block or soft-delete, don't cascade-null silently.
- External provider ID uniqueness per hospital (used later for EHR mapping — get the constraint right now).

**Testing checklist**
- [ ] Full CRUD works, tenant-isolated (hospital B admin gets 403/404 on hospital A's doctor)
- [ ] Doctor can't be activated without required fields
- [ ] Frontend: minimal table+form screens for all four entities

---

## Phase 4 — Calendar & Availability (Scheduling Engine)

**Data model**
```python
class Calendar(Base): id, doctor_id, is_active
class AvailabilityRule(Base):
    id, doctor_id, day_of_week, start_time, end_time, recurrence: Enum(weekly, one_off), valid_from, valid_to
class BlockedSlot(Base):
    id, doctor_id, start_datetime, end_datetime, reason: Enum(leave, ad_hoc, appointment)
```

**Files**
```
backend/app/domain/scheduling/models.py
backend/app/domain/scheduling/availability.py   # pure functions, easiest to unit test
backend/app/domain/scheduling/service.py        # orchestration + locking
backend/app/domain/scheduling/router.py
```

**Core function signature (this is the one that everything later calls)**
```python
def get_available_slots(
    doctor_id: UUID, appointment_type_id: UUID,
    date_from: date, date_to: date, session
) -> list[SlotRef]:
    # 1. doctor active + calendar active check
    # 2. expand AvailabilityRule into candidate slots for the range
    # 3. subtract BlockedSlot ranges
    # 4. subtract already-booked Appointment slots (Pending/Confirmed states)
    # 5. filter by appointment_type_id compatibility + duration
    ...
```

**Locking / double-booking prevention**
```python
# At booking time (used again in Phase 7):
with session.begin():
    session.execute(select(Appointment).where(...).with_for_update())
    # re-check slot still free, then insert
```
Alternative: unique constraint on `(doctor_id, slot_start)` for non-cancelled appointments — belt and suspenders with the row lock.

**Edge cases**
- Overlapping AvailabilityRules for the same doctor — define precedence (most specific/most recent wins) and document it.
- Appointment-type duration longer than a single availability window — slot must fit entirely within one contiguous available window.
- Timezone handling — store UTC, convert at the edges (API in/out), never store local time.

**Testing checklist**
- [ ] Unit tests: rule expansion, blocked-slot subtraction, duration compatibility
- [ ] Concurrency test: fire 2 simultaneous booking attempts at the same slot — exactly one succeeds
- [ ] Manual: change working hours, confirm slots update correctly

---

## Phase 5 — Patient Management

**Data model**
```python
class UserPreferences(Base):
    id, patient_user_id
    preferred_doctor_id, preferred_hospital_id, preferred_appointment_type_id: nullable
    preferred_time_of_day: Enum(morning, afternoon, evening) | None
    preferred_consultation_mode: Enum(in_person, video, phone) | None
```

**Files**
```
backend/app/domain/patient/models.py, service.py, router.py
frontend/apps/patient/src/pages/{Home,Profile,Preferences}.tsx (empty-state shells)
```

**Endpoints**
```
GET/PUT /patients/me
GET/PUT /patients/me/preferences
```

**Edge cases**
- Patient identity is hospital-agnostic (no `hospital_id` on User for patients) — don't accidentally scope patient queries by hospital here; that scoping happens on the *appointment* side, not the identity side.

**Testing checklist**
- [ ] Patient can update profile/preferences, changes persist
- [ ] A patient with zero appointments sees clean empty states, not errors

---

## Phase 6 — Mock EHR + Integration Layer

**Mock EHR (treat as a separate mini-app, own tables, prefixed `mock_ehr_`)**
```python
# backend/app/integration/mock_ehr/models.py
class MockPatient, MockProvider, MockFacility, MockDepartment, MockAppointment

# backend/app/integration/mock_ehr/router.py  (simulate a real vendor's REST API shape)
POST   /mock-ehr/patients/lookup
POST   /mock-ehr/providers/lookup
POST   /mock-ehr/appointments            # create
PUT    /mock-ehr/appointments/{id}       # update/reschedule
DELETE /mock-ehr/appointments/{id}       # cancel
GET    /mock-ehr/appointments/{id}       # retrieve/verify
```

**Debug fault-injection (critical for Phase 8 later)**
```python
# backend/app/integration/mock_ehr/fault_injection.py
class FaultMode(Enum): none, timeout, network_error, slow_5s, create_but_no_response, server_error
# settable via POST /mock-ehr/_debug/fault-mode {mode}  — used only in demo/test envs
```

**Connector interface**
```python
class EHRConnector(Protocol):
    def create_appointment(self, req: CreateApptRequest) -> ExternalApptResult: ...
    def update_appointment(self, external_id: str, req) -> ExternalApptResult: ...
    def cancel_appointment(self, external_id: str) -> ExternalApptResult: ...
    def get_appointment(self, external_id: str) -> ExternalApptResult | None: ...
    def find_appointment_by_idempotency_key(self, key: str) -> ExternalApptResult | None: ...

class MockEHRConnector(EHRConnector): ...  # HTTP client to the mock-ehr router above
```

**Mapping table**
```python
class ExternalIdentifierMapping(Base):
    id, hospital_id, entity_type: Enum(patient, doctor, facility, appointment)
    internal_id: UUID, external_id: str, healthcare_system_connection_id
```

**Files**
```
backend/app/integration/connector_interface.py
backend/app/integration/mock_ehr/{models,router,fault_injection}.py
backend/app/integration/mapping/service.py     # get_or_create_mapping()
backend/app/integration/integration_service.py # the ONLY caller of connectors
```

**Edge cases**
- `find_appointment_by_idempotency_key` must exist on the connector — this is what makes the unknown-outcome recovery in Phase 8 possible. Build it now even if unused until then.
- Mock EHR should have its own patient/provider lookup so mapping isn't hardcoded — create mock records on first sync, not manually.

**Testing checklist**
- [ ] Create/update/cancel/retrieve round-trip through connector works with fault_mode=none
- [ ] Each fault mode actually produces the expected failure when toggled
- [ ] Mapping table correctly links internal↔external IDs after a create

---

## Phase 7 — Appointment Core

**Data model**
```python
class Appointment(Base):
    id, hospital_id, patient_id, doctor_id, appointment_type_id
    slot_start, slot_end
    state: Enum(requested, pending, confirmed, rescheduled, cancelled,
                completed, no_show, failed, sync_pending, reconciliation_required)
    internal_id (=id), external_id: str | None
    idempotency_key: str (unique)
    correlation_id: UUID

class AppointmentHistory(Base):
    id, appointment_id, from_state, to_state, actor_user_id | actor_system,
    reason: str | None, correlation_id, created_at
```

**Files**
```
backend/app/domain/appointment/models.py
backend/app/domain/appointment/state_machine.py   # explicit allowed transitions, raise on invalid
backend/app/domain/appointment/service.py         # create/reschedule/cancel — calls Scheduling + Integration
backend/app/domain/appointment/router.py          # plain REST, no AI yet
```

**State machine — encode transitions explicitly, don't allow arbitrary state writes**
```python
ALLOWED_TRANSITIONS = {
    "requested": {"pending", "failed"},
    "pending": {"confirmed", "sync_pending", "failed"},
    "confirmed": {"rescheduled", "cancelled", "completed", "no_show"},
    "sync_pending": {"confirmed", "reconciliation_required", "failed"},
    "reconciliation_required": {"confirmed", "cancelled", "failed"},
    # ...
}
def transition(appt, to_state, reason=None): 
    if to_state not in ALLOWED_TRANSITIONS[appt.state]: raise InvalidTransition
    ...write AppointmentHistory row...
```

**Endpoints (internal-facing, will be wrapped as MCP tools in Phase 9)**
```
POST /appointments               {patient_id, doctor_id, slot, appointment_type_id, idempotency_key}
POST /appointments/{id}/reschedule
POST /appointments/{id}/cancel
GET  /appointments/{id}
GET  /appointments?patient_id=|doctor_id=|hospital_id=
```

**Booking service logic (happy path only — verification loop comes in Phase 8)**
```
1. validate slot still available (re-check Scheduling)
2. lock + reserve (Phase 4 locking pattern) -> Appointment(state=pending)
3. call IntegrationService.create_appointment(...) 
4. on success response -> state=confirmed (verification loop added Phase 8)
5. on any failure -> state=failed
```

**Edge cases**
- Idempotency: if `create_appointment` is called twice with the same `idempotency_key`, return the existing appointment, don't create a second one — enforce via unique DB constraint + check-before-insert.
- Reschedule must release the old slot only after the new one is confirmed, not before.

**Testing checklist**
- [ ] Book/reschedule/cancel via raw API calls, verify DB state + Mock EHR state match
- [ ] Duplicate idempotency_key returns same appointment, no duplicate row
- [ ] Invalid state transition raises, doesn't silently corrupt state

---

## Phase 8 — Verification, Synchronization, Reconciliation ⭐

**Data model**
```python
class IntegrationOperation(Base):
    id, appointment_id, operation_type: Enum(create, update, cancel, verify)
    request_payload, response_payload: JSONB
    status: Enum(sent, succeeded, failed, timed_out, unknown)
    attempt_number, correlation_id, created_at

class ReconciliationRecord(Base):
    id, operation_id, appointment_id, external_id: str | None
    error: str, attempts: int
    external_status: str | None, internal_status: str
    resolution_status: Enum(open, retrying, resolved, escalated)
    created_at, resolved_at
```

**Files**
```
backend/app/reliability/verification/service.py
backend/app/reliability/synchronization/service.py
backend/app/reliability/reconciliation/service.py
backend/app/reliability/failure_classifier.py   # timeout/network/validation/etc -> retry policy
```

**Failure classification → action mapping**
```python
class FailureClass(Enum):
    TRANSIENT_RETRYABLE      # network blip, 5xx, timeout -> query-then-maybe-retry
    NOT_RETRYABLE_VALIDATION # bad input -> fail immediately, no retry
    RATE_LIMITED             # backoff + retry
    UNKNOWN                  # can't classify -> treat as unknown outcome

def classify(exception_or_response) -> FailureClass: ...
```

**The core unknown-outcome algorithm (implement this precisely)**
```python
def handle_create_failure(appointment, exc):
    op = IntegrationOperation(status="timed_out"/"failed", ...)
    fc = classify(exc)
    if fc == FailureClass.NOT_RETRYABLE_VALIDATION:
        transition(appointment, "failed"); return

    # Don't blindly retry create — check first
    existing = connector.find_appointment_by_idempotency_key(appointment.idempotency_key)
    if existing:
        synchronize_state(appointment, existing)   # -> confirmed, no duplicate
        return

    if fc == FailureClass.TRANSIENT_RETRYABLE and op.attempt_number < MAX_RETRIES:
        # safe retry: same idempotency_key, connector/mock-ehr must dedupe on it too
        retry_create.delay(appointment.id)          # Celery task, Phase 10 dependency — 
        transition(appointment, "sync_pending")      # ok to build this as a sync call for now,
        return                                        # move to Celery once Phase 10 exists

    # still unknown after retries
    ReconciliationRecord(appointment_id=..., resolution_status="open", ...)
    transition(appointment, "reconciliation_required")
```

**Verification (called after any "success" response too — don't trust it blindly)**
```python
def verify_external_appointment(appointment) -> bool:
    external = connector.get_appointment(appointment.external_id)
    ok = external is not None and external.matches(appointment)  # patient/doctor/slot match
    IntegrationVerification(operation_id=..., verified_bool=ok, verified_at=now())
    return ok
```

**Edge cases**
- Mock EHR must support idempotent creates (same idempotency_key → same record) so retries are actually safe — implement this in Phase 6's mock if you haven't.
- Cap retries (e.g. 2) with exponential backoff — don't hammer a down system.
- `ReconciliationRecord.resolution_status` must be independently queryable for the Operations dashboard (Phase 13) — don't bury it inside JSON blobs.

**Testing checklist — this is the phase to over-test**
- [ ] fault_mode=timeout on create → system queries, finds it, confirms, no duplicate
- [ ] fault_mode=timeout + Mock EHR never actually received it → safe retry succeeds
- [ ] fault_mode=server_error repeatedly → ends in reconciliation_required, not stuck in a retry loop
- [ ] Verify a "successful" response that doesn't actually match (simulate mismatch) → not blindly trusted

---

## Phase 9 — MCP Server + AI Agent (text)

**Files**
```
backend/app/mcp_server/tools/{search_hospitals,search_doctors,check_availability,
  lookup_patient,get_appointment,create_appointment,reschedule_appointment,
  cancel_appointment,get_questionnaire,submit_questionnaire,send_notification,
  start_workflow,get_context,update_preferences,verify_external_appointment,
  synchronize_state,transfer_to_human}.py
backend/app/mcp_server/middleware/{auth,idempotency,audit,retry_policy}.py
backend/app/mcp_server/server.py            # registers all tools
backend/app/ai/context/ai_context.py        # Redis-backed structured context (from architecture doc §4)
backend/app/ai/agent/orchestrator.py        # system prompt + tool-calling loop
backend/app/ai/mcp_client/client.py
frontend/apps/patient/src/pages/ChatDebug.tsx  # plain text chat, dev-only
```

**Tool wrapper pattern (apply to all 16)**
```python
def mcp_tool(name, retry_safe: bool, requires_idempotency: bool, allowed_roles: list[Role]):
    def decorator(fn):
        @wraps(fn)
        async def wrapper(input: BaseModel, ctx: RequestContext):
            if ctx.role not in allowed_roles: raise CapabilityAuthError
            if requires_idempotency and not input.idempotency_key: raise ValidationError
            start = time.time()
            try:
                result = await fn(input, ctx)
                status = "success"
            except Exception as e:
                status = "error"; raise
            finally:
                CapabilityExecution(name=name, input=input.dict(), status=status,
                                     latency_ms=(time.time()-start)*1000,
                                     correlation_id=ctx.correlation_id).save()
            return result
        return wrapper
    return decorator
```

**Agent system prompt — encode the safety boundary explicitly**
```
You are an administrative scheduling assistant. You may: find hospitals/doctors,
check availability, book/reschedule/cancel, ask approved pre-visit questions,
record responses, escalate to a human. You must NEVER diagnose, prescribe,
recommend treatment, or state clinical conclusions the patient didn't say
themselves. If asked to do any of these, decline and offer to escalate to a
human or continue with scheduling.
```

**AIContext lifecycle**
```
get_context(conversation_id) -> AIContext (from Redis, TTL e.g. 2h)
... agent updates fields as it goes (selected_doctor, pending_clarification, etc)
update_preferences persists durable prefs to Postgres UserPreferences, NOT to AIContext
```

**Edge cases**
- Tool-calling loop must have a max-iterations guard (don't let the agent loop forever on a confused request).
- `transfer_to_human` must actually persist something queryable (an escalation record) even though HITL UI comes in Phase 13.
- Ambiguous slot references ("that one") must resolve via AIContext, not re-asked every turn — this is a good manual test case.

**Testing checklist**
- [ ] "I need a cardiologist this week" → clarify → search → real availability → book, entirely via chat
- [ ] Ask the agent something clinical ("what does this mean for my heart") → it declines and offers to continue scheduling or escalate
- [ ] Kill Mock EHR mid-conversation (fault_mode) → Phase 8's reconciliation still fires correctly even when triggered via chat, not just raw API

---

## Phase 10 — Workflow Engine + Notifications

**Data model**
```python
class Notification(Base): id, recipient_user_id, channel: Enum(email, in_app), type, status, sent_at
class WorkflowExecution(Base):
    id, event_type, status: Enum(running, completed, failed, retried)
    payload: JSONB, attempt, execution_history: JSONB, correlation_id
```

**Files**
```
backend/app/workflow/celery_app.py
backend/app/workflow/tasks/{on_appointment_booked, on_appointment_cancelled,
  on_appointment_rescheduled, send_reminder, retry_ehr_create}.py
backend/app/workflow/event_bus.py     # publish_event(type, payload, correlation_id)
backend/app/notification/service.py   # send_email(), create_in_app()
```

**Wiring**
- Move Phase 8's inline "retry_create.delay(...)" call into a real Celery task now.
- `Appointment` state changes call `publish_event(...)` → Celery task picks it up → sends notification.
- Reminder: scheduled Celery beat task, e.g. "24h before slot_start."

**Edge cases**
- Celery task must be idempotent (task retried by Celery itself on worker crash shouldn't double-send notification) — use the same idempotency-key pattern.
- Failed workflow tasks need visible `status=failed` + retry count, not silent swallowing.

**Testing checklist**
- [ ] Book an appointment via chat → real email/in-app notification arrives async
- [ ] Kill a worker mid-task → task resumes/retries without double notification
- [ ] `WorkflowExecution.execution_history` shows a readable trace of what happened

---

## Phase 11 — Pre-Visit Questionnaire

**Data model**
```python
class Questionnaire(Base):
    id, hospital_id, scope: Enum(hospital, specialty, doctor, appointment_type)
    scope_ref_id, name
class QuestionnaireQuestion(Base):
    id, questionnaire_id, order, type: Enum(yes_no, choice, multi_choice, numeric, date, short_text, long_text, structured)
    prompt, options: JSONB | None, required: bool
class QuestionnaireResponse(Base):
    id, appointment_id, questionnaire_id, answers: JSONB, completed_at
```

**Files**
```
backend/app/domain/questionnaire/models.py, service.py, router.py
backend/app/mcp_server/tools/{get_questionnaire,submit_questionnaire}.py  # wire real logic now
```

**Agent-side guard (critical)**
- The agent's questionnaire-collection prompt is scoped to *only* the fetched `QuestionnaireQuestion` list for this appointment — no free-form clinical questions invented by the model. Enforce by having the tool return the exact question set and instructing the agent to ask only those, in order.

**Edge cases**
- Required vs optional questions — agent must not mark complete until all required answered.
- Escalation policy for concerning free-text answers (e.g. patient mentions something urgent in a long_text field) — define a simple keyword/flag rule that triggers `transfer_to_human`, don't have the AI interpret medically.

**Testing checklist**
- [ ] Assign a questionnaire to an appointment type, complete it conversationally, structured response stored
- [ ] Doctor can view the response (dashboard stub is fine here, full UI in Phase 13)
- [ ] Agent never asks a question outside the configured set (adversarial manual test: try to get it to ask something clinical)

---

## Phase 12 — Web Voice

**Files**
```
frontend/shared/voice/useWebRTCAudio.ts     # mic capture, VAD, barge-in signal
backend/app/voice/web_voice/ws_handler.py   # WebSocket: receives audio chunks, streams STT
backend/app/voice/stt_provider.py           # wraps chosen streaming STT API
backend/app/voice/tts_provider.py           # wraps chosen streaming TTS API, sentence-chunked
backend/app/voice/session_manager.py        # ties WS session -> AIContext/conversation_id
```

**Flow**
```
mic -> WS audio chunks -> STT partials -> agent starts on stable partial (for search-type
intents only, not writes) -> full response text streamed sentence-by-sentence into TTS ->
audio chunks streamed back -> client plays + can barge-in (stop playback, send interrupt signal)
```

**Edge cases**
- Barge-in must cancel the in-flight TTS stream AND tell the agent orchestrator to stop generating (don't just mute audio client-side while the backend keeps working uselessly).
- Silence timeout: re-prompt once ("Are you still there?"), then gracefully end/escalate on second silence.
- Never trigger a write capability (create/reschedule/cancel) off a partial/unconfirmed transcript — only reads.

**Testing checklist**
- [ ] Full booking flow by voice, latency feels reasonable
- [ ] Interrupting mid-response actually stops the audio and the agent doesn't keep talking over you
- [ ] Silence handling triggers a re-prompt, not a hang

---

## Phase 13 — Dashboards

**Doctor dashboard**
```
GET /doctors/me/appointments?range=today|upcoming
GET /doctors/me/calendar
GET /doctors/me/questionnaire-responses/{appointment_id}
```
Pages: Today, Upcoming, Calendar/Availability editor, Blocked Time editor, Appointment detail.

**Hospital Admin dashboard**
```
GET /hospitals/{id}/overview   # counts: doctors, appointments this week, pending reconciliations
```
Reuses Phase 3 CRUD screens + adds: Appointments list/filter, AI Activity (CapabilityExecution log filtered by hospital), Integration status, basic Analytics charts.

**Platform Admin dashboard**
Reuses Phase 2 approval screens + adds: cross-hospital Doctors/Patients/Appointments views, AI Evaluation (Phase 9 data), global Analytics, Audit Log viewer (Phase 2's AuditEvent table).

**Operations/HITL dashboard ⭐**
```
GET  /operations/reconciliation?status=open
POST /operations/reconciliation/{id}/retry
POST /operations/reconciliation/{id}/resolve   {resolution_note, final_state}
POST /operations/reconciliation/{id}/escalate
```
This is the UI on top of Phase 8's `ReconciliationRecord` — wire the buttons to actually call `synchronize_state`/`transition` so resolving here changes real appointment state.

**Testing checklist**
- [ ] Each role sees only their own scope
- [ ] Operator can resolve a real reconciliation record end-to-end from the UI and the appointment state updates correctly

---

## Phase 14 — Telephone (optional)

**Files**
```
backend/app/voice/telephony/twilio_webhook.py   # inbound call webhook
backend/app/voice/telephony/media_stream_handler.py  # same STT/agent/TTS as Phase 12
```

**Flow**
```
Twilio inbound call -> webhook -> start Media Stream -> WS -> reuse Phase 12 pipeline
-> phone-number lookup against Patient records -> spoken identity confirmation
   (name/DOB) before any lookup_patient/get_appointment call
```

**Edge cases**
- Unknown number / can't verify identity → agent declines to discuss any patient data, offers to take a message or escalate.
- Call drop mid-booking → treat like any other unknown-outcome scenario (Phase 8 logic, not special-cased).

**Testing checklist**
- [ ] Inbound call completes a booking end-to-end
- [ ] Identity fails to verify → no patient data is exposed

---

## Phase 15 — Observability & Audit Polish

**Files**
```
backend/app/observability/tracing.py    # OpenTelemetry setup, auto-instrument FastAPI/SQLAlchemy
backend/app/observability/correlation.py # middleware: generate/propagate correlation_id header
backend/app/observability/metrics.py     # counters/histograms per the architecture doc's Analytics section
```

**What to check**
- Every layer touched in Phase 0–14 propagates `correlation_id` — audit this explicitly rather than assuming.
- One trace, filtered by `correlation_id`, should show: conversation → AI decision → capability → scheduling → EHR op → verification → sync → workflow → notification.

**Testing checklist**
- [ ] Pick one booking, pull its correlation_id, and produce a full trace/log view of everything that happened
- [ ] Metrics dashboard (even basic) shows booking success rate, reconciliation count, AI latency

---

## Phase 16 — Testing Pass

Organize by the categories already used in the PRD — go through each bullet as a literal test file:
```
tests/unit/{availability,slot_validation,state_transitions,context_resolution,
  capability_validation,idempotency,reconciliation}_test.py
tests/integration/{ai_to_scheduling,scheduling_to_appointment,appointment_to_ehr,
  ehr_to_verification,verification_to_sync,booking_to_workflow,workflow_to_notification}_test.py
tests/ai/{intent,context,clarification,tool_selection,safety_boundary}_test.py
tests/ehr/{patient_mapping,provider_mapping,create,reschedule,cancel,timeout,
  duplicate,unknown_outcome,verification,reconciliation}_test.py
tests/e2e/{happy_path,failure_recovery}_spec.ts   # Playwright
```

**Testing checklist**
- [ ] Every file above has at least one real test, not a stub
- [ ] `happy_path` and `failure_recovery` E2E specs both pass headless in CI

---

## Phase 17 — Deployment

**Steps**
1. Push managed Postgres + Redis, run Alembic migrations against them.
2. Deploy backend (Render/Railway) with env vars set in the platform's dashboard, not in code.
3. Deploy frontend (Vercel) pointing at the deployed backend URL.
4. Point Twilio webhook (if Phase 14 built) at the deployed backend's public URL.
5. Run both E2E specs against the deployed URL.

**Testing checklist**
- [ ] Fresh browser, no local setup, full happy path works on the deployed URL
- [ ] Failure/recovery demo works on the deployed URL (toggle fault_mode via the debug endpoint or a seeded demo scenario)
- [ ] No secrets visible in repo or client-side bundle
