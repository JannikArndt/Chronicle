# Setting up the sharing backend

Chronicle runs **without any of this**. With no Supabase project configured the
app is what it always was: IndexedDB only, no account, no network calls, and the
Supabase SDK is not even emitted into the bundle. Everything here is optional and
only needed if you want the sharing feature (`src/sharing/`) to work — on your own
deployment, or on a fork.

Two paths: a local stack in Docker for development, or a hosted project for a
deployment other people can actually reach.

---

## Fast path

```
npm run setup:supabase          # local stack in Docker, writes .env.local
npm run setup:supabase -- --remote   # link a hosted project instead
npm run verify:sql              # run the migration + RLS assertions against Postgres
npm run dev
```

The script is idempotent — re-run it whenever you change the migration.

---

## What actually has to be true

Whichever path you take, four things:

1. **The migration is applied.** `migrations/0001_sharing.sql` creates the tables,
   the row-level-security policies that *are* the access control, and the
   `redeem_invite` function. It is written to be safely re-runnable.
2. **`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set** at build time (in
   `.env.local` locally, as repository secrets for a deployment).
3. **The redirect URLs are allow-listed.** Sign-in is a magic link that returns to
   whatever page the user was on — including the `#/invite/<token>` route — so
   the URL pattern has to be allowed or the link lands on an error page.
4. **SMTP is configured for anything real.** Supabase's built-in sender is
   rate-limited to a handful of mails an hour and is documented as
   development-only. Family members who cannot receive a sign-in link cannot
   sign in.

---

## Local stack (development)

Needs Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development).

```
npm run setup:supabase
```

which is the equivalent of:

```
supabase start                         # postgres + auth + realtime in docker
supabase db reset                      # applies supabase/migrations/*.sql
```

then putting the URL and anon key the CLI prints into `.env.local`:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<the anon key `supabase start` printed>
```

Magic links do not leave the machine: `supabase start` runs a mail catcher
(Inbucket, http://127.0.0.1:54324 by default) and every sign-in mail lands there.
That is enough to exercise the whole invite → publish → propagate cycle with two
browser profiles, without sending a single real email.

`config.toml` already allows `http://localhost:5173/Chronicle/**` as a redirect
target — the Vite dev server plus Chronicle's base path. If you run the dev
server somewhere else, add it there.

## Hosted project (a deployment)

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
   Pick a region near the people who will use it; this is a family app, not a CDN.
2. Apply the migration, either with the CLI:

   ```
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   or by pasting `migrations/0001_sharing.sql` into the dashboard's SQL editor.
   Both are fine; the file is the source of truth either way.
3. **Settings → API**: copy the project URL and the `anon` / publishable key into
   `.env.local` (local builds) or into the repository secrets your deploy
   workflow reads (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

   The anon key is *meant* to be public — it identifies the project and
   authorises nothing; RLS is the gate. The `service_role` key is the opposite:
   it bypasses RLS entirely. It must never appear in a `VITE_` variable, in this
   repo, or in a browser bundle.
4. **Authentication → URL Configuration**: set the site URL to where the app is
   served (for the reference deployment, `https://jannikarndt.github.io/Chronicle/`)
   and add a redirect pattern covering the whole path space:

   ```
   https://jannikarndt.github.io/Chronicle/**
   http://localhost:5173/Chronicle/**
   ```

   Without the wildcard, an invite link that arrives while the user is on
   `#/invite/<token>` bounces.
5. **Authentication → Providers → Email**: leave "Confirm email" off and password
   sign-in off. Magic link is the only path — nobody is creating a password to
   fill in their own childhood.
6. **Project Settings → Auth → SMTP**: point at a real sender (Resend, Postmark,
   SES, your own). Skipping this is the single most common reason a family
   invite silently fails.

### Deploying with sharing enabled

`.github/workflows/deploy.yml` builds with whatever `VITE_*` variables are in
the environment. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
repository secrets and pass them into the build step. Leave them unset and the
deployed app is the local-only Chronicle — which is a perfectly good thing for a
fork to be.

---

## Verifying it

```
npm run verify:sql
```

Creates a scratch database, loads `tests/shim.sql` (a stand-in for the pieces of
a Supabase project a bare Postgres lacks: the `auth` schema, `auth.uid()`, the
`anon`/`authenticated` roles), applies the migration, and runs
`tests/rls.test.sql` — the family scenario from the design doc, asserted against
real RLS with the identity switched per statement the way PostgREST switches it
per request.

It needs a Postgres to talk to. Any of these works:

```
npm run verify:sql                                  # a local cluster on the default socket
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres npm run verify:sql
                                                    # the one `supabase start` runs
```

This is not the same as `npm test`. The TypeScript suite exercises the sharing
*client* against `src/sharing/fakeBackend.ts`, which re-implements the visibility
rule in TypeScript — a test double, deliberately, so the app's tests need no
database. The SQL is the actual security boundary, and only `verify:sql` runs it.
Change one, change the other, run both.

---

## What is not set up here

- **No end-to-end encryption.** Published payloads are readable by the server.
  The structural/`payload` column split exists so E2EE stays a later option
  rather than a rewrite, but today the server can read what you publish, and the
  app says so in the sharing menu.
- **No backups.** Signing in is not a backup of your timeline — only what you
  publish is uploaded. Keep exporting JSON.
- **Nothing multi-region, nothing scaled.** Phase 1 re-pulls the whole visible
  set on every change. That is fine for a family and would not be fine for a
  crowd.
