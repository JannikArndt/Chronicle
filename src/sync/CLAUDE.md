# src/sync — the client side of the server

Signed out, nothing here runs and the app makes no network calls. Signed in,
this is how the dataset on screen stays in step with the server and with
everyone else editing it. Design: `plans/v2-server-design.md` §4.

- `protocol.ts` — the wire types, **shared with `server/`** (a renamed field is
  a type error on both sides).
- `hlc.ts` — hybrid logical clock; fixed-width, so string order is time order.
- `entities.ts` — entity ↔ wire fields, `stableStringify`.
- `replica.ts` — **pure core**: `base` + `pending`, `buildView`, `diffView`,
  `acknowledge`, remote application. Most tests live here.
- `api.ts` — one function per endpoint; `useTransport` for tests.
- `live.ts` — the SSE stream, read with fetch (works in Node tests too).
- `engine.ts` — the runtime: capture, push, pull, reconnect, persistence,
  presence, people. Owns module state; `__resetEngineForTests` resets it.

## The shape of it

`state.dataset` is the view: `buildView(base ⊕ pending)`. The actions in
`state/actions.ts` edit it as they always did; `persistSoon` calls
`datasetChanged()`, which diffs the dataset against the last view
(`diffView`) and turns each changed field into a pending change stamped with
the HLC. Pushes are acknowledged per record with the server's resolved state;
live `records`/`gone` events update `base`; every remote change first captures
local edits (nothing typed is lost to a rebuild) and then rebuilds the view.

## Invariants

- **Trees never mix, and whose a new record is follows its container.** An
  entry added to Dad's timeline is Dad's record (`ownerOfNew`). A move across
  owners, an edit to a read-only record, or a delete of one is *refused* —
  dropped from pending and undone on screen by a rebuild — never sent.
- **Someone else's record with an out-of-sight container is "root-projected"**:
  drawn at the top level, unordered; its container and `order` are not this
  view's to change, so diffs on them are ignored. `isAnchoredId` in the store
  exposes it so the UI does not offer moving or deleting it.
- **Collapsing someone else's group is a local preference**
  (`prefs.foreignCollapsed`), never pushed — it would fold it for its owner.
- **An acknowledgement only clears what it acknowledges.** A field edited again
  while its push was in flight keeps the newer pending value.
- **Sharing actions `settle()` first**: pending changes reach the server before
  an invite, grant or link names something created a moment ago.
- **Signing out forgets everything** — replica, `main`, other people's data. A
  shared device must not keep anyone's timelines once nobody is signed in.
- **First sign-in adopts the device's local timelines, rekeyed** (fresh ids:
  the server keeps an id with its first owner). Imports are rekeyed too.
- **Selectors return stable references.** `useAppState((s) => x ?? [])` builds
  a new array per call and loops React forever (#185) — select the object,
  derive after.

## Not built

- Character-level merging of one text field typed by two people at once:
  later keystroke wins that field; presence chips are the mitigation.
- Incremental catch-up after being offline: a reconnect is a full pull.
