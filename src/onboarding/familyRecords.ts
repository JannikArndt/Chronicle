// Kids and grandkids for the first-run assistant: a person is a group with a
// birth date, so each child is a sub-group of a top-level "Family" group and
// each grandchild a sub-group of its parent's. Like the sequence screens, the
// two screens edit a draft that is loaded from the dataset and reconciled back
// on Next, so Back and replay update the same groups instead of adding more.
//
// The draft holds birth *years*; a stored birth date whose year did not change
// is kept as it is (a day set later in the group's settings survives).

import { orderedChildren } from "../model/dataset";
import type { Group, TimelineDataset } from "../model/types";

export const FAMILY_LABEL = "Family";

export interface KidDraft {
  key: string;
  name: string;
  year: number;
  groupId?: string; // the group it was loaded from
}

export interface GrandkidDraft {
  key: string;
  parentKey: string; // a KidDraft's key
  name: string;
  year: number;
  groupId?: string;
}

export interface FamilyDraft {
  kids: KidDraft[];
  grandkids: GrandkidDraft[];
}

const yearOf = (ms: number) => new Date(ms).getUTCFullYear();
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

let keyCounter = 0;
export function newFamilyKey(): string {
  keyCounter += 1;
  return `person-${keyCounter}`;
}

export function kidLabel(kid: KidDraft, index: number): string {
  return kid.name.trim() || `Child ${index + 1}`;
}

export function grandkidLabel(grandkid: GrandkidDraft): string {
  return grandkid.name.trim() || "Grandchild";
}

export function findFamilyGroup(dataset: TimelineDataset): Group | undefined {
  return dataset.groups.find((group) => group.parentGroupId === undefined && group.label === FAMILY_LABEL);
}

// Sub-groups that are people, in the order the rail shows them.
function peopleIn(dataset: TimelineDataset, parentGroupId: string): Group[] {
  return orderedChildren(dataset, parentGroupId)
    .filter((child) => child.kind === "group")
    .map((child) => dataset.groups.find((group) => group.id === child.id))
    .filter((group): group is Group => group !== undefined && group.birthDate !== undefined);
}

export function loadFamily(dataset: TimelineDataset): FamilyDraft {
  const family = findFamilyGroup(dataset);
  if (!family) return { kids: [], grandkids: [] };
  const kids: KidDraft[] = [];
  const grandkids: GrandkidDraft[] = [];
  peopleIn(dataset, family.id).forEach((group) => {
    const kid: KidDraft = { key: newFamilyKey(), name: group.label, year: yearOf(group.birthDate!), groupId: group.id };
    kids.push(kid);
    peopleIn(dataset, group.id).forEach((child) => {
      grandkids.push({
        key: newFamilyKey(),
        parentKey: kid.key,
        name: child.label,
        year: yearOf(child.birthDate!),
        groupId: child.id,
      });
    });
  });
  return { kids, grandkids };
}

// ---------- defaults and ranges (ages only ever set ranges, never names) ----------

export function kidYearRange(birthYear: number, nowYear: number): [number, number] {
  const age = nowYear - birthYear;
  return [birthYear + Math.min(14, Math.max(0, age)), nowYear];
}

export function newKidYear(draft: FamilyDraft, birthYear: number, nowYear: number): number {
  const [low, high] = kidYearRange(birthYear, nowYear);
  const previous = draft.kids[draft.kids.length - 1];
  const age = nowYear - birthYear;
  const year = previous ? previous.year + 3 : birthYear + Math.round(age * 0.4) + 12;
  return clamp(year, low, high);
}

export function grandkidYearRange(parentYear: number, nowYear: number): [number, number] {
  return [Math.min(nowYear, parentYear + 15), nowYear];
}

export function newGrandkidYear(parentYear: number, nowYear: number): number {
  const [low, high] = grandkidYearRange(parentYear, nowYear);
  return clamp(parentYear + 30, low, high);
}

export function removeKid(draft: FamilyDraft, key: string): FamilyDraft {
  return {
    kids: draft.kids.filter((kid) => kid.key !== key),
    grandkids: draft.grandkids.filter((grandkid) => grandkid.parentKey !== key),
  };
}

// ---------- reconcile ----------

export type ParentRef = { groupId: string } | { kidKey: string };

export type FamilyOp =
  | { kind: "createFamily" }
  | { kind: "createKid"; key: string; label: string; birthDate: number }
  | { kind: "createGrandkid"; parent: ParentRef; label: string; birthDate: number }
  | { kind: "update"; groupId: string; patch: Partial<Pick<Group, "label" | "birthDate">> }
  | { kind: "move"; groupId: string; parent: ParentRef }
  | { kind: "delete"; groupId: string }
  | { kind: "deleteFamilyIfEmpty" };

function birthDateFor(year: number, existing: number | undefined): number {
  return existing !== undefined && yearOf(existing) === year ? existing : Date.UTC(year, 0, 1);
}

// The writes, in an order that can be run top to bottom: the Family group if
// it is needed, each child before any grandchild that goes inside it, and the
// removals last — so a grandchild moved away from a removed child has already
// left before that child's group is deleted with everything in it.
export function planFamily(draft: FamilyDraft, dataset: TimelineDataset): FamilyOp[] {
  const ops: FamilyOp[] = [];
  const family = findFamilyGroup(dataset);
  const stored = loadFamily(dataset);
  const groupById = new Map(dataset.groups.map((group) => [group.id, group]));
  const keptKids = new Set(draft.kids.map((kid) => kid.groupId));
  const keptGrandkids = new Set(draft.grandkids.map((grandkid) => grandkid.groupId));
  const kidByKey = new Map(draft.kids.map((kid) => [kid.key, kid]));

  if (draft.kids.length > 0 && !family) ops.push({ kind: "createFamily" });

  draft.kids.forEach((kid, index) => {
    const label = kidLabel(kid, index);
    const existing = kid.groupId ? groupById.get(kid.groupId) : undefined;
    const birthDate = birthDateFor(kid.year, existing?.birthDate);
    if (!existing) {
      ops.push({ kind: "createKid", key: kid.key, label, birthDate });
      return;
    }
    const patch: Partial<Pick<Group, "label" | "birthDate">> = {};
    if (existing.label !== label) patch.label = label;
    if (existing.birthDate !== birthDate) patch.birthDate = birthDate;
    if (Object.keys(patch).length > 0) ops.push({ kind: "update", groupId: existing.id, patch });
  });

  draft.grandkids.forEach((grandkid) => {
    const parent = kidByKey.get(grandkid.parentKey);
    if (!parent) return;
    const parentRef: ParentRef = parent.groupId ? { groupId: parent.groupId } : { kidKey: parent.key };
    const label = grandkidLabel(grandkid);
    const existing = grandkid.groupId ? groupById.get(grandkid.groupId) : undefined;
    const birthDate = birthDateFor(grandkid.year, existing?.birthDate);
    if (!existing) {
      ops.push({ kind: "createGrandkid", parent: parentRef, label, birthDate });
      return;
    }
    if (existing.parentGroupId !== parent.groupId) ops.push({ kind: "move", groupId: existing.id, parent: parentRef });
    const patch: Partial<Pick<Group, "label" | "birthDate">> = {};
    if (existing.label !== label) patch.label = label;
    if (existing.birthDate !== birthDate) patch.birthDate = birthDate;
    if (Object.keys(patch).length > 0) ops.push({ kind: "update", groupId: existing.id, patch });
  });

  stored.grandkids.forEach((grandkid) => {
    if (!keptGrandkids.has(grandkid.groupId)) ops.push({ kind: "delete", groupId: grandkid.groupId! });
  });
  stored.kids.forEach((kid) => {
    if (!keptKids.has(kid.groupId)) ops.push({ kind: "delete", groupId: kid.groupId! });
  });
  if (draft.kids.length === 0 && family) ops.push({ kind: "deleteFamilyIfEmpty" });
  return ops;
}
