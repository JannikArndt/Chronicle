// Words for "what is shared" — a timeline, a group, or everything — shared by
// every surface that lists grants, invites and links, so they all say it the
// same way.

import type { TimelineDataset } from "../model/types";
import type { Role, Subject } from "../sync/protocol";

export function subjectLabel(subject: Subject | null, dataset: TimelineDataset): string {
  if (subject === null) return "nothing — just to connect";
  if (subject.kind === "all") return "everything they publish";
  const record =
    subject.kind === "group"
      ? dataset.groups.find((group) => group.id === subject.id)
      : dataset.rows.find((row) => row.id === subject.id);
  return record === undefined ? `a ${subject.kind === "group" ? "group" : "timeline"}` : `“${record.label}”`;
}

export function roleVerb(role: Role | null): string {
  return role === "editor" ? "edit" : "view";
}
