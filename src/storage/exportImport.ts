// Manual JSON export/import — the v1 sync path (ENGINEERING_PROMPT.md §3).
// Import validates schemaVersion and shape and REJECTS mismatches with a
// message instead of silently corrupting IndexedDB (§9).

import { SCHEMA_VERSION } from "../model/types";
import type { TimelineDataset } from "../model/types";

export function serializeDataset(dataset: TimelineDataset): string {
  return JSON.stringify(dataset, null, 2);
}

export type ImportResult = { ok: true; dataset: TimelineDataset } | { ok: false; error: string };

const ARRAY_FIELDS = ["people", "groups", "categories", "rows", "entries"] as const;

// Oldest export shape this importer still reads. v1/v2 files are structurally
// valid as-is: v2 only added the optional selfPersonId, and v3 only dropped the
// (now-ignored) `entities`/`linkedEntityIds` fields — no migration needed, those
// fields just go unread on an older file.
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
  // No field migration needed beyond the version bump: v1→v2's diff (selfPersonId)
  // is optional and stays undefined; v3 only removes fields the app no longer
  // reads, so any leftover `entities`/`linkedEntityIds` in an older file are
  // simply ignored rather than migrated.
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
