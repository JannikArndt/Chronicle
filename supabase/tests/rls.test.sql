-- The family scenario from plans/sharing-feature-design.md, run against a real
-- Postgres with RLS on, switching identity per statement the way PostgREST
-- switches it per request.
--
-- src/sharing/fakeBackend.ts re-implements this same visibility rule in
-- TypeScript so the app's tests can run in-process. That one is a test double.
-- *This* file is the security boundary, so the two have to agree: change one,
-- change the other, and run both.
--
-- Run with: scripts/verify-sql.sh   (throwaway database: shim + migration + this)

\set ON_ERROR_STOP on
\t on
\pset format unaligned

-- ------------------------------------------------------------- assertions ---

create or replace function chk(p_label text, p_actual anyelement, p_expected anyelement)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL  %  — expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok    %', p_label;
end $$;

-- Refusal has two shapes under RLS and both count: a write that violates a
-- WITH CHECK raises, while a write whose USING clause matches nothing simply
-- touches zero rows and reports success. Only the third outcome — rows actually
-- changed — is a failure.
create or replace function chk_denied(p_label text, p_sql text)
returns void language plpgsql as $$
declare
  v_rows bigint;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    raise exception 'FAIL  %  — affected % row(s), should have been refused', p_label, v_rows;
  end if;
  raise notice 'ok    % (no rows)', p_label;
exception
  when insufficient_privilege or check_violation or invalid_parameter_value then
    raise notice 'ok    % (refused)', p_label;
end $$;

-- ------------------------------------------------------------- the people ---

-- A clean slate, so the file can be re-run against the same database. Cascades
-- through accounts to every table that references it.
truncate auth.users cascade;

\set alice    '00000000-0000-4000-8000-00000000a11c'
\set dad      '00000000-0000-4000-8000-00000000dad0'
\set stranger '00000000-0000-4000-8000-0000000057a0'

insert into auth.users (id, email) values
  (:'alice',    'alice@example.test'),
  (:'dad',      'dad@example.test'),
  (:'stranger', 'stranger@example.test');

-- The trigger, not this file, is supposed to have created these.
select chk('signing up creates an account row', (select count(*)::int from accounts), 3);

update accounts set display_name = 'Alice' where id = :'alice';
update accounts set display_name = 'Dad'   where id = :'dad';

-- ------------------------------------------------------- alice's timeline ---
-- g-me ─ r-job     (published)
--      └ r-therapy (private — the "few they might not like")
-- g-family ─ g-dad ─ r-dad-job (private; dad will co-own g-dad)
--
-- No group is published in its own right: groups ride along as the containers
-- of published rows, which is the ordinary case and the one where un-publishing
-- has to take the container with it.

select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;

insert into shared_records (owner_account, kind, id, parent_id, shared, payload, clock, updated_by) values
  (:'alice', 'group', 'g-me',      null,        false, '{"label":"Alice"}',    '0001', :'alice'),
  (:'alice', 'group', 'g-family',  null,        false, '{"label":"Family"}',   '0001', :'alice'),
  (:'alice', 'group', 'g-dad',     'g-family',  false, '{"label":"Dad"}',      '0001', :'alice'),
  (:'alice', 'row',   'r-job',     'g-me',      true,  '{"label":"Job"}',      '0001', :'alice'),
  (:'alice', 'row',   'r-therapy', 'g-me',      false, '{"label":"Therapy"}',  '0001', :'alice'),
  (:'alice', 'row',   'r-dad-job', 'g-dad',     false, '{"label":"Dad: Job"}', '0001', :'alice'),
  (:'alice', 'entry', 'e-job-1',   'r-job',     true,  '{"title":"Kestrel"}',  '0001', :'alice'),
  (:'alice', 'entry', 'e-ther-1',  'r-therapy', false, '{"title":"Session"}',  '0001', :'alice'),
  -- Events (schema v8). Like entries they carry `shared = false` and are never
  -- asked about it: their row answers for them.
  (:'alice', 'event', 'v-job-1',   'r-job',     false, '{"title":"First day"}', '0001', :'alice'),
  (:'alice', 'event', 'v-ther-1',  'r-therapy', false, '{"title":"Told her"}',  '0001', :'alice');

select chk('an owner sees all of her own records', (select count(*)::int from shared_records), 10);
reset role;

-- ------------------------------------------------------ before any invite ---

select set_config('request.jwt.claim.sub', :'dad', false);
set role authenticated;
select chk('an account with no grant sees nothing', (select count(*)::int from shared_records), 0);
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
select chk('an anonymous request sees no records',  (select count(*)::int from shared_records), 0);
select chk('an anonymous request sees no accounts', (select count(*)::int from accounts), 0);
reset role;

-- --------------------------------------------- invite dad to own his group ---

select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
insert into invites (owner_account, subject_kind, subject_id, role)
  values (:'alice', 'group', 'g-dad', 'owner');
select chk('the invite token is generated server-side',
           (select length(token) >= 32 from invites limit 1), true);
select chk('the token is url-safe',
           (select token !~ '[+/=]' from invites limit 1), true);
reset role;

-- The invitee must not be able to read the invites table — that would let
-- anyone enumerate tokens. Redemption goes through the definer function.
select set_config('request.jwt.claim.sub', :'dad', false);
set role authenticated;
select chk('an invitee cannot enumerate invites', (select count(*)::int from invites), 0);
reset role;

select token as invite_token from invites limit 1 \gset

select set_config('request.jwt.claim.sub', :'dad', false);
set role authenticated;
select redeem_invite(:'invite_token');
reset role;

select chk('redeeming an owner invite makes a co-owner',
           (select count(*)::int from group_owners where group_id = 'g-dad' and account_id = :'dad'), 1);
select chk('redeeming marks the invite used',
           (select count(*)::int from invites where redeemed_by = :'dad'), 1);

-- ------------------------------------------------- what co-ownership buys ---

select set_config('request.jwt.claim.sub', :'dad', false);
set role authenticated;

select chk('a co-owner sees his group',
           (select count(*)::int from shared_records where kind = 'group' and id = 'g-dad'), 1);
select chk('a co-owner sees an UNPUBLISHED row in his group',
           (select count(*)::int from shared_records where kind = 'row' and id = 'r-dad-job'), 1);
select chk('the container above it comes along so the row has a lane',
           (select count(*)::int from shared_records where id = 'g-family'), 1);
select chk('co-ownership leaks none of the rest of her timeline',
           (select count(*)::int from shared_records
             where id in ('r-job', 'r-therapy', 'e-job-1', 'e-ther-1', 'v-job-1', 'v-ther-1')), 0);
select chk('co-ownership does not reveal a sibling group',
           (select count(*)::int from shared_records where kind = 'group' and id = 'g-me'), 0);

-- A co-owner writes into Alice's namespace: the record stays filed under her
-- account, which is what keeps a mirror's ids stable when two people edit.
insert into shared_records (owner_account, kind, id, parent_id, shared, payload, clock, updated_by)
  values (:'alice', 'entry', 'e-dad-1', 'r-dad-job', false, '{"title":"Apprenticeship"}', '0002', :'dad');
select chk('a co-owner can add an entry to a row in his group',
           (select count(*)::int from shared_records where id = 'e-dad-1'), 1);

insert into shared_records (owner_account, kind, id, parent_id, shared, payload, clock, updated_by)
  values (:'alice', 'event', 'v-dad-1', 'r-dad-job', false, '{"title":"Passed the exam"}', '0002', :'dad');
select chk('a co-owner can add an event to a row in his group',
           (select count(*)::int from shared_records where id = 'v-dad-1'), 1);

select chk_denied('a co-owner cannot write outside his group', $sql$
  insert into shared_records (owner_account, kind, id, parent_id, shared, payload, clock, updated_by)
  values ('00000000-0000-4000-8000-00000000a11c', 'row', 'r-forged', 'g-me', true, '{}', '0003',
          '00000000-0000-4000-8000-00000000dad0')
$sql$);
reset role;

-- ---------------------------------------- and now read access to her group ---

select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
insert into grants (owner_account, subject_kind, subject_id, grantee)
  values (:'alice', 'group', 'g-me', :'dad');
reset role;

select set_config('request.jwt.claim.sub', :'dad', false);
set role authenticated;

select chk('a grant reveals the published row',       (select count(*)::int from shared_records where id = 'r-job'), 1);
select chk('a grant reveals its entries',             (select count(*)::int from shared_records where id = 'e-job-1'), 1);
select chk('a grant reveals its events',              (select count(*)::int from shared_records where id = 'v-job-1'), 1);
select chk('a grant does NOT reveal a private row',   (select count(*)::int from shared_records where id = 'r-therapy'), 0);
select chk('a private row''s entries stay hidden',    (select count(*)::int from shared_records where id = 'e-ther-1'), 0);
select chk('a private row''s events stay hidden',     (select count(*)::int from shared_records where id = 'v-ther-1'), 0);
select chk('the containing group comes with the row', (select count(*)::int from shared_records where id = 'g-me'), 1);

select chk_denied('a reader cannot edit what he can read', $sql$
  update shared_records set payload = '{"label":"hacked"}'
   where owner_account = '00000000-0000-4000-8000-00000000a11c' and id = 'r-job'
$sql$);
select chk_denied('a reader cannot delete it either', $sql$
  delete from shared_records
   where owner_account = '00000000-0000-4000-8000-00000000a11c' and id = 'r-job'
$sql$);
-- The one that got away first time round: the write policy's entry branch
-- asked whether the account could *read* the row, so a read-only grant carried
-- write access to every entry on it.
select chk_denied('a reader cannot edit an entry on a row he can read', $sql$
  update shared_records set payload = '{"title":"hacked"}'
   where owner_account = '00000000-0000-4000-8000-00000000a11c' and id = 'e-job-1'
$sql$);
select chk_denied('a reader cannot add an entry to a row he can read', $sql$
  insert into shared_records (owner_account, kind, id, parent_id, shared, payload, clock, updated_by)
  values ('00000000-0000-4000-8000-00000000a11c', 'entry', 'e-forged', 'r-job', true, '{}', '0009',
          '00000000-0000-4000-8000-00000000dad0')
$sql$);
-- The same trap, one kind along: an event's write branch must ask about
-- co-ownership of the group, never about being able to read the row.
select chk_denied('a reader cannot edit an event on a row he can read', $sql$
  update shared_records set payload = '{"title":"hacked"}'
   where owner_account = '00000000-0000-4000-8000-00000000a11c' and id = 'v-job-1'
$sql$);
select chk_denied('a reader cannot add an event to a row he can read', $sql$
  insert into shared_records (owner_account, kind, id, parent_id, shared, payload, clock, updated_by)
  values ('00000000-0000-4000-8000-00000000a11c', 'event', 'v-forged', 'r-job', false, '{}', '0009',
          '00000000-0000-4000-8000-00000000dad0')
$sql$);
reset role;

-- A grant on a parent group reaches one level down — that is how "share the
-- family" works without naming everyone in it.

select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
update shared_records set shared = true where id = 'r-dad-job';
insert into grants (owner_account, subject_kind, subject_id, grantee)
  values (:'alice', 'group', 'g-family', :'stranger');
reset role;

select set_config('request.jwt.claim.sub', :'stranger', false);
set role authenticated;
select chk('a grant on a parent group reaches a sub-group''s published row',
           (select count(*)::int from shared_records where id = 'r-dad-job'), 1);
select chk('...and both containers above it',
           (select count(*)::int from shared_records where id in ('g-dad', 'g-family')), 2);
select chk('...and nothing on the other branch',
           (select count(*)::int from shared_records where id in ('r-job', 'r-therapy', 'g-me')), 0);
select chk('...and the entry a co-owner wrote into it',
           (select count(*)::int from shared_records where id = 'e-dad-1'), 1);
select chk('...and the event he wrote into it',
           (select count(*)::int from shared_records where id = 'v-dad-1'), 1);
reset role;

-- --------------------------------------------------------------- un-share ---

select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
update shared_records set shared = false where id = 'r-job';
reset role;

select set_config('request.jwt.claim.sub', :'dad', false);
set role authenticated;
select chk('un-publishing hides the row again',   (select count(*)::int from shared_records where id = 'r-job'), 0);
select chk('un-publishing hides its entries too', (select count(*)::int from shared_records where id = 'e-job-1'), 0);
select chk('un-publishing hides its events too',  (select count(*)::int from shared_records where id = 'v-job-1'), 0);
select chk('the group goes with the last shared row it held',
           (select count(*)::int from shared_records where id = 'g-me'), 0);
reset role;

-- ------------------------------------------------------------- tombstones ---

select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
update shared_records set shared = true where id = 'r-job';
update shared_records set deleted = true, payload = null where id = 'e-job-1';
update shared_records set deleted = true, payload = null where id = 'v-job-1';
reset role;

select set_config('request.jwt.claim.sub', :'dad', false);
set role authenticated;
select chk('the row is back', (select count(*)::int from shared_records where id = 'r-job'), 1);
select chk('a tombstone is not shipped to a reader — absence is the delete',
           (select count(*)::int from shared_records where id = 'e-job-1'), 0);
select chk('an event''s tombstone is not shipped either',
           (select count(*)::int from shared_records where id = 'v-job-1'), 0);
reset role;

-- ------------------------------------------------------------- revocation ---

select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
delete from grants where grantee = :'dad';
reset role;

select set_config('request.jwt.claim.sub', :'dad', false);
set role authenticated;
select chk('revoking the grant closes the door',
           (select count(*)::int from shared_records where parent_id = 'g-me'), 0);
select chk('...and co-ownership is untouched by it',
           (select count(*)::int from shared_records where id = 'r-dad-job'), 1);
reset role;

-- A grantee can walk away without asking the owner (grants_self_removal).
select set_config('request.jwt.claim.sub', :'stranger', false);
set role authenticated;
delete from grants where grantee = :'stranger';
select chk('a grantee can remove the grant naming him',
           (select count(*)::int from shared_records where id = 'r-dad-job'), 0);
reset role;

-- --------------------------------------------------------- invite hygiene ---

select set_config('request.jwt.claim.sub', :'alice', false);
set role authenticated;
insert into invites (owner_account, subject_kind, subject_id, role, expires_at)
  values (:'alice', 'row', 'r-job', 'reader', now() - interval '1 day');
reset role;

select token as expired_token from invites where expires_at < now() \gset

select set_config('request.jwt.claim.sub', :'stranger', false);
set role authenticated;
select chk_denied('an expired invite is refused', format('select redeem_invite(%L)', :'expired_token'));
select chk_denied('an unknown token is refused',  $sql$select redeem_invite('not-a-real-token')$sql$);
select chk('a refused redemption grants nothing',
           (select count(*)::int from grants where grantee = :'stranger'), 0);
reset role;

select set_config('request.jwt.claim.sub', :'dad', false);
set role authenticated;
select chk_denied('an invite cannot be redeemed twice', format('select redeem_invite(%L)', :'invite_token'));
reset role;

-- ------------------------------------------------------------ identities ---

select set_config('request.jwt.claim.sub', :'dad', false);
set role authenticated;
select chk('a display name is readable — it heads a mirror',
           (select display_name from accounts where id = :'alice'), 'Alice'::text);
select chk_denied('another account cannot be renamed', $sql$
  update accounts set display_name = 'Not Alice'
   where id = '00000000-0000-4000-8000-00000000a11c'
$sql$);
select chk('no email is reachable from the app schema',
           (select count(*)::int from information_schema.columns
             where table_schema = 'public' and column_name like '%email%'), 0);
reset role;

\echo ''
\echo 'All RLS assertions passed.'
