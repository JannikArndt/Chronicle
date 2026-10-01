// Manual JSON export/import. Import accepts exactly the current schema and
// REJECTS anything else — another version, a missing array, a malformed
// record — with a message instead of silently corrupting IndexedDB. There is
// no upgrade path from older versions; a schema bump that needs one adds it
// here, and `loadDataset` picks it up too.

import { SCHEMA_VERSION } from "../model/types";
import type { TimelineDataset } from "../model/types";

export function serializeDataset(dataset: TimelineDataset): string {
  return JSON.stringify(dataset, null, 2);
}

export type ImportResult = { ok: true; dataset: TimelineDataset } | { ok: false; error: string };

const ARRAY_FIELDS = ["groups", "rows", "entries", "events"] as const;

export function validateImport(raw: unknown): ImportResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Not a Chronicle export: expected a JSON object." };
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `Unsupported schemaVersion ${String(candidate.schemaVersion)} — this app reads version ${SCHEMA_VERSION} only. ` +
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
  for (const event of candidate.events as Array<Record<string, unknown>>) {
    if (typeof event.id !== "string" || typeof event.rowId !== "string" || typeof event.date !== "object") {
      return { ok: false, error: "Malformed event found (needs id, rowId, date). Import aborted." };
    }
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
