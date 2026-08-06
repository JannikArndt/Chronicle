#!/usr/bin/env bash
# Set up the sharing backend — supabase/README.md has the long version.
#
#   scripts/setup-supabase.sh              # local stack in Docker, writes .env.local
#   scripts/setup-supabase.sh --remote     # link a hosted project and push the migration
#
# Idempotent: re-run it after changing a migration. It never writes a key
# anywhere but .env.local, which is git-ignored.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="local"
[[ "${1:-}" == "--remote" ]] && MODE="remote"

ENV_FILE=".env.local"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# The CLI is not a dependency of the app — only of this script — so it is used
# via npx rather than added to package.json.
supa() {
  if command -v supabase >/dev/null 2>&1; then supabase "$@"; else npx --yes supabase "$@"; fi
}

# Rewrite one KEY=value line in .env.local, leaving anything else in the file
# alone. Creating the file from .env.example keeps its comments.
set_env() {
  local key="$1" value="$2"
  [[ -f "$ENV_FILE" ]] || cp .env.example "$ENV_FILE"
  if grep -q "^${key}=" "$ENV_FILE"; then
    # A URL and a JWT both contain '/', so use a separator that cannot appear.
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

if [[ "$MODE" == "local" ]]; then
  command -v docker >/dev/null 2>&1 || die "Docker is required for the local stack. Use --remote for a hosted project."
  docker info >/dev/null 2>&1 || die "Docker is installed but not running."

  say "Starting the local Supabase stack (first run pulls several images)…"
  supa start

  say "Applying supabase/migrations to the local database…"
  # `db reset` re-creates the database and replays every migration, which is what
  # makes re-running this script mean something.
  supa db reset

  say "Reading the local keys…"
  status="$(supa status -o env)"
  url="$(sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' <<< "$status")"
  key="$(sed -n 's/^ANON_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' <<< "$status")"
  [[ -n "$url" && -n "$key" ]] || die "Could not read API_URL / ANON_KEY from 'supabase status'."

  set_env VITE_SUPABASE_URL "$url"
  set_env VITE_SUPABASE_ANON_KEY "$key"

  say "Done."
  echo "  $ENV_FILE now points at the local stack."
  echo "  Sign-in mails are caught locally — open the Inbucket URL from 'supabase status'."
  echo "  Next: npm run dev"
else
  say "Linking a hosted Supabase project"
  ref="${SUPABASE_PROJECT_REF:-}"
  if [[ -z "$ref" ]]; then
    read -r -p "Project ref (dashboard URL: /project/<ref>): " ref
  fi
  [[ -n "$ref" ]] || die "No project ref given."

  supa link --project-ref "$ref"

  say "Pushing supabase/migrations to the project…"
  supa db push

  say "Keys"
  echo "Dashboard → Settings → API. The anon (publishable) key is safe in a"
  echo "browser bundle; the service_role key is NOT and must never be set here."
  url="${SUPABASE_URL:-}"
  key="${SUPABASE_ANON_KEY:-}"
  [[ -n "$url" ]] || read -r -p "Project URL (https://<ref>.supabase.co): " url
  [[ -n "$key" ]] || read -r -p "anon / publishable key: " key
  [[ -n "$url" && -n "$key" ]] || die "Both a URL and an anon key are needed."
  case "$key" in
    *service_role*) die "That looks like the service_role key. It bypasses row-level security — never put it in a VITE_ variable." ;;
  esac

  set_env VITE_SUPABASE_URL "$url"
  set_env VITE_SUPABASE_ANON_KEY "$key"

  say "Two things the CLI cannot do for you"
  echo "  1. Authentication → URL Configuration: allow your deployment's URL with a"
  echo "     /** wildcard, or invite links will bounce."
  echo "  2. Project Settings → Auth → SMTP: point at a real sender. The built-in"
  echo "     one is rate-limited and dev-only, and a family invite that never"
  echo "     arrives is the most common way this setup fails."
fi

say "Verify the policies with: npm run verify:sql"
