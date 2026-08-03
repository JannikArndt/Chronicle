// The seam between Chronicle and its backend — plans/sharing-feature-design.md §D1.
//
// Everything above this interface is pure, testable, and knows nothing about
// Supabase. That is not architecture for its own sake: it is what lets the whole
// invite → publish → propagate → revoke cycle be tested in-process against
// `fakeBackend.ts`, and what keeps the choice of backend reversible.

import type { SyncRecord } from "./records";

export interface SharingSession {
  accountId: string; // opaque uuid — never an email, see §D6
  email: string;
}

export type ShareSubjectKind = "group" | "row";

export interface Grant {
  id: string;
  subjectKind: ShareSubjectKind;
  subjectId: string;
  granteeAccountId: string;
  // A display name, never an email: this is rendered in a list of "who can see
  // this", and an email address there is a leak waiting to be screenshotted.
  granteeName: string;
}

export interface InviteDraft {
  subjectKind: ShareSubjectKind;
  subjectId: string;
  role: "reader" | "owner";
}

// One other person's shared data, as it arrived. Kept per-owner rather than
// pooled so revoking one person is a delete of one object.
export interface MirrorSnapshot {
  ownerAccountId: string;
  ownerName: string;
  // "owner" means co-ownership: this group is mine to edit as well, so the UI
  // offers editing and writes route back through the sync layer instead of into
  // `state.dataset`.
  role: "owner" | "reader";
  records: SyncRecord[];
}

export interface SharingBackend {
  currentSession(): Promise<SharingSession | null>;
  // Magic link rather than a password: family members are not going to create
  // an account with a password manager to fill in their own childhood.
  requestMagicLink(email: string, redirectTo: string): Promise<void>;
  signOut(): Promise<void>;

  push(records: SyncRecord[]): Promise<void>;
  // Everything this account can see that it did not write itself.
  pullVisible(): Promise<MirrorSnapshot[]>;
  // Phase 1 re-pulls the visible set on any change rather than applying deltas.
  // A few hundred rows over a warm connection is cheap, and it cannot drift out
  // of sync the way incremental application can. Deltas are a phase-3 concern,
  // when co-editing latency starts to matter.
  subscribe(onChange: () => void): () => void;

  createInvite(draft: InviteDraft): Promise<string>; // returns the token
  redeemInvite(token: string): Promise<void>;
  listGrants(): Promise<Grant[]>;
  revokeGrant(grantId: string): Promise<void>;
}
