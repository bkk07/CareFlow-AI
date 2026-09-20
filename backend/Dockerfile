# CareFlow AI backend — all-in-one Railway image.
#
# Deploy: point a Railway service at the `backend/` folder. Railway detects
# this Dockerfile, builds it, and runs it. One container serves:
#   - FastAPI (uvicorn) on $PORT (Railway injects it; defaults to 8000)
#   - Celery worker + Celery beat (via supervisord, same container)
#   - Redis fallback: if REDIS_URL is unset/local, a local redis-server
#     is started inside the container so the app works with zero add-ons.
#
# Required env on Railway:
#   DATABASE_URL  from a Railway Postgres service (plugin reference)
#                 e.g. ${{Postgres.DATABASE_URL}} — the entrypoint normalizes
#                 postgres://... to postgresql+psycopg2://... for SQLAlchemy.
# Optional env:
#   REDIS_URL     from Railway Redis, or omit to use the embedded redis.
#   JWT_SECRET, BACKEND_CORS_ORIGINS (comma-separated frontend URLs),
#   LLM/GROQ/INCEPTION keys, TWILIO_*, ALL_IN_ONE=false (API-only mode).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    ALL_IN_ONE=true

WORKDIR /code

# redis-server = embedded broker/cache fallback, supervisor = run
# API + worker + beat in one container, curl = Railway healthchecks/debugging.
RUN apt-get update \
    && apt-get install -y --no-install-recommends redis-server supervisor curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Entry scripts referenced below (start.sh, supervisord.conf) ship with the
# repo; ensure the entrypoint is executable even on Windows checkouts.
RUN chmod +x start.sh

EXPOSE 8000

# start.sh: normalize DATABASE_URL/REDIS_URL -> wait for Postgres ->
# alembic upgrade head (retried) -> exec supervisord (or uvicorn alone
# when ALL_IN_ONE=false, preserving the old split docker-compose layout).
CMD ["./start.sh"]
