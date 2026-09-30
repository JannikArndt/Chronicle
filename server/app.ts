// The HTTP application: routing, the API, and the static client — everything
// except opening a port, which `main.ts` does. Tests build one of these on an
// in-memory database and listen on port 0.

import { Auth, RateLimiter, accountInfo } from "./auth";
import { openDatabase } from "./db";
import { HttpError, Router, clientAddress, isSecureRequest, readJson, sendError, sendJson } from "./http";
import { Hub } from "./hub";
import { Passkeys, passkeyName } from "./passkeys";
import { RecordStore } from "./records";
import { Social, parseRole, parseSubject } from "./social";
import { SyncService } from "./sync";
import { createStaticSite, SECURITY_HEADERS } from "./static";
import { ID_PATTERN } from "./validate";
import { CSRF_HEADER, ERROR_CONFIRM_IDENTITY, HANDLE_PATTERN, MIN_PASSWORD_LENGTH } from "../src/sync/protocol";
import type { Database } from "./db";
import type { RequestContext } from "./http";
import type { RelyingParty } from "./passkeys";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PushRecord } from "../src/sync/protocol";

export interface AppConfig {
  // Where chronicle.db lives; ":memory:" in tests.
  dataDir: string;
  // The built client (dist/). Undefined in tests and in `npm run dev`, where
  // Vite serves the client and proxies /api here.
  staticDir?: string;
  buildId: string;
  version: string;
  // Honour X-Forwarded-Proto/-For. True behind CapRover's nginx.
  trustProxy: boolean;
  // Attempts per address per window. Tests raise them; production keeps the
  // defaults.
  limits?: { signUpsPerHour?: number; signInsPer10Min?: number };
  // scrypt's cost parameter. Tests lower it; production keeps the default.
  passwordCost?: number;
  // The app's own origin (https://chronicle.timpanini.com), which every
  // passkey is bound to. Unset, it is read off each request — which is right
  // behind a proxy that passes the Host header on, and in development.
  publicOrigin?: string;
}

export interface App {
  handle(req: IncomingMessage, res: ServerResponse): void;
  close(): void;
  db: Database;
}

const STARTED_AT = new Date().toISOString();
const MAX_NAME_LENGTH = 60;
const MAX_PASSWORD_LENGTH = 200;
const MAX_PUSH_RECORDS = 5000;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function checkName(value: unknown): string {
  const name = text(value);
  if (name === "" || name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `Your name needs 1 to ${MAX_NAME_LENGTH} characters.`);
  }
  return name;
}

function checkPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return value;
}

function checkHandle(value: unknown): string {
  const handle = text(value).toLowerCase();
  if (!HANDLE_PATTERN.test(handle)) {
    throw new HttpError(400, "Handles are 3 to 32 characters: letters, digits, dots, dashes or underscores.");
  }
  return handle;
}

function checkId(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new HttpError(400, "Invalid id.");
  return value;
}

export function createApp(config: AppConfig): App {
  const db = openDatabase(config.dataDir);
  const auth = new Auth(db, config.trustProxy, config.passwordCost);
  const store = new RecordStore(db);
  const passkeys = new Passkeys(db);
  const hub = new Hub(config.buildId);
  // Social and SyncService need each other's names and broadcasts; the
  // names lookup is late-bound to break the cycle.
  let social!: Social;
  const sync = new SyncService(store, hub, { nameOf: (id) => social.nameOf(id) });
  social = new Social(db, store, sync, hub);
  hub.presence = {
    relevantAccounts: (accountId) => social.relevantAccounts(accountId),
    canRead: (viewer, recordId) => store.canRead(viewer, recordId),
  };

  const signUpLimit = new RateLimiter(config.limits?.signUpsPerHour ?? 10, 60 * 60 * 1000);
  const signInLimit = new RateLimiter(config.limits?.signInsPer10Min ?? 20, 10 * 60 * 1000);
  const tokenLimit = new RateLimiter(120, 60 * 1000);

  const router = new Router();
  const site = createStaticSite(config.staticDir, config.buildId);
  const address = (req: IncomingMessage) => clientAddress(req, config.trustProxy);
  // Behind the production proxy, a password never travels in the clear: if
  // HTTPS is not switched on for the app yet, signing in says so instead of
  // quietly working over plain HTTP. (Local development talks to the server
  // directly, without the proxy, and is not affected.)
  const requireHttps = (req: IncomingMessage) => {
    if (config.trustProxy && !isSecureRequest(req, true)) {
      throw new HttpError(403, "Chronicle only signs in over HTTPS — switch HTTPS on for this app first.");
    }
  };

  // Changes that could take an account over — a new passkey, a new password,
  // deleting it — need a session that proved who it is in the last few
  // minutes. The client answers this error by asking for a passkey or the
  // password, then tries again.
  const requireRecentlyVerified = (req: IncomingMessage) => {
    if (!auth.isRecentlyVerified(req)) {
      throw new HttpError(403, "Confirm it’s you first.", ERROR_CONFIRM_IDENTITY);
    }
  };

  const relyingParty = (req: IncomingMessage): RelyingParty => {
    const origin =
      config.publicOrigin ??
      `${isSecureRequest(req, config.trustProxy) ? "https" : "http"}://${String(req.headers.host ?? "localhost")}`;
    const url = new URL(origin);
    return { origin: url.origin, rpID: url.hostname };
  };

  // ---------- version ----------

  // `build` says the code changed; `schema` says a stored shape changed too.
  router.on("GET", "/version", ({ req, res }) => {
    sendJson(req, res, 200, { version: config.version, schema: 2, build: config.buildId, startedAt: STARTED_AT });
  });
  router.on("GET", "/healthz", ({ req, res }) => sendJson(req, res, 200, { ok: true }));

  // ---------- accounts ----------

  router.on("POST", "/api/auth/signup", async ({ req, res }) => {
    requireHttps(req);
    signUpLimit.hit(address(req));
    const body = await readJson<{ handle?: unknown; password?: unknown; name?: unknown }>(req);
    const handle = checkHandle(body.handle);
    const account = await auth.createAccount(handle, checkPassword(body.password), checkName(body.name));
    auth.startSession(req, res, account.id);
    sendJson(req, res, 201, { me: accountInfo(account) });
  });

  router.on("POST", "/api/auth/signin", async ({ req, res }) => {
    requireHttps(req);
    const body = await readJson<{ handle?: unknown; password?: unknown }>(req);
    const handle = text(body.handle).toLowerCase();
    signInLimit.hit(address(req));
    signInLimit.hit(`handle:${handle}`);
    const account = typeof body.password === "string" ? await auth.checkPassword(handle, body.password) : null;
    if (account === null) throw new HttpError(401, "That handle and password do not match.");
    auth.startSession(req, res, account.id);
    sendJson(req, res, 200, { me: accountInfo(account) });
  });

  router.on("POST", "/api/auth/signout", ({ req, res }) => {
    auth.endSession(req, res);
    sendJson(req, res, 200, { ok: true });
  });

  router.on("GET", "/api/me", ({ req, res }) => {
    sendJson(req, res, 200, { me: accountInfo(auth.require(req)) });
  });

  router.on("PATCH", "/api/me", async ({ req, res }) => {
    const account = auth.require(req);
    const body = await readJson<{ name?: unknown; selfGroupId?: unknown }>(req);
    if (body.name !== undefined) {
      const name = checkName(body.name);
      db.prepare("UPDATE accounts SET name = ? WHERE id = ?").run(name, account.id);
      hub.rename(account.id, name);
      for (const account2 of [account.id, ...social.connectionsOf(account.id)]) hub.send(account2, { type: "social" });
    }
    if (body.selfGroupId !== undefined) {
      const selfGroupId = body.selfGroupId === null ? null : checkId(body.selfGroupId);
      db.prepare("UPDATE accounts SET self_group_id = ? WHERE id = ?").run(selfGroupId, account.id);
    }
    sendJson(req, res, 200, { me: accountInfo(auth.require(req)) });
  });

  // Set or change the password. With the current password in the body that
  // is proof enough; without one (an account that has only passkeys, or
  // someone who just confirmed with a passkey) the session must have proved
  // itself recently.
  router.on("POST", "/api/me/password", async ({ req, res }) => {
    const account = auth.require(req);
    const body = await readJson<{ current?: unknown; next?: unknown }>(req);
    signInLimit.hit(`handle:${account.handle}`);
    const next = checkPassword(body.next);
    if (typeof body.current === "string" && body.current !== "") {
      if ((await auth.checkPassword(account.handle, body.current)) === null) {
        throw new HttpError(401, "Your current password is not right.");
      }
    } else {
      requireRecentlyVerified(req);
    }
    await auth.setPassword(account.id, next);
    auth.endOtherSessions(req, account.id);
    sendJson(req, res, 200, { me: accountInfo(auth.require(req)) });
  });

  router.on("DELETE", "/api/me", async ({ req, res }) => {
    const account = auth.require(req);
    const body = await readJson<{ password?: unknown }>(req);
    signInLimit.hit(`handle:${account.handle}`);
    if (typeof body.password === "string" && body.password !== "") {
      if ((await auth.checkPassword(account.handle, body.password)) === null) {
        throw new HttpError(401, "Your password is not right.");
      }
    } else {
      requireRecentlyVerified(req);
    }
    social.deleteAccount(account.id);
    auth.endSession(req, res);
    sendJson(req, res, 200, { ok: true });
  });

  // Confirm it's you: a password or a passkey, and for the next few minutes
  // this session may make the changes `requireRecentlyVerified` guards.
  router.on("POST", "/api/auth/confirm/options", async ({ req, res }) => {
    const account = auth.require(req);
    sendJson(req, res, 200, await passkeys.reauthOptions(relyingParty(req), account.id));
  });

  router.on("POST", "/api/auth/confirm", async ({ req, res }) => {
    const account = auth.require(req);
    const body = await readJson<{ password?: unknown; ceremonyId?: unknown; response?: unknown }>(req);
    signInLimit.hit(`handle:${account.handle}`);
    if (typeof body.password === "string") {
      if ((await auth.checkPassword(account.handle, body.password)) === null) {
        throw new HttpError(401, "Your password is not right.");
      }
    } else {
      await passkeys.reauth(relyingParty(req), account.id, body.ceremonyId, body.response);
    }
    auth.markVerified(req);
    sendJson(req, res, 200, { ok: true });
  });

  // ---------- passkeys ----------

  // A new account with a passkey and no password. The handle is checked
  // before the browser asks for Face ID, so nobody makes a passkey for an
  // account that then cannot be created.
  router.on("POST", "/api/passkeys/signup/options", async ({ req, res }) => {
    requireHttps(req);
    signUpLimit.hit(address(req));
    const body = await readJson<{ handle?: unknown; name?: unknown }>(req);
    const handle = checkHandle(body.handle);
    const name = checkName(body.name);
    if (auth.isHandleTaken(handle)) throw new HttpError(409, "That handle is taken — pick another one.");
    sendJson(req, res, 200, await passkeys.signUpOptions(relyingParty(req), handle, name));
  });

  router.on("POST", "/api/passkeys/signup", async ({ req, res }) => {
    requireHttps(req);
    const body = await readJson<{ ceremonyId?: unknown; response?: unknown; passkeyName?: unknown }>(req);
    const verified = await passkeys.verifySignUp(relyingParty(req), body.ceremonyId, body.response);
    const account = await auth.createAccount(verified.handle, null, verified.name, verified.accountId);
    try {
      verified.attach(passkeyName(body.passkeyName, "Passkey"));
    } catch (error) {
      // An account with no password and no passkey could never be signed
      // into again; it must not exist.
      db.prepare("DELETE FROM accounts WHERE id = ?").run(account.id);
      throw error;
    }
    auth.startSession(req, res, account.id);
    sendJson(req, res, 201, { me: accountInfo(account) });
  });

  router.on("POST", "/api/passkeys/signin/options", async ({ req, res }) => {
    requireHttps(req);
    tokenLimit.hit(address(req));
    sendJson(req, res, 200, await passkeys.signInOptions(relyingParty(req)));
  });

  router.on("POST", "/api/passkeys/signin", async ({ req, res }) => {
    requireHttps(req);
    signInLimit.hit(address(req));
    const body = await readJson<{ ceremonyId?: unknown; response?: unknown }>(req);
    const accountId = await passkeys.signIn(relyingParty(req), body.ceremonyId, body.response);
    const account = auth.account(accountId);
    if (account === null) throw new HttpError(401, "This passkey is not registered with Chronicle — it may have been removed.");
    auth.startSession(req, res, account.id);
    sendJson(req, res, 200, { me: accountInfo(account) });
  });

  router.on("GET", "/api/passkeys", ({ req, res }) => {
    sendJson(req, res, 200, { passkeys: passkeys.list(auth.require(req).id) });
  });

  router.on("POST", "/api/passkeys/options", async ({ req, res }) => {
    const account = auth.require(req);
    requireRecentlyVerified(req);
    const user = { accountId: account.id, handle: account.handle, name: account.name };
    sendJson(req, res, 200, await passkeys.addOptions(relyingParty(req), user));
  });

  router.on("POST", "/api/passkeys", async ({ req, res }) => {
    const account = auth.require(req);
    requireRecentlyVerified(req);
    const body = await readJson<{ ceremonyId?: unknown; response?: unknown; name?: unknown }>(req);
    await passkeys.add(relyingParty(req), account.id, body.ceremonyId, body.response, passkeyName(body.name, "Passkey"));
    sendJson(req, res, 201, { passkeys: passkeys.list(account.id) });
  });

  router.on("PATCH", "/api/passkeys/:id", async ({ req, res, params }) => {
    const account = auth.require(req);
    const body = await readJson<{ name?: unknown }>(req);
    passkeys.rename(account.id, params.id, passkeyName(body.name, "Passkey"));
    sendJson(req, res, 200, { passkeys: passkeys.list(account.id) });
  });

  router.on("DELETE", "/api/passkeys/:id", ({ req, res, params }) => {
    const account = auth.require(req);
    requireRecentlyVerified(req);
    passkeys.remove(account.id, params.id, account.hasPassword);
    sendJson(req, res, 200, { passkeys: passkeys.list(account.id) });
  });

  // ---------- records ----------

  router.on("GET", "/api/pull", ({ req, res }) => {
    const account = auth.require(req);
    sendJson(req, res, 200, { me: accountInfo(account), ...sync.pull(account.id) });
  });

  router.on("POST", "/api/push", async ({ req, res }) => {
    const account = auth.require(req);
    const body = await readJson<{ records?: unknown; connectionId?: unknown }>(req);
    if (!Array.isArray(body.records)) throw new HttpError(400, "Expected records.");
    if (body.records.length > MAX_PUSH_RECORDS) throw new HttpError(413, "Too many records in one push.");
    const origin =
      typeof body.connectionId === "string" && hub.owns(body.connectionId, account.id) ? body.connectionId : undefined;
    const results = sync.push(account.id, body.records as PushRecord[], origin);
    sendJson(req, res, 200, { results });
  });

  router.on("GET", "/api/events", ({ req, res }) => {
    const account = auth.require(req);
    hub.open(req, res, account.id, account.name);
  });

  router.on("POST", "/api/presence", async ({ req, res }) => {
    const account = auth.require(req);
    const body = await readJson<{ connectionId?: unknown; focusId?: unknown }>(req);
    if (typeof body.connectionId !== "string" || !hub.owns(body.connectionId, account.id)) {
      throw new HttpError(404, "No such connection.");
    }
    hub.setFocus(body.connectionId, body.focusId === null || body.focusId === undefined ? null : checkId(body.focusId));
    sendJson(req, res, 200, { ok: true });
  });

  // ---------- people ----------

  router.on("GET", "/api/people", ({ req, res }) => {
    sendJson(req, res, 200, social.people(auth.require(req).id));
  });
  const personRoute = (action: (accountId: string, other: string) => void) => (ctx: RequestContext) => {
    const account = auth.require(ctx.req);
    action(account.id, checkId(ctx.params.id));
    sendJson(ctx.req, ctx.res, 200, social.people(account.id));
  };
  router.on("POST", "/api/people/:id/request", personRoute((a, b) => social.request(a, b)));
  router.on("POST", "/api/people/:id/accept", personRoute((a, b) => social.accept(a, b)));
  router.on("POST", "/api/people/:id/decline", personRoute((a, b) => social.decline(a, b)));
  router.on("POST", "/api/people/:id/dismiss", personRoute((a, b) => social.dismiss(a, b)));
  router.on("DELETE", "/api/people/:id", personRoute((a, b) => social.disconnect(a, b)));

  // ---------- grants ----------

  router.on("GET", "/api/grants", ({ req, res }) => {
    sendJson(req, res, 200, social.grants(auth.require(req).id));
  });

  router.on("POST", "/api/grants", async ({ req, res }) => {
    const account = auth.require(req);
    const body = await readJson<{ granteeId?: unknown; subject?: unknown; role?: unknown }>(req);
    social.grant(account.id, checkId(body.granteeId), parseSubject(body.subject), parseRole(body.role));
    sendJson(req, res, 200, social.grants(account.id));
  });

  router.on("DELETE", "/api/grants/:id", ({ req, res, params }) => {
    const account = auth.require(req);
    social.revoke(account.id, params.id);
    sendJson(req, res, 200, social.grants(account.id));
  });

  // ---------- invites ----------
  // Tokens travel in request bodies, never in URLs: a URL ends up in access
  // logs, and an invite token is a working key until it is used.

  router.on("GET", "/api/invites", ({ req, res }) => {
    sendJson(req, res, 200, { invites: social.invites(auth.require(req).id) });
  });

  router.on("POST", "/api/invites", async ({ req, res }) => {
    const account = auth.require(req);
    const body = await readJson<{ subject?: unknown; role?: unknown }>(req);
    const subject = body.subject === null || body.subject === undefined ? null : parseSubject(body.subject);
    const role = subject === null ? null : parseRole(body.role);
    sendJson(req, res, 201, social.createInvite(account.id, subject, role));
  });

  router.on("DELETE", "/api/invites/:id", ({ req, res, params }) => {
    const account = auth.require(req);
    social.cancelInvite(account.id, params.id);
    sendJson(req, res, 200, { invites: social.invites(account.id) });
  });

  router.on("POST", "/api/invite/preview", async ({ req, res }) => {
    tokenLimit.hit(address(req));
    const body = await readJson<{ token?: unknown }>(req);
    sendJson(req, res, 200, social.previewInvite(text(body.token)));
  });

  router.on("POST", "/api/invite/redeem", async ({ req, res }) => {
    const account = auth.require(req);
    tokenLimit.hit(address(req));
    const body = await readJson<{ token?: unknown }>(req);
    sendJson(req, res, 200, social.redeemInvite(account.id, text(body.token)));
  });

  // ---------- public links ----------

  router.on("GET", "/api/links", ({ req, res }) => {
    sendJson(req, res, 200, { links: social.publicLinks(auth.require(req).id) });
  });

  router.on("POST", "/api/links", async ({ req, res }) => {
    const account = auth.require(req);
    const body = await readJson<{ subject?: unknown }>(req);
    sendJson(req, res, 201, social.createPublicLink(account.id, parseSubject(body.subject)));
  });

  router.on("DELETE", "/api/links/:id", ({ req, res, params }) => {
    const account = auth.require(req);
    social.deletePublicLink(account.id, params.id);
    sendJson(req, res, 200, { links: social.publicLinks(account.id) });
  });

  router.on("POST", "/api/public", async ({ req, res }) => {
    tokenLimit.hit(address(req));
    const body = await readJson<{ token?: unknown }>(req);
    sendJson(req, res, 200, social.publicView(text(body.token)));
  });

  // ---------- dispatch ----------

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    if (isSecureRequest(req, config.trustProxy)) res.setHeader("strict-transport-security", "max-age=31536000");

    const method = req.method ?? "GET";
    const isApi = pathname.startsWith("/api/");
    if (isApi && method !== "GET" && method !== "HEAD" && req.headers[CSRF_HEADER] !== "1") {
      sendError(req, res, 403, "Missing the X-Chronicle header.");
      return;
    }

    const matched = router.match(method, pathname);
    if (matched === "wrong-method") {
      sendError(req, res, 405, "Method not allowed.");
      return;
    }
    if (matched !== null) {
      // Async wrapper, so a handler that throws before its first await is
      // answered like one that rejects later.
      (async () => matched.handler({ req, res, url, params: matched.params }))().catch((error: unknown) => {
        if (error instanceof HttpError) {
          sendError(req, res, error.status, error.message, error.code);
          return;
        }
        console.error(`${method} ${pathname} failed:`, error);
        sendError(req, res, 500, "Something went wrong on the server.");
      });
      return;
    }
    if (isApi) {
      sendError(req, res, 404, "No such endpoint.");
      return;
    }
    if (!site.serve(req, res, pathname)) sendError(req, res, 404, "Not found.");
  };

  return {
    handle,
    db,
    close() {
      hub.closeAll();
      db.close();
    },
  };
}
