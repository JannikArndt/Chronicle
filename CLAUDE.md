# Chronicle — project guide for Claude sessions

Chronicle is a personal life-timeline web app: parallel horizontal timelines on one
shared time axis. React + TypeScript + Vite, custom Canvas renderer, IndexedDB storage,
no backend, deployed to GitHub Pages at https://jannikarndt.github.io/Chronicle/.

## Commands

```
npm run dev       # dev server
npm test          # vitest (100+ unit tests)
npm run build     # tsc -b && vite build  (tsc also typechecks test files)
```

Deploy: push to `main` → `.github/workflows/deploy.yml` builds and publishes Pages.
The local folder is `Timeline/` but the GitHub repo is `Chronicle` → Vite `base` is
`/Chronicle/`. Don't "fix" that mismatch.

## Architecture map

Each directory below has its own `CLAUDE.md` with the detail — this file only holds
what's true across the whole codebase.

- `src/model/` — pure data logic, no DOM. Three entities: `Group`, `TimelineRow`,
  `TimelineEntry` (glossary in `docs/GLOSSARY.md`).
- `src/render/` — the framework-agnostic canvas engine.
- `src/state/` — the observable store and all mutations.
- `src/publicData/` — read-only shared datasets loaded from `public-data/*.json`.
- `src/storage/` — IndexedDB and export/import, including schema upgrades.
- `src/ui/` — the React shell: desktop rail/panels and the mobile shell.
- `src/onboarding/` — conversational onboarding and the entry/timeline add-flows.

## Cross-cutting invariants (violating these reintroduces known bugs)

- **UTC everywhere**: every stored `ms` is a UTC instant; parsing, formatting, and
  ticks all use `Date.UTC`/`getUTC*`. Never introduce local-time methods.
- **CSS colors are custom properties, not literals**: `styles.css` defines
  `--color-*` on `:root` plus a `@media (prefers-color-scheme: dark)` override
  block; the canvas engine mirrors the same variables via `getComputedStyle`. A new
  rule with a hardcoded hex color renders correctly in light mode and wrong (or
  invisible) in dark mode — always reuse or extend the variable set instead.
- **Privacy**: personal data exists only in IndexedDB and user-initiated exports.
  Nothing personal may ever be written to the repo/filesystem; only `public-data/`
  is repo-tracked data.
- **No dropdowns under ~7 options** — use `PillSelector`. No Save/Cancel buttons —
  autosave per field change. No browse/edit mode toggle, no modal create screen.

## Testing conventions

- Vitest, `environment: node`, tests co-located as `src/**/*.test.ts`. Canvas
  painting itself is not unit-tested — its math is (`bars.ts`, `layout.ts`,
  `timeAxis.ts`, `miniMap.ts`). Same split on the mobile side: pure logic tested,
  React components not.
- `src/publicData/schemaValidation.test.ts` Ajv-validates every `public-data/*.json`
  against `public-data/schema.json`; CI runs this, so a bad contributed file fails
  PRs.
- E2E: drive the dev server with playwright-core against system Chrome
  (`channel: "chrome"`). `window.__chronicleEngine` (read `plusHits`/`entryHits` for
  canvas hit coordinates) and `window.__chronicleStore` are exposed exactly for
  this. A reference script lives outside the repo; entry titles are canvas text,
  so assert persistence via the store, not `getByText`.

## v1 scope cuts (deliberate — do not "fix" unasked)

- No publish/subscribe sharing; there is no `visibility` field on the model
  today — it existed in schema v1–v3 and was removed in v4 (see
  `src/storage/exportImport.ts`), so reintroducing it needs a real schema
  bump and migration, not a dormant field waking up. No Gist sync — it's a
  marked, honest gap (PAT flow unsolved
  for non-technical users). No keyboard-only/screen-reader path. Only one level
  of group nesting is *drawn* — the model no longer forbids more, but
  `computeLayout` draws a group, then its sub-groups, and stops.
- Hover-revealed rail controls on fine pointers vs always-visible on touch is an
  intentional split, not an inconsistency.

Known gaps and pre-release TODOs for specific features live in that feature's
directory `CLAUDE.md` (e.g. the famous-people feature's punch list is in
`src/publicData/CLAUDE.md`, mobile gaps in `src/ui/CLAUDE.md`).
