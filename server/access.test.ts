import { describe, expect, test } from "vitest";
import { ancestorIds, computeAccess, indexRecords } from "./access";
import type { AccessGrant, StructRecord } from "./access";

// My tree:
//   Family (g-family)
//     Dad (g-dad)
//       Dad's jobs (r-dad-jobs, shared)      e-dad-job, v-dad-born
//       Dad's secrets (r-dad-secret)         e-dad-secret
//       Dad's kids (g-dad-kids)
//         Kid (r-kid, shared)                 e-kid
//     Mom (g-mom, shared)                     — published, holds nothing published
//       Mom's diary (r-mom-diary)             e-mom-diary
//   Me (g-me)
//     Places (r-places, shared)               e-places
//     Health (r-health)                       e-health
//   Loose (r-loose, top level, shared)        e-loose
//   Private loose (r-private-loose)
const records: StructRecord[] = [
  { id: "g-family", kind: "group", parentId: null, shared: false },
  { id: "g-dad", kind: "group", parentId: "g-family", shared: false },
  { id: "r-dad-jobs", kind: "row", parentId: "g-dad", shared: true },
  { id: "e-dad-job", kind: "entry", parentId: "r-dad-jobs", shared: false },
  { id: "v-dad-born", kind: "event", parentId: "r-dad-jobs", shared: false },
  { id: "r-dad-secret", kind: "row", parentId: "g-dad", shared: false },
  { id: "e-dad-secret", kind: "entry", parentId: "r-dad-secret", shared: false },
  { id: "g-dad-kids", kind: "group", parentId: "g-dad", shared: false },
  { id: "r-kid", kind: "row", parentId: "g-dad-kids", shared: true },
  { id: "e-kid", kind: "entry", parentId: "r-kid", shared: false },
  { id: "g-mom", kind: "group", parentId: "g-family", shared: true },
  { id: "r-mom-diary", kind: "row", parentId: "g-mom", shared: false },
  { id: "e-mom-diary", kind: "entry", parentId: "r-mom-diary", shared: false },
  { id: "g-me", kind: "group", parentId: null, shared: false },
  { id: "r-places", kind: "row", parentId: "g-me", shared: true },
  { id: "e-places", kind: "entry", parentId: "r-places", shared: false },
  { id: "r-health", kind: "row", parentId: "g-me", shared: false },
  { id: "e-health", kind: "entry", parentId: "r-health", shared: false },
  { id: "r-loose", kind: "row", parentId: null, shared: true },
  { id: "e-loose", kind: "entry", parentId: "r-loose", shared: false },
  { id: "r-private-loose", kind: "row", parentId: null, shared: false },
];
const index = indexRecords(records);

function access(grants: AccessGrant[]): Record<string, string> {
  return Object.fromEntries([...computeAccess(index, grants)].sort(([a], [b]) => a.localeCompare(b)));
}

describe("no grants", () => {
  test("sees nothing at all", () => {
    expect(access([])).toEqual({});
  });
});

describe("viewer of a group", () => {
  const dadViewer = access([{ subjectKind: "group", subjectId: "g-dad", role: "viewer" }]);

  test("sees the group itself, published rows in its subtree and what they hold", () => {
    expect(dadViewer).toMatchObject({
      "g-dad": "read",
      "r-dad-jobs": "read",
      "e-dad-job": "read",
      "v-dad-born": "read",
    });
  });

  test("does not see an unpublished row, nor anything on it", () => {
    expect(dadViewer["r-dad-secret"]).toBeUndefined();
    expect(dadViewer["e-dad-secret"]).toBeUndefined();
  });

  test("sees the unpublished sub-group on the way to a published row inside it", () => {
    expect(dadViewer["g-dad-kids"]).toBe("read");
    expect(dadViewer["r-kid"]).toBe("read");
    expect(dadViewer["e-kid"]).toBe("read");
  });

  test("sees nothing above the subject — not even the group it sits in", () => {
    expect(dadViewer["g-family"]).toBeUndefined();
    expect(dadViewer["g-mom"]).toBeUndefined();
  });

  test("never gets write access", () => {
    expect(Object.values(dadViewer)).not.toContain("edit");
  });
});

describe("viewer of everything", () => {
  const all = access([{ subjectKind: "all", subjectId: "", role: "viewer" }]);

  test("sees exactly the published rows, their contents and their containers", () => {
    expect(all).toEqual({
      "g-family": "read",
      "g-dad": "read",
      "r-dad-jobs": "read",
      "e-dad-job": "read",
      "v-dad-born": "read",
      "g-dad-kids": "read",
      "r-kid": "read",
      "e-kid": "read",
      "g-mom": "read",
      "g-me": "read",
      "r-places": "read",
      "e-places": "read",
      "r-loose": "read",
      "e-loose": "read",
    });
  });

  test("a published group is visible even with nothing published inside it", () => {
    expect(all["g-mom"]).toBe("read");
    expect(all["r-mom-diary"]).toBeUndefined();
  });

  test("an unpublished top-level row stays home", () => {
    expect(all["r-private-loose"]).toBeUndefined();
  });

  test("a top-level group is not revealed just for existing", () => {
    const onlyPrivate = indexRecords([
      { id: "g", kind: "group", parentId: null, shared: false },
      { id: "r", kind: "row", parentId: "g", shared: false },
    ]);
    expect(computeAccess(onlyPrivate, [{ subjectKind: "all", subjectId: "", role: "viewer" }]).size).toBe(0);
  });
});

describe("viewer of a single timeline", () => {
  test("a direct grant on a row publishes that row, even if its flag is off", () => {
    const secret = access([{ subjectKind: "row", subjectId: "r-dad-secret", role: "viewer" }]);
    expect(secret).toEqual({ "r-dad-secret": "read", "e-dad-secret": "read" });
  });

  test("does not reveal the row's group", () => {
    const places = access([{ subjectKind: "row", subjectId: "r-places", role: "viewer" }]);
    expect(places["g-me"]).toBeUndefined();
  });
});

describe("editor", () => {
  const dadEditor = access([{ subjectKind: "group", subjectId: "g-dad", role: "editor" }]);

  test("edits everything in the subtree, published or not", () => {
    expect(dadEditor).toEqual({
      "g-dad": "edit",
      "r-dad-jobs": "edit",
      "e-dad-job": "edit",
      "v-dad-born": "edit",
      "r-dad-secret": "edit",
      "e-dad-secret": "edit",
      "g-dad-kids": "edit",
      "r-kid": "edit",
      "e-kid": "edit",
    });
  });

  test("edit wins over read when grants overlap", () => {
    const both = access([
      { subjectKind: "all", subjectId: "", role: "viewer" },
      { subjectKind: "group", subjectId: "g-dad", role: "editor" },
    ]);
    expect(both["r-dad-jobs"]).toBe("edit");
    expect(both["r-dad-secret"]).toBe("edit");
    expect(both["g-family"]).toBe("read");
    expect(both["r-places"]).toBe("read");
    expect(both["r-health"]).toBeUndefined();
  });

  test("the order of the grants does not matter", () => {
    const reversed = access([
      { subjectKind: "group", subjectId: "g-dad", role: "editor" },
      { subjectKind: "all", subjectId: "", role: "viewer" },
    ]);
    expect(reversed["r-dad-jobs"]).toBe("edit");
  });
});

describe("failing closed", () => {
  test("a grant on a subject that does not exist reaches nothing", () => {
    expect(access([{ subjectKind: "group", subjectId: "nope", role: "editor" }])).toEqual({});
  });

  test("a grant naming the wrong kind reaches nothing", () => {
    expect(access([{ subjectKind: "row", subjectId: "g-dad", role: "editor" }])).toEqual({});
  });

  test("an entry whose row is gone is unreachable, even for an editor of everything", () => {
    const orphaned = indexRecords([{ id: "e", kind: "entry", parentId: "missing-row", shared: false }]);
    expect(computeAccess(orphaned, [{ subjectKind: "all", subjectId: "", role: "editor" }]).size).toBe(0);
  });

  test("a group whose container is gone is reachable only through `all`", () => {
    const orphanGroup = indexRecords([
      { id: "g", kind: "group", parentId: "missing", shared: true },
      { id: "r", kind: "row", parentId: "g", shared: true },
    ]);
    expect(computeAccess(orphanGroup, [{ subjectKind: "all", subjectId: "", role: "viewer" }]).get("r")).toBe("read");
  });

  test("a parent cycle cannot hang the walk", () => {
    const cyclic = indexRecords([
      { id: "a", kind: "group", parentId: "b", shared: true },
      { id: "b", kind: "group", parentId: "a", shared: true },
      { id: "r", kind: "row", parentId: "a", shared: true },
    ]);
    const result = computeAccess(cyclic, [
      { subjectKind: "group", subjectId: "a", role: "viewer" },
      { subjectKind: "group", subjectId: "b", role: "editor" },
    ]);
    expect(result.get("r")).toBe("edit");
    expect(ancestorIds(cyclic, "a")).toEqual(["b"]);
  });
});

describe("ancestorIds", () => {
  test("walks to the top, nearest first", () => {
    expect(ancestorIds(index, "g-dad-kids")).toEqual(["g-dad", "g-family"]);
    expect(ancestorIds(index, "g-me")).toEqual([]);
  });
});
