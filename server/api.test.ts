import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TestClient, change, clock, record, startTestServer } from "./testkit";
import type { TestServer } from "./testkit";
import type { GrantsResponse, PeopleResponse, PullResponse, ServerEvent, WireRecord } from "../src/sync/protocol";

let server: TestServer;
beforeEach(async () => {
  server = await startTestServer();
});
afterEach(async () => {
  await server.close();
});

const client = () => new TestClient(server.url);

async function pullIds(c: TestClient): Promise<Record<string, string>> {
  const pulled = await c.ok<PullResponse>("GET", "/api/pull");
  return Object.fromEntries(pulled.records.map((r) => [r.id, r.access]));
}

async function pullRecord(c: TestClient, id: string): Promise<WireRecord | undefined> {
  return (await c.ok<PullResponse>("GET", "/api/pull")).records.find((r) => r.id === id);
}

const entry = (id: string, rowId: string, title: string) =>
  ({ rowId, title, start: { ms: Date.UTC(2020, 0, 1), precision: "year" } }) as Record<string, unknown>;

describe("accounts", () => {
  test("sign up, see yourself, sign out, sign back in", async () => {
    const me = client();
    const id = await me.signUp("jannik", "Jannik");
    expect((await me.ok<{ me: { id: string; name: string } }>("GET", "/api/me")).me).toMatchObject({ id, name: "Jannik" });
    await me.ok("POST", "/api/auth/signout");
    expect((await me.request("GET", "/api/me")).status).toBe(401);
    await me.ok("POST", "/api/auth/signin", { handle: "JANNIK", password: "correct horse" });
    expect((await me.ok<{ me: { id: string } }>("GET", "/api/me")).me.id).toBe(id);
  });

  test("a wrong password and an unknown handle look the same", async () => {
    await client().signUp("jannik");
    const wrong = await client().request("POST", "/api/auth/signin", { handle: "jannik", password: "nope nope nope" });
    const unknown = await client().request("POST", "/api/auth/signin", { handle: "nobody", password: "nope nope nope" });
    expect(wrong).toEqual(unknown);
    expect(wrong.status).toBe(401);
  });

  test("handles are unique and passwords have a minimum length", async () => {
    await client().signUp("jannik");
    expect((await client().request("POST", "/api/auth/signup", { handle: "jannik", password: "long enough", name: "J" })).status).toBe(409);
    expect((await client().request("POST", "/api/auth/signup", { handle: "other", password: "short", name: "O" })).status).toBe(400);
    expect((await client().request("POST", "/api/auth/signup", { handle: "a b", password: "long enough", name: "O" })).status).toBe(400);
  });

  test("every write needs the X-Chronicle header — a cookie alone is not enough", async () => {
    const me = client();
    await me.signUp("jannik");
    const response = await me.request("POST", "/api/push", { records: [] }, { "x-chronicle": "0" });
    expect(response.status).toBe(403);
  });

  test("the session cookie is HttpOnly and SameSite", async () => {
    const response = await fetch(`${server.url}/api/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-chronicle": "1" },
      body: JSON.stringify({ handle: "jannik", password: "correct horse", name: "J" }),
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  test("changing the password signs out every other session", async () => {
    const laptop = client();
    await laptop.signUp("jannik");
    const phone = client();
    await phone.ok("POST", "/api/auth/signin", { handle: "jannik", password: "correct horse" });
    await laptop.ok("POST", "/api/me/password", { current: "correct horse", next: "battery staple" });
    expect((await phone.request("GET", "/api/me")).status).toBe(401);
    expect((await laptop.request("GET", "/api/me")).status).toBe(200);
  });

  test("the account keeps which group is the person themselves", async () => {
    const me = client();
    await me.signUp("jannik");
    const { me: info } = await me.ok<{ me: { selfGroupId?: string } }>("PATCH", "/api/me", { selfGroupId: "g-me" });
    expect(info.selfGroupId).toBe("g-me");
  });
});

describe("own records", () => {
  test("push, then pull them back — private records are the owner's", async () => {
    const me = client();
    const id = await me.signUp("jannik");
    const results = await me.push([
      record("group", "g-me", id, { label: "Me", collapsed: false }),
      record("row", "r-work", id, { label: "Work", groupId: "g-me" }),
      record("entry", "e-job", id, entry("e-job", "r-work", "First job")),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await pullIds(me)).toEqual({ "g-me": "own", "r-work": "own", "e-job": "own" });
  });

  test("two edits to different fields of one entry both survive", async () => {
    const me = client();
    const id = await me.signUp("jannik");
    await me.push([record("row", "r", id, { label: "Work" }), record("entry", "e", id, entry("e", "r", "Job"))]);
    // Phone and laptop, each changing its own field, arriving in either order.
    const laptop = { id: "e", kind: "entry" as const, owner: id, fields: change({ title: "Engineer" }, "laptop") };
    const phone = { id: "e", kind: "entry" as const, owner: id, fields: change({ description: "Loved it" }, "phone") };
    await me.push([phone]);
    await me.push([laptop]);
    const merged = await pullRecord(me, "e");
    expect(merged?.fields).toMatchObject({ title: "Engineer", description: "Loved it" });
  });

  test("the later edit of the same field wins, whichever arrives last", async () => {
    const me = client();
    const id = await me.signUp("jannik");
    await me.push([record("row", "r", id, { label: "Work" })]);
    const early = { id: "r", kind: "row" as const, owner: id, fields: change({ label: "Early" }) };
    const late = { id: "r", kind: "row" as const, owner: id, fields: change({ label: "Late" }) };
    await me.push([late]);
    const [stale] = await me.push([early]);
    expect(stale.record?.fields.label).toBe("Late");
  });

  test("clearing a field removes it", async () => {
    const me = client();
    const id = await me.signUp("jannik");
    await me.push([record("row", "r", id, { label: "Work", icon: "💼" })]);
    await me.push([{ id: "r", kind: "row", owner: id, fields: change({ icon: null }) }]);
    expect((await pullRecord(me, "r"))?.fields).toEqual({ label: "Work" });
  });

  test("a delete is permanent — a late edit cannot bring it back", async () => {
    const me = client();
    const id = await me.signUp("jannik");
    await me.push([record("row", "r", id, { label: "Work" })]);
    const lateEdit = { id: "r", kind: "row" as const, owner: id, fields: change({ label: "Edited offline" }) };
    await me.push([{ id: "r", kind: "row", owner: id, fields: {}, deleted: clock() }]);
    const [result] = await me.push([lateEdit]);
    expect(result.record?.deleted).toBe(true);
    expect(await pullIds(me)).toEqual({});
  });

  test("malformed records are refused, one at a time", async () => {
    const me = client();
    const id = await me.signUp("jannik");
    const results = await me.push([
      record("row", "ok", id, { label: "Fine" }),
      record("row", "bad-type", id, { label: { evil: true } }),
      record("row", "unknown-field", id, { label: "x", script: "alert(1)" }),
      record("entry", "no-row", id, { title: "Orphan", start: { ms: 0, precision: "year" } }),
      record("row", "pub:nope", id, { label: "Pretending to be public" }),
      { id: "no-label", kind: "row", owner: id, fields: change({ color: "red" }) },
    ]);
    expect(results.map((r) => [r.id, r.ok])).toEqual([
      ["ok", true],
      ["bad-type", false],
      ["unknown-field", false],
      ["no-row", false],
      ["pub:nope", false],
      ["no-label", false],
    ]);
  });

  test("a clock far in the future is refused", async () => {
    const me = client();
    const id = await me.signUp("jannik");
    const future = `${String(Date.now() + 24 * 60 * 60 * 1000).padStart(15, "0")}:00000:evil`;
    const [result] = await me.push([{ id: "r", kind: "row", owner: id, fields: { label: { v: "x", c: future } } }]);
    expect(result).toMatchObject({ ok: false, reason: "invalid clock" });
  });

  test("a group cannot be moved inside itself", async () => {
    const me = client();
    const id = await me.signUp("jannik");
    await me.push([record("group", "a", id, { label: "A" }), record("group", "b", id, { label: "B", parentGroupId: "a" })]);
    const [result] = await me.push([{ id: "a", kind: "group", owner: id, fields: change({ parentGroupId: "b" }) }]);
    expect(result.ok).toBe(false);
  });

  test("an id belongs to its first owner", async () => {
    const jannik = client();
    const jannikId = await jannik.signUp("jannik");
    const mallory = client();
    const malloryId = await mallory.signUp("mallory");
    await jannik.push([record("row", "r-mine", jannikId, { label: "Mine" })]);
    const [result] = await mallory.push([record("row", "r-mine", malloryId, { label: "Stolen" })]);
    expect(result.ok).toBe(false);
    expect((await pullRecord(jannik, "r-mine"))?.fields.label).toBe("Mine");
  });

  test("nobody can write into a tree they hold no grant on", async () => {
    const jannik = client();
    const jannikId = await jannik.signUp("jannik");
    const mallory = client();
    await mallory.signUp("mallory");
    await jannik.push([record("row", "r", jannikId, { label: "Mine" })]);
    const [result] = await mallory.push([
      { id: "r", kind: "row", owner: jannikId, fields: change({ label: "Defaced" }) },
    ]);
    expect(result.ok).toBe(false);
  });

  test("another device of the same account hears about every change", async () => {
    const laptop = client();
    const id = await laptop.signUp("jannik");
    const phone = client();
    await phone.ok("POST", "/api/auth/signin", { handle: "jannik", password: "correct horse" });
    await phone.connect();
    await laptop.connect();
    await laptop.push([record("row", "r", id, { label: "Work" })]);
    const event = await phone.waitFor((e) => e.type === "records");
    expect(event).toMatchObject({ type: "records", records: [{ id: "r", access: "own" }] });
    // The device that pushed already has the answer and hears nothing.
    await laptop.expectNone((e) => e.type === "records");
    await laptop.push([{ id: "r", kind: "row", owner: id, fields: {}, deleted: clock() }]);
    expect(await phone.waitFor((e) => e.type === "gone")).toEqual({ type: "gone", ids: ["r"] });
  });
});

// Builds the family: Jannik owns the tree; Dad is invited to edit his own
// group; Mom is invited to view everything published.
async function family() {
  const jannik = client();
  const jannikId = await jannik.signUp("jannik", "Jannik");
  await jannik.push([
    record("group", "g-family", jannikId, { label: "Family", collapsed: false }),
    record("group", "g-dad", jannikId, { label: "Dad", parentGroupId: "g-family", collapsed: false }),
    record("row", "r-dad-work", jannikId, { label: "Dad's work", groupId: "g-dad" }),
    record("group", "g-me", jannikId, { label: "Me", collapsed: false }),
    record("row", "r-places", jannikId, { label: "Places", groupId: "g-me", shared: true }),
    record("entry", "e-berlin", jannikId, entry("e-berlin", "r-places", "Berlin")),
    record("row", "r-health", jannikId, { label: "Health", groupId: "g-me" }),
    record("entry", "e-knee", jannikId, entry("e-knee", "r-health", "Knee surgery")),
  ]);

  const dadInvite = await jannik.ok<{ token: string }>("POST", "/api/invites", {
    subject: { kind: "group", id: "g-dad" },
    role: "editor",
  });
  const momInvite = await jannik.ok<{ token: string }>("POST", "/api/invites", {
    subject: { kind: "all", id: "" },
    role: "viewer",
  });

  const dad = client();
  const dadId = await dad.signUp("dad", "Dad");
  const preview = await dad.ok("POST", "/api/invite/preview", { token: dadInvite.token });
  expect(preview).toEqual({ inviter: { id: jannikId, name: "Jannik" }, subject: { kind: "group", label: "Dad" }, role: "editor" });
  await dad.ok("POST", "/api/invite/redeem", { token: dadInvite.token });

  const mom = client();
  const momId = await mom.signUp("mom", "Mom");
  await mom.ok("POST", "/api/invite/redeem", { token: momInvite.token });

  return { jannik, jannikId, dad, dadId, mom, momId };
}

describe("sharing", () => {
  test("an editor sees the whole subtree they were invited to, and nothing else", async () => {
    const { dad } = await family();
    expect(await pullIds(dad)).toEqual({ "g-dad": "edit", "r-dad-work": "edit" });
  });

  test("a viewer of everything sees only what is published", async () => {
    const { mom } = await family();
    expect(await pullIds(mom)).toEqual({ "g-me": "read", "r-places": "read", "e-berlin": "read" });
  });

  test("an editor's new entry lands in the owner's tree and reaches the owner live", async () => {
    const { jannik, jannikId, dad } = await family();
    await jannik.connect();
    const [result] = await dad.push([record("entry", "e-dad-job", jannikId, entry("e-dad-job", "r-dad-work", "Engineer"))]);
    expect(result).toMatchObject({ ok: true, record: { owner: jannikId, access: "edit" } });
    const event = await jannik.waitFor((e) => e.type === "records");
    expect(event).toMatchObject({ records: [{ id: "e-dad-job", owner: jannikId, access: "own" }] });
  });

  test("two people editing the same entry live converge, field by field", async () => {
    const { jannik, jannikId, dad } = await family();
    await dad.push([record("entry", "e-trip", jannikId, entry("e-trip", "r-dad-work", "Trip"))]);
    await jannik.connect();
    await dad.connect();
    await jannik.push([{ id: "e-trip", kind: "entry", owner: jannikId, fields: change({ title: "Spain trip" }, "jannik") }]);
    await dad.push([{ id: "e-trip", kind: "entry", owner: jannikId, fields: change({ description: "Rained" }, "dad") }]);
    const toDad = await dad.waitFor((e) => e.type === "records");
    const toJannik = await jannik.waitFor((e) => e.type === "records");
    expect(toDad).toMatchObject({ records: [{ fields: { title: "Spain trip" } }] });
    expect(toJannik).toMatchObject({ records: [{ fields: { title: "Spain trip", description: "Rained" } }] });
  });

  test("an editor cannot reach outside the subtree, move it, or delete it", async () => {
    const { jannikId, dad } = await family();
    const results = await dad.push([
      { id: "r-health", kind: "row", owner: jannikId, fields: change({ label: "Hacked" }) },
      record("row", "r-new-top", jannikId, { label: "Top level" }),
      record("row", "r-in-family", jannikId, { label: "Sneaky", groupId: "g-family" }),
      { id: "g-dad", kind: "group", owner: jannikId, fields: change({ parentGroupId: null }) },
      { id: "g-dad", kind: "group", owner: jannikId, fields: {}, deleted: clock() },
      { id: "r-dad-work", kind: "row", owner: jannikId, fields: change({ groupId: "g-me" }) },
    ]);
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  test("an editor can rename the group, add a sub-group, and delete inside it", async () => {
    const { jannikId, dad } = await family();
    const results = await dad.push([
      { id: "g-dad", kind: "group", owner: jannikId, fields: change({ label: "Papa" }) },
      record("group", "g-dad-kids", jannikId, { label: "Kids", parentGroupId: "g-dad" }),
      record("row", "r-kid", jannikId, { label: "Kid", groupId: "g-dad-kids" }),
      { id: "r-dad-work", kind: "row", owner: jannikId, fields: {}, deleted: clock() },
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true, true, true]);
  });

  test("a viewer cannot write", async () => {
    const { jannikId, mom } = await family();
    const [result] = await mom.push([{ id: "r-places", kind: "row", owner: jannikId, fields: change({ label: "Mom was here" }) }]);
    expect(result.ok).toBe(false);
  });

  test("publishing a timeline brings it to viewers live; un-publishing takes it away", async () => {
    const { jannik, jannikId, mom } = await family();
    await mom.connect();
    await jannik.push([{ id: "r-health", kind: "row", owner: jannikId, fields: change({ shared: true }) }]);
    const arrived = await mom.waitFor((e) => e.type === "records");
    expect(arrived.type === "records" && arrived.records.map((r) => r.id).sort()).toEqual(["e-knee", "r-health"]);

    await jannik.push([{ id: "r-health", kind: "row", owner: jannikId, fields: change({ shared: false }) }]);
    const gone = await mom.waitFor((e) => e.type === "gone");
    expect(gone.type === "gone" && [...gone.ids].sort()).toEqual(["e-knee", "r-health"]);
  });

  test("editing a private timeline tells a viewer nothing at all", async () => {
    const { jannik, jannikId, mom } = await family();
    await mom.connect();
    await jannik.push([{ id: "e-knee", kind: "entry", owner: jannikId, fields: change({ title: "Other knee" }) }]);
    await mom.expectNone((e) => e.type === "records" || e.type === "gone");
  });

  test("moving a published timeline out of view is a removal for the viewer", async () => {
    const { jannik, jannikId, dad } = await family();
    await dad.connect();
    await jannik.push([{ id: "r-dad-work", kind: "row", owner: jannikId, fields: change({ groupId: "g-me" }) }]);
    const gone = await dad.waitFor((e) => e.type === "gone");
    expect(gone).toEqual({ type: "gone", ids: ["r-dad-work"] });
  });

  test("revoking a grant removes everything it gave, live", async () => {
    const { jannik, mom } = await family();
    await mom.connect();
    const { given } = await jannik.ok<GrantsResponse>("GET", "/api/grants");
    const momsGrant = given.find((grant) => grant.grantee.name === "Mom")!;
    await jannik.ok("DELETE", `/api/grants/${momsGrant.id}`);
    const gone = await mom.waitFor((e) => e.type === "gone");
    expect(gone.type === "gone" && [...gone.ids].sort()).toEqual(["e-berlin", "g-me", "r-places"]);
    expect(await pullIds(mom)).toEqual({});
  });

  test("a grantee can leave a grant", async () => {
    const { mom } = await family();
    const { received } = await mom.ok<GrantsResponse>("GET", "/api/grants");
    await mom.ok("DELETE", `/api/grants/${received[0].id}`);
    expect(await pullIds(mom)).toEqual({});
  });

  test("sharing directly with a connection, and upgrading the role", async () => {
    const { jannik, dad, dadId } = await family();
    await dad.connect();
    await jannik.ok("POST", "/api/grants", { granteeId: dadId, subject: { kind: "row", id: "r-health" }, role: "viewer" });
    expect(dad.takeRecordIds.bind(dad)).toBeDefined();
    await dad.waitFor((e) => e.type === "records");
    expect((await pullIds(dad))["r-health"]).toBe("read");
    await jannik.ok("POST", "/api/grants", { granteeId: dadId, subject: { kind: "row", id: "r-health" }, role: "editor" });
    const upgraded = await dad.waitFor((e) => e.type === "records");
    expect(upgraded).toMatchObject({ records: expect.arrayContaining([expect.objectContaining({ id: "r-health", access: "edit" })]) });
  });

  test("only connections can be granted access, and only to your own things", async () => {
    const { jannik, dad, dadId } = await family();
    const stranger = client();
    const strangerId = await stranger.signUp("stranger");
    expect((await jannik.request("POST", "/api/grants", { granteeId: strangerId, subject: { kind: "all", id: "" }, role: "viewer" })).status).toBe(403);
    expect((await dad.request("POST", "/api/grants", { granteeId: dadId, subject: { kind: "group", id: "g-dad" }, role: "viewer" })).status).toBe(400);
    const { jannikId } = { jannikId: jannik.accountId };
    expect(
      (await dad.request("POST", "/api/grants", { granteeId: jannikId, subject: { kind: "group", id: "g-dad" }, role: "viewer" })).status,
    ).toBe(404);
  });

  test("deleting a shared group ends its grants and tells the grantee", async () => {
    const { jannik, jannikId, dad } = await family();
    await dad.connect();
    await jannik.push([
      { id: "r-dad-work", kind: "row", owner: jannikId, fields: {}, deleted: clock() },
      { id: "g-dad", kind: "group", owner: jannikId, fields: {}, deleted: clock() },
    ]);
    await dad.waitFor((e) => e.type === "gone");
    await dad.waitFor((e) => e.type === "social");
    expect((await dad.ok<GrantsResponse>("GET", "/api/grants")).received).toEqual([]);
  });
});

describe("invites", () => {
  test("an invite works once", async () => {
    const jannik = client();
    await jannik.signUp("jannik");
    const { token } = await jannik.ok<{ token: string }>("POST", "/api/invites", { subject: null });
    const anna = client();
    await anna.signUp("anna");
    await anna.ok("POST", "/api/invite/redeem", { token });
    const bob = client();
    await bob.signUp("bob");
    expect((await bob.request("POST", "/api/invite/redeem", { token })).status).toBe(404);
    expect((await bob.request("POST", "/api/invite/preview", { token })).status).toBe(404);
  });

  test("a plain invite connects without sharing anything", async () => {
    const jannik = client();
    await jannik.signUp("jannik", "Jannik");
    const { token } = await jannik.ok<{ token: string }>("POST", "/api/invites", { subject: null });
    const anna = client();
    await anna.signUp("anna", "Anna");
    expect(await anna.ok("POST", "/api/invite/preview", { token })).toMatchObject({ subject: null, role: null });
    await anna.ok("POST", "/api/invite/redeem", { token });
    const people = await jannik.ok<PeopleResponse>("GET", "/api/people");
    expect(people.connections.map((c) => c.name)).toEqual(["Anna"]);
    expect(await pullIds(anna)).toEqual({});
  });

  test("you cannot invite someone to a thing that is not yours", async () => {
    const { dad } = await family();
    expect((await dad.request("POST", "/api/invites", { subject: { kind: "group", id: "g-dad" }, role: "viewer" })).status).toBe(404);
  });

  test("an outstanding invite can be cancelled", async () => {
    const jannik = client();
    await jannik.signUp("jannik");
    const { token, invite } = await jannik.ok<{ token: string; invite: { id: string } }>("POST", "/api/invites", { subject: null });
    await jannik.ok("DELETE", `/api/invites/${invite.id}`);
    const anna = client();
    await anna.signUp("anna");
    expect((await anna.request("POST", "/api/invite/redeem", { token })).status).toBe(404);
  });
});

describe("people", () => {
  test("a connection of a connection is suggested — with who links you — and granted nothing", async () => {
    const { jannik, dad } = await family();
    // Dad invites the brother, to Dad's own (empty) Chronicle.
    const { token } = await dad.ok<{ token: string }>("POST", "/api/invites", { subject: null });
    const brother = client();
    const brotherId = await brother.signUp("brother", "Brother");
    await brother.ok("POST", "/api/invite/redeem", { token });

    const people = await jannik.ok<PeopleResponse>("GET", "/api/people");
    expect(people.suggestions).toEqual([{ id: brotherId, name: "Brother", via: [{ id: dad.accountId, name: "Dad" }] }]);
    expect(await pullIds(brother)).toEqual({});
  });

  test("request, accept, connected — then disconnecting ends every grant between the two", async () => {
    const { jannik, jannikId, dad } = await family();
    const { token } = await dad.ok<{ token: string }>("POST", "/api/invites", { subject: null });
    const brother = client();
    const brotherId = await brother.signUp("brother", "Brother");
    await brother.ok("POST", "/api/invite/redeem", { token });

    await jannik.ok("POST", `/api/people/${brotherId}/request`);
    expect((await brother.ok<PeopleResponse>("GET", "/api/people")).incoming).toEqual([{ id: jannikId, name: "Jannik" }]);
    await brother.ok("POST", `/api/people/${jannikId}/accept`);
    expect((await jannik.ok<PeopleResponse>("GET", "/api/people")).connections.map((c) => c.name)).toContain("Brother");

    await jannik.ok("POST", "/api/grants", { granteeId: brotherId, subject: { kind: "all", id: "" }, role: "viewer" });
    expect(Object.keys(await pullIds(brother)).length).toBeGreaterThan(0);
    await brother.ok("DELETE", `/api/people/${jannikId}`);
    expect(await pullIds(brother)).toEqual({});
  });

  test("strangers cannot be sent requests", async () => {
    const jannik = client();
    await jannik.signUp("jannik");
    const stranger = client();
    const strangerId = await stranger.signUp("stranger");
    expect((await jannik.request("POST", `/api/people/${strangerId}/request`)).status).toBe(403);
  });

  test("a dismissed suggestion stays dismissed", async () => {
    const { jannik, dad } = await family();
    const { token } = await dad.ok<{ token: string }>("POST", "/api/invites", { subject: null });
    const brother = client();
    const brotherId = await brother.signUp("brother");
    await brother.ok("POST", "/api/invite/redeem", { token });
    await jannik.ok("POST", `/api/people/${brotherId}/dismiss`);
    expect((await jannik.ok<PeopleResponse>("GET", "/api/people")).suggestions).toEqual([]);
  });
});

describe("presence", () => {
  test("a connection sees what you have open — if they can see it too", async () => {
    const { jannik, dad, mom } = await family();
    await jannik.connect();
    await dad.connect();
    await mom.connect();
    await dad.ok("POST", "/api/presence", { connectionId: dad.connectionId, focusId: "r-dad-work" });

    const isDadFocused = (e: ServerEvent) =>
      e.type === "peers" && e.peers.some((p) => p.name === "Dad" && p.focusId === "r-dad-work");
    await jannik.waitFor(isDadFocused);
    // Mom is not connected to Dad at all, so she does not see him.
    await mom.expectNone(isDadFocused);
  });

  test("a focus the recipient cannot see is not revealed", async () => {
    const { jannik, dad, dadId } = await family();
    // Jannik and Dad are connected; Jannik looks at his private Health row.
    await dad.connect();
    await jannik.connect();
    await jannik.ok("POST", "/api/presence", { connectionId: jannik.connectionId, focusId: "r-health" });
    const event = await dad.waitFor(
      (e) => e.type === "peers" && e.peers.some((p) => p.name === "Jannik"),
    );
    expect(event.type === "peers" && event.peers.find((p) => p.name === "Jannik")?.focusId).toBeNull();
    expect(dadId).toBeDefined();
  });

  test("a presence update for someone else's connection is refused", async () => {
    const { jannik, dad } = await family();
    await jannik.connect();
    expect((await dad.request("POST", "/api/presence", { connectionId: jannik.connectionId, focusId: null })).status).toBe(404);
  });
});

describe("public links", () => {
  test("anyone with the link sees the published part of the subject — no account", async () => {
    const { jannik } = await family();
    const { token } = await jannik.ok<{ token: string }>("POST", "/api/links", { subject: { kind: "group", id: "g-me" } });
    const anonymous = client();
    const view = await anonymous.ok<{ owner: { name: string }; records: WireRecord[] }>("POST", "/api/public", { token });
    expect(view.owner.name).toBe("Jannik");
    expect(view.records.map((r) => r.id).sort()).toEqual(["e-berlin", "g-me", "r-places"]);
  });

  test("switching a link off makes it stop working", async () => {
    const { jannik } = await family();
    const { token, link } = await jannik.ok<{ token: string; link: { id: string } }>("POST", "/api/links", {
      subject: { kind: "all", id: "" },
    });
    await jannik.ok("DELETE", `/api/links/${link.id}`);
    expect((await client().request("POST", "/api/public", { token })).status).toBe(404);
  });
});

describe("deleting an account", () => {
  test("takes its records, and everyone who could see them is told", async () => {
    const { jannik, mom } = await family();
    await mom.connect();
    expect((await jannik.request("DELETE", "/api/me", { password: "wrong password" })).status).toBe(401);
    await jannik.ok("DELETE", "/api/me", { password: "correct horse" });
    await mom.waitFor((e) => e.type === "gone");
    expect(await pullIds(mom)).toEqual({});
    expect((await jannik.request("GET", "/api/me")).status).toBe(401);
  });
});

describe("the static site and version", () => {
  test("/version answers with the build", async () => {
    const response = await fetch(`${server.url}/version`);
    expect(await response.json()).toMatchObject({ build: "test-build" });
  });

  test("an unknown API path is a JSON 404, not the app", async () => {
    const response = await fetch(`${server.url}/api/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No such endpoint." });
  });
});
