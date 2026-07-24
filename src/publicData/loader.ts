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
  return loadPublicCatalog().map((item) => item.dataset);
}

// A "world events" entry for the rail picker: a stable key (the file stem), a
// human label (the first group's label), and the namespaced dataset. Nothing
// is shown until the user toggles it on, so the growing public data no longer
// floods the view by default.
export interface PublicCatalogItem {
  key: string;
  label: string;
  dataset: TimelineDataset;
}

export function loadPublicCatalog(): PublicCatalogItem[] {
  const items: PublicCatalogItem[] = [];
  for (const [path, module] of Object.entries(publicFiles)) {
    const fileName = path.split("/").pop()!;
    if (fileName === "schema.json") continue;
    const fileStem = fileName.replace(/\.json$/, "");
    const dataset = namespaceDataset(withPublicDefaults(module.default), fileStem);
    items.push({ key: fileStem, label: dataset.groups[0]?.label ?? fileStem, dataset });
  }
  return items.sort((a, b) => a.label.localeCompare(b.label));
}

// Public files omit `people`; fill the gap so the rest of the app sees a
// complete TimelineDataset.
function withPublicDefaults(raw: TimelineDataset): TimelineDataset {
  return {
    ...raw,
    people: raw.people ?? [],
  };
}
