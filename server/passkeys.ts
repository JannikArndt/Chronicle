// Passkeys (WebAuthn): make an account with one, sign in with one, add and
// remove them, and confirm it's you with one.
//
// The cryptography — attestation and assertion parsing, signature checks,
// challenge/origin/RP-ID matching, the signature counter — is
// @simplewebauthn/server, bundled into the server by esbuild. This file only
// decides what a ceremony is for and what it may do.
//
// Every ceremony is a server-side record holding its challenge, used once
// and gone after five minutes: an options request hands out a ceremony id,
// the matching verify request consumes it. A challenge the browser never
// asked for, or one used twice, verifies nothing.

import { randomUUID } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { HttpError } from "./http";
import type { Database } from "./db";
import type { PasskeyInfo } from "../src/sync/protocol";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from "@simplewebauthn/server";

const CEREMONY_TTL_MS = 5 * 60 * 1000;
const RP_NAME = "Chronicle";
const MAX_PASSKEYS_PER_ACCOUNT = 20;
const MAX_NAME_LENGTH = 60;

// Where the browser says it is, which the signed client data must match.
// `origin` is scheme + host (+ port); the RP ID is its host name.
export interface RelyingParty {
  origin: string;
  rpID: string;
}

type Ceremony =
  | { kind: "signup"; challenge: string; accountId: string; handle: string; name: string; expiresAt: number }
  | { kind: "register"; challenge: string; accountId: string; expiresAt: number }
  | { kind: "signin"; challenge: string; expiresAt: number }
  | { kind: "reauth"; challenge: string; accountId: string; expiresAt: number };

interface PasskeyRow {
  id: string;
  account_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string;
  backed_up: number;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

function toInfo(row: PasskeyRow): PasskeyInfo {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    backedUp: row.backed_up === 1,
  };
}

// Transports are a hint the browser gives back to the authenticator later
// ("try the phone over Bluetooth"); only the known strings are kept.
const TRANSPORTS = new Set(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);

export function passkeyName(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? value.trim().slice(0, MAX_NAME_LENGTH) : "";
  return name === "" ? fallback : name;
}

export class Passkeys {
  private readonly ceremonies = new Map<string, Ceremony>();

  constructor(private readonly db: Database) {}

  // ---------- ceremonies ----------

  private remember(ceremony: Ceremony): string {
    const now = Date.now();
    for (const [id, existing] of this.ceremonies) if (existing.expiresAt <= now) this.ceremonies.delete(id);
    const id = randomUUID();
    this.ceremonies.set(id, ceremony);
    return id;
  }

  // Single use: whatever happens next, this ceremony is spent.
  private take<K extends Ceremony["kind"]>(id: unknown, kind: K): Extract<Ceremony, { kind: K }> {
    const ceremony = typeof id === "string" ? this.ceremonies.get(id) : undefined;
    if (typeof id === "string") this.ceremonies.delete(id);
    if (ceremony === undefined || ceremony.kind !== kind || ceremony.expiresAt <= Date.now()) {
      throw new HttpError(400, "That took too long, or was already used — please try again.");
    }
    return ceremony as Extract<Ceremony, { kind: K }>;
  }

  // ---------- storage ----------

  list(accountId: string): PasskeyInfo[] {
    const rows = this.db
      .prepare("SELECT * FROM passkeys WHERE account_id = ? ORDER BY created_at")
      .all(accountId) as unknown as PasskeyRow[];
    return rows.map(toInfo);
  }

  count(accountId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE account_id = ?").get(accountId) as { n: number }).n;
  }

  private row(id: string): PasskeyRow | undefined {
    return this.db.prepare("SELECT * FROM passkeys WHERE id = ?").get(id) as PasskeyRow | undefined;
  }

  private credential(row: PasskeyRow): WebAuthnCredential {
    return {
      id: row.id,
      publicKey: new Uint8Array(row.public_key),
      counter: row.counter,
      transports: JSON.parse(row.transports) as string[],
    };
  }

  rename(accountId: string, id: string, name: string): void {
    this.db.prepare("UPDATE passkeys SET name = ? WHERE id = ? AND account_id = ?").run(name, id, accountId);
  }

  // Refuses to remove an account's last way in.
  remove(accountId: string, id: string, hasPassword: boolean): void {
    const row = this.row(id);
    if (row === undefined || row.account_id !== accountId) throw new HttpError(404, "No such passkey.");
    if (!hasPassword && this.count(accountId) <= 1) {
      throw new HttpError(400, "This is your only way to sign in — add another passkey or set a password first.");
    }
    this.db.prepare("DELETE FROM passkeys WHERE id = ?").run(id);
  }

  private store(accountId: string, credential: WebAuthnCredential, backedUp: boolean, name: string): void {
    const transports = (credential.transports ?? []).filter((transport) => TRANSPORTS.has(transport));
    this.db
      .prepare(
        "INSERT INTO passkeys (id, account_id, public_key, counter, transports, backed_up, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(credential.id, accountId, credential.publicKey, credential.counter, JSON.stringify(transports), backedUp ? 1 : 0, name, Date.now());
  }

  // ---------- registration: a new account, or another passkey ----------

  private registrationOptions(
    rp: RelyingParty,
    user: { accountId: string; handle: string; name: string },
    exclude: PasskeyRow[],
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rp.rpID,
      // The account id, not the handle: it never changes and says nothing
      // about the person, and it is what the authenticator hands back.
      userID: new TextEncoder().encode(user.accountId),
      userName: user.handle,
      userDisplayName: user.name,
      attestationType: "none",
      excludeCredentials: exclude.map((row) => ({ id: row.id, transports: JSON.parse(row.transports) as string[] })),
      // A discoverable credential is what lets "Sign in with a passkey"
      // work without typing a handle first; user verification (Face ID, a
      // fingerprint, a PIN) is what makes a passkey on its own enough.
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
  }

  async signUpOptions(
    rp: RelyingParty,
    handle: string,
    name: string,
  ): Promise<{ ceremonyId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const accountId = randomUUID();
    const options = await this.registrationOptions(rp, { accountId, handle, name }, []);
    const ceremonyId = this.remember({
      kind: "signup",
      challenge: options.challenge,
      accountId,
      handle,
      name,
      expiresAt: Date.now() + CEREMONY_TTL_MS,
    });
    return { ceremonyId, options };
  }

  // Verifies the new passkey; the caller creates the account it belongs to
  // and then calls `attach` — or nothing is stored at all.
  async verifySignUp(
    rp: RelyingParty,
    ceremonyId: unknown,
    response: unknown,
  ): Promise<{ accountId: string; handle: string; name: string; attach: (passkeyName: string) => void }> {
    const ceremony = this.take(ceremonyId, "signup");
    const { credential, backedUp } = await this.verifyRegistration(rp, ceremony.challenge, response);
    return {
      accountId: ceremony.accountId,
      handle: ceremony.handle,
      name: ceremony.name,
      attach: (passkeyName) => this.store(ceremony.accountId, credential, backedUp, passkeyName),
    };
  }

  async addOptions(
    rp: RelyingParty,
    user: { accountId: string; handle: string; name: string },
  ): Promise<{ ceremonyId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const existing = this.db.prepare("SELECT * FROM passkeys WHERE account_id = ?").all(user.accountId) as unknown as PasskeyRow[];
    if (existing.length >= MAX_PASSKEYS_PER_ACCOUNT) throw new HttpError(400, "That is enough passkeys for one account.");
    const options = await this.registrationOptions(rp, user, existing);
    const ceremonyId = this.remember({
      kind: "register",
      challenge: options.challenge,
      accountId: user.accountId,
      expiresAt: Date.now() + CEREMONY_TTL_MS,
    });
    return { ceremonyId, options };
  }

  async add(rp: RelyingParty, accountId: string, ceremonyId: unknown, response: unknown, name: string): Promise<void> {
    const ceremony = this.take(ceremonyId, "register");
    if (ceremony.accountId !== accountId) throw new HttpError(400, "That passkey was started by someone else.");
    const { credential, backedUp } = await this.verifyRegistration(rp, ceremony.challenge, response);
    this.store(accountId, credential, backedUp, name);
  }

  private async verifyRegistration(
    rp: RelyingParty,
    challenge: string,
    response: unknown,
  ): Promise<{ credential: WebAuthnCredential; backedUp: boolean }> {
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      });
    } catch (error) {
      throw new HttpError(400, `That passkey could not be verified: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    if (!verification.verified) throw new HttpError(400, "That passkey could not be verified.");
    const { credential, credentialBackedUp } = verification.registrationInfo;
    if (this.row(credential.id) !== undefined) throw new HttpError(409, "That passkey is already registered.");
    return { credential, backedUp: credentialBackedUp };
  }

  // ---------- authentication: signing in, or confirming it's you ----------

  async signInOptions(rp: RelyingParty): Promise<{ ceremonyId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
    // No allowCredentials: the authenticator offers whichever of its
    // passkeys belong to this site, so nobody types a handle first.
    const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required" });
    const ceremonyId = this.remember({ kind: "signin", challenge: options.challenge, expiresAt: Date.now() + CEREMONY_TTL_MS });
    return { ceremonyId, options };
  }

  async signIn(rp: RelyingParty, ceremonyId: unknown, response: unknown): Promise<string> {
    const ceremony = this.take(ceremonyId, "signin");
    return this.verifyAssertion(rp, ceremony.challenge, response, undefined);
  }

  async reauthOptions(
    rp: RelyingParty,
    accountId: string,
  ): Promise<{ ceremonyId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
    const rows = this.db.prepare("SELECT * FROM passkeys WHERE account_id = ?").all(accountId) as unknown as PasskeyRow[];
    if (rows.length === 0) throw new HttpError(400, "This account has no passkey yet.");
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      userVerification: "required",
      allowCredentials: rows.map((row) => ({ id: row.id, transports: JSON.parse(row.transports) as string[] })),
    });
    const ceremonyId = this.remember({
      kind: "reauth",
      challenge: options.challenge,
      accountId,
      expiresAt: Date.now() + CEREMONY_TTL_MS,
    });
    return { ceremonyId, options };
  }

  async reauth(rp: RelyingParty, accountId: string, ceremonyId: unknown, response: unknown): Promise<void> {
    const ceremony = this.take(ceremonyId, "reauth");
    if (ceremony.accountId !== accountId) throw new HttpError(400, "That confirmation was started by someone else.");
    await this.verifyAssertion(rp, ceremony.challenge, response, accountId);
  }

  // The account the passkey belongs to, once its signature checks out.
  private async verifyAssertion(
    rp: RelyingParty,
    challenge: string,
    response: unknown,
    expectedAccount: string | undefined,
  ): Promise<string> {
    const id = (response as { id?: unknown } | null)?.id;
    const row = typeof id === "string" ? this.row(id) : undefined;
    if (row === undefined) {
      throw new HttpError(401, "This passkey is not registered with Chronicle — it may have been removed.");
    }
    if (expectedAccount !== undefined && row.account_id !== expectedAccount) {
      throw new HttpError(401, "That passkey belongs to a different account.");
    }
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: response as AuthenticationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        credential: this.credential(row),
        requireUserVerification: true,
      });
    } catch (error) {
      throw new HttpError(401, `That passkey could not be verified: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    if (!verification.verified) throw new HttpError(401, "That passkey could not be verified.");
    this.db
      .prepare("UPDATE passkeys SET counter = ?, backed_up = ?, last_used_at = ? WHERE id = ?")
      .run(verification.authenticationInfo.newCounter, verification.authenticationInfo.credentialBackedUp ? 1 : 0, Date.now(), row.id);
    return row.account_id;
  }
}
