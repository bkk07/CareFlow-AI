# Deployment

Verified against `backend/Dockerfile`, `backend/start.sh`, `backend/supervisord.conf`, `backend/railway.toml`, `infra/docker-compose.yml`, `infra/docker-compose.alt-ports.yml`, and `frontend/apps/*/vercel.json` + `Dockerfile`.

There is no CI/CD in the repository (no `.github/workflows`).

## Backend — Railway all-in-one container

- Image: `backend/Dockerfile` (`python:3.13-slim` + `redis-server` + `supervisor` + `curl`), `CMD ["./start.sh"]`, service root = `backend/` (`backend/railway.toml`).
- `railway.toml`: Dockerfile builder, `healthcheckPath=/health`, `healthcheckTimeout=300`, restart `ON_FAILURE` × 10.
- `start.sh`: normalizes `DATABASE_URL` (`postgres://` / `postgresql://` → `postgresql+psycopg2://`, strips Neon `channel_binding`), boots embedded `redis-server` when `REDIS_URL` is unset/local, TCP-waits Postgres (skipped for sqlite), widens `alembic_version.version_num`, retries `alembic upgrade head` (10 × 5s), then `supervisord` (uvicorn API + Celery worker `--concurrency=2` + Celery beat) or bare uvicorn when `ALL_IN_ONE=false`.
- Required env (Railway Postgres/Redis plugins or equivalents): `DATABASE_URL`, `REDIS_URL` (optional — embedded fallback), `JWT_SECRET` (long random string), `BACKEND_CORS_ORIGINS` (must cover the Vercel URLs), plus optional `INCEPTION_API_KEY` / `LLM_API_KEY`, `STT_*`, `TWILIO_*`, `SMTP_*`, `TELEPHONY_STREAM_URL`. See `backend/.env.example` and `infra/.env.example`.
- Caveats: chat fails closed without LLM keys (502/503); STT defaults to `stub`; telephony webhook returns 503 when `TELEPHONY_STREAM_URL` is empty.

## Frontend — Vercel SPAs

- Five apps (`frontend/apps/*`), each with identical `vercel.json` SPA rewrite (`/(.*)` → `/index.html`).
- Four have public deployments linked in `README.md` (patient, doctor, hospital-admin, platform-admin). Operations Admin has no public deployment.
- Each app's `src/api.ts` uses `VITE_API_URL` with compiled-in production fallback `https://careflow-ai-production.up.railway.app`. Set `VITE_API_URL` per Vercel project for non-default backends.

## Local — compose split layout

- `infra/docker-compose.yml` (`name: careflow`): `postgres:16-alpine` (5432), `redis:7-alpine` (6379), `backend` API-only (`ALL_IN_ONE=false`, 8000, `/health` check), `hospital-admin` (5174, `VITE_API_URL=http://localhost:8000`), `doctor` (5177), `worker` (`celery worker --concurrency=2`), `beat` (`celery beat`). Volumes `pgdata`, `redisdata`. Patient SPA runs via local `npm run dev`, not compose.
- Port conflicts: overlay `infra/docker-compose.alt-ports.yml` (`8001/6380/5179/5180`, see `docs/SETUP.md`).

## Database / migration requirements

- Production DB must be PostgreSQL 16. Alembic `0001–0023` run automatically at container start; ensure the DB user can alter schema (the entrypoint widens `alembic_version.version_num` for the 34-char `0019` revision id).
