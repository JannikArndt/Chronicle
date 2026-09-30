// The browser half of passkeys: ask the platform (Face ID, Windows Hello, a
// phone nearby, a password manager) to make or use one, and turn what it
// says into something a person can read. @simplewebauthn/browser does the
// WebAuthn plumbing; the server verifies everything (server/passkeys.ts).

import {
  WebAuthnAbortService,
  WebAuthnError,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";

// The person closed the passkey sheet, or it timed out — not a failure to
// report, just nothing to do.
export class PasskeyCancelled extends Error {}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && browserSupportsWebAuthn();
}

export async function passkeyAutofillSupported(): Promise<boolean> {
  return passkeysSupported() && (await browserSupportsWebAuthnAutofill());
}

function explain(error: unknown): Error {
  if (error instanceof WebAuthnError) {
    if (error.code === "ERROR_CEREMONY_ABORTED") return new PasskeyCancelled();
    if (error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      return new Error("This device already has a passkey for your account.");
    }
    if (error.code === "ERROR_INVALID_DOMAIN" || error.code === "ERROR_INVALID_RP_ID") {
      return new Error("Passkeys only work on Chronicle’s own address, over HTTPS.");
    }
  }
  // NotAllowedError covers both "cancelled" and "timed out": the browser
  // deliberately does not say which.
  if (error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")) {
    return new PasskeyCancelled();
  }
  return error instanceof Error ? error : new Error("The passkey did not work.");
}

export async function createPasskey(options: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON> {
  try {
    return await startRegistration({ optionsJSON: options });
  } catch (error) {
    throw explain(error);
  }
}

// `autofill`: offer the passkey in the handle field's autofill list instead
// of opening a sheet — it waits quietly until someone picks one.
export async function usePasskey(
  options: PublicKeyCredentialRequestOptionsJSON,
  autofill = false,
): Promise<AuthenticationResponseJSON> {
  try {
    return await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
  } catch (error) {
    throw explain(error);
  }
}

// A waiting autofill request would otherwise hold on after its form closes.
export function cancelPendingPasskey(): void {
  WebAuthnAbortService.cancelCeremony();
}

// A name for a new passkey that says where it was made, so a list of them
// means something ("iPhone", "Mac") — renamable afterwards.
export function deviceName(): string {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone/.test(agent)) return "iPhone";
  if (/iPad/.test(agent)) return "iPad";
  if (/Android/.test(agent)) return "Android";
  if (/Macintosh|Mac OS X/.test(agent)) return "Mac";
  if (/Windows/.test(agent)) return "Windows";
  if (/CrOS/.test(agent)) return "Chromebook";
  if (/Linux/.test(agent)) return "Linux";
  return "Passkey";
}
