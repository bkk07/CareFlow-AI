#!/bin/sh
# All-in-one entrypoint for Railway (backend/ folder is the service root).
# Steps: normalize DATABASE_URL/REDIS_URL -> optional embedded redis ->
# wait for Postgres -> alembic migrations -> supervisord (API+worker+beat)
# or plain uvicorn when ALL_IN_ONE=false.
set -eu

PORT="${PORT:-8000}"
ALL_IN_ONE="${ALL_IN_ONE:-true}"

# --- 1) Normalize DATABASE_URL for SQLAlchemy/psycopg2 -----------------------
# Railway Postgres plugins expose postgres://... or postgresql://..., while
# the app default is postgresql+psycopg2://... Accept all three spellings.
if [ -n "${DATABASE_URL:-}" ]; then
  case "$DATABASE_URL" in
    postgres://*) DATABASE_URL="postgresql+psycopg2://${DATABASE_URL#postgres://}" ;;
    postgresql://*) DATABASE_URL="postgresql+psycopg2://${DATABASE_URL#postgresql://}" ;;
  esac
  # Neon pooler URLs append channel_binding=require, which psycopg2's bundled
  # libpq rejects as an invalid connection option — strip that one parameter
  # and keep everything else (e.g. sslmode=require, which is required).
  DATABASE_URL="$(python -c "
from urllib.parse import urlsplit, parse_qsl, urlencode, urlunsplit
import os
u = urlsplit(os.environ.get('DATABASE_URL', ''))
q = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k != 'channel_binding']
print(urlunsplit((u.scheme, u.netloc, u.path, urlencode(q), u.fragment)))
")"
  export DATABASE_URL
fi

# --- 2) Redis: external when provided, embedded fallback otherwise -----------
# If REDIS_URL is unset or points at localhost, boot the redis-server that
# ships in this image so Celery + AI context work with zero add-ons.
case "${REDIS_URL:-}" in
  ""|*localhost*|*127.0.0.1*)
    export REDIS_URL="redis://localhost:6379/0"
    echo "[start] no external REDIS_URL — starting embedded redis-server…"
    redis-server --daemonize yes --save '' --appendonly no
    ;;
  *)
    echo "[start] using external REDIS_URL"
    ;;
esac

# --- 3) Wait for Postgres (skipped for sqlite URLs) ---------------------------
case "${DATABASE_URL:-}" in
  sqlite*|"") echo "[start] non-Postgres DATABASE_URL — skipping DB wait" ;;
  *)
    if [ -n "${DATABASE_URL:-}" ]; then
  echo "[start] waiting for Postgres…"
  for i in $(seq 1 30); do
    if python -c "
import os, sys
from urllib.parse import urlparse
raw = os.environ['DATABASE_URL']
u = urlparse(raw.split('?', 1)[0])
try:
    import socket
    host = u.hostname or 'localhost'
    port = u.port or 5432
    socket.create_connection((host, port), timeout=3).close()
    sys.exit(0)
except Exception:
    sys.exit(1)
"; then
      echo "[start] Postgres reachable"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "[start] WARNING: Postgres not reachable after 30s — continuing anyway (migrations will retry)"
    fi
    sleep 2
  done
    fi
    ;;
esac

# --- 3b) Widen alembic_version.version_num ------------------------------------
# Alembic's default version table is VARCHAR(32), but this repo has a longer
# revision id (0019_appointment_consultation_mode, 34 chars): fresh databases
# fail stamping it. Pre-widen (or pre-create) the table to VARCHAR(128) —
# safe on existing DBs, required on fresh ones. Best-effort: real errors
# still surface from the migration loop below.
python -c "
import os
url = os.environ.get('DATABASE_URL', '')
if url.startswith('sqlite'):
    raise SystemExit(0)
try:
    from sqlalchemy import create_engine, text
    eng = create_engine(url)
    with eng.begin() as c:
        exists = c.execute(text(\"SELECT to_regclass('public.alembic_version')\")).scalar()
        if exists:
            c.execute(text('ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(128)'))
            print('[start] widened alembic_version.version_num to VARCHAR(128)')
        else:
            c.execute(text('CREATE TABLE alembic_version (version_num VARCHAR(128) NOT NULL PRIMARY KEY)'))
            print('[start] pre-created alembic_version (VARCHAR(128))')
except Exception as e:
    print(f'[start] version-table prep skipped ({e})')
" || true

# --- 4) Migrations (idempotent via alembic version table; retried) -----------
echo "[start] running alembic upgrade head…"
for i in $(seq 1 10); do
  if python -m alembic -c alembic.ini upgrade head; then
    echo "[start] migrations done"
    break
  fi
  if [ "$i" -eq 10 ]; then
    echo "[start] ERROR: migrations failed after 10 attempts" >&2
    exit 1
  fi
  echo "[start] migration attempt $i failed — retrying in 5s…"
  sleep 5
done

# --- 5) Launch ----------------------------------------------------------------
if [ "$ALL_IN_ONE" = "false" ]; then
  # Split layout (docker-compose backend service): API only; worker/beat run
  # as their own containers.
  echo "[start] ALL_IN_ONE=false — starting API only on port $PORT"
  exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
fi

echo "[start] starting supervisord (api + celery worker + celery beat) on port $PORT"
exec /usr/bin/supervisord -c /code/supervisord.conf
