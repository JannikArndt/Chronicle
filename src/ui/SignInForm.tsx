// Create an account or sign in — one form, two modes, passkey first.
//
// A passkey is the default because it is the one thing nobody has to invent,
// remember or type: Face ID or a fingerprint, and it follows the person to
// their other devices through their own password manager. A password is
// always one tap away ("Use a password instead"), for a browser without
// passkeys or anyone who would rather.
//
// It is a real <form> with the autocomplete hints password managers look
// for, and in sign-in mode the handle field offers saved passkeys in its
// autofill list (WebAuthn conditional mediation) where the browser can.

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { signIn, signInWithPasskey, signUp, signUpWithPasskey } from "../sync/engine";
import { PasskeyCancelled, cancelPendingPasskey, passkeyAutofillSupported, passkeysSupported } from "../sync/passkeys";
import { useAppState } from "../state/store";
import { PillSelector } from "./PillSelector";
import { HANDLE_PATTERN, MIN_PASSWORD_LENGTH } from "../sync/protocol";

type Mode = "signup" | "signin";

export function SignInForm({
  initialMode = "signin",
  fixedHandle,
  submitSuffix = "",
  onSignedIn,
}: {
  initialMode?: Mode;
  // Re-signing in on a device whose session expired: the account is known.
  fixedHandle?: string;
  submitSuffix?: string;
  onSignedIn?: () => void;
}) {
  const supported = passkeysSupported();
  const [mode, setMode] = useState<Mode>(fixedHandle === undefined ? initialMode : "signin");
  const [withPassword, setWithPassword] = useState(!supported);
  const [handle, setHandle] = useState(fixedHandle ?? "");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [keepLocal, setKeepLocal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localCount = useAppState((s) => (s.sync.account === undefined ? s.dataset.rows.length : 0));

  const normalized = handle.trim().toLowerCase();
  const handleOk = HANDLE_PATTERN.test(normalized);
  const passwordOk = password.length >= MIN_PASSWORD_LENGTH;
  const nameOk = name.trim() !== "";

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setPassword("");
      onSignedIn?.();
    } catch (reason) {
      if (!(reason instanceof PasskeyCancelled)) {
        setError(reason instanceof Error ? reason.message : "That did not work.");
      }
    } finally {
      setBusy(false);
    }
  };

  // Saved passkeys in the handle field's autofill list, for as long as the
  // sign-in form is open. It resolves only if one is picked there.
  useEffect(() => {
    if (mode !== "signin" || fixedHandle !== undefined) return;
    let open = true;
    void passkeyAutofillSupported().then((available) => {
      if (!available || !open) return;
      signInWithPasskey(keepLocal, true).then(
        () => open && onSignedIn?.(),
        () => undefined, // cancelled when the form closes or a sheet opens instead
      );
    });
    return () => {
      open = false;
      cancelPendingPasskey();
    };
    // Restarting it for every keystroke of the checkbox would be noise; the
    // value at the moment it resolves is read from the closure it started in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, fixedHandle]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode === "signup") {
      if (!handleOk || !nameOk) return;
      if (withPassword) {
        if (passwordOk) void run(() => signUp(normalized, password, name.trim()));
      } else {
        void run(() => signUpWithPasskey(normalized, name.trim()));
      }
      return;
    }
    if (handleOk && passwordOk) void run(() => signIn(normalized, password, keepLocal));
  };

  const passwordField = (
    <input
      type="password"
      name="password"
      autoComplete={mode === "signup" ? "new-password" : "current-password"}
      placeholder={mode === "signup" ? `Password (at least ${MIN_PASSWORD_LENGTH} characters)` : "Password"}
      value={password}
      onChange={(event) => setPassword(event.target.value)}
    />
  );

  const keepLocalLine = mode === "signin" && fixedHandle === undefined && localCount > 0 && (
    <label className="checkbox-line">
      <input type="checkbox" checked={keepLocal} onChange={(event) => setKeepLocal(event.target.checked)} />
      Add the {localCount} {localCount === 1 ? "timeline" : "timelines"} on this device to the account
    </label>
  );

  return (
    <form className="popover-form sign-in-form" onSubmit={submit}>
      {fixedHandle === undefined && (
        <PillSelector<Mode>
          options={[
            { value: "signup", icon: "✨", label: "New account" },
            { value: "signin", icon: "🔑", label: "Sign in" },
          ]}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setError(null);
          }}
        />
      )}

      {mode === "signin" && supported && (
        <>
          {keepLocalLine}
          <button
            type="button"
            className="small-button small-button-primary"
            disabled={busy}
            onClick={() => void run(() => signInWithPasskey(keepLocal))}
          >
            {busy ? "One moment…" : `🔑 Sign in with a passkey${submitSuffix}`}
          </button>
          <div className="form-divider">or with your password</div>
        </>
      )}

      <input
        name="username"
        // "webauthn" is what lets the browser list saved passkeys here.
        autoComplete={mode === "signin" ? "username webauthn" : "username"}
        autoCapitalize="none"
        spellCheck={false}
        placeholder={mode === "signup" ? "Pick a handle, e.g. jannik" : "Handle"}
        value={handle}
        readOnly={fixedHandle !== undefined}
        onChange={(event) => setHandle(event.target.value)}
      />
      {mode === "signup" && handle !== "" && !handleOk && (
        <div className="hint">3–32 characters: letters, digits, dots, dashes, underscores.</div>
      )}
      {mode === "signup" && (
        <input
          name="name"
          autoComplete="name"
          placeholder="Your name, as others will see it"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      )}

      {mode === "signin" && (
        <>
          {passwordField}
          {!supported && keepLocalLine}
          <button type="submit" className="small-button" disabled={busy || !handleOk || !passwordOk}>
            {busy ? "One moment…" : `Sign in${submitSuffix}`}
          </button>
        </>
      )}

      {mode === "signup" && (
        <>
          {withPassword && passwordField}
          <button
            type="submit"
            className="small-button small-button-primary"
            disabled={busy || !handleOk || !nameOk || (withPassword && !passwordOk)}
          >
            {busy ? "One moment…" : `${withPassword ? "Create account" : "🔑 Create account with a passkey"}${submitSuffix}`}
          </button>
          {supported && (
            <button type="button" className="link-button" onClick={() => setWithPassword(!withPassword)}>
              {withPassword ? "Use a passkey instead" : "Use a password instead"}
            </button>
          )}
          {localCount > 0 && (
            <div className="hint">
              The {localCount} {localCount === 1 ? "timeline" : "timelines"} on this device become the start of your
              account.
            </div>
          )}
        </>
      )}

      {error !== null && <div className="note">{error}</div>}
      {mode === "signup" && (
        <div className="hint">
          {withPassword
            ? "A forgotten password cannot be reset — there is no email on file — so let your browser save it. "
            : "A passkey is Face ID, a fingerprint or your device PIN; your phone or password manager keeps it, and it cannot be phished. "}
          With an account, your timelines are stored on Chronicle’s server so every device you sign in on has
          them. Nobody else sees any of it unless you share it. The server can read what it stores — it is not
          end-to-end encrypted.
        </div>
      )}
    </form>
  );
}
