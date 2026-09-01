// Famous-people spike (see plans/famous-people-spike.md).
//
// A "famous person" is a public biography: a person with a known birth instant
// and a small set of dated life entries. Unlike the file-based world-events
// public data (public-data/*.json), these carry a `birthMs` so the app can
// answer "what did Mozart do at MY age?" by shifting the whole life so the
// person's birth lands on the user's birth (see alignToAge.ts).
//
// The `dataset` is authored in the same shape as a public-data file (no
// `people`, ids unique only within the person) and is namespaced + optionally
// shifted at add time — it never touches the validated public-data/ schema.

import type { TimelineDataset } from "../../model/types";

// The un-namespaced authoring shape: a normal dataset minus the owner concept.
// `events` is optional here and required on the dataset itself: a life scraped
// from Wikidata is spans, and a hand-written biography should not have to write
// `events: []` to say it has no moments in it.
export type FamousBiography = Omit<TimelineDataset, "people" | "schemaVersion" | "events"> & {
  events?: TimelineDataset["events"];
};

export interface FamousPerson {
  id: string; // unique within the catalog, e.g. "mozart"
  name: string;
  emoji: string;
  birthMs: number; // UTC instant of birth — the anchor for age alignment
  blurb: string; // one line for the picker
  biography: FamousBiography;
}
