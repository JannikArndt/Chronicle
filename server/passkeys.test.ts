import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SoftAuthenticator } from "./softAuthenticator";
import { TestClient, startTestServer } from "./testkit";
import type { TestServer } from "./testkit";
import type { AccountInfo, PasskeyInfo } from "../src/sync/protocol";

let server: TestServer;
beforeEach(async () => {
  server = await startTestServer();
});
afterEach(async () => {
  await server.close();
});

type Options = { ceremonyId: string; options: Parameters<SoftAuthenticator["create"]>[0] & Parameters<SoftAuthenticator["get"]>[0] };

async function signUpWithPasskey(client: TestClient, authenticator: SoftAuthenticator, handle: string, name = handle) {
  const { ceremonyId, options } = await client.ok<Options>("POST", "/api/passkeys/signup/options", { handle, name });
  const response = authenticator.create(options);
  const { me } = await client.ok<{ me: AccountInfo }>("POST", "/api/passkeys/signup", {
    ceremonyId,
    response,
    passkeyName: "Test phone",
  });
  client.accountId = me.id;
  return me;
}

async function signInWithPasskey(client: TestClient, authenticator: SoftAuthenticator) {
  const { ceremonyId, options } = await client.ok<Options>("POST", "/api/passkeys/signin/options");
  const response = authenticator.get(options);
  return client.request<{ me?: AccountInfo; error?: string }>("POST", "/api/passkeys/signin", { ceremonyId, response });
}

// Makes the session look like it proved itself long ago.
function ageSessions(): void {
  server.app.db.prepare("UPDATE sessions SET verified_at = ?").run(Date.now() - 60 * 60 * 1000);
}

describe("an account made with a passkey", () => {
  test("has no password, and signs in again with the passkey alone — no handle typed", async () => {
    const phone = new SoftAuthenticator(server.url);
    const me = await signUpWithPasskey(new TestClient(server.url), phone, "anna", "Anna");
    expect(me).toMatchObject({ handle: "anna", name: "Anna", hasPassword: false });

    const laptop = new TestClient(server.url);
    const signedIn = await signInWithPasskey(laptop, phone);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.me?.id).toBe(me.id);
    expect((await laptop.ok<{ me: AccountInfo }>("GET", "/api/me")).me.id).toBe(me.id);
  });

  test("cannot be signed into with any password", async () => {
    await signUpWithPasskey(new TestClient(server.url), new SoftAuthenticator(server.url), "anna");
    const attempt = await new TestClient(server.url).request("POST", "/api/auth/signin", { handle: "anna", password: "" });
    expect(attempt.status).toBe(401);
  });

  test("a taken handle is refused before the browser asks for a passkey", async () => {
    await new TestClient(server.url).signUp("anna");
    const attempt = await new TestClient(server.url).request("POST", "/api/passkeys/signup/options", { handle: "anna", name: "A" });
    expect(attempt.status).toBe(409);
  });

  test("the passkey is listed with the name it was given", async () => {
    const client = new TestClient(server.url);
    await signUpWithPasskey(client, new SoftAuthenticator(server.url), "anna");
    const { passkeys } = await client.ok<{ passkeys: PasskeyInfo[] }>("GET", "/api/passkeys");
    expect(passkeys.map((p) => p.name)).toEqual(["Test phone"]);
  });
});

describe("what a passkey will not do", () => {
  test("a ceremony works once — the same response cannot be replayed", async () => {
    const phone = new SoftAuthenticator(server.url);
    await signUpWithPasskey(new TestClient(server.url), phone, "anna");
    const client = new TestClient(server.url);
    const { ceremonyId, options } = await client.ok<Options>("POST", "/api/passkeys/signin/options");
    const response = phone.get(options);
    expect((await client.request("POST", "/api/passkeys/signin", { ceremonyId, response })).status).toBe(200);
    expect((await client.request("POST", "/api/passkeys/signin", { ceremonyId, response })).status).toBe(400);
  });

  test("an assertion made for another site is refused — the phishing case", async () => {
    const phone = new SoftAuthenticator(server.url);
    await signUpWithPasskey(new TestClient(server.url), phone, "anna");
    const client = new TestClient(server.url);
    const { ceremonyId, options } = await client.ok<Options>("POST", "/api/passkeys/signin/options");
    const response = phone.get(options, "https://chronicle.evil.example");
    expect((await client.request("POST", "/api/passkeys/signin", { ceremonyId, response })).status).toBe(401);
    expect((await client.request("GET", "/api/me")).status).toBe(401);
  });

  test("a passkey without user verification (no Face ID, no PIN) is not enough", async () => {
    const client = new TestClient(server.url);
    const { ceremonyId, options } = await client.ok<Options>("POST", "/api/passkeys/signup/options", { handle: "anna", name: "A" });
    const response = new SoftAuthenticator(server.url, { userVerified: false }).create(options);
    expect((await client.request("POST", "/api/passkeys/signup", { ceremonyId, response })).status).toBe(400);
    // …and no half-made account is left behind.
    expect((await client.request("POST", "/api/passkeys/signup/options", { handle: "anna", name: "A" })).status).toBe(200);
  });

  test("a passkey the server does not know signs nobody in", async () => {
    const stranger = new SoftAuthenticator(server.url);
    stranger.create({ challenge: "x", rp: {}, user: { id: "eA" } });
    const result = await signInWithPasskey(new TestClient(server.url), stranger);
    expect(result.status).toBe(401);
  });
});

describe("adding and removing passkeys", () => {
  test("a password account adds a passkey right after signing in, then signs in with it", async () => {
    const client = new TestClient(server.url);
    const id = await client.signUp("jannik");
    const laptop = new SoftAuthenticator(server.url, { backedUp: true });
    const { ceremonyId, options } = await client.ok<Options>("POST", "/api/passkeys/options");
    const { passkeys } = await client.ok<{ passkeys: PasskeyInfo[] }>("POST", "/api/passkeys", {
      ceremonyId,
      response: laptop.create(options),
      name: "Laptop",
    });
    expect(passkeys).toMatchObject([{ name: "Laptop", backedUp: true }]);
    const signedIn = await signInWithPasskey(new TestClient(server.url), laptop);
    expect(signedIn.body.me?.id).toBe(id);
  });

  test("the same passkey cannot be added twice", async () => {
    const client = new TestClient(server.url);
    const phone = new SoftAuthenticator(server.url);
    await signUpWithPasskey(client, phone, "anna");
    const { options } = await client.ok<Options>("POST", "/api/passkeys/options");
    // The browser is told which passkeys to leave out.
    expect(options).toMatchObject({ excludeCredentials: [expect.objectContaining({ type: "public-key" })] });
  });

  test("a session that proved itself long ago must confirm first — with the password, or with a passkey", async () => {
    const client = new TestClient(server.url);
    await client.signUp("jannik");
    ageSessions();
    const refused = await client.request<{ code?: string }>("POST", "/api/passkeys/options");
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("confirm-identity");

    expect((await client.request("POST", "/api/auth/confirm", { password: "wrong password" })).status).toBe(401);
    await client.ok("POST", "/api/auth/confirm", { password: "correct horse" });
    expect((await client.request("POST", "/api/passkeys/options")).status).toBe(200);
  });

  test("confirming with a passkey works for an account that has only passkeys", async () => {
    const client = new TestClient(server.url);
    const phone = new SoftAuthenticator(server.url);
    await signUpWithPasskey(client, phone, "anna");
    ageSessions();
    expect((await client.request("POST", "/api/me/password", { next: "a new password" })).status).toBe(403);
    const { ceremonyId, options } = await client.ok<Options>("POST", "/api/auth/confirm/options");
    await client.ok("POST", "/api/auth/confirm", { ceremonyId, response: phone.get(options) });
    const { me } = await client.ok<{ me: AccountInfo }>("POST", "/api/me/password", { next: "a new password" });
    expect(me.hasPassword).toBe(true);
    await new TestClient(server.url).ok("POST", "/api/auth/signin", { handle: "anna", password: "a new password" });
  });

  test("someone else's passkey cannot confirm it's me", async () => {
    const anna = new TestClient(server.url);
    const annasPhone = new SoftAuthenticator(server.url);
    await signUpWithPasskey(anna, annasPhone, "anna");
    const mallory = new TestClient(server.url);
    const mallorysPhone = new SoftAuthenticator(server.url);
    await signUpWithPasskey(mallory, mallorysPhone, "mallory");
    const { ceremonyId, options } = await anna.ok<Options>("POST", "/api/auth/confirm/options");
    // Mallory's authenticator has none of Anna's allowed credentials.
    expect(() => mallorysPhone.get(options)).toThrow();
    const forged = mallorysPhone.get({ challenge: options.challenge, rpId: options.rpId });
    expect((await anna.request("POST", "/api/auth/confirm", { ceremonyId, response: forged })).status).toBe(401);
  });

  test("the last way in cannot be removed", async () => {
    const client = new TestClient(server.url);
    await signUpWithPasskey(client, new SoftAuthenticator(server.url), "anna");
    const { passkeys } = await client.ok<{ passkeys: PasskeyInfo[] }>("GET", "/api/passkeys");
    expect((await client.request("DELETE", `/api/passkeys/${passkeys[0].id}`)).status).toBe(400);
    await client.ok("POST", "/api/me/password", { next: "a password now" });
    const after = await client.ok<{ passkeys: PasskeyInfo[] }>("DELETE", `/api/passkeys/${passkeys[0].id}`);
    expect(after.passkeys).toEqual([]);
  });

  test("a removed passkey signs nobody in", async () => {
    const client = new TestClient(server.url);
    await client.signUp("jannik");
    const laptop = new SoftAuthenticator(server.url);
    const { ceremonyId, options } = await client.ok<Options>("POST", "/api/passkeys/options");
    const { passkeys } = await client.ok<{ passkeys: PasskeyInfo[] }>("POST", "/api/passkeys", { ceremonyId, response: laptop.create(options) });
    await client.ok("DELETE", `/api/passkeys/${passkeys[0].id}`);
    expect((await signInWithPasskey(new TestClient(server.url), laptop)).status).toBe(401);
  });

  test("renaming", async () => {
    const client = new TestClient(server.url);
    await signUpWithPasskey(client, new SoftAuthenticator(server.url), "anna");
    const [passkey] = (await client.ok<{ passkeys: PasskeyInfo[] }>("GET", "/api/passkeys")).passkeys;
    const { passkeys } = await client.ok<{ passkeys: PasskeyInfo[] }>("PATCH", `/api/passkeys/${passkey.id}`, { name: "Anna's iPhone" });
    expect(passkeys[0].name).toBe("Anna's iPhone");
  });

  test("deleting a passkey-only account needs a recent confirmation", async () => {
    const client = new TestClient(server.url);
    const phone = new SoftAuthenticator(server.url);
    await signUpWithPasskey(client, phone, "anna");
    ageSessions();
    expect((await client.request("DELETE", "/api/me", {})).status).toBe(403);
    const { ceremonyId, options } = await client.ok<Options>("POST", "/api/auth/confirm/options");
    await client.ok("POST", "/api/auth/confirm", { ceremonyId, response: phone.get(options) });
    await client.ok("DELETE", "/api/me", {});
    expect((await signInWithPasskey(new TestClient(server.url), phone)).status).toBe(401);
  });
});

describe("behind the production proxy", () => {
  test("passkey sign-in, like password sign-in, needs HTTPS", async () => {
    const proxied = await startTestServer({ trustProxy: true });
    try {
      const response = await fetch(`${proxied.url}/api/passkeys/signin/options`, {
        method: "POST",
        headers: { "x-chronicle": "1", "x-forwarded-proto": "http" },
      });
      expect(response.status).toBe(403);
    } finally {
      await proxied.close();
    }
  });
});
