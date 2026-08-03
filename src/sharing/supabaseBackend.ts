// The Supabase implementation of `SharingBackend` — plans/sharing-feature-design.md §D1.
//
// Two rules this file exists to enforce:
//
//  1. **The SDK is lazy-imported.** A signed-out Chronicle must behave exactly
//     as it did before sharing existed, and "exactly" includes not downloading
//     a websocket client. The `import()` below is the only reference, so Vite
//     emits it as a separate chunk that is never fetched until someone signs in.
//  2. **Missing config is a supported state, not an error.** Anyone who clones
//     the repo and runs `npm run dev` has no Supabase project. Sharing reports
//     itself unavailable and the rest of the app is untouched.
//
// The anon key is publishable by design: it identifies the project, it does not
// authorise anything. Row-level security is the gate.

import { keyOf } from "./records";
import type { Grant, InviteDraft, MirrorSnapshot, SharingBackend, SharingSession } from "./backend";
import type { SyncRecord } from "./records";
import type { SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isSharingConfigured(): boolean {
  return typeof SUPABASE_URL === "string" && SUPABASE_URL !== "" && typeof SUPABASE_ANON_KEY === "string";
}

let clientPromise: Promise<SupabaseClient> | null = null;

async function client(): Promise<SupabaseClient> {
  if (!isSharingConfigured()) throw new Error("Sharing is not configured for this build.");
  clientPromise ??= import("@supabase/supabase-js").then((module) =>
    module.createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }),
  );
  return clientPromise;
}

interface RecordRow {
  owner_account: string;
  kind: SyncRecord["kind"];
  id: string;
  parent_id: string | null;
  shared: boolean;
  payload: Record<string, unknown> | null;
  clock: string;
  updated_by: string;
  deleted: boolean;
}

function toRecord(row: RecordRow): SyncRecord {
  return {
    kind: row.kind,
    id: row.id,
    ownerAccountId: row.owner_account,
    parentId: row.parent_id ?? undefined,
    shared: row.shared,
    payload: row.payload,
    clock: row.clock,
    updatedBy: row.updated_by,
    deleted: row.deleted,
  };
}

function toRow(record: SyncRecord): RecordRow {
  return {
    owner_account: record.ownerAccountId,
    kind: record.kind,
    id: record.id,
    parent_id: record.parentId ?? null,
    shared: record.shared,
    payload: record.payload,
    clock: record.clock,
    updated_by: record.updatedBy,
    deleted: record.deleted,
  };
}

export const supabaseBackend: SharingBackend = {
  async currentSession(): Promise<SharingSession | null> {
    if (!isSharingConfigured()) return null;
    const { data } = await (await client()).auth.getSession();
    const user = data.session?.user;
    return user === undefined ? null : { accountId: user.id, email: user.email ?? "" };
  },

  async requestMagicLink(email: string, redirectTo: string): Promise<void> {
    const { error } = await (await client()).auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) throw new Error(error.message);
  },

  async signOut(): Promise<void> {
    await (await client()).auth.signOut();
  },

  async push(records: SyncRecord[]): Promise<void> {
    if (records.length === 0) return;
    const { error } = await (await client())
      .from("shared_records")
      .upsert(records.map(toRow), { onConflict: "owner_account,kind,id" });
    if (error) throw new Error(error.message);
  },

  async pullVisible(): Promise<MirrorSnapshot[]> {
    const supabase = await client();
    const session = await this.currentSession();
    if (session === null) return [];

    // No owner filter and no visibility logic here on purpose: RLS decides what
    // comes back. Re-implementing the rule client-side would create a second
    // place for it to be wrong, and the client's copy is the one that cannot be
    // trusted anyway.
    const [{ data: rows, error }, { data: names }, { data: owned }] = await Promise.all([
      supabase.from("shared_records").select("*").eq("deleted", false),
      supabase.from("accounts").select("id, display_name"),
      supabase.from("group_owners").select("owner_account").eq("account_id", session.accountId),
    ]);
    if (error) throw new Error(error.message);

    const nameById = new Map((names ?? []).map((row) => [row.id as string, row.display_name as string]));
    const coOwnedOwners = new Set((owned ?? []).map((row) => row.owner_account as string));

    const byOwner = new Map<string, SyncRecord[]>();
    for (const row of (rows ?? []) as RecordRow[]) {
      if (row.owner_account === session.accountId) continue; // your own data is not a mirror
      const list = byOwner.get(row.owner_account) ?? [];
      list.push(toRecord(row));
      byOwner.set(row.owner_account, list);
    }

    return [...byOwner].map(([ownerAccountId, records]) => ({
      ownerAccountId,
      ownerName: nameById.get(ownerAccountId) ?? "Someone",
      role: coOwnedOwners.has(ownerAccountId) ? ("owner" as const) : ("reader" as const),
      records,
    }));
  },

  subscribe(onChange: () => void): () => void {
    if (!isSharingConfigured()) return () => undefined;
    // Phase 1 re-pulls rather than applying the payload of each change event:
    // Postgres change events do not carry the RLS re-evaluation a grant change
    // implies, so a revoke would otherwise leave stale rows on screen.
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void client().then((supabase) => {
      if (cancelled) return;
      const channel = supabase
        .channel("chronicle-sharing")
        .on("postgres_changes", { event: "*", schema: "public", table: "shared_records" }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "grants" }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "group_owners" }, onChange)
        .subscribe();
      dispose = () => void supabase.removeChannel(channel);
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  },

  async createInvite(draft: InviteDraft): Promise<string> {
    const session = await this.currentSession();
    if (session === null) throw new Error("Sign in first.");
    const { data, error } = await (await client())
      .from("invites")
      .insert({
        owner_account: session.accountId,
        subject_kind: draft.subjectKind,
        subject_id: draft.subjectId,
        role: draft.role,
      })
      .select("token")
      .single();
    if (error) throw new Error(error.message);
    return data.token as string;
  },

  async redeemInvite(token: string): Promise<void> {
    const { error } = await (await client()).rpc("redeem_invite", { p_token: token });
    if (error) throw new Error(error.message);
  },

  async listGrants(): Promise<Grant[]> {
    const session = await this.currentSession();
    if (session === null) return [];
    const { data, error } = await (await client())
      .from("grants")
      .select("id, subject_kind, subject_id, grantee, accounts:grantee (display_name)")
      .eq("owner_account", session.accountId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: row.id as string,
      subjectKind: row.subject_kind as Grant["subjectKind"],
      subjectId: row.subject_id as string,
      granteeAccountId: row.grantee as string,
      granteeName: (row.accounts as { display_name?: string } | null)?.display_name ?? "Someone",
    }));
  },

  async revokeGrant(grantId: string): Promise<void> {
    const { error } = await (await client()).from("grants").delete().eq("id", grantId);
    if (error) throw new Error(error.message);
  },
};

// Exported for the tests that assert the wire mapping without a live project.
export const __wire = { toRecord, toRow, keyOf };
