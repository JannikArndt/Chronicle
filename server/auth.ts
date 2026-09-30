// Accounts and sessions.
//
// A handle and a password — no email, so there is no mail server to run and
// no address on file to leak. The password is stored as scrypt; the session is
// a random 256-bit token in an HttpOnly cookie, stored as its SHA-256 so a copy
// of the database does not sign anyone in.

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { HttpError, isSecureRequest, parseCookies } from "./http";
import type { Database } from "./db";
import type { AccountInfo } from "../src/sync/protocol";
import type { IncomingMessage, ServerResponse } from "node:http";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const SESSION_COOKIE = "chronicle_session";
const SESSION_MAX_AGE_S = 365 * 24 * 60 * 60;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

export interface Account {
  id: string;
  handle: string;
  name: string;
  selfGroupId: string | null;
}

export function accountInfo(account: Account): AccountInfo {
  return {
    id: account.id,
    handle: account.handle,
    name: account.name,
    ...(account.selfGroupId === null ? {} : { selfGroupId: account.selfGroupId }),
  };
}

export async function hashPassword(password: string, cost = SCRYPT.N): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, { ...SCRYPT, N: cost });
  return `scrypt$${cost}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Every failed sign-in costs the same scrypt as a successful one, including
// for a handle that does not exist — otherwise the response time says which
// handles are taken.
const dummyHashes = new Map<number, Promise<string>>();
function dummyPasswordHash(cost: number): Promise<string> {
  let hash = dummyHashes.get(cost);
  if (hash === undefined) dummyHashes.set(cost, (hash = hashPassword(randomUUID(), cost)));
  return hash;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

interface AccountRow {
  id: string;
  handle: string;
  name: string;
  password_hash: string;
  self_group_id: string | null;
}

function toAccount(row: AccountRow): Account {
  return { id: row.id, handle: row.handle, name: row.name, selfGroupId: row.self_group_id };
}

export class Auth {
  constructor(
    private readonly db: Database,
    private readonly trustProxy: boolean,
    private readonly passwordCost: number = SCRYPT.N,
  ) {}

  async createAccount(handle: string, password: string, name: string): Promise<Account> {
    const existing = this.db.prepare("SELECT 1 FROM accounts WHERE handle = ?").get(handle);
    if (existing !== undefined) throw new HttpError(409, "That handle is taken — pick another one.");
    const id = randomUUID();
    const passwordHash = await hashPassword(password, this.passwordCost);
    try {
      this.db
        .prepare("INSERT INTO accounts (id, handle, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, handle, name, passwordHash, Date.now());
    } catch {
      // Two sign-ups racing for the same handle across the scrypt above.
      throw new HttpError(409, "That handle is taken — pick another one.");
    }
    return { id, handle, name, selfGroupId: null };
  }

  async checkPassword(handle: string, password: string): Promise<Account | null> {
    const row = this.db.prepare("SELECT * FROM accounts WHERE handle = ?").get(handle) as AccountRow | undefined;
    if (row === undefined) {
      await verifyPassword(password, await dummyPasswordHash(this.passwordCost));
      return null;
    }
    return (await verifyPassword(password, row.password_hash)) ? toAccount(row) : null;
  }

  async setPassword(accountId: string, password: string): Promise<void> {
    this.db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(await hashPassword(password, this.passwordCost), accountId);
  }

  account(accountId: string): Account | null {
    const row = this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId) as AccountRow | undefined;
    return row === undefined ? null : toAccount(row);
  }

  startSession(req: IncomingMessage, res: ServerResponse, accountId: string): void {
    const token = newToken();
    const now = Date.now();
    this.db
      .prepare("INSERT INTO sessions (token_hash, account_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)")
      .run(sha256(token), accountId, now, now);
    this.setCookie(req, res, token, SESSION_MAX_AGE_S);
  }

  endSession(req: IncomingMessage, res: ServerResponse): void {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token !== undefined) this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    this.setCookie(req, res, "", 0);
  }

  // Every session of the account except the one making the request — what a
  // password change does, so a stolen session dies with the old password.
  endOtherSessions(req: IncomingMessage, accountId: string): void {
    const token = parseCookies(req)[SESSION_COOKIE] ?? "";
    this.db.prepare("DELETE FROM sessions WHERE account_id = ? AND token_hash != ?").run(accountId, sha256(token));
  }

  authenticate(req: IncomingMessage): Account | null {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token === undefined || token === "") return null;
    const hash = sha256(token);
    const session = this.db.prepare("SELECT account_id, last_seen_at FROM sessions WHERE token_hash = ?").get(hash) as
      | { account_id: string; last_seen_at: number }
      | undefined;
    if (session === undefined) return null;
    const now = Date.now();
    if (now - session.last_seen_at > TOUCH_INTERVAL_MS) {
      this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(now, hash);
    }
    return this.account(session.account_id);
  }

  require(req: IncomingMessage): Account {
    const account = this.authenticate(req);
    if (account === null) throw new HttpError(401, "Not signed in.");
    return account;
  }

  private setCookie(req: IncomingMessage, res: ServerResponse, value: string, maxAgeS: number): void {
    const parts = [
      `${SESSION_COOKIE}=${value}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${maxAgeS}`,
    ];
    // Secure whenever the browser is talking HTTPS — which in production is
    // always (CapRover terminates TLS). Plain-HTTP localhost keeps working.
    if (isSecureRequest(req, this.trustProxy)) parts.push("Secure");
    res.setHeader("set-cookie", parts.join("; "));
  }
}

// A fixed window per key. In memory on purpose: one process, and a restart
// forgetting the counts is harmless next to scrypt's own cost per attempt.
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string): void {
    const now = Date.now();
    const window = this.windows.get(key);
    if (window === undefined || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.windows.size > 10_000) this.sweep(now);
      return;
    }
    window.count += 1;
    if (window.count > this.limit) {
      throw new HttpError(429, "Too many attempts — wait a few minutes and try again.");
    }
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}
