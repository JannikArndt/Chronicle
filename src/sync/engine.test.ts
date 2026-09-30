// The sync engine — the browser side — against a real server in-process.
// Jannik is this "browser" (the engine and the app store); the other people
// are plain API clients, so what reaches Jannik's screen arrives exactly the
// way it would in production: over the event stream.

import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { TestClient, change, record, startTestServer } from "../../server/testkit";
import { useTransport } from "./api";
import {
  __resetEngineForTests,
  createInviteLink,
  initSync,
  redeemInvite,
  signIn,
  signOut,
  signUp,
} from "./engine";
import { addEntry, addRow, replaceDataset, toggleGroupCollapsed, updateEntry, updateRow } from "../state/actions";
import { appStore, isReadOnlyId } from "../state/store";
import { emptyDataset } from "../model/dataset";
import { loadSync } from "../storage/db";
import type { TestServer } from "../../server/testkit";
import type { PullResponse } from "./protocol";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

// The engine's HTTP goes to the test server, with a cookie jar standing in
// for the browser's.
beforeEach(() => {
  let cookie = "";
  useTransport({
    base: server.url,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (cookie !== "") headers.set("cookie", cookie);
      const response = await fetch(input, { ...init, headers });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie !== null) cookie = setCookie.split(";")[0];
      return response;
    },
  });
});

afterEach(async () => {
  await __resetEngineForTests();
});

let handles = 0;
const uniqueHandle = (base: string) => `${base}${++handles}`;

async function waitUntil(condition: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const synced = () => appStore.getState().sync.status === "online" && appStore.getState().sync.pending === 0;

// After a local edit: the store's save debounce has to fire before the edit
// is even pending, so "nothing pending" alone would be true too early.
async function editSent(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await waitUntil(synced, "the edit reaching the server");
}
const date = { ms: Date.UTC(2020, 0, 1), precision: "year" as const };
const state = () => appStore.getState();

function localLife(): void {
  replaceDataset({
    ...emptyDataset(),
    groups: [{ id: "g-me", label: "Me", collapsed: false }],
    rows: [{ id: "r-places", groupId: "g-me", label: "Places" }],
    entries: [{ id: "e-berlin", rowId: "r-places", title: "Berlin", start: date }],
    selfGroupId: "g-me",
  });
}

async function serverView(handle: string): Promise<PullResponse> {
  const client = new TestClient(server.url);
  await client.ok("POST", "/api/auth/signin", { handle, password: "correct horse" });
  return client.ok<PullResponse>("GET", "/api/pull");
}

describe("signing up", () => {
  test("the device's own timelines become the account's, with fresh ids", async () => {
    localLife();
    const handle = uniqueHandle("jannik");
    await signUp(handle, "correct horse", "Jannik");
    await waitUntil(synced, "first sync");

    const view = await serverView(handle);
    expect(view.records.map((r) => r.fields.label ?? r.fields.title).sort()).toEqual(["Berlin", "Me", "Places"]);
    expect(view.records.map((r) => r.id)).not.toContain("g-me");
    // Which group is the person themselves travels with the account.
    const me = view.records.find((r) => r.fields.label === "Me")!;
    await waitUntil(() => state().sync.account?.selfGroupId === me.id, "self group on the account");
    expect(state().dataset.selfGroupId).toBe(me.id);
  });

  test("an edit reaches the server, and survives a restart of the app", async () => {
    localLife();
    const handle = uniqueHandle("jannik");
    await signUp(handle, "correct horse", "Jannik");
    await waitUntil(synced, "first sync");
    const rowId = state().dataset.rows[0].id;
    updateRow(rowId, { label: "Homes" });
    await editSent();
    expect((await serverView(handle)).records.find((r) => r.id === rowId)?.fields.label).toBe("Homes");

    // The replica is on disk: a fresh start shows the same thing before the
    // network has answered.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await loadSync())?.replica.base.find((r) => r.id === rowId)?.fields.label).toBe("Homes");
  });
});

describe("live, with other people", () => {
  async function jannikWithDadEditing() {
    localLife();
    const handle = uniqueHandle("jannik");
    await signUp(handle, "correct horse", "Jannik");
    await waitUntil(synced, "first sync");
    const groupId = state().dataset.groups[0].id;
    const rowId = state().dataset.rows[0].id;
    const url = await createInviteLink({ kind: "group", id: groupId }, "editor");
    const token = url.split("#/invite/")[1];
    const dad = new TestClient(server.url);
    await dad.signUp(uniqueHandle("dad"), "Dad");
    await dad.ok("POST", "/api/invite/redeem", { token });
    return { handle, groupId, rowId, dad, jannikId: state().sync.account!.id };
  }

  test("Dad's new entry appears on Jannik's screen as Jannik's own record", async () => {
    const { rowId, dad, jannikId } = await jannikWithDadEditing();
    await dad.push([record("entry", "e-dad-1", jannikId, { rowId, title: "Visited", start: date })]);
    await waitUntil(() => state().dataset.entries.some((e) => e.id === "e-dad-1"), "Dad's entry arriving");
    expect(state().sync.meta.get("e-dad-1")).toMatchObject({ owner: jannikId, access: "own" });
  });

  test("two people editing one entry at once keep both edits", async () => {
    const { rowId, dad, jannikId } = await jannikWithDadEditing();
    const entryId = state().dataset.entries.find((e) => e.rowId === rowId)!.id;
    updateEntry(entryId, { description: "We took the train" });
    await dad.push([{ id: entryId, kind: "entry", owner: jannikId, fields: change({ title: "Berlin, finally" }, "dad") }]);
    await editSent();
    await waitUntil(() => state().dataset.entries.find((e) => e.id === entryId)?.title === "Berlin, finally", "Dad's title");
    const entry = state().dataset.entries.find((e) => e.id === entryId)!;
    expect(entry).toMatchObject({ title: "Berlin, finally", description: "We took the train" });
    const onServer = (await dad.ok<PullResponse>("GET", "/api/pull")).records.find((r) => r.id === entryId)!;
    expect(onServer.fields).toMatchObject({ title: "Berlin, finally", description: "We took the train" });
  });

  test("a timeline shared for viewing is read-only, and an edit to it snaps back", async () => {
    localLife();
    await signUp(uniqueHandle("jannik"), "correct horse", "Jannik");
    await waitUntil(synced, "first sync");
    const mom = new TestClient(server.url);
    const momId = await mom.signUp(uniqueHandle("mom"), "Mom");
    await mom.push([
      record("group", "g-mom", momId, { label: "Mom", collapsed: false }),
      record("row", "r-mom", momId, { label: "Mom's travels", groupId: "g-mom", shared: true }),
    ]);
    const { token } = await mom.ok<{ token: string }>("POST", "/api/invites", { subject: { kind: "all", id: "" }, role: "viewer" });
    await redeemInvite(token);
    await waitUntil(() => state().dataset.rows.some((r) => r.id === "r-mom"), "Mom's timeline arriving");
    expect(isReadOnlyId("r-mom")).toBe(true);
    expect(state().sync.names[momId]).toBe("Mom");

    updateRow("r-mom", { label: "Jannik was here" });
    await waitUntil(() => state().dataset.rows.find((r) => r.id === "r-mom")?.label === "Mom's travels", "the edit reverting");
    expect(state().sync.pending).toBe(0);

    // Collapsing someone else's group is allowed — it is this device's view.
    toggleGroupCollapsed("g-mom");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(state().dataset.groups.find((g) => g.id === "g-mom")?.collapsed).toBe(true);
    expect(state().sync.pending).toBe(0);

    // Un-publishing takes it off Jannik's screen, live.
    await mom.push([{ id: "r-mom", kind: "row", owner: momId, fields: change({ shared: false }) }]);
    await waitUntil(() => !state().dataset.rows.some((r) => r.id === "r-mom"), "the un-published timeline leaving");
  });

  test("an editor adds to someone else's group, and it is theirs", async () => {
    localLife();
    await signUp(uniqueHandle("jannik"), "correct horse", "Jannik");
    await waitUntil(synced, "first sync");
    const mom = new TestClient(server.url);
    const momId = await mom.signUp(uniqueHandle("mom"), "Mom");
    await mom.push([record("group", "g-mom2", momId, { label: "Mom", collapsed: false })]);
    const { token } = await mom.ok<{ token: string }>("POST", "/api/invites", {
      subject: { kind: "group", id: "g-mom2" },
      role: "editor",
    });
    await redeemInvite(token);
    await waitUntil(() => state().dataset.groups.some((g) => g.id === "g-mom2"), "Mom's group arriving");

    const rowId = addRow("g-mom2", "Her childhood");
    addEntry({ rowId, title: "Born", start: date });
    await editSent();
    const moms = await mom.ok<PullResponse>("GET", "/api/pull");
    expect(moms.records.filter((r) => r.owner === momId).map((r) => r.fields.label ?? r.fields.title).sort()).toEqual([
      "Born",
      "Her childhood",
      "Mom",
    ]);
  });
});

describe("signing out and back in", () => {
  test("signing out leaves the device empty; signing in brings it all back", async () => {
    localLife();
    const handle = uniqueHandle("jannik");
    await signUp(handle, "correct horse", "Jannik");
    await waitUntil(synced, "first sync");
    await signOut();
    expect(state().dataset.groups).toEqual([]);
    expect(state().sync.status).toBe("local");
    expect(await loadSync()).toBeNull();

    await signIn(handle, "correct horse", true);
    await waitUntil(() => synced() && state().dataset.groups.length === 1, "everything back");
    expect(state().dataset.entries.map((e) => e.title)).toEqual(["Berlin"]);
  });

  test("a restart of a signed-in device picks up where it was", async () => {
    localLife();
    await signUp(uniqueHandle("jannik"), "correct horse", "Jannik");
    await waitUntil(synced, "first sync");
    appStore.setState({ dataset: emptyDataset() });
    expect(await initSync()).toBe(true);
    expect(state().dataset.entries.map((e) => e.title)).toEqual(["Berlin"]);
    await waitUntil(synced, "reconnected");
  });
});
