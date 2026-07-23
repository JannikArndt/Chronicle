// Manual JSON export/import — the v1 sync path (ENGINEERING_PROMPT.md §3).
// Import validates schemaVersion and shape and REJECTS mismatches with a
// message instead of silently corrupting IndexedDB (§9).

import { SCHEMA_VERSION } from "../model/types";
import type { TimelineDataset } from "../model/types";

export function serializeDataset(dataset: TimelineDataset): string {
  return JSON.stringify(dataset, null, 2);
}

export type ImportResult = { ok: true; dataset: TimelineDataset } | { ok: false; error: string };

const ARRAY_FIELDS = ["people", "groups", "categories", "rows", "entities", "entries"] as const;

// Oldest export shape this importer still reads. v1's only difference from v2 is
// the (optional) selfPersonId field, so v1 files are already structurally valid.
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
  // No field migration needed beyond the version bump: every schema difference
  // between v1 and v2 (selfPersonId) is optional and simply stays undefined.
  if (schemaVersion < SCHEMA_VERSION) {
    candidate.schemaVersion = SCHEMA_VERSION;
  }
  return { ok: true, dataset: candidate as unknown as TimelineDataset };
}

export function parseImportFile(text: string): ImportResult {
  try {
    return validateImport(JSON.parse(text));
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
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
