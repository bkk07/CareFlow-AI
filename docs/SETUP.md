# Setup

Canonical local-development setup. For the full narrative see `README.md`; for deploy see `docs/DEPLOYMENT.md`; for tests see `docs/TESTING.md`.

## Prerequisites

- Python 3.13 (`backend/Dockerfile:18`)
- Node 18+
- Docker + Docker Compose
- PostgreSQL 16 + Redis 7 (or Docker to provide them)

## 1. Environment files

Never commit `.env` (gitignored). Copy the examples:

```bash
cp infra/.env.example infra/.env
cp backend/.env.example backend/.env   # optional local overrides
cp frontend/apps/patient/.env.example frontend/apps/patient/.env
cp frontend/apps/doctor/.env.example frontend/apps/doctor/.env
cp frontend/apps/hospital-admin/.env.example frontend/apps/hospital-admin/.env
cp frontend/apps/operations-admin/.env.example frontend/apps/operations-admin/.env
cp frontend/apps/platform-admin/.env.example frontend/apps/platform-admin/.env
```

Every frontend `.env.example` contains only `VITE_API_URL=http://localhost:8000`. The full variable list (database, Redis, JWT, LLM/STT/TTS, Twilio, SMTP, CORS) is in `infra/.env.example`; `backend/.env.example` documents the Railway single-container subset. LLM/STT/Twilio keys are optional (see `docs/AI_EVAL.md` fail-closed behavior).

## 2. Database

Compose creates the `careflow` DB on `postgres:16-alpine`. Alternatively point `DATABASE_URL` at a local Postgres. Migrations run automatically in the container entrypoint; run manually after pulling migration changes:

```bash
cd backend
alembic upgrade head
```

Alembic versions `0001–0023` live in `backend/alembic/versions/`.

## 3. Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Verify: `GET http://localhost:8000/health` → `{"status":"ok"}`. API docs: `/docs`, `/openapi.json` (see `docs/API.md`).

## 4. Frontend (per app)

```bash
cd frontend/apps/patient   # or doctor | hospital-admin | operations-admin | platform-admin
npm install
npm run dev
```

| App | Dev port (`vite.config.ts`) |
|---|---|
| patient | 5173 |
| hospital-admin | 5174 |
| operations-admin | 5176 |
| doctor | 5177 |
| platform-admin | 5178 |

Each app reads `VITE_API_URL` (local `http://localhost:8000`; production Railway fallback compiled in `src/api.ts`).

## 5. Docker (optional)

```bash
cd infra
docker compose up -d --build
docker compose logs -f backend worker beat
```

The `patient` SPA is not in compose — run it via `npm run dev`. Compose `backend` runs API-only (`ALL_IN_ONE=false`); see `docs/DEPLOYMENT.md` for the all-in-one container.

## 6. Alternate ports

If ports clash, use the override (`redis 6380`, `backend 8001`, `hospital-admin 5179`, `doctor 5180`; `VITE_API_URL=http://localhost:8001`):

```bash
cd infra
docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml up -d --build redis backend
```

Defined in `infra/docker-compose.alt-ports.yml`.
