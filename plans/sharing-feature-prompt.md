# Prompt: build Chronicle's sharing feature

This is a ready-to-paste prompt for an Opus session tasked with designing and
building multi-user sharing in Chronicle. It exists because the feature is big
enough, and reverses enough current invariants, that it needs to be scoped
before anyone starts writing code — not discovered mid-implementation.

Everything below the `---` is the prompt itself. The section after that is for
whoever hands this off (you, or a future session picking it up).

---

## Context

Chronicle today is **100% local**: React + TypeScript + Vite, a custom Canvas
renderer, one IndexedDB database (`chronicle` / store `datasets` / key
`main`), no backend, no accounts, no network calls except loading the static
`public-data/*.json` datasets that ship with the app. The only way data leaves
a device is a user-initiated JSON export file, and the only way it arrives on
another device is a user-initiated import. `src/model/types.ts` even carries
a load-bearing comment that `Group.parentGroupId` is "the future attachment
point for importing/subscribing to someone else's shared timeline" — nesting
exists, but nothing subscribes yet.

Two things from the root `CLAUDE.md` are directly relevant and you should
re-read before starting:

- The v1 scope-cuts section says "No publish/subscribe sharing... No Gist
  sync — it's a marked, honest gap." This feature is what fills that gap. You
  are not fixing an oversight; you are doing the thing the project explicitly
  deferred, on purpose, until now.
- The Privacy invariant — "personal data exists only in IndexedDB and
  user-initiated exports... nothing personal may ever be written to the
  repo/filesystem" — is about the *repository*, not about a sync backend, so
  it doesn't forbid this feature. But sharing means personal data leaving the
  device for the first time ever, onto infrastructure this project has never
  needed before. Treat every design choice here (who can read what, at rest,
  in transit, on whose server) with the weight that deserves.

One more piece of ground truth, because the CLAUDE.md wording is stale here:
there is **no `visibility` field in the model right now**. `visibility` /
`defaultVisibility` existed in schema v1–v3 and were *removed* in schema v4
(see the comments in `src/storage/exportImport.ts`). Whatever "published /
private" state this feature needs is a brand-new field, on a brand-new schema
version, with a real migration — not a dormant field waking up.

## The vision, condensed

The product owner described six scenarios, roughly in order of ambition:

1. **Family invite.** You fill in your own life. You add your parents (as
   groups). You don't know their pre-you history, so you invite your dad and
   mom to each own their group of timelines and fill it in themselves. They
   can see most of your other timelines, except a few you'd rather they
   didn't.
2. **Second-degree invite.** Your dad invites your brother. When your brother
   joins, the app suggests to *you* that you might want to add him too.
3. **Side-by-side live editing.** You and your girlfriend, on two phones,
   next to each other, jointly fill in entries for a trip you took together —
   edits from both of you land in (near) real time.
4. **Stranger sharing via QR.** Later, the app is popular enough that people
   share a read-only "public profile" with a first date by scanning a QR
   code — no account required to view it, no cookie banner. If the viewer
   already has their own profile, sharing theirs back is one tap.
5. **The dinner-table proof.** A family argument about when a trip to Spain
   happened gets settled because someone pulls out Chronicle and looks it up
   — years of continuous use paying off as a shared, trustworthy record.
6. **2028: global matching.** Chronicle becomes the default way people find
   friends and partners worldwide, matching people by what they've actually
   done and cared about. World peace follows.

**Scenarios 5 and 6 are north-star motivation, not build targets.** Scenario 5
is really just a vibe check — "does this feel durable and trustworthy years
in" — and needs no dedicated feature. Scenario 6 (a global matching/discovery
algorithm, implicitly a public searchable directory of people) is a separate,
much later product with its own consent, safety, and abuse-prevention
problems; **do not design or scaffold it as part of this task.** If anything
in your design would make scenario 6 easier later without compromising
scenarios 1–4, fine, but it is not a requirement here, and "world peace" is
not an acceptance criterion.

Scenarios 1–4 are the actual spec. Distilled into concrete requirements:

- A group (a person, in Chronicle's model) can have more than one **owner**
  — e.g. dad and mom jointly own "their" group and its timelines.
- A user can grant another person **read access** to a group or timeline,
  at a granularity finer than "everything" — a few timelines can be held
  back from an otherwise-shared person.
- New timelines (and, implicitly, new groups) default to **private**. They
  must be explicitly **published** before anyone with read access can see
  them — *unless* the group's parent node has an override that flips the
  default to shared-by-default for everything created under it.
- Edits to an already-shared/published timeline propagate to everyone with
  read access **as they happen** (not on some manual sync/export cycle).
  This is symmetric: your parents' edits to timelines you can already see
  come back to you the same way, live — but a *new* timeline they create is
  still private-until-published, same rule as everyone else.
- Invites can chain, and chaining surfaces a **suggestion**, not an
  automatic grant: if your dad invites your brother, you get suggested "add
  your brother," you don't automatically get read access to him or he to
  you.
- Two people can **co-edit live** in the same session (same physical room,
  own devices) with edits from both visible to both without a manual
  refresh — this is a stronger real-time requirement than the family-sharing
  propagation above and may need different machinery (conflict resolution
  for concurrent edits to the same row/entry, not just "push new state to
  subscribers").
- A user can mark a **profile** (some subset of their data — likely "the
  set of currently-published groups/timelines," but confirm) as **public**,
  shareable via a scannable QR code, viewable by a stranger with **no
  account, no cookie banner, no sign-up**. If the viewer has their own
  Chronicle profile, offering to share it back is a single tap.

## What to actually design and build

This is a phased feature, not a single PR. Work through these in order, and
stop to get the phase-0 decisions confirmed before writing code for anything
downstream — they constrain everything else.

**Phase 0 — foundational decisions (design doc, get these confirmed first):**

- Chronicle has never had a backend. Real-time propagation to other people's
  devices requires one. Pick an approach (managed BaaS like Firebase/Supabase,
  a small custom sync service, or something else) and state the tradeoffs —
  this is the single biggest architectural reversal in the project's history
  and deserves explicit sign-off, not a quiet dependency addition.
- Decide the sync/CRDT strategy. "Push edits to subscribers as they happen"
  (phase 2/3 below) and "two phones co-editing in the same room" (phase 4)
  have different latency and conflict-resolution demands — figure out if one
  mechanism covers both or if live co-editing needs something stronger
  (e.g. a CRDT library) layered on top of simpler pub/sub for family sharing.
- Decide the auth/invite model. Family members who *edit* shared data need
  some identity (even if lightweight — a magic link, not necessarily a
  password). QR-code strangers who only *view* a public profile must need
  **none**. Don't let the editor auth requirement leak into the viewer path.
- Design the new schema: what field(s) express "private / published,"
  where they live (entry? row? group?), what the group-level override looks
  like, and how this becomes schema v7 with a real migration in
  `src/storage/exportImport.ts` (v4 already removed a `visibility` field
  once — make sure this migration doesn't collide with old exports that
  still carry the dead field name).
- Design revocation: what happens on every device that already synced a
  timeline/group when the owner un-shares or un-publishes it later.

**Phase 1 — invite + read-only sharing (the actual MVP):**
Owner/co-owner roles on a group, per-timeline read-access grants, the
publish/private default with group-level override, and one-way propagation
of edits to read-access holders. No live co-editing yet, no QR/public
profiles yet.

**Phase 2 — invite chaining and suggestions:**
Surfacing "your dad added your brother, want to add him too?" without
auto-granting access.

**Phase 3 — live co-editing:**
Two authenticated users, same session, concurrent edits to overlapping
timelines, resolved without clobbering each other.

**Phase 4 — public profile via QR:**
An explicit, separate "make this profile public" action; a no-signup,
no-cookie-banner viewer experience; one-tap reciprocal sharing when the
viewer already has a profile.

**Explicitly not in scope for this task:** any global discovery, search,
matching, or recommendation system (scenario 6). If it comes up, flag it and
move on.

## Deliverable

Given the size of this, don't jump straight to code. First produce a design
doc (schema changes, sync architecture choice, invite/permission model,
migration plan for schema v7) and get it reviewed, then implement phase 1
end-to-end (model → storage/sync → UI) with tests, following the existing
per-directory `CLAUDE.md` conventions (`src/model`, `src/state`,
`src/storage`, `src/ui`) before moving on to later phases.

---

## Notes for whoever hands this off

- This prompt intentionally pushes back on scope: the original ask spans six
  scenarios of wildly different sizes, from "invite your parents" to "achieve
  world peace." Scenarios 5–6 are kept in the prompt as motivation (they
  explain *why* this matters) but are explicitly carved out as non-goals so
  Opus doesn't try to design a matching algorithm on day one.
- Phase 0 is deliberately a stop-and-confirm gate: introducing a backend and
  changing the schema are both irreversible-ish decisions for a project that
  has been backend-free and privacy-first since inception. Don't let an
  agent pick a BaaS vendor and start syncing personal data without a human
  looking at that decision first.
- The stale CLAUDE.md line about `visibility` "existing on entries" is called
  out directly in the prompt so Opus doesn't go looking for a field that was
  actually removed in schema v4. Worth fixing that CLAUDE.md line separately,
  independent of this feature.
