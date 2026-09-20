# Appointment AI — Current State (Read-Only Architecture Audit)

> Audit date: 2026-09-20. No code was modified for this report.
> Method: repository inspection + execution-path tracing. All claims cite actual files.
> Headline finding: **there is no LangGraph in this repository** (zero hits for
> `langgraph|StateGraph|MemorySaver|checkpointer` in `backend/`). The "agent" is a
> hand-rolled OpenAI-compatible tool loop in `backend/app/ai/agent/orchestrator.py`,
> state is a Redis-backed `AIContext` Pydantic model, and tools are a custom MCP-style
> registry in `backend/app/mcp_server/`. Any phase-2 plan that assumes LangGraph
> nodes/edges/checkpointers must be adapted to what actually exists.

---

## A. Current architecture

Actual (verified) topology — there is no LangGraph layer:

```text
User (chat input / voice mic / phone call)
 ↓
Frontend Chat (POST /chat, REST JSON) | Voice WS (/voice/ws) | Twilio media WS
 ↓
API routers (backend/app/ai/router.py, app/voice/web_voice/ws_handler.py,
             app/voice/telephony/media_stream_handler.py)
 ↓
Hand-rolled agent loop (backend/app/ai/agent/orchestrator.py::run_conversation,
                        while iterations < MAX_ITERATIONS=8, NOT a graph)
 ↓
AIContext state (backend/app/ai/context/ai_context.py, Redis key
                 careflow:ai-context:{conversation_id}, TTL 7200s, in-mem fallback)
 ↓
Custom MCP registry (backend/app/mcp_server/server.py, tools/*.py, 20 tools)
 ↓
Domain services (app/domain/{appointment,scheduling,doctor,hospital,
                 hospital_config,patient}/service.py)
 ↓
Postgres (+ Mock EHR vendor via app/integration/integration_service.py)
 ↓
Response: ChatOut JSON (reply + doctors/slots/types/day_schedule/modes/
          pending_booking/booking_stage) → frontend widgets
 ↓
Booking UI (confirm panel → next turn calls create_appointment) or
direct POST /appointments (guided BookPage)
 ↓
Appointment row + BlockedSlot hold + vendor record + notifications/audit
```

Repository layout (top level):

```text
backend/          FastAPI app (app/main.py), requirements.txt (no langgraph/langchain dep)
frontend/apps/    patient | doctor | hospital-admin | operations-admin | platform-admin (independent Vite+React+TS)
frontend/shared/  stub only (not imported by patient app)
infra/            docker-compose.yml (postgres, redis, backend, worker, beat, frontends)
docs/             this report
backend/tests/    62 test files (see §16)
```

Key entry points:

| Stage | File | Class / function |
|---|---|---|
| Chat API | `backend/app/ai/router.py:83` | `chat(body: ChatIn) -> ChatOut` |
| Agent turn | `backend/app/ai/agent/orchestrator.py:1352` | `run_conversation(*, db, ctx, conversation_id, user_message, complete, max_iterations, should_stop, latitude, longitude)` |
| LLM backend | `orchestrator.py:613,635` | `_chat_backend()`, `groq_complete()` (`httpx.post {base}/chat/completions`, OpenAI `tools=[{type:function}]`) |
| State load/save | `backend/app/ai/context/ai_context.py:122,142,152` | `get_ai_context()`, `save_ai_context()`, `clear_ai_context()` |
| Tool registry | `backend/app/mcp_server/server.py:55` | `execute_tool()` over 20 registered tools |
| Tool client | `backend/app/ai/mcp_client/client.py:24,38` | `AgentToolClient.specs()`, `.call()` → `{ok, result|error}` |
| Voice loop | `backend/app/voice/web_voice/ws_handler.py:275` | `handle_voice_socket()` → same `run_conversation()` |
| Telephony loop | `backend/app/voice/telephony/media_stream_handler.py:325` | `handle_media_stream()` → same `run_conversation()` |

### Full booking trace (chat path)

```text
User message (ChatPage.tsx:82 sendPrompt)
  ↓  api.ts:530 postChat() → POST /chat {message, conversation_id, latitude, longitude}
API (ai/router.py:83 chat) — span chat.turn, calls run_conversation (ai/router.py:95)
  ↓
Agent (orchestrator.py:1352 run_conversation):
  cid = conversation_id or uuid4 (:1371); context = get_ai_context(cid) (:1375)
  deterministic extractors pre-LLM (:1398-1423): detect_doctor_selection,
    detect_type_selection, detect_consultation_mode, detect_date_iso → mutate context
  messages = [system + context.model_dump_json() + history[-10:]] (:1496-1505)
  while iterations < 8 (:1518): complete_fn → tool_calls →
    gates (telephony :1525, visit_type :1530, completeness :1532, confirm :1536) →
    client.call (:1540) → _remember_booking_selection (:1541) →
    _apply_result_to_context (:1557) → append role=tool (:1560) → reply or loop
State mutation: AIContext fields (see §B) + history (cap 20); saved at :1427/:1446/:1600
  ↓
Tool calls → MCP server.execute_tool → tools/*.py → domain services → Postgres
  (e.g. search_doctors → Doctor⨝Hospital query; create_appointment →
   appointment/service.py::create_appointment → reserve_slot + Appointment row +
   IntegrationService.create_appointment (vendor) → verify → transition(confirmed))
  ↓
Response assembly (:1582-1686): reply + doctors/slots/appointment_types/day_schedule/
  consultation_modes/booking_stage/pending_booking → ChatOut (ai/router.py:66)
  ↓
Frontend (ChatPage.tsx:99-113 → ChatBubble in components/ai/ai.tsx:34):
  markdown + LiveDoctorCard + SlotChips + TypeSelect + ModeChips + DaySlots +
  DateStrip + ConfirmPanel. Each widget's onSend posts the NEXT text turn
  (never calls booking APIs directly) — except guided BookPage which POSTs
  /appointments directly with {patient_id, doctor_id, appointment_type_id,
  slot_start, slot_end, consultation_mode} (BookPage.tsx:351-370).
  ↓
Appointment creation: confirm gate requires explicit "yes" (:87-90, :455-508);
  next turn's create_appointment tool → service → 201 confirmed (or 202 parked on
  vendor divergence) → event appointment.booked → in-app notification + audit rows.
```

Per-stage I/O summary:

| Stage | Input | Output | DB interaction |
|---|---|---|---|
| Frontend `sendPrompt` | text + conversation_id + geo | appended patient bubble | none (localStorage id) |
| `POST /chat` | `ChatIn{message, conversation_id?, latitude?, longitude?}` | `ChatOut{...}` | span row via observability |
| `run_conversation` | db, ctx, cid, message | `{reply, conversation_id, doctors, slots, ...}` | reads/writes AIContext (Redis) |
| Extractors | raw text + context | `selected_doctor_id / selected_appointment_type_id / selected_consultation_mode / selected_date` | none |
| Tool call | tool name + args | `{ok, result|error}` | per-tool queries (see §11) |
| `create_appointment` svc | scoped ids + slot + idempotency key | `(Appointment, created_bool)` + outcome | Appointment row + BlockedSlot + history + vendor mapping |
| Frontend render | `ChatOut` | widgets | `GET /patients/me/appointments` refresh for lists |

---

## B. Current LangGraph state

There is no LangGraph state class, no reducers, no checkpointer, no `thread_id`
(zero hits repo-wide). The equivalent is `AIContext`:

File: `backend/app/ai/context/ai_context.py:27-81` — `class AIContext(BaseModel)`, **27 fields**:

```python
conversation_id: str
user_id: str | None = None
selected_hospital_id: str | None = None
selected_doctor_id: str | None = None
selected_appointment_type_id: str | None = None
selected_slot: dict[str, str] | None = None          # {start, end}
offered_slots: list[dict[str, str]] = []             # [{start, end}] cap 10
offered_doctors: list[dict[str, str]] = []           # accumulated, cap 30
offered_doctor_page: list[str] = []                  # current page of 5 ids
last_search: dict[str, Any] | None = None            # {filters, offset, total}
visit_types_seen: bool = False
visit_types: list[dict[str, Any]] = []               # [{id, name, duration_minutes}] cap 20
visit_type_name: str | None = None
selected_consultation_mode: str | None = None        # video|phone|in_person
flow_open: bool = False
consultation_modes: list[str] = []
selected_date: str | None = None                     # YYYY-MM-DD
pending_clarification: str | None = None
pending_booking: dict[str, Any] | None = None        # proposal awaiting "yes"
awaiting_confirmation: bool = False
last_appointment_id: str | None = None
history: list[dict[str, str]] = []                   # cap 20 turns
channel: str = "web"                                 # web | telephony
caller_phone: str | None = None
caller_patient_id: str | None = None
caller_verified: bool = False
identity_attempts: int = 0
```

Spec coverage check (spec asked for these names — actual names differ):

```text
hospital_id          → selected_hospital_id (rarely set; no hospital extractor exists)
hospital_name        → NOT stored (only inside offered_doctors[].hospital_name snapshots)
doctor_id            → selected_doctor_id
doctor_name          → NOT stored (only inside offered_doctors[].name snapshots)
date                 → selected_date (YYYY-MM-DD)
visit_type           → visit_type_name (display) + selected_appointment_type_id (FK)
visit_type_id        → selected_appointment_type_id
consultation_type    → selected_consultation_mode (values video|phone|in_person)
consultation_type_id → N/A (mode is a string, not an FK)
duration             → NOT stored directly (derived from visit_types[].duration_minutes)
start_time/end_time  → selected_slot{start,end} + pending_booking{slot_start,slot_end}
availability         → offered_slots (cap 10) + last_search; full windows NOT persisted
appointment_id       → last_appointment_id
booking_status       → pending_booking + awaiting_confirmation + booking_stage() (derived, not stored)
```

How state survives turns: `get_ai_context(cid)` at turn open (`orchestrator.py:1375`),
`save_ai_context()` at `:1427/:1446/:1600`. Persistence: Redis
`careflow:ai-context:{cid}` with `TTL = max(ai_context_ttl_s, 60)` (default 7200s),
in-memory `_fallback` dict on Redis failure (`ai_context.py:95-159`).
Thread identifier is `conversation_id` (client-generated, localStorage
`careflow_patient_conversation`; voice `resume=` param; telephony `conversation_id`
custom parameter). History capped at 20 entries (`remember_turn`, `:86-88`);
only last 10 messages sent to the LLM (`:1505`).

Tool results enter state in `_apply_result_to_context` (`orchestrator.py:688-777`,
called `:1557-1559` after every tool call): `search_doctors` accumulates
`offered_doctors` + sets `offered_doctor_page` + `last_search` + `flow_open=True`;
`check_availability` sets `offered_slots`; `list_appointment_types` (via
`_remember_booking_selection`, `:1144-1190`) sets `visit_types_seen=True` +
`visit_types`; `create/reschedule/cancel` clear slots/pending/awaiting and set
`last_appointment_id`; confirmed booking resets type/mode/date/flow.

Extracted user info enters state deterministically BEFORE the LLM
(`:1398-1423`): `detect_doctor_selection` (`:807-873`, ordinal vs
`offered_doctor_page`, substring, difflib≥0.6 fuzzy — needs prior offers) →
`selected_doctor_id`; `detect_type_selection` (`:876-896`, substring vs
`visit_types[].name` — needs prior listing) → `selected_appointment_type_id`;
`detect_consultation_mode` (`:1096-1109`, regexes, earliest mention wins) →
`selected_consultation_mode`; `detect_date_iso` (`:1026-1086`) → `selected_date`.
Later nodes (same loop iteration or next turn) read them via the serialized
`Conversation context (JSON)` system message (`:1500-1501`), the deterministic
gates (`booking_completeness` `:966-997`, `visit_type_gate` `:918-930`,
`_booking_confirmation_gate` `:455-508`), and the response builders (`:1611-1686`).

---

## C. Current MCP tools

Registry: `backend/app/mcp_server/server.py:55-77` — **20 tools** (asserted `len==20`
at `:82`). Wrapper `tools/_base.py::mcp_tool` adds auth, idempotency, retry,
audit. The AI reaches them via `AgentToolClient` (`app/ai/mcp_client/client.py`),
which forwards to `server.execute_tool`. The AI never touches the DB directly.

Appointment-related tools:

| Tool | Input schema | Output schema | RBAC / service / DB | Notes |
|---|---|---|---|---|
| `search_doctors` | `{hospital_id?, specialty?, query?, city?, consultation_mode?, latitude?, longitude?, radius_km?, limit=5, offset=0}` | `{total, offset, limit, doctors[{id,name,hospital_id,hospital_name,hospital_city,specialty,available_durations,consultation_types,default_duration_minutes,distance_km}]}` | Direct `Doctor⨝Hospital⨝Specialty` query (`status==active`, hospital approved); specialty synonym/stem; geo rank | Prompt mandates `limit=5,offset=0` first, `offset+5` paging |
| `search_hospitals` | `{query?, city?, latitude?, longitude?, radius_km?}` | `{hospitals[{id,name,city,latitude,longitude,image_url,distance_km}]}` | `Hospital(status==approved)` only | First step of "book at Apollo" |
| `list_appointment_types` | `{hospital_id}` | `{appointment_types[{id,name,duration_minutes}]}` | `AppointmentType WHERE hospital_id`, ordered by name | Gated: booking tools refused until `visit_types_seen` |
| `check_availability` | `{doctor_id, appointment_type_id, date_from, date_to}` | `{doctor_id, slots[{start,end,start_ist,end_ist,day_ist}]}` | `get_scoped_type` + `get_or_create_calendar` + `get_available_slots(booked=live_intervals)` | Range cap 62d |
| `get_day_schedule` | `{doctor_id, date}` | `{doctor_id,date,working_hours[{...}],busy[{...}]}` | `get_day_schedule(booked=live_intervals)` | Timeline UI source; busy is anonymous |
| `create_appointment` | `{doctor_id, appointment_type_id, slot_start, slot_end, idempotency_key, patient_id?, consultation_mode?}` (`requires_idempotency=True`, `retry_safe=False`) | `{appointment_id,state,outcome:confirmed/parked/failed,value,created,external_id}` | `appointment/service.py::create_appointment` | Confirm gate: only after explicit "yes" |
| `get_appointment` | `{appointment_id}` | `{id,hospital_id,patient_id,doctor_id,appointment_type_id,slot_start,slot_end,state,external_id,idempotency_key,history[]}` | `get_appointment_or_404` + access check | Read-only |
| `reschedule_appointment` | `{appointment_id, slot_start, slot_end, reason?, idempotency_key}` | `{appointment_id,state,slot_start,slot_end}` | `service.reschedule_appointment` | Same confirm gate |
| `cancel_appointment` | `{appointment_id, reason?, idempotency_key}` | `{appointment_id,state}` | `service.cancel_appointment` | Same confirm gate |
| `get_context` | `{conversation_id}` | `{conversation_id, context}` | `get_ai_context` (no domain service) | Debug/introspection |

Supporting (non-booking): `lookup_patient`, `get_questionnaire`,
`submit_questionnaire`, `send_notification`, `start_workflow`,
`update_preferences`, `verify_caller_identity`, `verify_external_appointment`,
`synchronize_state`, `transfer_to_human`.

Error handling: `{ok:false, error}` envelopes; validation errors (422/404/409)
returned as tool results, not exceptions. Idempotency: create/reschedule/cancel
keys enforced (create via `appointments.idempotency_key` UNIQUE; others via
`integration_operations.request_payload`). Retry: LLM layer retries 429/5xx ×4
(`_throttle_delay_s`); vendor create has query-by-key → retry-same-key → park
(`reconciliation.handle_create_failure`). Audit: every tool call writes
`CapabilityExecution`; every state transition writes `AppointmentHistory`.

---

## D. Current booking lifecycle

Statuses: `AppointmentState` enum (`app/domain/appointment/models.py:29-39`), 10 values:
`requested, pending, confirmed, rescheduled, cancelled, completed, no_show,
failed, sync_pending, reconciliation_required`.
Transitions enforced in `app/domain/appointment/state_machine.py:31-76`:

```text
requested → {pending, failed}
pending → {confirmed, sync_pending, failed}
confirmed → {rescheduled, cancelled, completed, no_show}
rescheduled → {rescheduled, reconciliation_required, cancelled, completed, no_show}
sync_pending → {confirmed, reconciliation_required, failed, cancelled}
reconciliation_required → {confirmed, rescheduled, cancelled, failed}
cancelled | completed | no_show | failed → ∅ (terminal)
LIVE_STATES (hold a slot): requested, pending, confirmed, rescheduled,
                           sync_pending, reconciliation_required
```

Creation path (`POST /appointments`, `app/domain/appointment/router.py:134-181`;
MCP `create_appointment` shares `service.create_appointment`,
`app/domain/appointment/service.py:270-443`):

1. Idempotency pre-read (`WHERE idempotency_key` → replay 200).
2. Scope checks (hospital approved; doctor+type in same hospital; doctor active;
   consultation mode offered; datetimes tz-aware).
3. `assert_slot_available` (exact duration, inside one window, no block/live overlap).
4. `reserve_slot` (calendar `FOR UPDATE` lock; insert `BlockedSlot(reason=appointment)`).
5. Insert `Appointment(state=pending)`; `IntegrityError` → release hold, return winner.
6. EHR sync (`IntegrationService.create_appointment`: ensure patient/doctor/facility,
   `connector.create_appointment(idempotency_key)`).
7. Verify (`verify_external_appointment`): match → `transition(confirmed)` (201);
   else `transition(sync_pending)` + optional `reconciliation_required` + open
   `ReconciliationRecord` (202 parked). Vendor exception → 502 `failed`.
8. `publish_event("appointment.booked")` only if confirmed → Celery
   `on_appointment_booked` → in-app notification (dedupe `booked:{id}:in_app`).

So "confirmed" means DB row + vendor record + verification match. "Parked"
(`sync_pending`/`reconciliation_required`) means DB row exists but vendor
diverged — reconciled later, never silently reported as booked (prompt `:162`:
never report confirmed unless `outcome==confirmed`).

---

## E. Current hospital/doctor relationship

Single-hospital affiliation, no departments-as-link, no join table:
`Doctor.hospital_id: Uuid NOT NULL` (plain column, **no FK**),
`Doctor.specialty_id → specialties.id`, `Doctor.department_id → departments.id`
(`app/domain/doctor/models.py:22-80`; DDL `alembic/versions/0003_config_doctors.py`).
`Hospital.status` must be `approved` for anything live
(`assert_hospital_approved`).

"Book me at Apollo tomorrow" actual behavior (traced, no hospital extractor exists —
only doctor/type/date/mode detectors in `orchestrator.py:1398-1423`, so
`selected_hospital_id` stays `None`):

1. Date `tomorrow` recorded deterministically; hospital/doctor not recorded.
2. LLM must call `search_hospitals(query="Apollo")` (`Hospital.name|city ILIKE`,
   approved only) → `hospital_id`.
3. Then `search_doctors(hospital_id=...)` (`Doctor.hospital_id==input AND
   Doctor.status==active AND Hospital.status==approved`) → cards.
4. User picks a doctor → `selected_doctor_id` set → `get_day_schedule` →
   `list_appointment_types(hospital_id)` → type+mode → time → propose → "yes" → book.
5. Scope re-checked at booking: `doctor.hospital_id==hospital.id` and
   `type.hospital_id==hospital.id` else 404 (`appointment/service.py:300-309`).

There is no hospital-first prompt branch (guided flow assumes `search_doctors`
first) and no test covering the Apollo chain. Global search is the default;
hospital filtering only happens when the model passes `hospital_id` through.

---

## F. Current visit type implementation

`appointment_types` table (`app/domain/hospital_config/models.py:38-47`):
`{id, hospital_id (index), name: String(255) free-form, duration_minutes: int>0,
compatible_specialty_ids: JSONB (empty = universal), created_at, updated_at}`,
`UniqueConstraint(hospital_id, name)`. **Hospital-scoped** (all CRUD filtered by
`hospital_id`, `hospital_config/router.py:41-60,268-357`); **doctor compatibility
is indirect** (doctor's `specialty_id` must be listed or type universal —
checked at activation `doctor/service.py:185-218` and at booking
`appointment/service.py:109-113`).

Duration: **fixed per type row, stored on the type, NOT on the appointment**.
Booking must be exactly `duration_minutes` (`appointment/service.py:115-120`).
The AI discovers types only via `list_appointment_types(hospital_id)` (prompt
`:135-145` forbids assuming 30 min); gates refuse availability/booking until
`visit_types_seen + selected_appointment_type_id` (`visit_type_gate` `:918-930`,
`booking_completeness` `:966-997`). Frontend shows `"{name} · {duration} min"`
(`ai.tsx:283-323` TypeSelect; `BookPage.tsx:581-597` select).

"follow-up" / "new consultation" / "routine checkup" are **natural-language
aliases, not DB or enum values**: `name` is free text with no enum class and no
alias table; resolution is fuzzy substring vs `visit_types[].name`
(`detect_type_selection`, `:876-896`) plus model matching ("match to closest type
name yourself", `:142-143`). Seeds use `Consult {tag}`; tests only assert exact
`Consult`.

---

## G. Current consultation type implementation

Canonical stored values: **`in_person | video | phone`** (no `call` stored;
user saying "call" is regex-mapped to `phone`).

| Layer | Representation |
|---|---|
| Patient preference | `ConsultationMode(str, Enum): in_person, video, phone` (`domain/patient/models.py:31-34`) |
| Doctor offer | `Doctor.consultation_types: list[str] JSONB` (`domain/doctor/models.py:52-54`), unconstrained in schemas |
| Appointment | `appointments.consultation_mode: String(20) NULL` (`models.py:80-82`), "NULL=not specified" |
| Validation | `_normalize_consultation_mode()` (`appointment/service.py:173-187`): must be in `doctor.consultation_types` (empty offer = accept anything); `search_doctors` filter strictly validates the 3 values |
| AI extraction | `detect_consultation_mode` regexes (`orchestrator.py:1089-1109`): video→`video/virtual/video call`, phone→`phone/call/telephone/voice call`, in_person→`in-person/clinic/physical`; earliest mention wins; auto-filled into booking if omitted |
| Frontend | `ConsultationMode` union (`types/index.ts:9`); chips `Video/Phone/In-person` (`ai.tsx:336-340`); `BookPage` select+radio (`:507-620`); unknown coerced to `in_person` |

The AI does NOT hardcode availability of modes: `consultation_modes` shown in chat
come from the booking response (`:1598`), and booking validates against the
doctor's actual offer. Choices are tool/service-grounded with a deterministic
fallback, not a free LLM invention.

---

## H. Current availability algorithm

Models (`app/domain/scheduling/models.py`): `calendars{doctor_id UNIQUE, is_active}`;
`availability_rules{doctor_id, day_of_week 0=Mon..6=Sun NULL, start_time/end_time
(Time, IST wall), recurrence weekly|one_off, valid_from/valid_to NULL}`;
`blocked_slots{doctor_id, start/end (tz), reason leave|ad_hoc|appointment}`,
`UniqueConstraint(doctor_id,start,end)`.

Algorithm (`scheduling/availability.py` + `scheduling/service.py:106-245`):

1. `expand_rules_to_windows`: one-off rules covering the date win over weekly;
   overlapping/adjacent windows union-merged; rule times interpreted as IST wall → UTC.
2. `slice_windows`: step = **appointment-type duration** (granularity is per-type,
   not fixed 30m); trailing stub dropped. A 30-min type on 09:00–10:00 suggests
   only `09:00-09:30, 09:30-10:00` — 09:15 is never suggested.
3. `subtract_intervals` with `overlaps = a_start<b_end and b_start<a_end`
   (touching boundaries do NOT overlap).
4. Orchestration `get_available_slots`: inactive doctor/calendar rejected; type must
   be same-hospital; range cap 62 days; subtract `BlockedSlot`s + live appointments
   (`LIVE_STATES`); sorted output with UTC ISO + `start_ist/end_ist/day_ist` labels.
   `get_day_schedule` returns `working_hours[] + busy[]` for the timeline UI.

Overlap detection is therefore **interval-based, not grid-cell-based**: booking
`09:15-09:45` (exact type duration, inside one window, overlapping nothing)
**succeeds** via API even though the suggestion grid never offers it
(`assert_slot_available`, `appointment/service.py:86-170`; proven by
`test_day_schedule.py:73` "off-grid books when free"). `09:00-09:30` vs
`09:15-09:45` conflict via the overlap predicate, not a UNIQUE constraint
(the composite index `ix_appointments_doctor_slot` is a lookup aid; atomicity
comes from `reserve_slot`'s calendar `FOR UPDATE` lock + overlap re-check, with a
SQLite `threading.Lock` + UNIQUE backstop; concurrent-race test
`test_scheduling.py:349` "exactly one winner").

Timezone: store UTC, reject naive datetimes (422), IST (`UTC+5:30`, no DST) for
display/parsing only. Frontend `STEP_MIN=30, IST_OFFSET_MIN=330`
(`DaySchedulePicker.tsx:6-24`).

---

## I. Current frontend time selection

Active components (`frontend/apps/patient/src/`):

| Component | File | Orientation / resolution | API | Selection → backend |
|---|---|---|---|---|
| `DaySchedulePicker` | `components/appointment/DaySchedulePicker.tsx` | **Vertical** timeline (`ROW_H=56px/hr`, hour gutter + schedule column); busy = proportional absolute blocks; dropdown of 30-min starts + manual `<input type=time>` | `get_day_schedule` (via `BookPage.tsx:314`) | `{start, end=start+duration}` → `POST /appointments` |
| `SlotPicker` | `components/appointment/SlotPicker.tsx` | Grouped grid Morning/Afternoon/Evening, `grid-cols-3/4`, one button per backend slot | `check_availability` (reschedule path, `VisitsPage.tsx:530`) | `{slot_start, slot_end}` → `POST /appointments/{id}/reschedule` |
| `DaySlots` (chat) | `components/ai/ai.tsx:422` | **Horizontal** scroll chips, fixed 30-min step | `reply.day_schedule` | `onSend("{day} at {HH:MM}")` → next chat turn (never books directly) |
| `SlotChips` | `ai.tsx:181` | Horizontal wrap, max 6 | `reply.slots` | `onSend("Yes, book {label}")` → next chat turn |
| `DateStrip` | `ai.tsx:365` | Horizontal 7-day buttons | shown when `booking_stage==="pick_date"` | `onSend(...)` → next chat turn |
| `TypeSelect` / `ModeChips` | `ai.tsx:285` | `<select>` + chips | `reply.appointment_types` / `reply.consultation_modes` | `sendPrompt(name/label)` → next chat turn |
| `ConfirmPanel` | `ai.tsx:215` | Yes/No panel | `reply.pending_booking` | `onSend("Yes, ..."/"No, ...")` → next chat turn |
| `DayStripWithCalendar` | `components/appointment/DayStripWithCalendar.tsx` | Horizontal 7-day strip + month popup | none (pure picker) | `onSelect(YYYY-MM-DD)` → parent state |

Representing `09:15-09:45` inside a `09:00/09:30/10:00` grid: **not possible via
grid chips** — chat `DaySlots` and the `DaySchedulePicker` dropdown both step by
fixed 30 min and mark overlapping boundary chips unavailable (documented in
`ai.tsx:415-421`). Partially possible via the timeline: the busy overlay renders
at correct sub-hour offsets, and the manual time input (`istWallToUtcIso`) can
select/display any `HH:MM` with server-side interval validation. So arbitrary
times are *bookable* but not *tappable*.

State management: no Redux/Zustand — `AuthContext` (user/token/live) +
`AppStateContext` (appointments/notifications/refresh/reschedule/cancel) +
per-page `useState` (`chosenType`, `dayKey`).

---

## J. Current problems (architectural weaknesses — not fixed)

1. **No graph, no checkpointer.** The "LangGraph" phase-2 plan assumes nodes/edges/
   reducers that do not exist. Equivalent logic (gates, extractors, UI assembly)
   lives in one 1711-line module (`orchestrator.py`) plus `_apply/_remember`
   helpers. Any improvement must either keep the loop or explicitly introduce a
   graph — it cannot "extend" one.
2. **Known-state handling is split-brain.** Deterministic extractors
   (doctor/type/date/mode) run pre-LLM, but `hospital` has NO extractor, time has
   NO parser (only IST-label match), and type matching needs prior `visit_types`
   (cold-start "follow-up" is always dropped). The prompt says "never re-ask",
   but the code only guarantees it for the four extracted fields.
3. **Tool-grounded choices are prompt-gated, not schema-gated.** `visit_type_gate`
   / `booking_completeness` / confirm-gate enforce order in code, yet option
   *resolution* ("closest type name", "match start_ist", specialty synonyms)
   happens inside the LLM with fuzzy helpers. A wrong-but-valid UUID passes every
   gate; nothing cross-checks the model's pick against the offered list at the
   protocol level.
4. **Hospital constraint is downstream-only.** Search defaults to global; hospital
   scoping is enforced at booking (`doctor.hospital_id==type.hospital_id`) rather
   than at conversation state (`selected_hospital_id` rarely set). "Apollo"
   flows depend entirely on the model chaining `search_hospitals → search_doctors`
   with no dedicated test.
5. **Date inference is UTC-based and day-only.** `detect_date_iso` uses
   `datetime.now(timezone.utc)` while the product speaks IST; `next Monday` ==
   bare Monday (no this/next disambiguation); `DD-MM-YYYY` (`25/09/2026`)
   unhandled; times (`9:30`, `at 10`) never parsed — they survive only as IST
   label matches later. "Tomorrow" works; "tomorrow at 9:30" half-works.
6. **Visit duration is invisible until listed.** Duration lives only on
   `appointment_types.duration_minutes`; `AIContext` stores no duration, chat
   carries it only as `appointment_types[].duration_minutes`, and the frontend
   guesses `chosenType.minutes ?? 30`. Any path that skips `list_appointment_types`
   (direct `POST /appointments` with a wrong duration) fails at the service with
   no conversational repair.
7. **Time selection is grid-locked in UI, free-form in API.** Backend accepts any
   exact-duration interval; frontend chips offer only 30-min starts. Off-grid
   bookings render correctly in the timeline but can never be tapped — and the
   chat `DaySlots` clash logic blacks out BOTH boundary chips around a sub-slot
   booking, shrinking apparent availability.
8. **Frontend/backend state sync is one-directional.** Backend is source of truth
   (`AIContext` in Redis); frontend keeps only `conversation_id` + widget echo
   (`chosenType`, `dayKey`). Widget actions re-enter as free text
   (`"Yes, book …"`, `"Monday at 10"`), so a paraphrase or a stale chip can
   resolve to a different slot than the one tapped. No typed selection event,
   no slot reservation on tap, no lock held between proposal and "yes".
9. **Voice/telephone reuse the loop but lose structure.** Voice speaks the same
   `reply` text but receives none of the cards/slots/types/schedule JSON, so
   multi-option turns ("which of these 5 doctors?") degrade to read-aloud lists
   with no tappable fallback in-call.

---

## Phase 2 — Stateful, tool-grounded booking (implemented 2026-09-20)

No LangGraph was introduced (per constraint). The hand-rolled
`run_conversation()` loop + Redis `AIContext` + MCP tools architecture is
kept; determinism moved from prompt prose into code:

```text
UNDERSTAND (extractors) → STORE (AIContext) → VALIDATE (tool grounding)
→ RETRIEVE (scoped tools) → PRESENT (structured UI) → SELECT (typed
events) → REVALIDATE (readiness) → CONFIRM (pending_booking) → BOOK
```

### New canonical state (`app/ai/context/ai_context.py`, now 37 fields)

Added alongside existing fields (IDs = identity, names = display):

```text
selected_hospital_name, hospital_query, offered_hospitals,
selected_doctor_name, doctor_query,
type_query, duration_minutes,
requested_start (raw "HH:MM"), selected_start/selected_end (UTC ISO),
selected_slot ({start,end} legacy mirror, kept in sync)
```

Query fields hold UNVALIDATED candidates until tool results ground them;
`duration_minutes` comes only from the validated visit type (never asked,
never guessed).

### Deterministic extractors (`app/ai/agent/booking_state.py`, new)

- `detect_date_iso(text, today=IST)`: today/tomorrow/day-after, this/next
  weekday disambiguation ("next Monday" on a Monday → +7), month-day both
  orders, ISO, **DD/MM/YYYY + DD-MM-YYYY** (product locale first). IST today.
- `detect_time_hhmm`: 9 / 9:30 / at 10 / 10 AM / 2 PM / 14:30 → "HH:MM".
- `detect_hospital_candidate` ("at Apollo" → "Apollo", filler-trimmed,
  capitalized-name guard so "What are the hospital …" never matches),
  `detect_doctor_candidate` ("Dr Rao" → "Rao"), `detect_type_candidate`
  (follow-up/review-visit/routine/new-consultation aliases),
  `detect_mode_candidate` (video/virtual/online, phone/call/telephone,
  in-person/clinic).
- `compute_interval_utc(date, HH:MM, duration)`: end = start + duration,
  IST wall → UTC ISO. The LLM never does interval math.
- `match_hospital_offer` / `match_type_offer` / `sync_duration_from_types`
  ground candidates against `search_hospitals` / `visit_types` results.
- `field_status`: UNKNOWN / KNOWN / VALIDATED / STALE per tracked field.
- `invalidate_on_change(doctor|date|visit_type|hospital)`: drops dependent
  availability + slot + proposal. Mode change drops only the pending
  proposal (mode does not feed slot generation in this repo).
- `evaluate_readiness`: hospital-scope resolvable AND doctor AND date AND
  type AND duration AND mode AND start-validated AND interval-in-offers.
  The model follows `missing[]`; it never decides readiness.

### Orchestrator wiring (`app/ai/agent/orchestrator.py`)

- Turn-open: typed selection first, then candidate extraction (doctor/type/
  mode skipped while awaiting confirmation; confirmations never shift a
  recorded date), type grounding, interval build, targeted invalidation.
- Hospital-first: `search_hospitals` results ground `hospital_query`;
  cold-start doctor names ground post-`search_doctors`; scope line injected
  into the system prompt when set; hospital↔doctor mismatch returns a
  structured correction (alternates in-hospital) instead of substituting.
- Response adds `hospital, selected_date/start/end, duration_minutes,
  missing_fields`. `ChatIn.selection` / `run_conversation(selection=)` carry
  `{"type":"booking_selection","field","value"}` (hospital|doctor|
  appointment_type|date|start_time|consultation_mode).

### Frontend (`apps/patient`)

- `api.ts`: `postChat(message, conversationId, location, selection?)`;
  `ChatReply` gains the canonical snapshot; `BookingStage` gains `pick_mode`.
- `ChatPage.tsx`: `sendPrompt(text, selection?)`; taps send text (transcript)
  + selection (state) together.
- `ai.tsx`: doctor Choose button, type/mode/date/time widgets emit typed
  selections; `DaySlots` is now a horizontal timeline — working lane +
  exact-offset busy blocks (09:15–09:45 renders mid-cell) + tappable
  30-min free starts + selected highlight, duration-aware, server
  re-validates every tap.

### Tests

- New `backend/tests/test_booking_state.py` (45 tests): extractors, IST
  dates, aliases, interval math, sub-grid overlap, grounding, invalidation,
  readiness, persistence, typed selections, Examples A/F, mismatch
  correction.
- Full suite: 376+ passed; 6 pre-existing HEAD failures unrelated to this
  work (role-enforcement 403→422 ×2, reschedule/cancel confirm, missing-key
  503, reschedule idempotency 422, unit availability TZ expectation,
  ai_to_scheduling audit count) — all reproduce on the clean tree.

### Known limitations

- Voice/telephone turns still receive prose only (no card JSON in-call);
  typed selections are chat-only.
- No slot hold between proposal and "yes" (unchanged); races still resolve
  in `reserve_slot`.
- `DD-MM` vs `MM-DD` numeric dates prefer the product-locale (DD/MM) parse.
- "Telephone Testerson"-style proper nouns still flip the mode heuristic
  (pre-existing); now harmless (mode no longer wipes availability).

---

## Appendix — traceability index

- Agent loop + prompt: `backend/app/ai/agent/orchestrator.py` (1711 lines; `SYSTEM_PROMPT:26`,
  `run_conversation:1352`, gates `:267-508,918-997`, extractors `:807-1109,1398-1423`,
  loop `:1518-1575`, UI assembly `:1582-1686`)
- State: `backend/app/ai/context/ai_context.py` (27 fields at audit; 37 after
  Phase 2) + `backend/app/ai/agent/booking_state.py` (deterministic extractors,
  readiness, invalidation), Redis `careflow:ai-context:`
- Chat contract: `backend/app/ai/router.py` (`ChatIn:19`, `ChatOut:66`)
- Tools: `backend/app/mcp_server/tools/` (20 tools) + `server.py` + `app/ai/mcp_client/client.py`
- Appointment: `backend/app/domain/appointment/{models.py:42,service.py:270,router.py:134,state_machine.py:31,schemas.py:11}`
- Scheduling: `backend/app/domain/scheduling/{models.py:29,availability.py:57,service.py:106,router.py:120,schemas.py}`
- Types: `backend/app/domain/hospital_config/{models.py:38,router.py:264,schemas.py:42}`
- Doctor/hospital: `backend/app/domain/doctor/models.py:22`, `backend/app/domain/hospital/models.py:24`
- Frontend booking: `frontend/apps/patient/src/{api.ts:530,pages/ChatPage.tsx:82,pages/BookPage.tsx:314,components/ai/ai.tsx:34,components/appointment/DaySchedulePicker.tsx:98,components/appointment/SlotPicker.tsx:10}`
- Voice: `backend/app/voice/{vad.py,stt_provider.py,web_voice/ws_handler.py,telephony/media_stream_handler.py}`, `frontend/apps/patient/src/voice/useWebRTCAudio.ts`
- Migrations: `backend/alembic/versions/{0003_config_doctors.py,0007_appointments.py,0019_appointment_consultation_mode.py}`
