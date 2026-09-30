// The server's HTTP API, one function per endpoint. Same-origin, cookie
// session; every non-GET carries the CSRF header the server insists on.

import { CSRF_HEADER } from "./protocol";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/browser";
import type {
  AccountInfo,
  GrantsResponse,
  PasskeyInfo,
  InviteInfo,
  InvitePreview,
  PeopleResponse,
  PersonRef,
  PublicLinkInfo,
  PublicView,
  PullResponse,
  PushRecord,
  PushResult,
  Role,
  Subject,
} from "./protocol";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // Set for the few errors the client acts on (ERROR_CONFIRM_IDENTITY).
    readonly code?: string,
  ) {
    super(message);
  }
}

// A WebAuthn ceremony the server started: its id comes back with the
// browser's answer, and the options go to navigator.credentials.
export interface Ceremony<Options> {
  ceremonyId: string;
  options: Options;
}

// A request that never got an answer — offline, or the server restarting
// mid-deploy. Distinct from ApiError, which is the server saying no.
export class NetworkError extends Error {}

interface Transport {
  base: string;
  fetch: typeof fetch;
}

let transport: Transport = { base: "", fetch: (...args) => fetch(...args) };

// Tests point the client at an in-process server, with their own cookie jar.
export function useTransport(next: Transport): void {
  transport = next;
}

export function transportFetch(path: string, init?: RequestInit): Promise<Response> {
  return transport.fetch(`${transport.base}${path}`, { credentials: "same-origin", ...init });
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await transportFetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(method === "GET" ? {} : { [CSRF_HEADER]: "1" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new NetworkError(error instanceof Error ? error.message : "The server could not be reached.");
  }
  if (!response.ok) {
    let message = `The server said ${response.status}.`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: string; code?: string };
      message = body.error ?? message;
      code = body.code;
    } catch {
      // not JSON — keep the status line
    }
    throw new ApiError(response.status, message, code);
  }
  return (await response.json()) as T;
}

export const api = {
  signUp: (handle: string, password: string, name: string) =>
    call<{ me: AccountInfo }>("POST", "/api/auth/signup", { handle, password, name }),
  signIn: (handle: string, password: string) => call<{ me: AccountInfo }>("POST", "/api/auth/signin", { handle, password }),
  signOut: () => call<{ ok: true }>("POST", "/api/auth/signout"),
  me: () => call<{ me: AccountInfo }>("GET", "/api/me"),
  updateMe: (patch: { name?: string; selfGroupId?: string | null }) => call<{ me: AccountInfo }>("PATCH", "/api/me", patch),
  // Without `current`, the session must have confirmed it's you recently.
  changePassword: (current: string | undefined, next: string) =>
    call<{ me: AccountInfo }>("POST", "/api/me/password", { current, next }),
  deleteAccount: (password: string | undefined) => call<{ ok: true }>("DELETE", "/api/me", { password }),
  confirmOptions: () => call<Ceremony<PublicKeyCredentialRequestOptionsJSON>>("POST", "/api/auth/confirm/options"),
  confirm: (proof: { password: string } | { ceremonyId: string; response: AuthenticationResponseJSON }) =>
    call<{ ok: true }>("POST", "/api/auth/confirm", proof),

  passkeySignUpOptions: (handle: string, name: string) =>
    call<Ceremony<PublicKeyCredentialCreationOptionsJSON>>("POST", "/api/passkeys/signup/options", { handle, name }),
  passkeySignUp: (ceremonyId: string, response: RegistrationResponseJSON, passkeyName: string) =>
    call<{ me: AccountInfo }>("POST", "/api/passkeys/signup", { ceremonyId, response, passkeyName }),
  passkeySignInOptions: () => call<Ceremony<PublicKeyCredentialRequestOptionsJSON>>("POST", "/api/passkeys/signin/options"),
  passkeySignIn: (ceremonyId: string, response: AuthenticationResponseJSON) =>
    call<{ me: AccountInfo }>("POST", "/api/passkeys/signin", { ceremonyId, response }),
  passkeys: () => call<{ passkeys: PasskeyInfo[] }>("GET", "/api/passkeys"),
  addPasskeyOptions: () => call<Ceremony<PublicKeyCredentialCreationOptionsJSON>>("POST", "/api/passkeys/options"),
  addPasskey: (ceremonyId: string, response: RegistrationResponseJSON, name: string) =>
    call<{ passkeys: PasskeyInfo[] }>("POST", "/api/passkeys", { ceremonyId, response, name }),
  renamePasskey: (id: string, name: string) =>
    call<{ passkeys: PasskeyInfo[] }>("PATCH", `/api/passkeys/${encodeURIComponent(id)}`, { name }),
  removePasskey: (id: string) => call<{ passkeys: PasskeyInfo[] }>("DELETE", `/api/passkeys/${encodeURIComponent(id)}`),

  pull: () => call<PullResponse>("GET", "/api/pull"),
  push: (records: PushRecord[], connectionId: string | undefined) =>
    call<{ results: PushResult[] }>("POST", "/api/push", { records, connectionId }),
  presence: (connectionId: string, focusId: string | null) =>
    call<{ ok: true }>("POST", "/api/presence", { connectionId, focusId }),

  people: () => call<PeopleResponse>("GET", "/api/people"),
  requestConnection: (id: string) => call<PeopleResponse>("POST", `/api/people/${encodeURIComponent(id)}/request`),
  acceptConnection: (id: string) => call<PeopleResponse>("POST", `/api/people/${encodeURIComponent(id)}/accept`),
  declineConnection: (id: string) => call<PeopleResponse>("POST", `/api/people/${encodeURIComponent(id)}/decline`),
  dismissSuggestion: (id: string) => call<PeopleResponse>("POST", `/api/people/${encodeURIComponent(id)}/dismiss`),
  disconnect: (id: string) => call<PeopleResponse>("DELETE", `/api/people/${encodeURIComponent(id)}`),

  grants: () => call<GrantsResponse>("GET", "/api/grants"),
  grant: (granteeId: string, subject: Subject, role: Role) =>
    call<GrantsResponse>("POST", "/api/grants", { granteeId, subject, role }),
  revoke: (grantId: string) => call<GrantsResponse>("DELETE", `/api/grants/${encodeURIComponent(grantId)}`),

  invites: () => call<{ invites: InviteInfo[] }>("GET", "/api/invites"),
  createInvite: (subject: Subject | null, role: Role | null) =>
    call<{ token: string; invite: InviteInfo }>("POST", "/api/invites", { subject, role }),
  cancelInvite: (id: string) => call<{ invites: InviteInfo[] }>("DELETE", `/api/invites/${encodeURIComponent(id)}`),
  previewInvite: (token: string) => call<InvitePreview>("POST", "/api/invite/preview", { token }),
  redeemInvite: (token: string) => call<{ inviter: PersonRef }>("POST", "/api/invite/redeem", { token }),

  links: () => call<{ links: PublicLinkInfo[] }>("GET", "/api/links"),
  createLink: (subject: Subject) => call<{ token: string; link: PublicLinkInfo }>("POST", "/api/links", { subject }),
  deleteLink: (id: string) => call<{ links: PublicLinkInfo[] }>("DELETE", `/api/links/${encodeURIComponent(id)}`),
  publicView: (token: string) => call<PublicView>("POST", "/api/public", { token }),
};
