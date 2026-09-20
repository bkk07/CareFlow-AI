# Contributing to CareFlow AI

This documents the repository's actual workflow, verified against `README.md`, `infra/docker-compose.yml`, `backend/requirements.txt`, `frontend/apps/*/package.json`, and `backend/alembic/`.

## Prerequisites

- Python 3.13 (`backend/Dockerfile:18 FROM python:3.13-slim`)
- Node 18+ (frontend images use `node:22-alpine`)
- Docker + Docker Compose
- PostgreSQL 16 + Redis 7 (or Docker to provide them via `infra/docker-compose.yml`: `postgres:16-alpine`, `redis:7-alpine`)

## Environment setup

Never commit `.env`. Only `.env.example` files are tracked (see `.gitignore`).

```bash
cp infra/.env.example infra/.env
cp backend/.env.example backend/.env   # optional local overrides
cp frontend/apps/patient/.env.example frontend/apps/patient/.env
cp frontend/apps/doctor/.env.example frontend/apps/doctor/.env
cp frontend/apps/hospital-admin/.env.example frontend/apps/hospital-admin/.env
cp frontend/apps/operations-admin/.env.example frontend/apps/operations-admin/.env
cp frontend/apps/platform-admin/.env.example frontend/apps/platform-admin/.env
```

Each frontend reads only `VITE_API_URL` (defaults to `http://localhost:8000` in every `.env.example`; production fallback `https://careflow-ai-production.up.railway.app` is compiled in `frontend/apps/*/src/api.ts`). Full variable list lives in `infra/.env.example` (database, Redis, JWT, LLM/STT/TTS, Twilio, SMTP, CORS).

## Backend setup

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: `GET http://localhost:8000/health`. Interactive docs: `/docs`, `/redoc`, `/openapi.json` (see `docs/API.md`).

## Frontend setup (per app)

```bash
cd frontend/apps/patient   # or doctor | hospital-admin | operations-admin | platform-admin
npm install
npm run dev                # Vite: 5173 / 5177 / 5174 / 5176 / 5178
```

Scripts are identical in all five `package.json` files: `dev` = `vite`, `build` = `tsc --noEmit && vite build`, `preview` = `vite preview`.

| App | Dev port (`vite.config.ts`) |
|---|---|
| patient | 5173 |
| hospital-admin | 5174 |
| operations-admin | 5176 |
| doctor | 5177 |
| platform-admin | 5178 |

## Docker

```bash
cd infra
docker compose up -d --build
docker compose logs -f backend worker beat
```

If ports clash, use the alt-ports override (`8001/6380/5179+`):

```bash
cd infra
docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml up -d --build redis backend
```

Notes: `patient` SPA was removed from compose — run it via local `npm run dev`. `backend` in compose runs API-only (`ALL_IN_ONE=false`); production Railway runs all-in-one via `supervisord` (see `docs/DEPLOYMENT.md`).

## Migrations

Alembic versions `0001–0023` live in `backend/alembic/versions/`. Containers run `alembic upgrade head` automatically (`backend/start.sh`); run it manually after pulling migration changes:

```bash
cd backend
alembic upgrade head
```

Do not edit applied migrations; add a new revision.

## Tests

Supported commands (see `docs/TESTING.md`):

```bash
cd backend && pytest
pytest tests/test_booking_state.py
pytest tests/unit tests/integration tests/ai tests/ehr
```

```bash
cd backend/tests/e2e && npm install && npx playwright test
```

Per-app frontend check: `npm run build` in `frontend/apps/<app>` (`tsc --noEmit && vite build`).

## Branch / PR expectations

- `main` is the maintained branch (remote `origin https://github.com/bkk07/CareFlow-AI.git`).
- Keep PRs scoped; do not bundle unrelated backend/frontend/infra changes.
- Include test evidence: backend `pytest` and affected frontend `npm run build`.
- No CI/CD exists in the repo (no `.github/workflows`) — the PR description is the test record.
- Do not paste secrets, tokens, or `.env` contents into PRs.

## Code quality

- Backend: Pydantic validation on router/tool inputs; role checks via `require_role`; tenant filtering via `hospital_scoped_query`.
- Frontend: TypeScript strict via `tsc --noEmit`; per-app `src/api.ts` owns the API base URL.
- Docs: if you add routes, tools, or env vars, update `docs/API.md` and the relevant `.env.example` in the same PR.
