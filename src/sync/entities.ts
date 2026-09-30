// Model entities ↔ wire fields. A record's fields are the entity minus its id,
// with undefined values dropped — so "unset" has exactly one representation
// and a field that was cleared compares equal to one that was never set.

import { SCHEMA_VERSION } from "../model/types";
import type { Fields, RecordKind } from "./protocol";
import type { Group, TimelineDataset, TimelineEntry, TimelineEvent, TimelineRow } from "../model/types";

export type Entity = Group | TimelineRow | TimelineEntry | TimelineEvent;

export interface EntityRecord {
  id: string;
  kind: RecordKind;
  fields: Fields;
}

export function fieldsOf(entity: Entity): Fields {
  const fields: Fields = {};
  for (const [key, value] of Object.entries(entity)) {
    if (key === "id" || value === undefined) continue;
    fields[key] = value;
  }
  return fields;
}

// Every record of a dataset, keyed by id, in one pass.
export function recordsOfDataset(dataset: TimelineDataset): Map<string, EntityRecord> {
  const records = new Map<string, EntityRecord>();
  const add = (kind: RecordKind, entity: Entity) => records.set(entity.id, { id: entity.id, kind, fields: fieldsOf(entity) });
  dataset.groups.forEach((group) => add("group", group));
  dataset.rows.forEach((row) => add("row", row));
  dataset.entries.forEach((entry) => add("entry", entry));
  dataset.events.forEach((event) => add("event", event));
  return records;
}

export function entityOf(kind: RecordKind, id: string, fields: Fields): Entity {
  // A group always has `collapsed` in the model; on the wire it is optional.
  if (kind === "group") return { collapsed: false, ...fields, id } as Group;
  return { ...fields, id } as Entity;
}

export function datasetOf(records: Iterable<EntityRecord>, selfGroupId?: string): TimelineDataset {
  const dataset: TimelineDataset = { schemaVersion: SCHEMA_VERSION, groups: [], rows: [], entries: [], events: [] };
  for (const record of records) {
    const entity = entityOf(record.kind, record.id, record.fields);
    if (record.kind === "group") dataset.groups.push(entity as Group);
    else if (record.kind === "row") dataset.rows.push(entity as TimelineRow);
    else if (record.kind === "entry") dataset.entries.push(entity as TimelineEntry);
    else dataset.events.push(entity as TimelineEvent);
  }
  if (selfGroupId !== undefined) dataset.selfGroupId = selfGroupId;
  return dataset;
}

// Key order in a JS object follows insertion, and `Object.assign` patches in
// actions.ts append keys rather than rebuilding the object, so two equal
// values can serialise differently. Sorting keys keeps that from reading as
// an edit nobody made.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return stableStringify(a) === stableStringify(b);
}
