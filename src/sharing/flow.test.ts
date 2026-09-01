// The phase-1 acceptance test: the family scenario, end to end, against the
// in-process backend. Publish → invite → propagate → edit → revoke.

import { describe, expect, test } from "vitest";
import { planPush } from "./diff";
import { FakeServer } from "./fakeBackend";
import { formatHlc } from "./hlc";
import { buildMirrors } from "./mirror";
import { recordsFromSubset } from "./records";
import { emptyDataset } from "../model/dataset";
import { syncSubset } from "../model/sharing";
import type { SharingBackend } from "./backend";
import type { SyncRecord } from "./records";
import type { TimelineDataset } from "../model/types";

// A tiny stand-in for what `sync.ts` does in the app: keep a snapshot, diff
// against it on every save, push the difference.
class Pusher {
  private snapshot: SyncRecord[] = [];
  private wall = 1_000;

  constructor(
    private readonly backend: SharingBackend,
    private readonly accountId: string,
  ) {}

  async push(dataset: TimelineDataset): Promise<void> {
    this.wall += 100;
    const clock = formatHlc({ wall: this.wall, counter: 0, node: this.accountId });
    const current = recordsFromSubset(syncSubset(dataset, "shared-only"), this.accountId, clock);
    const plan = planPush(this.snapshot, current);
    this.snapshot = plan.nextSnapshot;
    if (plan.writes.length > 0) await this.backend.push(plan.writes);
  }
}

// Me: a "Me" group with a published "Places lived" and a private "Therapy".
function myDataset(): TimelineDataset {
  const dataset = emptyDataset();
  dataset.groups = [
    { id: "g-me", label: "Jannik", birthDate: Date.UTC(1988, 2, 4), collapsed: false },
    { id: "g-dad", label: "Dad", collapsed: false },
  ];
  dataset.rows = [
    { id: "r-places", groupId: "g-me", label: "Places lived", color: "#8ba66f", shared: true },
    { id: "r-therapy", groupId: "g-me", label: "Therapy", color: "#a66f8b" },
  ];
  dataset.entries = [
    { id: "e-berlin", rowId: "r-places", title: "Berlin", start: { ms: Date.UTC(2011, 0, 1), precision: "year" } },
    { id: "e-session", rowId: "r-therapy", title: "Weekly", start: { ms: Date.UTC(2019, 0, 1), precision: "year" } },
  ];
  // One moment on the published timeline, one on the held-back one.
  dataset.events = [
    { id: "v-moved", rowId: "r-places", title: "Moved in", date: { ms: Date.UTC(2011, 3, 1), precision: "day" } },
    { id: "v-told", rowId: "r-therapy", title: "Told her", date: { ms: Date.UTC(2019, 5, 2), precision: "day" } },
  ];
  return dataset;
}

async function setUp() {
  const server = new FakeServer();
  const meId = server.account("me@example.test", "Jannik");
  const dadId = server.account("dad@example.test", "Dad");
  const me = server.client(meId);
  const dad = server.client(dadId);
  const dataset = myDataset();
  const pusher = new Pusher(me, meId);
  await pusher.push(dataset);
  return { server, me, dad, meId, dadId, dataset, pusher };
}

describe("the family scenario", () => {
  test("a stranger with no grant sees nothing at all", async () => {
    const { dad } = await setUp();
    expect(await dad.pullVisible()).toEqual([]);
  });

  test("redeeming an invite to my group shows my published timeline", async () => {
    const { me, dad } = await setUp();
    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-me", role: "reader" }));

    const mirrors = buildMirrors(await dad.pullVisible());
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0].ownerName).toBe("Jannik");
    expect(mirrors[0].role).toBe("reader");
    expect(mirrors[0].dataset.rows.map((row) => row.label)).toEqual(["Places lived"]);
  });

  // The held-back timeline. This is the requirement that "a few timelines can be
  // held back from an otherwise-shared person" turns into.
  test("the private timeline is not in the mirror, and neither are its entries", async () => {
    const { me, dad } = await setUp();
    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-me", role: "reader" }));

    const mirror = buildMirrors(await dad.pullVisible())[0];
    expect(mirror.dataset.rows.some((row) => row.label === "Therapy")).toBe(false);
    expect(mirror.dataset.entries.some((entry) => entry.title === "Weekly")).toBe(false);
  });

  test("the events on a published timeline travel with it", async () => {
    const { me, dad, meId } = await setUp();
    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-me", role: "reader" }));

    const mirror = buildMirrors(await dad.pullVisible())[0];
    expect(mirror.dataset.events.map((event) => event.title)).toEqual(["Moved in"]);
    // Namespaced like everything else, and still attached to its row.
    expect(mirror.dataset.events[0].rowId).toBe(`shared:${meId}:r-places`);
  });

  test("the events on a held-back timeline never leave the device", async () => {
    const { me, dad } = await setUp();
    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-me", role: "reader" }));

    const mirror = buildMirrors(await dad.pullVisible())[0];
    expect(mirror.dataset.events.some((event) => event.title === "Told her")).toBe(false);
  });

  test("un-publishing takes the events back too", async () => {
    const { me, dad, dataset, pusher } = await setUp();
    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-me", role: "reader" }));
    dataset.rows[0].shared = false;
    await pusher.push(dataset);

    expect(buildMirrors(await dad.pullVisible())).toEqual([]);
  });

  test("an event added later reaches the reader", async () => {
    const { me, dad, dataset, pusher } = await setUp();
    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-me", role: "reader" }));

    dataset.events.push({
      id: "v-left",
      rowId: "r-places",
      title: "Left again",
      date: { ms: Date.UTC(2014, 8, 1), precision: "month" },
    });
    await pusher.push(dataset);

    const titles = buildMirrors(await dad.pullVisible())[0].dataset.events.map((event) => event.title);
    expect(titles).toContain("Left again");
  });

  test("mirrored ids are namespaced by owner, so they cannot collide with my own", async () => {
    const { me, dad, meId } = await setUp();
    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-me", role: "reader" }));

    const mirror = buildMirrors(await dad.pullVisible())[0];
    expect(mirror.dataset.rows[0].id).toBe(`shared:${meId}:r-places`);
    expect(mirror.dataset.rows[0].groupId).toBe(`shared:${meId}:g-me`);
    expect(mirror.dataset.entries[0].rowId).toBe(`shared:${meId}:r-places`);
  });

  test("an edit to a published timeline reaches the reader", async () => {
    const { me, dad, dataset, pusher } = await setUp();
    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-me", role: "reader" }));

    dataset.entries[0].title = "Berlin, Neukölln";
    await pusher.push(dataset);

    expect(buildMirrors(await dad.pullVisible())[0].dataset.entries[0].title).toBe("Berlin, Neukölln");
  });

  test("a newly published timeline appears; a new private one does not", async () => {
    const { me, dad, dataset, pusher } = await setUp();
    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-me", role: "reader" }));

    dataset.rows.push({ id: "r-jobs", groupId: "g-me", label: "Jobs", color: "#333", shared: true });
    dataset.rows.push({ id: "r-diary", groupId: "g-me", label: "Diary", color: "#333" });
    await pusher.push(dataset);

    const labels = buildMirrors(await dad.pullVisible())[0].dataset.rows.map((row) => row.label);
    expect(labels).toContain("Jobs");
    expect(labels).not.toContain("Diary");
  });

  test("un-publishing removes it from the reader's mirror", async () => {
    const { me, dad, dataset, pusher } = await setUp();
    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-me", role: "reader" }));

    dataset.rows[0].shared = false;
    await pusher.push(dataset);

    expect(buildMirrors(await dad.pullVisible())).toEqual([]);
  });

  test("revoking the grant empties the mirror", async () => {
    const { me, dad } = await setUp();
    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-me", role: "reader" }));
    expect(await dad.pullVisible()).not.toEqual([]);

    const [grant] = await me.listGrants();
    expect(grant.granteeName).toBe("Dad");
    await me.revokeGrant(grant.id);

    expect(await dad.pullVisible()).toEqual([]);
  });

  test("a grant on one timeline shows that one and no other", async () => {
    const { me, dad, dataset, pusher } = await setUp();
    dataset.rows.push({ id: "r-jobs", groupId: "g-me", label: "Jobs", color: "#333", shared: true });
    await pusher.push(dataset);

    await dad.redeemInvite(await me.createInvite({ subjectKind: "row", subjectId: "r-jobs", role: "reader" }));

    const mirror = buildMirrors(await dad.pullVisible())[0];
    expect(mirror.dataset.rows.map((row) => row.label)).toEqual(["Jobs"]);
    // The container came with it — a bar has to be drawn under a header.
    expect(mirror.dataset.groups.map((group) => group.label)).toEqual(["Jannik"]);
  });

  test("a co-owner invite makes the group editable rather than read-only", async () => {
    const { me, dad, dataset, pusher } = await setUp();
    dataset.rows.push({ id: "r-dad-life", groupId: "g-dad", label: "Dad's life", color: "#333", shared: true });
    await pusher.push(dataset);

    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-dad", role: "owner" }));

    const mirror = buildMirrors(await dad.pullVisible())[0];
    expect(mirror.role).toBe("owner");
    expect(mirror.dataset.rows.some((row) => row.label === "Dad's life")).toBe(true);
  });

  test("subscribers are woken by a push", async () => {
    const { me, dad, dataset, pusher } = await setUp();
    await dad.redeemInvite(await me.createInvite({ subjectKind: "group", subjectId: "g-me", role: "reader" }));

    let wakeups = 0;
    const unsubscribe = dad.subscribe(() => {
      wakeups += 1;
    });
    dataset.entries[0].title = "Berlin, Kreuzberg";
    await pusher.push(dataset);
    expect(wakeups).toBe(1);

    unsubscribe();
    dataset.entries[0].title = "Berlin, Mitte";
    await pusher.push(dataset);
    expect(wakeups).toBe(1);
  });

  test("a bad invite token is refused", async () => {
    const { dad } = await setUp();
    await expect(dad.redeemInvite("nope")).rejects.toThrow("not valid");
  });
});
