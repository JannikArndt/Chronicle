// Where the first-run assistant reads its drafts from and writes them back to.
// Everything is found again from the dataset each time — the self group by
// `selfGroupId`, its topic timelines by label, "Family" by label at the top
// level — so Back, a reload and "✨ Replay setup assistant" all resume from what
// was saved instead of creating a second copy (the identity half of this rule
// is older: see `commitName` in OnboardingAssistant).

import { birthAnswerFromMs, birthDateToStore, DEFAULT_AGE } from "./birthYear";
import type { BirthAnswer } from "./birthYear";
import { findFamilyGroup, planFamily } from "./familyRecords";
import type { FamilyDraft, ParentRef } from "./familyRecords";
import { KIDS_COLOR } from "./lifeTopics";
import type { LifeTopic } from "./lifeTopics";
import { isEmptyPlan, loadSequence, planSequenceEntries } from "./sequenceRecords";
import type { SequenceLoad } from "./sequenceRecords";
import type { Sequence } from "./sequence";
import {
  addGroup,
  addRow,
  addSubGroup,
  applyEntryChanges,
  deleteGroupWithCascade,
  moveGroup,
  updateGroup,
} from "../state/actions";
import { appStore } from "../state/store";
import type { Group, TimelineDataset, TimelineEntry, TimelineRow } from "../model/types";

export function findSelfGroup(dataset: TimelineDataset): Group | undefined {
  return dataset.groups.find((group) => group.id === dataset.selfGroupId);
}

export function findTopicRow(dataset: TimelineDataset, topic: LifeTopic): TimelineRow | undefined {
  const self = findSelfGroup(dataset);
  if (!self) return undefined;
  return dataset.rows.find((row) => row.groupId === self.id && row.label === topic.rowLabel);
}

function entriesOf(dataset: TimelineDataset, rowId: string | undefined): TimelineEntry[] {
  return rowId === undefined ? [] : dataset.entries.filter((entry) => entry.rowId === rowId);
}

// The birth answer the screens work from: what is stored, or the slider's
// untouched starting point (never written on its own).
export function storedBirth(dataset: TimelineDataset, nowMs: number): { answer: BirthAnswer; stored: number | undefined } {
  const stored = findSelfGroup(dataset)?.birthDate;
  if (stored !== undefined) return { answer: birthAnswerFromMs(stored), stored };
  return { answer: { year: new Date(nowMs).getUTCFullYear() - DEFAULT_AGE, month: null }, stored: undefined };
}

export function loadTopic(dataset: TimelineDataset, topic: LifeTopic, birthYear: number, age: number): SequenceLoad {
  return loadSequence(entriesOf(dataset, findTopicRow(dataset, topic)?.id), {
    birthYear,
    age,
    rules: topic.rules,
    withPlace: topic.withPlace,
  });
}

export function commitBirth(answer: BirthAnswer): void {
  const dataset = appStore.getState().dataset;
  const self = findSelfGroup(dataset);
  if (!self) return;
  const birthDate = birthDateToStore(answer, self.birthDate);
  if (birthDate !== self.birthDate) updateGroup(self.id, { birthDate });
}

// Reconciles one topic's draft with its timeline. The timeline is created on
// the first commit that has something to put on it; a topic left empty
// creates nothing.
export function commitTopic(topic: LifeTopic, sequence: Sequence, birthYear: number): void {
  const dataset = appStore.getState().dataset;
  const self = findSelfGroup(dataset);
  if (!self) return;
  let rowId = findTopicRow(dataset, topic)?.id;
  const plan = planSequenceEntries(sequence, entriesOf(dataset, rowId), birthYear, topic.withPlace);
  if (isEmptyPlan(plan)) return;
  rowId ??= addRow(self.id, topic.rowLabel, topic.icon, topic.color);
  applyEntryChanges(rowId, plan);
}

export function commitFamily(draft: FamilyDraft): void {
  const ops = planFamily(draft, appStore.getState().dataset);
  let familyId = findFamilyGroup(appStore.getState().dataset)?.id;
  const createdKids = new Map<string, string>();
  const parentId = (ref: ParentRef) => ("groupId" in ref ? ref.groupId : createdKids.get(ref.kidKey));

  ops.forEach((op) => {
    switch (op.kind) {
      case "createFamily":
        familyId = addGroup("Family", undefined, undefined, "👨‍👩‍👧");
        break;
      case "createKid": {
        if (familyId === undefined) break;
        const id = addSubGroup(familyId, op.label, op.birthDate, KIDS_COLOR);
        if (id) createdKids.set(op.key, id);
        break;
      }
      case "createGrandkid": {
        const parent = parentId(op.parent);
        if (parent) addSubGroup(parent, op.label, op.birthDate, KIDS_COLOR);
        break;
      }
      case "update":
        updateGroup(op.groupId, op.patch);
        break;
      case "move": {
        const parent = parentId(op.parent);
        if (parent) moveGroup(op.groupId, parent, null);
        break;
      }
      case "delete":
        deleteGroupWithCascade(op.groupId);
        break;
      case "deleteFamilyIfEmpty": {
        const current = appStore.getState().dataset;
        const id = familyId;
        if (id === undefined) break;
        const empty = !current.groups.some((g) => g.parentGroupId === id) && !current.rows.some((r) => r.groupId === id);
        if (empty) deleteGroupWithCascade(id);
        break;
      }
    }
  });
}

// What the canvas frames when the assistant closes: birth to now, with a
// little room on either side.
export function lifeRange(birthYear: number, nowMs: number): { startMs: number; endMs: number } {
  const startMs = Date.UTC(birthYear, 0, 1);
  const margin = Math.max(365 * 86_400_000, (nowMs - startMs) * 0.04);
  return { startMs: startMs - margin, endMs: nowMs + margin };
}
