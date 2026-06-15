#!/bin/sh
# =============================================================================
# NextLib-Cloud container entrypoint
# =============================================================================
# Runs database migrations before handing off to the main process (CMD).
# Only migrates when DATABASE_URL is set — lets the container boot in a
# no-DB context (e.g. building) without crashing.
#
# Works for both the web server (CMD = next start) and the worker (CMD = tsx),
# since both need an up-to-date schema. To avoid races when app + worker start
# at the same time against the same DB, drizzle-kit migrate is safe to run
# concurrently (it takes an advisory lock).
# =============================================================================
set -e

if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] Running database migrations..."
  # npx pulls in drizzle-kit from devDependencies, which ARE installed because
  # the runner stage ships the full node_modules (see Dockerfile).
  npx drizzle-kit migrate
  echo "[entrypoint] Migrations complete."
else
  echo "[entrypoint] DATABASE_URL not set — skipping migrations."
fi

# Hand off to the container's CMD (PID 1) so signals propagate correctly.
exec "$@"
