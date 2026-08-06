#!/usr/bin/env bash
# Run supabase/migrations/*.sql against a real Postgres and assert that the RLS
# policies behave — the one thing `npm test` structurally cannot do, because
# there the policies are re-implemented in TypeScript (src/sharing/fakeBackend.ts).
#
#   scripts/verify-sql.sh                        # local cluster, throwaway db
#   DATABASE_URL=postgres://… scripts/verify-sql.sh
#
# With DATABASE_URL the database is used as-is and must be empty-ish; without
# it, a scratch database is created and dropped again.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="${DB_NAME:-chronicle_sql_check}"

# psql as a superuser. On a local cluster that means the postgres role, which
# on Debian/Ubuntu is reachable only by becoming the postgres user.
run() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql -X -v ON_ERROR_STOP=1 --quiet "$DATABASE_URL" "$@"
  elif [[ "$(id -un)" != "postgres" ]] && id postgres >/dev/null 2>&1 && [[ "$(id -u)" == "0" ]]; then
    su postgres -c "$(printf '%q ' psql -X -v ON_ERROR_STOP=1 --quiet "$@")"
  else
    psql -X -v ON_ERROR_STOP=1 --quiet "$@"
  fi
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  if ! pg_isready --quiet 2>/dev/null; then
    echo "No local Postgres is accepting connections." >&2
    echo "Start one — 'pg_ctlcluster 16 main start', 'brew services start postgresql'," >&2
    echo "or 'supabase start' — or set DATABASE_URL." >&2
    exit 1
  fi
  echo "→ scratch database $DB_NAME"
  run -c "drop database if exists $DB_NAME"
  run -c "create database $DB_NAME"
  db=(-d "$DB_NAME")
else
  echo "→ using DATABASE_URL"
  db=()
fi

echo "→ local Supabase shim (auth schema, roles, publication)"
run "${db[@]}" -f supabase/tests/shim.sql > /dev/null

for migration in supabase/migrations/*.sql; do
  echo "→ $migration"
  run "${db[@]}" -f "$migration" > /dev/null
done

echo "→ supabase/tests/rls.test.sql"
run "${db[@]}" -f supabase/tests/rls.test.sql

if [[ -z "${DATABASE_URL:-}" ]]; then
  run -c "drop database if exists $DB_NAME" > /dev/null
fi
