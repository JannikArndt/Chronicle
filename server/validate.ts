// The shape every stored record must have, per kind, checked after each merge.
//
// This is not about trusting our own client less. A shared record is rendered
// on other people's screens: a `title` that arrived as an object, or a
// megabyte-long `label`, would break someone else's app — so a record either
// matches its kind's schema or it is not stored.

import type { Fields, RecordKind } from "../src/sync/protocol";

type Check = (value: unknown) => boolean;

interface FieldRule {
  check: Check;
  required?: boolean;
}

export const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
export const MAX_RECORD_BYTES = 64 * 1024;

const PRECISIONS = new Set(["exact", "day", "month", "year", "circa"]);

const text =
  (max: number): Check =>
  (value) =>
    typeof value === "string" && value.length <= max;
const finite: Check = (value) => typeof value === "number" && Number.isFinite(value);
const bool: Check = (value) => typeof value === "boolean";
const recordId: Check = (value) => typeof value === "string" && ID_PATTERN.test(value);

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

const fuzzyDate: Check = (value) =>
  plainObject(value) &&
  onlyKeys(value, ["ms", "precision", "fuzzDays"]) &&
  finite(value.ms) &&
  PRECISIONS.has(value.precision as string) &&
  (value.fuzzDays === undefined || finite(value.fuzzDays));

const place: Check = (value) =>
  plainObject(value) &&
  onlyKeys(value, ["fullName", "coordinates", "street", "city", "country"]) &&
  text(1000)(value.fullName) &&
  (value.coordinates === undefined ||
    (plainObject(value.coordinates) &&
      onlyKeys(value.coordinates, ["lat", "lon"]) &&
      finite(value.coordinates.lat) &&
      finite(value.coordinates.lon))) &&
  ["street", "city", "country"].every((key) => value[key] === undefined || text(500)(value[key]));

const LABEL = text(500);
const COLOR = text(100);
const ICON = text(64);
const WEBSITE = text(500);
const DESCRIPTION = text(20_000);

const SCHEMAS: Record<RecordKind, Record<string, FieldRule>> = {
  group: {
    parentGroupId: { check: recordId },
    label: { check: LABEL, required: true },
    color: { check: COLOR },
    icon: { check: ICON },
    website: { check: WEBSITE },
    birthDate: { check: finite },
    collapsed: { check: bool },
    order: { check: finite },
    shared: { check: bool },
    shareByDefault: { check: bool },
  },
  row: {
    groupId: { check: recordId },
    label: { check: LABEL, required: true },
    color: { check: COLOR },
    icon: { check: ICON },
    website: { check: WEBSITE },
    birthDate: { check: finite },
    order: { check: finite },
    shared: { check: bool },
  },
  entry: {
    rowId: { check: recordId, required: true },
    title: { check: LABEL, required: true },
    subtitle: { check: LABEL },
    shortTitle: { check: LABEL },
    website: { check: WEBSITE },
    place: { check: place },
    description: { check: DESCRIPTION },
    start: { check: fuzzyDate, required: true },
    end: { check: fuzzyDate },
    fadeInDays: { check: finite },
    fadeOutDays: { check: finite },
    parentEntryId: { check: recordId },
  },
  event: {
    rowId: { check: recordId, required: true },
    title: { check: LABEL, required: true },
    date: { check: fuzzyDate, required: true },
    icon: { check: ICON },
    description: { check: DESCRIPTION },
    place: { check: place },
  },
};

export function isKnownField(kind: RecordKind, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(SCHEMAS[kind], field);
}

export function isRecordKind(value: unknown): value is RecordKind {
  return value === "group" || value === "row" || value === "entry" || value === "event";
}

// Undefined when the record is fine; otherwise what is wrong with it, in words
// a developer reading a rejected push can act on.
export function validateFields(kind: RecordKind, fields: Fields): string | undefined {
  const schema = SCHEMAS[kind];
  for (const [field, value] of Object.entries(fields)) {
    const rule = schema[field];
    if (rule === undefined) return `unknown field “${field}” on a ${kind}`;
    if (!rule.check(value)) return `invalid value for “${field}” on a ${kind}`;
  }
  for (const [field, rule] of Object.entries(schema)) {
    if (rule.required === true && !(field in fields)) return `missing “${field}” on a ${kind}`;
  }
  if (Buffer.byteLength(JSON.stringify(fields)) > MAX_RECORD_BYTES) return `${kind} is too large`;
  return undefined;
}
