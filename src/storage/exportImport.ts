// Manual JSON export/import — the v1 sync path (ENGINEERING_PROMPT.md §3).
// Import validates schemaVersion and shape and REJECTS mismatches with a
// message instead of silently corrupting IndexedDB (§9).

import { SCHEMA_VERSION } from "../model/types";
import type { TimelineDataset } from "../model/types";

export function serializeDataset(dataset: TimelineDataset): string {
  return JSON.stringify(dataset, null, 2);
}

export type ImportResult = { ok: true; dataset: TimelineDataset } | { ok: false; error: string };

const ARRAY_FIELDS = ["people", "groups", "rows", "entries"] as const;

// Oldest export shape this importer still reads. v1/v2/v3/v4 files are
// structurally valid as-is: v2 only added the optional selfPersonId, v3
// dropped the (now-ignored) `entities`/`linkedEntityIds` fields, and v4
// dropped `visibility`/`defaultVisibility`. v5 removed the Category concept
// and moved each row's color and icon onto the row itself — the only migration
// with an actual data step (folding category.color/icon onto the row, below).
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
  // v1→v4 need no data migration: their diffs are either an optional new field
  // (selfPersonId) or removed fields the app no longer reads
  // (`entities`/`linkedEntityIds`, `visibility`/`defaultVisibility`), so
  // leftover copies are simply ignored. v5 is the exception — it folds each
  // row's category color onto the row so the removed `categories` array doesn't
  // take the row's color with it.
  if (schemaVersion < SCHEMA_VERSION) {
    if (Array.isArray(candidate.categories)) foldCategoryColorsIntoRows(candidate);
    candidate.schemaVersion = SCHEMA_VERSION;
  }
  return { ok: true, dataset: candidate as unknown as TimelineDataset };
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
