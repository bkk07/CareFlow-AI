# Testing

Verified against `backend/tests/` layout, `backend/tests/conftest.py`, `backend/tests/e2e/`, and `frontend/apps/*/package.json`.

## Backend (pytest)

Suite: 28 top-level `test_*.py` files plus `unit/` (7), `integration/` (7), `ai/` (5), `ehr/` (10) — 57 pytest files total covering auth, scheduling, appointments, double-booking, lifecycle, reliability, workflow, questionnaire, dashboards, voice, telephony, MCP/agent, observability, geo.

Test DB behavior: `backend/tests/conftest.py:35-42` uses `sqlite://` + `StaticPool` with `Base.metadata.create_all` and per-test full-table cleanup; the app is served via `TestClient` with a `get_db` override. Production is PostgreSQL 16, so lock/concurrency paths (`FOR UPDATE`, unique backstops) are not exercised against real Postgres here. Async side effects run eager via `TASK_EAGER`.

Required services: none (SQLite + eager tasks). Postgres/Redis not needed for `pytest`.

```bash
cd backend && pytest
pytest tests/test_booking_state.py   # 45 deterministic booking-state tests
pytest tests/unit tests/integration tests/ai tests/ehr
```

## Frontend (typecheck + build)

No frontend unit-test runner is configured. Per-app verification is `tsc --noEmit && vite build` (identical `build` script in all five `package.json` files):

```bash
npm run build   # run inside frontend/apps/<app>
```

## E2E (Playwright)

Specs `happy_path_spec` + `failure_recovery_spec` with `seed.ts` in `backend/tests/e2e/` (own `package.json`, `@playwright/test ^1.47.2`, Chromium headless, `playwright.config.ts`):

```bash
cd backend/tests/e2e && npm install && npx playwright test
```

Requires a running backend + frontend per the spec/seed configuration. Artifacts (`test-results/`, `playwright-report/`) are gitignored.
