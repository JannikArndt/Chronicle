---
name: onboarding-questionnaire
description: Design and build (or extend) Chronicle's conversational first-run onboarding — a short questionnaire whose answers decide what gets created, ending with the person looking at their own first real timeline. Use when asked to redesign, extend or add steps to onboarding, the setup assistant, or the first-run experience.
user-invocable: true
---

<!--
Adapted for Chronicle from adamlyttleapps/claude-skill-app-onboarding-questionnaire
(commit 5bc4786, MIT License, Copyright (c) 2026 Adam Lyttle). The original is a
generic conversion funnel for paid mobile apps; this version keeps its phase
structure and its "the user must DO something" core, and drops everything that
does not fit a free, local-first, privacy-first app (see "What this skill
deliberately does not do").
-->

You are designing and implementing Chronicle's first-run onboarding. Chronicle is a
personal life-timeline web app (React + TypeScript + Vite, canvas renderer,
IndexedDB, optional sync server). It is free, has no paywall, and signed out it
makes no network calls. The goal of onboarding is not conversion: it is that a
person who has never seen the app ends the flow looking at **their own life, drawn**,
built from answers they gave in a couple of minutes.

Work in phases. Persist progress in `plans/onboarding-questionnaire.md` (a design
doc — product decisions only, never anyone's personal data). Claude memory does not
survive these cloud sessions; the repo file does.

---

## RECALL (always first)

1. Read `plans/onboarding-questionnaire.md` if it exists and summarise its state:

   ```
   ✅ Discovery: done
   ✅ Story: "scattered memories" → "my life on one page"
   ⏳ Blueprint: 6 steps drafted, not confirmed
   ◻️ Copy: not started
   ◻️ Implementation: not started
   ```

2. Read `src/onboarding/CLAUDE.md` and the root `CLAUDE.md` every time — they are
   the constraints this skill builds inside, and they change.
3. If no plan file exists, start at Phase 1.

---

## PHASE 1: DISCOVERY

Read, don't assume. At minimum:

- `CLAUDE.md`, `src/onboarding/CLAUDE.md`, `src/ui/CLAUDE.md`, `docs/GLOSSARY.md`,
  `site/index.html` (the product page's own copy).
- The existing flow: `shouldShowOnboarding.ts` (auto-show predicate),
  `OnboardingAssistant.tsx` (name → born → lived → learned → worked → partner →
  kids → grandkids, each screen a draft reconciled on Next — `firstRunRecords.ts`),
  `AddEntryAssistant.tsx`, `AddTimelineAssistant.tsx`, `AssistantStepShell.tsx`,
  `useAssistantFlow.ts` / `assistantFlowReducer.ts`, `addEntryCategories.ts`,
  `timelineSuggestions.ts`.
- What can be created on the first run: `Group` (a person when it has a
  `birthDate`), `TimelineRow`, `TimelineEntry` (span), `TimelineEvent` (point),
  and what `public-data/` already offers.

Produce, in the plan file:

- **What Chronicle does** in one sentence.
- **The first-session "aha"**: today, the moment the canvas shows the places-lived
  row against the person's own age.
- **Gaps in the current flow**: what a new person still has to figure out alone
  after the assistant closes (e.g. the second timeline, events vs entries,
  sharing).
- **Network touch points during onboarding** (e.g. Nominatim place search) — each
  one must be stated and justified, because signed out the app otherwise makes
  none.

Then ask the user only what the code cannot answer — for example:

- Who is the first-run person: someone documenting themselves, a parent
  documenting a family, a genealogist?
- Should onboarding mention signing in / sync at all, and where?
- Which part of the current flow do they consider weakest?

---

## PHASE 2: THE STORY

Every step should move the person from BEFORE to AFTER. Draft with the user:

- **BEFORE**: where this information lives today (photos, CVs, memory, a
  spreadsheet), and what's frustrating about that.
- **AFTER**: what they can now see or answer ("what was I doing the year my
  daughter was born?").
- **3–5 benefit statements** that are *true of the app as built*. No invented
  numbers. "See every place you've lived on one line" — not "Users remember 37%
  more".

Save the confirmed story to the plan file.

---

## PHASE 3: BLUEPRINT

Design the step sequence. Each step must pass one test: **does its answer change
what gets created or shown?** If not, cut it. Typical archetypes, adapted:

| # | Step | Purpose | Status |
|---|------|---------|--------|
| 1 | Welcome | One line on what they'll have at the end; a real render, not a mockup | Recommended |
| 2 | Who is this for? | Self / family / someone else — decides whether to create a self group, a family group, or a person row | Recommended |
| 3 | Identity | Name + birth date (exists: `OnboardingAssistant`) | Required |
| 4 | Goal / interests | "What do you want to see on it?" — multi-select of timeline kinds (places, work, education, relationships, pets, cars…). Each pick becomes a suggested `TimelineRow`, nothing more | Recommended |
| 5 | First real content | The demo *is* the app: fill one timeline with real entries via an editor that is the app's own data (patterns: `SequenceEditor`, `EntryTable`) | Required |
| 6 | Reveal | Close the assistant onto the canvas, scrolled/zoomed to their life, with their first rows drawn | Required |
| 7 | What's next (optional) | One quiet pointer: the "+" menu, or sync/sign-in if the user wants it mentioned | Optional |

Rules for the blueprint:

- **Respect the existing assistant contract**: assistants create nothing until the
  last step, except live-editable tables and screens that reconcile a draft in
  place (the first-run assistant); Back never crosses a commit boundary unless
  the commit reconciles in place; resume never re-creates identity or anything
  else (`firstRunRecords.ts` finds everything again from the dataset).
- **Skippable everywhere.** Every step keeps "Skip for now"; skipping never loses
  what was already entered and never nags later.
- **Short.** Aim for under two minutes to the reveal. Count the steps against that.
- Present the blueprint as a numbered list: step, prompt text, input control,
  what it creates, which archetypes were dropped and why. Get confirmation; save it.

---

## PHASE 4: COPY

For each confirmed step draft: prompt, optional hint, options (emoji where the
existing flow uses them), and the action label.

- Same voice as the existing assistants: second person, short, plain.
- "Would I say this to a friend?" — no marketing speak.
- Action labels say what happens: "Draw my timeline", not "Continue".
- Every claim must be true of the shipped app. No testimonials, no statistics, no
  "thousands of people like you".
- The assistant must still say plainly, wherever sync comes up, that the server can
  read what it stores (root `CLAUDE.md`, Privacy).

Save confirmed copy to the plan file.

---

## PHASE 5: IMPLEMENTATION

Build inside the existing structure, not beside it.

1. **Components**: one hand-written assistant per flow using `useAssistantFlow` and
   `AssistantStepShell`. Do not introduce a generic step-runner abstraction
   (`src/onboarding/CLAUDE.md` rules it out).
2. **Controls**: `PillSelector` for any choice with fewer than ~7 options — no
   dropdowns. Autosave per field; no Save/Cancel buttons; no modal create screen.
3. **Writes**: all mutations go through `src/state/` actions. Live tables keep rows
   in a ref and never write inside a `setState` updater (see `AddTimelineAssistant`).
4. **Model rules**: UTC only (`Date.UTC`, `getUTC*`); a span is an entry, a point is
   an event — never a zero-length entry; `birthDateForRow()` decides whose life a
   row belongs to; new rows/groups get an `order` and go through
   `normalizeChildOrder()`.
5. **Styling**: colours only via existing `--color-*` custom properties in
   `styles.css`, with the dark-mode block kept in step. No hex literals.
6. **Answers**: questionnaire answers that only steer creation are not stored.
   If one must persist (e.g. "don't suggest pets again"), it is a local view
   preference (IndexedDB, like `overlays`) — never in the dataset, never sent to
   the server, never in an export. No analytics.
7. **First-run detection**: keep `shouldShowOnboarding` as the single predicate;
   update it and its test if the blueprint changes what "fresh" means. The rail
   "✨ Replay setup assistant" entry must keep working and must resume, not
   duplicate.
8. **Mobile**: the mobile shell has its own add flow (`AddEntryAssistant`); check
   `src/ui/CLAUDE.md` and make the new steps work at phone width.
9. **Tests**: pure logic (option → rows mapping, flow reducer transitions,
   predicate changes) gets co-located `*.test.ts`; components are not unit-tested.
   Run `npm test` and `npm run build` (tsc typechecks tests too).
10. **Verify in the app**: `npm run build`, start `node dist-server/main.mjs` with
    `TRUST_PROXY=false`, drive a fresh profile with playwright-core (Chromium at
    `/opt/pw-browsers/chromium`), and assert what was created via
    `window.__chronicleStore` — canvas text is not in the DOM.
11. **Docs**: update `src/onboarding/CLAUDE.md` with any new assistant or
    invariant, and the plan file with what was built and where.

---

## What this skill deliberately does not do

These are parts of the original skill that conflict with Chronicle and must not be
reintroduced:

- **Paywall, trial, pricing, "restore purchases"** — Chronicle has none.
- **Account gate** ("sign up to unlock what you made") — signing in is optional and
  local use must remain complete without it.
- **Testimonials or statistics that are not real** — the original suggests writing
  "aspirational" reviews and projecting numbers; every claim here must be true.
- **Fake "processing" delays** and **sunk-cost framing** — the reveal is the
  person's real canvas, immediately.
- **Viral share of the result** — the output is someone's personal life history.
  Sharing exists (publish per timeline, invites) and stays a deliberate later
  action, never an onboarding prompt.
- **Pain amplification (swipe cards of frustrations)** — it collects nothing that
  changes what is created.
- **Permission priming** — a web app with no OS permissions in this flow; if one
  is ever added (e.g. notifications), ask in context when it is first needed.
- **Sending answers to analytics** — signed out, no network calls.
