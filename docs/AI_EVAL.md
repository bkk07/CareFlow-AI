# AI Evaluation Guide

Source-grounded. Verified against `backend/app/ai/agent/orchestrator.py`, `backend/app/mcp_server/tools/`, `backend/app/ai/context/ai_context.py`, `backend/app/ai/mcp_client/client.py`, `backend/app/mcp_server/server.py`, `backend/app/voice/`, `backend/app/core/config.py`, `backend/requirements.txt`, and `backend/tests/`.

## Intended use

Conversational healthcare **scheduling only**: find hospitals/doctors, check real availability, book / reschedule / cancel visits, collect pre-visit questionnaires, escalate to a human. The assistant must never diagnose, prescribe, or interpret answers medically (enforced in `SYSTEM_PROMPT` at `backend/app/ai/agent/orchestrator.py:42-214` and in deterministic code).

## AI architecture (not RAG)

Hand-rolled OpenAI-compatible tool-calling loop (`run_conversation`, `MAX_ITERATIONS=8` at `orchestrator.py:216,1832`), no agent framework. Flow per turn: deterministic pre-LLM gates → system prompt + serialized `AIContext` + last 10 history messages + tool specs → `POST {base}/chat/completions` with `tools=[{type:function}]`, `tool_choice=auto` (`groq_complete`, `orchestrator.py:680-730`) → tool calls via `AgentToolClient` → `MCP execute_tool` (Pydantic validation → 422 on invalid input) → domain service → PostgreSQL / EHR connector → context update → reply assembly (`ChatOut` with structured UI fields).

**RAG is not used.** Repository-wide search for `embedding|vector|langchain|langgraph|chromadb|faiss|pgvector|pinecone|qdrant|sentence-transformer` returns no hits in `backend/` (only an unrelated HMAC test-vector name). `backend/requirements.txt` has no AI/embedding/vector dependency (LLM access is `httpx` only). Facts come from live capability tools over PostgreSQL/the EHR connector; memory is structured `AIContext` in Redis (`careflow:ai-context:{conversation_id}`, TTL 7200s, in-memory fallback), not retrieved passages. History is capped at 20 turns, last 10 sent to the model (`backend/app/ai/context/ai_context.py`).

## Model / provider configuration (`backend/app/core/config.py`)

| Setting | Default | Behavior |
|---|---|---|
| `INCEPTION_API_KEY` / `INCEPTION_MODEL=mercury-2.5` / `INCEPTION_BASE_URL=https://api.inceptionlabs.ai/v1` | empty / `mercury-2.5` | Preferred chat backend when key is set (`_chat_backend`, `orchestrator.py:658-677`) |
| `LLM_API_KEY` (alias `GROQ_API_KEY`) / `LLM_MODEL=openai/gpt-oss-20b` / `LLM_BASE_URL=https://api.groq.com/openai/v1` | empty / `openai/gpt-oss-20b` | Fallback chat backend; also STT transport |
| `STT_PROVIDER=stub` / `STT_MODEL=whisper-large-v3-turbo` | `stub` | `StubSTT` hears nothing; `GroqSTT` posts PCM16→WAV to `{LLM_BASE_URL}/audio/transcriptions` (3-attempt retry on 429/5xx) when `STT_PROVIDER=groq` (`backend/app/voice/stt_provider.py`) |
| `TTS_PROVIDER=stub` / `TTS_MODEL=canopylabs/orpheus-v1-english` / `TTS_VOICE=troy` | `stub` | Server Orpheus removed; only `StubTTS` (raises on use) remains. Active speech is browser Web Speech API (`frontend/apps/patient/src/voice/useSpeechSynthesis.ts`) |
| `TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER`, `TELEPHONY_STREAM_URL` | empty | Telephony transport; empty stream URL disables inbound with 503 |
| `AI_CONTEXT_TTL_S=7200`, `VOICE_SILENCE_S=20.0` | — | Context TTL, voice silence budget |

Chat transport retries 4× on 429/5xx with vendor-header-aware backoff (`_throttle_delay_s`).

## Available MCP tools (20)

Custom in-process layer (`backend/app/mcp_server/server.py:82`), not the MCP protocol SDK. Wrapper (`backend/app/mcp_server/tools/_base.py`) enforces auth → idempotency (writes only) → bounded retry (reads) → audit. Only `create/reschedule/cancel_appointment` require `idempotency_key`.

| Tool | `allowed_roles` |
|---|---|
| `search_hospitals`, `search_doctors`, `check_availability`, `get_day_schedule`, `lookup_patient`, `get_appointment`, `get_context`, `get_questionnaire`, `list_appointment_types`, `synchronize_state`, `verify_external_appointment`, `transfer_to_human` | include `platform_admin` where listed in source; reads generally `patient, hospital_admin, platform_admin` |
| `create_appointment`, `reschedule_appointment`, `cancel_appointment`, `submit_questionnaire` | `patient, hospital_admin` (patients may only book for themselves) |
| `send_notification`, `start_workflow` | `hospital_admin, platform_admin` only |
| `update_preferences`, `verify_caller_identity` | `patient` only |

Per-tool files: `backend/app/mcp_server/tools/*.py` (each declares `TOOL_NAME` + `allowed_roles`).

## Tool allowlist (telephony)

Unverified telephone calls may call only 6 tools (`TELEPHONY_OPEN_TOOLS`, `orchestrator.py:281-290`): `verify_caller_identity`, `transfer_to_human`, `search_hospitals`, `search_doctors`, `check_availability`, `get_context`. All other tools return `caller_identity_required` until verified (`_telephony_gate`, `orchestrator.py:312-318`). `verify_caller_identity` caps at 3 attempts (`MAX_IDENTITY_ATTEMPTS=3`), then human transfer.

## Authorization / guard behavior

- Every tool call passes `allowed_roles`; denied calls are still audited.
- Deterministic gates run before/around the model: clinical-request decline (`CLINICAL_PATTERNS`, `is_clinical_request`), greeting-only replies, visit-type gate, booking-completeness gate (date + picked type-id match + picked mode), and booking-confirmation gate (mutating tools need an explicit yes; proposals mint `idempotency_key` and store `pending_booking`/`awaiting_confirmation`).
- Questionnaire collection asks only fetched questions in order; concerning free-text opens an `Escalation` with no medical interpretation (`FLAG_PHRASES`).
- Voice: partial transcripts are display-only and never trigger writes; barge-in aborts generation and speech; one silence re-prompt, then escalation. Structured booking widgets are chat-only; voice turns receive prose.

## Fail-closed behavior

- No chat key (`INCEPTION_API_KEY` and `LLM_API_KEY`/`GROQ_API_KEY` both empty) → `AINotConfiguredError`, chat returns 502/503, never a hallucinated booking.
- Empty message → `ValueError`; loop exhaustion → `LOOP_EXHAUSTED`; tool faults return `{ok:false, error}` so turns never crash (`orchestrator.py`).
- Telephony webhook without `TELEPHONY_STREAM_URL` → 503; bad Twilio signature → 403 (skipped only when no `TWILIO_AUTH_TOKEN`).
- EHR `4xx` validation errors fail immediately (never retried); unknown/divergent vendor outcomes park as `sync_pending` + open reconciliation record or escalate to `reconciliation_required`.

## Known limitations

- Server-side TTS is a stub; telephone/voice speech depends on the browser Web Speech path or test hooks.
- STT default `stub` hears nothing — real transcription needs `STT_PROVIDER=groq` + key.
- Test stack is SQLite while production is PostgreSQL (lock/concurrency paths differ).
- No embeddings, vector DB, LangChain/LangGraph, or MCP SDK in the codebase.

## Evaluation considerations

- Drive evaluation through `POST /chat` (`ChatIn{message, conversation_id, latitude, longitude, selection}`) and `POST /mcp/call {tool, input}`; inspect `GET /mcp/tools` for the live tool registry and `/openapi.json` for routes (see `docs/API.md`).
- Deterministic suites: `pytest tests/test_booking_state.py` (45 tests), `tests/ai/` (intent, context, clarification, tool selection, safety boundary), `tests/test_voice.py`, `tests/test_telephony.py` (22 tests).
- Check: confirmation gate blocks unconfirmed writes; unverified telephony cannot reach patient-data tools; clinical prompts decline; idempotent replays return the same booking; unknown EHR outcomes reconcile rather than confirm.
- Keys are env-only (`infra/.env.example`, `backend/.env.example`); no secrets appear in prompts or tool specs.
