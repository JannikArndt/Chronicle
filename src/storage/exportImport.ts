// Manual JSON export/import — the v1 sync path (ENGINEERING_PROMPT.md §3).
// Import validates schemaVersion and shape and REJECTS mismatches with a
// message instead of silently corrupting IndexedDB (§9).

import { normalizeChildOrder } from "../model/dataset";
import { SCHEMA_VERSION } from "../model/types";
import type { TimelineDataset } from "../model/types";

export function serializeDataset(dataset: TimelineDataset): string {
  return JSON.stringify(dataset, null, 2);
}

export type ImportResult = { ok: true; dataset: TimelineDataset } | { ok: false; error: string };

// `people` is not here: v6 removed it, so an export written today has no such
// array and requiring one would reject the app's own output. `events` is not
// here either, for the opposite reason: v8 *added* it, so every export written
// before then legitimately lacks one — see `addMissingEventsArray`.
const ARRAY_FIELDS = ["groups", "rows", "entries"] as const;

// Oldest export shape this importer still reads. v1/v2/v3/v4 files are
// structurally valid as-is: v2 only added the optional selfPersonId, v3
// dropped the (now-ignored) `entities`/`linkedEntityIds` fields, and v4
// dropped `visibility`/`defaultVisibility`. Five versions carry a real data
// step: v5 folded each category's color and icon onto the row, v6 folded the
// whole Person entity into Group, v7 added sharing, v8 added events and v10 made
// sibling order explicit (all below).
const MIN_SUPPORTED_SCHEMA_VERSION = 1;

export function validateImport(raw: unknown): ImportResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Not a Chronicle export: expected a JSON object." };
  }
  const candidate = raw as Record<string, unknown>;
  const schemaVersion = candidate.schemaVersion;
  if (typeof schemaVersion !== "number" || schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION || schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `Unsupported schemaVersion ${String(schemaVersion)} — this app reads versions ${MIN_SUPPORTED_SCHEMA_VERSION} through ${SCHEMA_VERSION}. ` +
        `Import aborted to avoid corrupting your data.`,
    };
  }
  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(candidate[field])) {
      return { ok: false, error: `Not a Chronicle export: missing “${field}” array.` };
    }
  }
  for (const entry of candidate.entries as Array<Record<string, unknown>>) {
    if (typeof entry.id !== "string" || typeof entry.rowId !== "string" || typeof entry.start !== "object") {
      return { ok: false, error: "Malformed entry found (needs id, rowId, start). Import aborted." };
    }
  }
  // Absent is fine (anything written before v8); present but not an array, or
  // holding something that isn't an event, is a corrupt file and says so.
  if (candidate.events !== undefined) {
    if (!Array.isArray(candidate.events)) {
      return { ok: false, error: "Not a Chronicle export: “events” is not an array." };
    }
    for (const event of candidate.events as Array<Record<string, unknown>>) {
      if (typeof event.id !== "string" || typeof event.rowId !== "string" || typeof event.date !== "object") {
        return { ok: false, error: "Malformed event found (needs id, rowId, date). Import aborted." };
      }
    }
  }
  // Outside the version check on purpose: the array is what every consumer
  // reads unguarded, and a v8 file that simply has no `events` key — a
  // hand-written one, or one from a build between the schema bump and the first
  // event — would otherwise arrive with `events: undefined`.
  addMissingEventsArray(candidate);
  // v1→v4 need no data migration: their diffs are either an optional new field
  // (selfPersonId) or removed fields the app no longer reads
  // (`entities`/`linkedEntityIds`), so leftover copies are simply ignored. v5,
  // v6 and v7 are the exceptions: the first two removed an entity that carried
  // data the rest of the model still needs, and v7 has a field name to defuse.
  if (schemaVersion < SCHEMA_VERSION) {
    if (Array.isArray(candidate.categories)) foldCategoryColorsIntoRows(candidate);
    if (Array.isArray(candidate.people)) foldPeopleIntoGroups(candidate);
    dropDeadVisibilityFields(candidate);
    flattenSubRows(candidate);
    assignSiblingOrder(candidate);
    candidate.schemaVersion = SCHEMA_VERSION;
  }
  return { ok: true, dataset: candidate as unknown as TimelineDataset };
}

// v7 migration: sharing arrives, and with it the one real hazard in this file.
//
// v1–v3 had `visibility` on records and `defaultVisibility` on the dataset; v4
// removed both and this importer has been ignoring the leftovers ever since. v7
// adds a publish flag that does the same *kind* of job, so two rules keep the
// dead field from animating:
//
//  1. the new fields are `shared`/`shareByDefault`, never `visibility` — a name
//     collision is impossible, not merely avoided by convention; and
//  2. the dead keys are deleted here, so no later code can pick them up either.
//
// What this deliberately does NOT do is translate `visibility: "public"` into
// `shared: true`. In a backend-less app that flag never meant anything had left
// the device — there was nowhere for it to go. Honouring it now would upload
// someone's timeline to a server on the strength of a three-versions-dead
// field. Everything migrates to private; publishing is always a deliberate act.
function dropDeadVisibilityFields(candidate: Record<string, unknown>): void {
  delete candidate.defaultVisibility;
  for (const field of ARRAY_FIELDS) {
    for (const record of candidate[field] as Array<Record<string, unknown>>) {
      delete record.visibility;
    }
  }
}

// v10 migration: sibling order becomes explicit. Before v10 a container drew
// every one of its timelines and then every one of its sub-groups, each in
// array order; `normalizeChildOrder` sorts un-ordered records exactly that way
// before numbering them, so an older file keeps the arrangement it had — the
// difference is only that the arrangement is now writable, and a group can be
// dragged above a timeline.
function assignSiblingOrder(candidate: Record<string, unknown>): void {
  normalizeChildOrder(candidate as unknown as TimelineDataset);
}

// v9 migration: a timeline can no longer nest inside another timeline —
// groups nest arbitrarily deep instead, and a "sub-timeline" is now expressed
// as a sub-group holding one row. Flattening is the safe default: a row that
// had `parentRowId` simply becomes a normal sibling in the same `groupId`, so
// every entry and event (which reference the row directly, never the nesting)
// survives untouched. Only the visual "nested under its parent" grouping is
// lost, and the row is one drag away from being re-filed into a sub-group if
// that grouping is still wanted.
function flattenSubRows(candidate: Record<string, unknown>): void {
  for (const row of candidate.rows as Array<Record<string, unknown>>) {
    delete row.parentRowId;
  }
}

// v8 migration: events arrive. There is nothing to convert — no earlier version
// had a concept to translate from — so this only guarantees the array exists,
// which is what lets every consumer read `dataset.events` without a `?? []`.
// Runs on every import, not only on an older one (see the call site).
function addMissingEventsArray(candidate: Record<string, unknown>): void {
  if (!Array.isArray(candidate.events)) candidate.events = [];
}

// v5 migration: rows used to get their color and icon from a shared Category
// (via `categoryId`); now both live on the row. Copy each row's category color
// and icon onto the row and strip the now-removed `categoryId`/`categories`.
function foldCategoryColorsIntoRows(candidate: Record<string, unknown>): void {
  const categories = candidate.categories as Array<Record<string, unknown>>;
  const categoryById = new Map(categories.map((category) => [category.id as string, category]));
  for (const row of candidate.rows as Array<Record<string, unknown>>) {
    const category = categoryById.get(row.categoryId as string);
    if (category) {
      if (row.color === undefined) row.color = category.color;
      if (row.icon === undefined) row.icon = category.icon;
    }
    delete row.categoryId;
  }
  delete candidate.categories;
}

// v6 migration: Person is gone — a person was only ever a group with a birth
// date. A group that WAS a person keeps its id and gains the date; a person
// nested inside a container group becomes a sub-group of it, and the rows that
// named that person are re-filed into it.
//
// A person nobody references is dropped: it had no timelines, so nothing about
// the picture changes.
function foldPeopleIntoGroups(candidate: Record<string, unknown>): void {
  const people = candidate.people as Array<Record<string, unknown>>;
  const personById = new Map(people.map((person) => [person.id as string, person]));
  const groups = candidate.groups as Array<Record<string, unknown>>;
  const rows = candidate.rows as Array<Record<string, unknown>>;

  // Which group each person turned into, so selfPersonId can be translated.
  const groupIdForPerson = new Map<string, string>();

  for (const group of groups) {
    const person = personById.get(group.personId as string);
    if (person) {
      if (person.birthDate !== undefined) group.birthDate = person.birthDate;
      groupIdForPerson.set(person.id as string, group.id as string);
    }
    delete group.personId;
  }

  // Sub-groups are inserted directly after their parent so the exported JSON
  // still reads top-down in the order the app draws it.
  const nested: Array<Record<string, unknown>> = [];
  const subGroupIdByRowKey = new Map<string, string>();
  for (const group of groups) {
    nested.push(group);
    const personIdsHere = [
      ...new Set(
        rows
          .filter((row) => row.groupId === group.id && typeof row.personId === "string")
          .map((row) => row.personId as string),
      ),
    ];
    for (const personId of personIdsHere) {
      const person = personById.get(personId);
      if (!person) continue;
      // The old model let one person appear in several container groups, which
      // now means several sub-groups — only the first may reuse the person's id.
      const subGroupId = groupIdForPerson.has(personId) ? `${personId}-in-${String(group.id)}` : personId;
      if (!groupIdForPerson.has(personId)) groupIdForPerson.set(personId, subGroupId);
      subGroupIdByRowKey.set(`${String(group.id)}::${personId}`, subGroupId);
      nested.push({
        id: subGroupId,
        parentGroupId: group.id,
        label: person.label,
        ...(person.birthDate !== undefined ? { birthDate: person.birthDate } : {}),
        collapsed: false,
      });
    }
  }
  candidate.groups = nested;

  for (const row of rows) {
    const subGroupId = subGroupIdByRowKey.get(`${String(row.groupId)}::${String(row.personId)}`);
    if (subGroupId !== undefined) row.groupId = subGroupId;
    delete row.personId;
  }

  const selfGroupId = groupIdForPerson.get(candidate.selfPersonId as string);
  if (selfGroupId !== undefined) candidate.selfGroupId = selfGroupId;
  delete candidate.selfPersonId;
  delete candidate.people;
}

export function parseImportFile(text: string): ImportResult {
  try {
    return validateImport(JSON.parse(text));
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
}

// Opens a hidden file-picker, reads the chosen file as text, parses it as a
// Chronicle export, and hands the result to the caller. Shared by every
// "Import JSON…" entry point so the file-input plumbing exists once.
export function triggerImportFlow(onResult: (result: ImportResult) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.style.display = "none";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) {
      void file.text().then((text) => onResult(parseImportFile(text)));
    }
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

// Blob + anchor download works on iOS Safari (shows the share/save sheet).
export function triggerDownload(dataset: TimelineDataset): void {
  const blob = new Blob([serializeDataset(dataset)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `chronicle-export-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
