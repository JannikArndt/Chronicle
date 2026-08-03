-- Chronicle sharing, phase 1 — plans/sharing-feature-design.md §3.
--
-- NOT YET RUN AGAINST A LIVE POSTGRES. The visibility rule is mirrored in
-- TypeScript in src/sharing/fakeBackend.ts, which the test suite exercises end
-- to end; this file is the same rule in SQL and needs a real `supabase db push`
-- plus a manual two-account check before anyone's data depends on it.
--
-- Design notes that matter for review:
--   * One `shared_records` table rather than three. The wire format is uniform
--     (see src/sharing/records.ts), so three tables would mean three copies of
--     one policy. The design doc sketched three; this is the deviation.
--   * `payload` is the only content-bearing column. Everything RLS reads is
--     plaintext structural metadata. That split is what keeps end-to-end
--     encryption a later option rather than a rewrite (§D3).
--   * Group nesting is walked exactly one level, not recursively. `addSubGroup`
--     in src/state/actions.ts refuses to nest deeper and only one level is ever
--     drawn, so a recursive CTE would be machinery for a tree that cannot exist.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- tables ----

create table if not exists accounts (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text not null default 'Someone',
  -- §D2: "shared-only" is the default and uploads nothing the user has not
  -- published. "everything" is the opt-in multi-device mode (phase 1b).
  sync_mode     text not null default 'shared-only' check (sync_mode in ('shared-only', 'everything')),
  created_at    timestamptz not null default now()
);

create table if not exists shared_records (
  owner_account uuid not null references accounts(id) on delete cascade,
  kind          text not null check (kind in ('group', 'row', 'entry')),
  id            text not null,          -- the owner's local id; unique per owner only
  parent_id     text,                   -- group → parentGroupId, row → groupId, entry → rowId
  shared        boolean not null default false,
  payload       jsonb,                  -- null on a tombstone
  clock         text not null,          -- serialised HLC; lexicographic order is the total order
  updated_by    uuid not null references accounts(id),
  deleted       boolean not null default false,
  primary key (owner_account, kind, id)
);

create index if not exists shared_records_parent_idx on shared_records (owner_account, kind, parent_id);

create table if not exists group_owners (
  owner_account uuid not null references accounts(id) on delete cascade,
  group_id      text not null,
  account_id    uuid not null references accounts(id) on delete cascade,
  primary key (owner_account, group_id, account_id)
);

create table if not exists grants (
  id            uuid primary key default gen_random_uuid(),
  owner_account uuid not null references accounts(id) on delete cascade,
  subject_kind  text not null check (subject_kind in ('group', 'row')),
  subject_id    text not null,
  grantee       uuid not null references accounts(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (owner_account, subject_kind, subject_id, grantee)
);

-- An invite is a link, not an email — Chronicle sends no mail (§D5). The token
-- is the capability, so it is generated server-side and expires.
create table if not exists invites (
  token         text primary key default encode(gen_random_bytes(24), 'base64url'),
  owner_account uuid not null references accounts(id) on delete cascade,
  subject_kind  text not null check (subject_kind in ('group', 'row')),
  subject_id    text not null,
  role          text not null check (role in ('reader', 'owner')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 days',
  redeemed_at   timestamptz,
  redeemed_by   uuid references accounts(id)
);

-- ------------------------------------------------------- visibility rule ----
-- SECURITY DEFINER because these read shared_records to answer a question about
-- shared_records; without it the policy would recurse into itself.

create or replace function is_group_owner(p_owner uuid, p_group text, p_viewer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_group is not null and exists (
    select 1 from group_owners
     where owner_account = p_owner and group_id = p_group and account_id = p_viewer
  );
$$;

create or replace function has_grant(p_owner uuid, p_kind text, p_subject text, p_viewer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_subject is not null and exists (
    select 1 from grants
     where owner_account = p_owner and subject_kind = p_kind and subject_id = p_subject and grantee = p_viewer
  );
$$;

-- Does the viewer's grant reach this group — directly, or through its parent?
create or replace function grant_reaches_group(p_owner uuid, p_group text, p_viewer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_group_owner(p_owner, p_group, p_viewer)
      or has_grant(p_owner, 'group', p_group, p_viewer)
      or exists (
           select 1 from shared_records g
            where g.owner_account = p_owner and g.kind = 'group' and g.id = p_group
              and g.parent_id is not null
              and (has_grant(p_owner, 'group', g.parent_id, p_viewer)
                or is_group_owner(p_owner, g.parent_id, p_viewer))
         );
$$;

-- A row is readable when it is published AND the viewer's grant reaches it.
-- Co-ownership of its group is the other way in, and is the only case where an
-- unpublished row is readable by someone other than its owner.
create or replace function can_read_row(p_owner uuid, p_row text, p_viewer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from shared_records r
     where r.owner_account = p_owner and r.kind = 'row' and r.id = p_row and not r.deleted
       and (r.shared or is_group_owner(p_owner, r.parent_id, p_viewer))
       and (has_grant(p_owner, 'row', p_row, p_viewer) or grant_reaches_group(p_owner, r.parent_id, p_viewer))
  );
$$;

-- A group is visible when it is published and granted, or when it is the
-- container (or the parent of the container) of a row the viewer can read. The
-- second clause is what stops a shared row arriving with no lane to sit on —
-- and it is why publishing a timeline also publishes its group's name.
create or replace function can_see_group(p_owner uuid, p_group text, p_viewer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_group_owner(p_owner, p_group, p_viewer)
      or exists (
           select 1 from shared_records r
            where r.owner_account = p_owner and r.kind = 'row' and not r.deleted
              and (
                r.parent_id = p_group
                or r.parent_id in (
                     select g.id from shared_records g
                      where g.owner_account = p_owner and g.kind = 'group' and g.parent_id = p_group
                   )
              )
              and can_read_row(p_owner, r.id, p_viewer)
         )
      or exists (
           select 1 from shared_records g
            where g.owner_account = p_owner and g.kind = 'group' and g.id = p_group
              and g.shared and grant_reaches_group(p_owner, p_group, p_viewer)
         );
$$;

-- --------------------------------------------------------------- policies ----

alter table accounts       enable row level security;
alter table shared_records enable row level security;
alter table group_owners   enable row level security;
alter table grants         enable row level security;
alter table invites        enable row level security;

create policy accounts_self on accounts
  for all using (id = auth.uid()) with check (id = auth.uid());

-- Display names are readable by anyone signed in: they are shown in "who can
-- see this" lists and as the header of a mirror. Emails live in auth.users and
-- are never exposed here.
create policy accounts_read_names on accounts for select to authenticated using (true);

create policy records_own on shared_records
  for all using (owner_account = auth.uid()) with check (owner_account = auth.uid());

create policy records_readable on shared_records for select to authenticated using (
  not deleted and case kind
    when 'group' then can_see_group(owner_account, id, auth.uid())
    when 'row'   then can_read_row(owner_account, id, auth.uid())
    when 'entry' then can_read_row(owner_account, parent_id, auth.uid())
    else false
  end
);

-- Co-owners write into someone else's namespace: the records stay filed under
-- the original owner_account, which is what keeps a mirror's ids stable when
-- two people edit the same group.
create policy records_coowner_write on shared_records for all to authenticated
  using (
    case kind
      when 'group' then is_group_owner(owner_account, id, auth.uid())
      when 'row'   then is_group_owner(owner_account, parent_id, auth.uid())
      when 'entry' then can_read_row(owner_account, parent_id, auth.uid())
      else false
    end
  )
  with check (
    case kind
      when 'group' then is_group_owner(owner_account, id, auth.uid())
      when 'row'   then is_group_owner(owner_account, parent_id, auth.uid())
      when 'entry' then can_read_row(owner_account, parent_id, auth.uid())
      else false
    end
  );

create policy group_owners_visible on group_owners for select to authenticated
  using (owner_account = auth.uid() or account_id = auth.uid());
create policy group_owners_managed on group_owners for all
  using (owner_account = auth.uid()) with check (owner_account = auth.uid());

-- A grantee may see (and delete) the grant naming them, so "stop sharing this
-- with me" does not require the owner.
create policy grants_visible on grants for select to authenticated
  using (owner_account = auth.uid() or grantee = auth.uid());
create policy grants_managed on grants for all
  using (owner_account = auth.uid()) with check (owner_account = auth.uid());
create policy grants_self_removal on grants for delete using (grantee = auth.uid());

create policy invites_own on invites for all
  using (owner_account = auth.uid()) with check (owner_account = auth.uid());

-- ------------------------------------------------------------- redemption ----
-- Redeeming runs as SECURITY DEFINER: the invitee cannot read the invites table
-- (that would let anyone enumerate tokens), so the check and the grant have to
-- happen inside one trusted function. It is deliberately silent about *why* a
-- token failed — "expired" and "never existed" look the same from outside.

create or replace function redeem_invite(p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_invite invites%rowtype;
begin
  select * into v_invite from invites
   where token = p_token and redeemed_at is null and expires_at > now();
  if not found then
    raise exception 'This invite link is not valid.' using errcode = '22023';
  end if;

  if v_invite.role = 'owner' and v_invite.subject_kind = 'group' then
    insert into group_owners (owner_account, group_id, account_id)
    values (v_invite.owner_account, v_invite.subject_id, auth.uid())
    on conflict do nothing;
  else
    insert into grants (owner_account, subject_kind, subject_id, grantee)
    values (v_invite.owner_account, v_invite.subject_kind, v_invite.subject_id, auth.uid())
    on conflict do nothing;
  end if;

  update invites set redeemed_at = now(), redeemed_by = auth.uid() where token = p_token;
end;
$$;

revoke all on function redeem_invite(text) from public;
grant execute on function redeem_invite(text) to authenticated;

-- An account row has to exist before anything can reference it.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into accounts (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Realtime: subscribers get postgres_changes filtered by the same policies.
alter publication supabase_realtime add table shared_records;
