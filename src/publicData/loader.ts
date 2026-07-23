// Loads every public dataset checked into public-data/ (ENGINEERING_PROMPT.md §3–§4).
// Files are bundled at build time via import.meta.glob and are strictly
// read-only: they merge into the view but are never written back.

import { namespaceDataset } from "./namespace";
import type { TimelineDataset } from "../model/types";

const publicFiles = import.meta.glob("../../public-data/*.json", { eager: true }) as Record<
  string,
  { default: TimelineDataset }
>;

export function loadPublicDatasets(): TimelineDataset[] {
  const datasets: TimelineDataset[] = [];
  for (const [path, module] of Object.entries(publicFiles)) {
    const fileName = path.split("/").pop()!;
    if (fileName === "schema.json") continue;
    const fileStem = fileName.replace(/\.json$/, "");
    datasets.push(namespaceDataset(withPublicDefaults(module.default), fileStem));
  }
  return datasets;
}

// Public files omit `visibility` (always shareable) and `people`; fill the
// gaps so the rest of the app sees a complete TimelineDataset.
function withPublicDefaults(raw: TimelineDataset): TimelineDataset {
  return {
    ...raw,
    people: raw.people ?? [],
    entries: raw.entries.map((entry) => ({
      ...entry,
      visibility: "shareable",
    })),
  };
}
