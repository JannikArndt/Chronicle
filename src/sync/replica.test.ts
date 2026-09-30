import { describe, expect, test } from "vitest";
import {
  acknowledge,
  adoptLocalDataset,
  applyGone,
  applyServerRecords,
  buildView,
  diffView,
  emptyReplica,
  pendingBatch,
  replaceBase,
} from "./replica";
import type { Replica, View, ViewPrefs } from "./replica";
import type { WireRecord } from "./protocol";
import type { TimelineDataset } from "../model/types";

const ME = "me";
const DAD = "dad";
const prefs = (): ViewPrefs => ({ foreignCollapsed: new Map() });

let tick = 0;
const stamp = () => `${String(1_700_000_000_000 + ++tick).padStart(15, "0")}:00000:me`;

function wire(id: string, kind: WireRecord["kind"], owner: string, access: WireRecord["access"], fields: Record<string, unknown>): WireRecord {
  return { id, kind, owner, access, fields };
}

const date = { ms: Date.UTC(2020, 0, 1), precision: "year" as const };

// My own group with a row, and Dad's group (which I may edit) with a row —
// Dad's group sits inside a "Family" group of his that I cannot see.
function replicaWithFamily(): Replica {
  const replica = emptyReplica(ME);
  applyServerRecords(replica, [
    wire("g-me", "group", ME, "own", { label: "Me", collapsed: false, order: 0 }),
    wire("r-me", "row", ME, "own", { label: "Places", groupId: "g-me", order: 0 }),
    wire("g-dad", "group", DAD, "edit", { label: "Dad", parentGroupId: "g-family", collapsed: false, order: 3 }),
    wire("r-dad", "row", DAD, "edit", { label: "Work", groupId: "g-dad", order: 0 }),
    wire("r-mom", "row", "mom", "read", { label: "Mom's", order: 1 }),
  ]);
  return replica;
}

function edit(view: View, mutate: (dataset: TimelineDataset) => void): TimelineDataset {
  const next = structuredClone(view.dataset);
  mutate(next);
  return next;
}

describe("buildView", () => {
  test("a foreign record whose container is out of sight is drawn at the top level, unordered", () => {
    const view = buildView(replicaWithFamily(), prefs());
    const dadGroup = view.dataset.groups.find((g) => g.id === "g-dad")!;
    expect(dadGroup.parentGroupId).toBeUndefined();
    expect(dadGroup.order).toBeUndefined();
    expect(view.meta.get("g-dad")).toEqual({ owner: DAD, access: "edit", rootProjected: true });
    // Inside a visible container, a foreign record keeps its place.
    expect(view.dataset.rows.find((r) => r.id === "r-dad")).toMatchObject({ groupId: "g-dad", order: 0 });
    expect(view.meta.get("r-dad")?.rootProjected).toBe(false);
  });

  test("own records come first", () => {
    const view = buildView(replicaWithFamily(), prefs());
    expect(view.dataset.groups.map((g) => g.id)).toEqual(["g-me", "g-dad"]);
  });

  test("pending changes are drawn over the server's version", () => {
    const replica = replicaWithFamily();
    replica.pending.set("r-me", { id: "r-me", kind: "row", owner: ME, fields: { label: { v: "Homes", c: stamp() } } });
    expect(buildView(replica, prefs()).dataset.rows.find((r) => r.id === "r-me")?.label).toBe("Homes");
  });

  test("a locally deleted record is gone before the server confirms it", () => {
    const replica = replicaWithFamily();
    replica.pending.set("r-me", { id: "r-me", kind: "row", owner: ME, fields: {}, deleted: stamp() });
    expect(buildView(replica, prefs()).dataset.rows.map((r) => r.id)).not.toContain("r-me");
  });

  test("collapsing someone else's group is this device's preference", () => {
    const view = buildView(replicaWithFamily(), { foreignCollapsed: new Map([["g-dad", true]]) });
    expect(view.dataset.groups.find((g) => g.id === "g-dad")?.collapsed).toBe(true);
  });
});

describe("diffView — my own records", () => {
  test("an edited field becomes one pending change", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    const next = edit(view, (d) => {
      d.rows.find((r) => r.id === "r-me")!.label = "Homes";
    });
    const outcome = diffView(view, next, replica, stamp);
    expect(outcome).toMatchObject({ changed: true, refused: false });
    expect(pendingBatch(replica, 10)).toEqual([
      { id: "r-me", kind: "row", owner: ME, fields: { label: { v: "Homes", c: expect.any(String) } } },
    ]);
  });

  test("a cleared optional field is sent as null", () => {
    const replica = emptyReplica(ME);
    applyServerRecords(replica, [wire("r", "row", ME, "own", { label: "Work", icon: "💼" })]);
    const view = buildView(replica, prefs());
    diffView(view, edit(view, (d) => delete d.rows[0].icon), replica, stamp);
    expect(replica.pending.get("r")?.fields.icon?.v).toBeNull();
  });

  test("an unchanged dataset produces nothing — not even from key order", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    const next = edit(view, (d) => {
      const row = d.rows.find((r) => r.id === "r-me")!;
      const { label, ...rest } = row;
      Object.keys(row).forEach((key) => delete (row as unknown as Record<string, unknown>)[key]);
      Object.assign(row, rest, { label });
    });
    expect(diffView(view, next, replica, stamp).changed).toBe(false);
    expect(replica.pending.size).toBe(0);
  });

  test("a new record is created with every field", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    diffView(
      view,
      edit(view, (d) => d.entries.push({ id: "e-new", rowId: "r-me", title: "Berlin", start: date })),
      replica,
      stamp,
    );
    const pending = replica.pending.get("e-new")!;
    expect(pending.owner).toBe(ME);
    expect(Object.keys(pending.fields).sort()).toEqual(["rowId", "start", "title"]);
  });

  test("a deletion is a tombstone", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    diffView(view, edit(view, (d) => (d.rows = d.rows.filter((r) => r.id !== "r-me"))), replica, stamp);
    expect(replica.pending.get("r-me")).toMatchObject({ deleted: expect.any(String), fields: {} });
  });
});

describe("diffView — someone else's records", () => {
  test("an entry added to Dad's timeline is Dad's record", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    const outcome = diffView(
      view,
      edit(view, (d) => d.entries.push({ id: "e-dad", rowId: "r-dad", title: "Engineer", start: date })),
      replica,
      stamp,
    );
    expect(replica.pending.get("e-dad")?.owner).toBe(DAD);
    expect(outcome.view.meta.get("e-dad")).toEqual({ owner: DAD, access: "edit", rootProjected: false });
  });

  test("a whole new sub-tree under Dad's group is Dad's, all the way down", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    diffView(
      view,
      edit(view, (d) => {
        d.groups.push({ id: "g-kids", parentGroupId: "g-dad", label: "Kids", collapsed: false });
        d.rows.push({ id: "r-kid", groupId: "g-kids", label: "Kid" });
        d.entries.push({ id: "e-kid", rowId: "r-kid", title: "Born", start: date });
      }),
      replica,
      stamp,
    );
    expect(["g-kids", "r-kid", "e-kid"].map((id) => replica.pending.get(id)?.owner)).toEqual([DAD, DAD, DAD]);
  });

  test("editing a read-only record is refused and nothing is sent", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    const outcome = diffView(view, edit(view, (d) => (d.rows.find((r) => r.id === "r-mom")!.label = "Mine now")), replica, stamp);
    expect(outcome.refused).toBe(true);
    expect(replica.pending.size).toBe(0);
  });

  test("adding to a read-only timeline is refused", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    const outcome = diffView(
      view,
      edit(view, (d) => d.entries.push({ id: "e-x", rowId: "r-mom", title: "Hi", start: date })),
      replica,
      stamp,
    );
    expect(outcome.refused).toBe(true);
    expect(replica.pending.has("e-x")).toBe(false);
  });

  test("deleting a read-only record is refused", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    const outcome = diffView(view, edit(view, (d) => (d.rows = d.rows.filter((r) => r.id !== "r-mom"))), replica, stamp);
    expect(outcome.refused).toBe(true);
    expect(replica.pending.size).toBe(0);
  });

  test("moving my timeline into Dad's group is refused — trees do not mix", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    const outcome = diffView(view, edit(view, (d) => (d.rows.find((r) => r.id === "r-me")!.groupId = "g-dad")), replica, stamp);
    expect(outcome.refused).toBe(true);
    expect(replica.pending.size).toBe(0);
  });

  test("moving Dad's timeline into my group is refused too", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    const outcome = diffView(view, edit(view, (d) => (d.rows.find((r) => r.id === "r-dad")!.groupId = "g-me")), replica, stamp);
    expect(outcome.refused).toBe(true);
  });

  test("renumbering at the top level does not touch a projected record's real place", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    const outcome = diffView(
      view,
      edit(view, (d) => {
        d.groups.find((g) => g.id === "g-dad")!.order = 7;
        d.rows.find((r) => r.id === "r-mom")!.order = 8;
      }),
      replica,
      stamp,
    );
    expect(outcome).toMatchObject({ changed: false, refused: false });
  });

  test("collapsing Dad's group is remembered here, not sent to him", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    const outcome = diffView(view, edit(view, (d) => (d.groups.find((g) => g.id === "g-dad")!.collapsed = true)), replica, stamp);
    expect(outcome.collapsed).toEqual([["g-dad", true]]);
    expect(replica.pending.size).toBe(0);
  });

  test("public data is never anyone's pending change", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    const next = edit(view, (d) => d.rows.push({ id: "pub:x:r", label: "Olympics" }));
    expect(diffView(view, next, replica, stamp).changed).toBe(false);
  });
});

describe("acknowledge", () => {
  test("accepted changes leave pending and the resolved record becomes base", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    diffView(view, edit(view, (d) => (d.rows.find((r) => r.id === "r-me")!.label = "Homes")), replica, stamp);
    const sent = pendingBatch(replica, 10);
    acknowledge(replica, sent, [
      { id: "r-me", ok: true, record: wire("r-me", "row", ME, "own", { label: "Homes", groupId: "g-me", order: 0 }) },
    ]);
    expect(replica.pending.size).toBe(0);
    expect(replica.base.get("r-me")?.fields.label).toBe("Homes");
  });

  test("a newer local edit made while the push was in flight stays pending", () => {
    const replica = replicaWithFamily();
    let view = buildView(replica, prefs());
    let outcome = diffView(view, edit(view, (d) => (d.rows.find((r) => r.id === "r-me")!.label = "Homes")), replica, stamp);
    const sent = pendingBatch(replica, 10);
    view = outcome.view;
    outcome = diffView(view, edit(view, (d) => (d.rows.find((r) => r.id === "r-me")!.label = "Homes!")), replica, stamp);
    acknowledge(replica, sent, [{ id: "r-me", ok: true, record: wire("r-me", "row", ME, "own", { label: "Homes" }) }]);
    expect(replica.pending.get("r-me")?.fields.label?.v).toBe("Homes!");
    expect(buildView(replica, prefs()).dataset.rows.find((r) => r.id === "r-me")?.label).toBe("Homes!");
  });

  test("when someone else's newer edit won a field, the view shows theirs", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    diffView(view, edit(view, (d) => (d.rows.find((r) => r.id === "r-dad")!.label = "Mine")), replica, stamp);
    const sent = pendingBatch(replica, 10);
    acknowledge(replica, sent, [{ id: "r-dad", ok: true, record: wire("r-dad", "row", DAD, "edit", { label: "Dad's newer" }) }]);
    expect(buildView(replica, prefs()).dataset.rows.find((r) => r.id === "r-dad")?.label).toBe("Dad's newer");
  });

  test("a rejected new record disappears entirely", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    diffView(view, edit(view, (d) => d.entries.push({ id: "e-x", rowId: "r-dad", title: "x", start: date })), replica, stamp);
    const rejected = acknowledge(replica, pendingBatch(replica, 10), [{ id: "e-x", ok: false, reason: "you cannot add to this" }]);
    expect(rejected).toHaveLength(1);
    expect(replica.pending.size).toBe(0);
    expect(buildView(replica, prefs()).dataset.entries.map((e) => e.id)).not.toContain("e-x");
  });

  test("an accepted delete removes the record from base", () => {
    const replica = replicaWithFamily();
    const view = buildView(replica, prefs());
    diffView(view, edit(view, (d) => (d.rows = d.rows.filter((r) => r.id !== "r-me"))), replica, stamp);
    acknowledge(replica, pendingBatch(replica, 10), [
      { id: "r-me", ok: true, record: { ...wire("r-me", "row", ME, "own", {}), deleted: true } },
    ]);
    expect(replica.base.has("r-me")).toBe(false);
    expect(replica.pending.size).toBe(0);
  });
});

describe("remote changes", () => {
  test("a live record replaces base but a pending local field stays on top", () => {
    const replica = replicaWithFamily();
    replica.pending.set("r-dad", { id: "r-dad", kind: "row", owner: DAD, fields: { label: { v: "Local", c: stamp() } } });
    applyServerRecords(replica, [wire("r-dad", "row", DAD, "edit", { label: "Remote", groupId: "g-dad", icon: "🔧" })]);
    const row = buildView(replica, prefs()).dataset.rows.find((r) => r.id === "r-dad")!;
    expect(row).toMatchObject({ label: "Local", icon: "🔧" });
  });

  test("losing edit access drops what was waiting to be sent", () => {
    const replica = replicaWithFamily();
    replica.pending.set("r-dad", { id: "r-dad", kind: "row", owner: DAD, fields: { label: { v: "Local", c: stamp() } } });
    applyServerRecords(replica, [wire("r-dad", "row", DAD, "read", { label: "Remote" })]);
    expect(replica.pending.size).toBe(0);
  });

  test("gone is gone, pending edits included", () => {
    const replica = replicaWithFamily();
    replica.pending.set("r-dad", { id: "r-dad", kind: "row", owner: DAD, fields: { label: { v: "Local", c: stamp() } } });
    applyGone(replica, ["r-dad", "g-dad"]);
    expect(replica.pending.size).toBe(0);
    expect(buildView(replica, prefs()).dataset.groups.map((g) => g.id)).toEqual(["g-me"]);
  });

  test("a full pull keeps records created here that the server has not heard of", () => {
    const replica = replicaWithFamily();
    replica.pending.set("r-new", { id: "r-new", kind: "row", owner: ME, fields: { label: { v: "New", c: stamp() } } });
    replica.pending.set("r-dad", { id: "r-dad", kind: "row", owner: DAD, fields: { label: { v: "Edit", c: stamp() } } });
    replaceBase(replica, [wire("g-me", "group", ME, "own", { label: "Me" })]);
    expect([...replica.pending.keys()]).toEqual(["r-new"]);
  });
});

describe("adoptLocalDataset", () => {
  test("every local record becomes mine, to be created on the server", () => {
    const replica = emptyReplica(ME);
    adoptLocalDataset(
      replica,
      {
        schemaVersion: 11,
        groups: [{ id: "g", label: "Me", collapsed: false }],
        rows: [{ id: "r", groupId: "g", label: "Places" }, { id: "pub:x:r", label: "public" }],
        entries: [{ id: "e", rowId: "r", title: "Berlin", start: date }],
        events: [],
      },
      stamp(),
    );
    expect([...replica.pending.values()].map((p) => [p.id, p.owner])).toEqual([
      ["g", ME],
      ["r", ME],
      ["e", ME],
    ]);
  });
});
