#!/bin/sh
# Optionally applies pending migrations before the API starts.
#
# Off by default: a migration is a schema change on live data and should be a
# conscious decision. Set RUN_MIGRATIONS=true on the deploy that needs it.
# `migrate deploy` only applies migrations that were already committed; it never
# creates one, resets the database or drops data on its own.
set -e

if [ "${RUN_MIGRATIONS}" = "true" ]; then
  echo "[entrypoint] Applying database migrations..."
  npx prisma migrate deploy --schema=src/database/prisma/schema.prisma
  echo "[entrypoint] Migrations applied."
fi

exec "$@"
