// A software passkey authenticator for tests: a real P-256 key pair per
// credential, "none" attestation, and signed assertions — exactly the bytes a
// phone would send, so the server's passkey flows are tested through the
// same verification as production, not around it.

import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";

// ---------- a minimal CBOR encoder: all WebAuthn needs ----------

type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;

function head(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length];
  if (length < 0x100) return [(major << 5) | 24, length];
  if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff];
  return [(major << 5) | 26, (length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff];
}

function cbor(value: Cbor): Uint8Array {
  if (typeof value === "number") {
    return Uint8Array.from(value >= 0 ? head(0, value) : head(1, -1 - value));
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return Uint8Array.from([...head(3, bytes.length), ...bytes]);
  }
  if (value instanceof Uint8Array) return Uint8Array.from([...head(2, value.length), ...value]);
  const parts: number[] = head(5, value.size);
  for (const [key, entry] of value) parts.push(...cbor(key), ...cbor(entry));
  return Uint8Array.from(parts);
}

// ---------- helpers ----------

const b64url = (bytes: Uint8Array | Buffer): string => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | string): Buffer => createHash("sha256").update(data).digest();

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

const UP = 0x01; // user present
const UV = 0x04; // user verified
const BE = 0x08; // backup eligible
const BS = 0x10; // backed up
const AT = 0x40; // attested credential data included

interface StoredCredential {
  id: Buffer;
  privateKey: KeyObject;
  rpID: string;
  userHandle: string; // base64url, as the options carried it
  counter: number;
}

interface CreationOptions {
  challenge: string;
  rp: { id?: string };
  user: { id: string };
}

interface RequestOptions {
  challenge: string;
  rpId?: string;
  allowCredentials?: Array<{ id: string }>;
}

export class SoftAuthenticator {
  private readonly credentials: StoredCredential[] = [];

  constructor(
    private readonly origin: string,
    private readonly options: { userVerified?: boolean; backedUp?: boolean } = {},
  ) {}

  private flags(extra: number): number {
    const verified = this.options.userVerified === false ? 0 : UV;
    const backup = this.options.backedUp === true ? BE | BS : 0;
    return UP | verified | backup | extra;
  }

  private clientData(type: string, challenge: string, origin = this.origin): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  // navigator.credentials.create(), as RegistrationResponseJSON.
  create(options: CreationOptions, origin = this.origin) {
    const rpID = options.rp.id ?? new URL(this.origin).hostname;
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const coseKey = cbor(
      new Map<number, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ]),
    );
    const id = randomBytes(16);
    const authData = Uint8Array.from([
      ...sha256(rpID),
      this.flags(AT),
      ...u32(0),
      ...new Uint8Array(16), // AAGUID
      id.length >> 8,
      id.length & 0xff,
      ...id,
      ...coseKey,
    ]);
    const attestationObject = cbor(
      new Map<string, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    this.credentials.push({ id, privateKey, rpID, userHandle: options.user.id, counter: 0 });
    return {
      id: b64url(id),
      rawId: b64url(id),
      type: "public-key",
      response: {
        clientDataJSON: b64url(this.clientData("webauthn.create", options.challenge, origin)),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  // navigator.credentials.get(), as AuthenticationResponseJSON. Without an
  // allow-list it picks the newest credential for the RP — what a phone's
  // passkey sheet offers first.
  get(options: RequestOptions, origin = this.origin) {
    const rpID = options.rpId ?? new URL(this.origin).hostname;
    const allowed = options.allowCredentials?.map((credential) => credential.id);
    const credential = [...this.credentials]
      .reverse()
      .find((candidate) => candidate.rpID === rpID && (allowed === undefined || allowed.includes(b64url(candidate.id))));
    if (credential === undefined) throw new Error("no matching passkey on this authenticator");
    credential.counter += 1;
    const authenticatorData = Buffer.from([...sha256(rpID), this.flags(0), ...u32(credential.counter)]);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge, origin);
    const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientDataJSON)]), credential.privateKey);
    return {
      id: b64url(credential.id),
      rawId: b64url(credential.id),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
        userHandle: credential.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  get credentialCount(): number {
    return this.credentials.length;
  }
}
