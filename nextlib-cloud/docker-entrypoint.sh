#!/bin/sh
# =============================================================================
# NextLib-Cloud container entrypoint
# =============================================================================
# Waits for Postgres to accept connections, then runs drizzle migrations
# before handing off to the main process (CMD).
#
# Why this exists: drizzle-kit migrate was failing silently inside the
# container (spinner output, no TTY) and the process exited non-zero, which
# combined with `restart: unless-stopped` caused an infinite restart loop.
# This entrypoint makes migration explicit, retry-backed, and non-interactive.
#
# Concurrency: only the service with RUN_MIGRATIONS=1 migrates. The worker
# omits it and just waits for the DB to be reachable, so app and worker don't
# race on the migration table.
# =============================================================================
set -e

# ---- Wait for Postgres ------------------------------------------------------
# drizzle-kit + pg need the server accepting connections before they connect.
# Retry up to ~30s so boot ordering with the `db` service is not fatal.
if [ -n "$DATABASE_URL" ]; then
  HOST=$(printf '%s' "$DATABASE_URL" | sed -nE 's|^postgresql://[^@]*@([^:/]+).*|\1|p')
  PORT=$(printf '%s' "$DATABASE_URL" | sed -nE 's|^postgresql://[^@]*@[^:/]+:([0-9]+).*|\1|p')
  PORT=${PORT:-5432}

  echo "[entrypoint] Waiting for database at ${HOST}:${PORT}..."
  i=0
  until nc -z "$HOST" "$PORT" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -ge 30 ]; then
      echo "[entrypoint] Database still unreachable after 30s — giving up." >&2
      exit 1
    fi
    sleep 1
  done
  echo "[entrypoint] Database is reachable."
fi

# ---- Run migrations (only the designated service) ---------------------------
if [ -n "$DATABASE_URL" ] && [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  echo "[entrypoint] Running database migrations..."
  # CI=true forces drizzle-kit into non-interactive mode so it never blocks on
  # a TTY/prompt (which was the cause of the silent spinner + restart loop).
  CI=true npx drizzle-kit migrate
  echo "[entrypoint] Migrations complete."
elif [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] RUN_MIGRATIONS is not 1 — skipping migrations."
else
  echo "[entrypoint] DATABASE_URL not set — skipping migrations."
fi

# ---- Hand off to CMD (PID 1) ------------------------------------------------
exec "$@"
