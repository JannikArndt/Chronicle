-- Chronicle events (schema v8): a moment on a timeline, alongside the spans.
--
-- A fourth record kind, and nothing else. An event belongs to a row exactly the
-- way an entry does, carries no publish flag of its own, and is therefore
-- readable by precisely the people who can read its row — so every rule below
-- is the entry rule with one more branch.
--
-- Written as its own migration rather than an edit to 0001_sharing.sql: that
-- file has been applied to real databases, and `create table if not exists`
-- would silently leave their `kind` constraint at the old three values.
--
-- Verified the same way as 0001: `npm run verify:sql` applies both files to a
-- real Postgres and runs supabase/tests/rls.test.sql, which now drives events
-- through the same publish → read → un-publish → tombstone cycle. The
-- TypeScript mirror of this rule lives in src/sharing/fakeBackend.ts and
-- changes with it.

-- ------------------------------------------------------------ the kind ------
-- Dropped by name first so the file is re-runnable: `add constraint` has no
-- `if not exists`. The unnamed inline check in 0001 got this name from
-- Postgres, and naming it explicitly here is what lets a later migration find
-- it again.

alter table shared_records drop constraint if exists shared_records_kind_check;
alter table shared_records
  add constraint shared_records_kind_check check (kind in ('group', 'row', 'entry', 'event'));

-- ------------------------------------------------------- who may write ------
-- An event is writable by a co-owner of the group its row sits in, and by
-- nobody else — the same question `owns_row_group` already answers for entries.
-- Deliberately NOT `can_read_row`: that is the bug 0001 shipped and fixed, where
-- a read-only grant carried write access to every entry on a shared timeline.

create or replace function can_write_record(p_owner uuid, p_kind text, p_id text, p_parent text, p_viewer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'group' then is_group_owner(p_owner, p_id, p_viewer)
    when 'row'   then is_group_owner(p_owner, p_parent, p_viewer)
    when 'entry' then owns_row_group(p_owner, p_parent, p_viewer)
    when 'event' then owns_row_group(p_owner, p_parent, p_viewer)
    else false
  end;
$$;

-- -------------------------------------------------------- who may read ------
-- Re-created rather than amended: a policy's USING expression cannot be
-- altered in place. Still the ONLY read path into someone else's records, and
-- `not deleted` is still unconditional — a tombstone tells a reader that
-- something was withdrawn, which is itself a disclosure.

drop policy if exists records_readable on shared_records;

create policy records_readable on shared_records for select to authenticated using (
  not deleted and case kind
    when 'group' then can_see_group(owner_account, id, auth.uid())
    when 'row'   then can_read_row(owner_account, id, auth.uid())
    when 'entry' then can_read_row(owner_account, parent_id, auth.uid())
    when 'event' then can_read_row(owner_account, parent_id, auth.uid())
    else false
  end
);
