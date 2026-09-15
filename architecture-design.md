# Multi-Tenant Healthcare AI Scheduling Platform — Architecture Design

Stack: React/Vite/TS/Tailwind/shadcn · FastAPI/Pydantic/SQLAlchemy 2.0/Alembic · PostgreSQL ·
JWT/Argon2/RBAC · MCP (Server+Client) · Twilio Voice · Redis/Celery · OpenTelemetry

---

## 1. Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ INTERFACES                                                       │
│  Web App (React) │ Web Voice (WebRTC) │ Telephone (Twilio)       │
└───────────────────────────┬───────────────────────────────────-─┘
                             │ REST (Axios) / WS (audio+events)
┌────────────────────────────▼──────────────────────────────────-─┐
│ API GATEWAY (FastAPI)                                            │
│  Auth middleware (JWT) │ Tenant resolver │ RBAC guard │ Router    │
└───────┬───────────────────────┬───────────────────────┬────────-─┘
        │                       │                        │
┌───────▼────────┐   ┌──────────▼─────────┐   ┌──────────▼────────┐
│ AI AGENT LAYER  │   │ CORE DOMAIN         │   │ ADMIN/DASHBOARD    │
│ Agent Orchestr. │   │ SERVICES            │   │ APIs (CRUD, read)  │
│ Context Mgr     │   │ Hospital / Doctor /│   │                    │
│ MCP Client      │   │ Patient / Schedule │   │                    │
│                 │   │ Appointment / Q'aire│  │                    │
└───────┬─────────┘   │ Notification        │   └────────────────────┘
        │ tool calls   └──────────┬──────────┘
┌───────▼─────────────────────────▼──────────────────────────────-─┐
│ MCP SERVER (Controlled Capabilities)                              │
│ search_hospitals · search_doctors · check_availability            │
│ lookup_patient · get_appointment · create/reschedule/cancel_apt   │
│ get/submit_questionnaire · send_notification · start_workflow     │
│ get_context · update_preferences · verify_external_appointment    │
│ synchronize_state · transfer_to_human                             │
│  (each: schema + validation + authz + retry + idempotency + audit)│
└───────┬─────────────────────────────────────────────────────────-┘
        │
┌───────▼────────────────┐   ┌─────────────────────────────────────┐
│ SCHEDULING ENGINE       │   │ INTEGRATION LAYER                    │
│ Slot calc, conflict     │   │ Integration Service → EHR Connector  │
│ detection, locking      │   │ Interface → Mock EHR (swappable)     │
└───────┬─────────────────┘   │ Verification Svc │ Sync Svc          │
        │                     │ Reconciliation Svc                   │
        │                     └───────────────┬───────────────────-─┘
┌───────▼─────────────────────────────────────▼───────────────────-┐
│ EVENTS / WORKFLOW ENGINE (Celery + Redis)                         │
│ Event bus → workflow tasks → retries/delays/conditions            │
└───────┬────────────────────────────────────────────────────────-─┘
        │
┌───────▼────────────────────────────────────────────────────────-─┐
│ DATA / OBSERVABILITY                                              │
│ PostgreSQL (tenant-scoped) │ OpenTelemetry traces │ Audit log      │
│ Correlation/Operation IDs across every hop above                  │
└────────────────────────────────────────────────────────────────-─┘
```

**Non-negotiable rules baked into this layout:**
- AI Agent never touches DB/EHR directly — only via MCP Server capabilities.
- Scheduling Engine has no knowledge of conversation state.
- Integration Layer is the *only* thing that knows Mock EHR exists (Connector interface first, Mock EHR is one implementation).
- Every hop carries `correlation_id` (per conversation/request) and `operation_id` (per capability execution).

---

## 2. Service Boundaries (Core Services)

| Service | Owns | Does NOT own |
|---|---|---|
| **Hospital Service** | Hospital profile, departments, specialties, onboarding lifecycle | Doctor calendars |
| **Doctor Service** | Doctor CRUD, lifecycle, qualifications | Slot calculation |
| **Patient Service** | Patient profile, preferences, auth identity | Appointment history logic (reads from Appointment Service) |
| **Scheduling Service** | Working hours, blocked slots, availability calc, double-booking prevention | Appointment persistence |
| **Appointment Service** | Appointment state machine, history, internal/external IDs | EHR calls (delegates to Integration Service) |
| **Questionnaire Service** | Question definitions, responses, associations | Diagnostic interpretation (forbidden) |
| **Notification Service** | Templates, delivery (email/in-app), notification log | Workflow scheduling logic |
| **Workflow Service** | Event consumption, Celery task orchestration, retries | Business validation (delegates back to domain services) |
| **Integration Service** | Connector selection, mapping tables, call orchestration | Availability truth (reads Scheduling) |
| **Verification Service** | Post-write confirmation against external system | Writing to internal state (delegates to Sync Service) |
| **Synchronization Service** | Applying verified external state → internal state | Retry policy (delegates to Reconciliation) |
| **Reconciliation Service** | Unknown-outcome resolution, reconciliation records | Human UI (delegates to HITL/Operator dashboard) |

Each service = FastAPI router + Pydantic schemas + SQLAlchemy models + a thin "repository" — kept in its own module so tenant filtering and authorization are enforced at one choke point per service.

---

## 3. Data Model (key entities)

All tenant-scoped tables carry `hospital_id` (nullable only for Platform-level entities) and are filtered at the ORM query layer, never trusted from client input.

```
Platform
Hospital (status: draft/submitted/under_review/approved/rejected/suspended)
  ├─ HospitalAdmin/Staff (user_id, hospital_id, role)
  ├─ Department
  ├─ Specialty
  ├─ AppointmentType (duration, compatible specialties)
  ├─ Doctor (status: invited/active/inactive/suspended, external_provider_id)
  │    ├─ Calendar
  │    ├─ AvailabilityRule (working hours, recurrence)
  │    └─ BlockedSlot (leave, ad hoc blocks)
  ├─ Questionnaire (scope: hospital/specialty/doctor/appointment_type)
  │    └─ QuestionnaireQuestion (type, config)
  └─ HealthcareSystemConnection (connector_type, credentials ref, config)

Patient (user_id, hospital-agnostic identity, per-hospital PatientContext if needed)
  ├─ UserPreferences (preferred doctor/hospital/time/mode)
  └─ ExternalIdentifierMapping (patient ↔ external_patient_id, per hospital)

Appointment (hospital_id, patient_id, doctor_id, appointment_type_id,
             state, internal_id, external_id, correlation_id)
  └─ AppointmentHistory (state transitions, timestamps, actor)

QuestionnaireResponse (appointment_id, questionnaire_id, answers[], structured)

AIConversation (channel: web_voice/telephone/text, patient_id, hospital_id?)
  └─ AIContext (see §4 — NOT a single blob; structured sub-objects)

Capability / CapabilityExecution (name, input, output, status, latency, correlation_id)

IntegrationOperation (type: create/update/cancel/verify, request, response,
                       status, attempts, external_id)
IntegrationVerification (operation_id, verified_bool, verified_at, source)
ReconciliationRecord (operation_id, appointment_id, external_id?, error,
                       attempts, external_status, internal_status, resolution_status)

Workflow / WorkflowExecution (event, status, retries, execution_history)
Notification (recipient, channel, type, status)

AIEvaluation (conversation_id, metric, score)
AuditEvent (actor, action, entity, hospital_id, correlation_id, timestamp)
OperationalEvent (type, severity, related_entity, status)
```

Indexing priorities: `hospital_id` on every tenant table, `(doctor_id, date)` on availability/appointments, `correlation_id` everywhere it appears, unique constraint on `(idempotency_key)` for write operations.

---

## 4. State Separation (explicit, not one AI blob)

| State type | Lives in | Example |
|---|---|---|
| Transactional | `Appointment` table | Confirmed |
| Conversational | `AIContext` (Redis-backed, TTL'd, keyed by conversation_id) | "selected Dr. Rao, slot pending" |
| User context | `UserPreferences` table | prefers evenings |
| Workflow | `WorkflowExecution` table | reminder scheduled T-24h |
| Integration | `IntegrationOperation` / `IntegrationVerification` | EHR appointment verified |
| Operational | `OperationalEvent` / `ReconciliationRecord` | reconciliation required |

`AIContext` itself is structured, not freeform:
```python
class AIContext(BaseModel):
    intent: str | None
    hospital_id: str | None
    doctor_id: str | None
    slot: SlotRef | None
    appointment_id: str | None
    pending_clarification: str | None
    turn_history_ref: str  # pointer, not full transcript blob
```
This is retrieved/updated only via the `get_context` / `update_preferences` MCP capabilities — the agent never writes raw dict blobs to the DB.

---

## 5. Appointment State Machine

```
Requested → Pending → Confirmed → Completed
                │           │
                │           ├─→ Rescheduled → (back to Pending)
                │           └─→ Cancelled
                ├─→ Failed
                ├─→ Synchronization Pending → Confirmed | Reconciliation Required
                └─→ Reconciliation Required → (resolved by operator) → Confirmed | Cancelled | Failed
No-show: Confirmed → No-show (post appointment-time, no visit recorded)
```
Every transition writes an `AppointmentHistory` row with `correlation_id`, actor, and reason. No transition skips verification when an external system is configured.

---

## 6. MCP Capability Contracts (pattern — apply to all 16)

Every capability follows this shape (FastMCP tool or custom MCP server tool):

```python
class CreateAppointmentInput(BaseModel):
    patient_id: str
    doctor_id: str
    slot: SlotRef
    appointment_type_id: str
    idempotency_key: str
    correlation_id: str

class CreateAppointmentOutput(BaseModel):
    appointment_id: str
    state: AppointmentState
    external_sync_status: Literal["pending","verified","not_applicable"]

# Cross-cutting, applied by a decorator/middleware around every tool:
# 1. auth: capability-level RBAC check (which role/channel may call this)
# 2. validate: pydantic input validation
# 3. idempotency: check idempotency_key before executing
# 4. execute: call domain service
# 5. audit: write CapabilityExecution row
# 6. retry policy: declared per-capability (e.g. create_appointment = NOT
#    blindly retryable; check_availability = freely retryable)
```

Retry/idempotency classification for the 16 capabilities:
- **Safe to retry freely:** search_hospitals, search_doctors, check_availability, lookup_patient, get_appointment, get_questionnaire, get_context
- **Idempotency-key required:** create_appointment, reschedule_appointment, cancel_appointment, submit_questionnaire, send_notification, start_workflow
- **Verification-required before success is reported:** create_appointment, reschedule_appointment, cancel_appointment (via verify_external_appointment + synchronize_state)
- **Escalation path only:** transfer_to_human

---

## 7. Booking Flow (with verification loop)

```
patient selects slot
   → check_availability (revalidate immediately before booking)
   → create_appointment (state=Requested, idempotency_key)
        → Scheduling: reserve slot (transaction/lock) → state=Pending
        → Integration Service → Connector → Mock EHR: create
            ├─ success response → verify_external_appointment
            │      ├─ verified → synchronize_state → state=Confirmed → notify patient
            │      └─ not verified → state=Synchronization Pending → retry verify (bounded)
            ├─ timeout/network error → state=Synchronization Pending
            │      → query EHR (idempotent lookup by idempotency_key/patient+slot)
            │          ├─ found → synchronize_state → Confirmed (no duplicate)
            │          └─ not found → classify: safe to retry? → retry once → re-check
            │                              → still unknown → ReconciliationRecord → HITL
            └─ hard failure (validation/auth/conflict) → state=Failed → notify + optionally re-offer slots
```
Patient is told "confirmed" **only** after the Confirmed state is reached — never optimistically.

---

## 8. Voice Architecture

```
Web:  Browser mic → WebRTC → STT (streaming) → AI Agent (text) → MCP → ...
      ... → response text → TTS (streaming) → browser playback
      Barge-in: client-side VAD cancels current TTS stream + informs agent to
      stop generating; silence handling: timeout → gentle re-prompt.

Telephone: Caller → Twilio Programmable Voice → Twilio Media Streams (WS) →
      same STT/Agent/TTS pipeline → audio back over Media Streams.
      Patient identification via phone number lookup + spoken confirmation
      (name/DOB) before any patient-data capability is called.
```
Both channels share one Agent Orchestrator + MCP Client — voice-specific code only lives at the transport edges (audio in/out), never in the agent logic.

Latency budget for sub-2s target: STT partial-results streaming, agent starts tool calls on partial intent where safe (e.g., search) rather than waiting for full utterance, TTS starts speaking before full response text is generated (sentence-level streaming).

---

## 9. Security & Tenant Isolation

- JWT carries `user_id`, `role`, `hospital_id` (null for Platform Admin/Patient).
- A single FastAPI dependency (`get_current_context`) resolves identity + tenant and is required on every router — no route queries the DB without it.
- SQLAlchemy queries go through repository functions that **always** apply `.filter(hospital_id=ctx.hospital_id)` for hospital-scoped models; there is no code path that queries these tables without that filter.
- Patients are hospital-agnostic identities; per-hospital data (appointments, questionnaire responses) is scoped by `hospital_id` on the child rows, not by patient tenant membership.
- Argon2 for password hashing; JWT short-lived access + refresh token; RBAC matrix enforced both at API-route level and MCP-capability level (a Doctor-role token cannot call `create_appointment` for another doctor's calendar, etc).
- Secrets (DB, EHR, Twilio, LLM API keys) via `.env` / environment variables only, never committed; separate `.env.example`.

---

## 10. Repo Structure

```
/frontend
  /apps/patient  /apps/doctor  /apps/hospital-admin  /apps/platform-admin
  /shared (ui components, api client, types)
/backend
  /app
    /core          (config, security, db session, deps)
    /domain
      hospital/ doctor/ patient/ scheduling/ appointment/
      questionnaire/ notification/ workflow/
    /integration
      connector_interface.py  mock_ehr/  mappings/
    /reliability
      verification/ synchronization/ reconciliation/
    /ai
      agent/  context/  mcp_client/
    /mcp_server
      tools/ (one file per capability)  middleware/ (auth, idempotency, audit)
    /voice
      web_voice/  telephony/ (twilio)
    /observability
      tracing.py  audit.py  metrics.py
    /api (FastAPI routers wiring domain → HTTP)
  /workers (celery tasks, beat schedule)
  /alembic
  /tests (unit/ integration/ ai/ ehr/ e2e)
/infra
  docker-compose.yml  Dockerfiles  .env.example
```

---

## 11. What Makes the "Unknown Outcome" Demo Work

This is the highest-value scenario to get right (explicit PRD requirement, ⭐⭐⭐):
1. `create_appointment` call to Mock EHR is made to **artificially time out** (toggle in Mock EHR for demo).
2. System marks appointment `Synchronization Pending`, does **not** retry the create blindly.
3. Reconciliation job (Celery) queries Mock EHR by `idempotency_key`/patient+slot.
4. If found → `synchronize_state` → `Confirmed`, no duplicate created.
5. If still unknown after bounded retries → `ReconciliationRecord` created → shows up in Operator Dashboard → human resolves (Retry/Resolve/Escalate buttons).
6. Entire chain visible in Admin "Operations" tab via `correlation_id`.

---

Next: I'll turn this into a day-by-day (or phase-by-phase) build plan sized to your 3–4 day prototype window, sequencing which pieces unlock the demo path fastest. Want it structured as **4 fixed days** or as **flexible phases** you can compress/expand depending on how much time you actually have?
