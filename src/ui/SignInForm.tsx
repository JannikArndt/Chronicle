// Create an account or sign in — one form, two modes. It is a real <form>
// with the autocomplete hints password managers look for, so a phone offers
// to generate and remember the password: nobody should have to invent one to
// fill in their own childhood.

import { useState } from "react";
import type { FormEvent } from "react";
import { signIn, signUp } from "../sync/engine";
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
  const [mode, setMode] = useState<Mode>(fixedHandle === undefined ? initialMode : "signin");
  const [handle, setHandle] = useState(fixedHandle ?? "");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [keepLocal, setKeepLocal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localCount = useAppState((s) => (s.sync.account === undefined ? s.dataset.rows.length : 0));

  const normalized = handle.trim().toLowerCase();
  const handleOk = HANDLE_PATTERN.test(normalized);
  const canSubmit =
    !busy && handleOk && password.length >= MIN_PASSWORD_LENGTH && (mode === "signin" || name.trim() !== "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") await signUp(normalized, password, name.trim());
      else await signIn(normalized, password, keepLocal);
      setPassword("");
      onSignedIn?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="popover-form" onSubmit={(event) => void submit(event)}>
      {fixedHandle === undefined && (
        <PillSelector<Mode>
          options={[
            { value: "signup", icon: "✨", label: "New account" },
            { value: "signin", icon: "🔑", label: "Sign in" },
          ]}
          value={mode}
          onChange={setMode}
        />
      )}
      <input
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="Handle, e.g. jannik"
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
      <input
        type="password"
        name="password"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        placeholder={mode === "signup" ? `Password (at least ${MIN_PASSWORD_LENGTH} characters)` : "Password"}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {mode === "signin" && fixedHandle === undefined && localCount > 0 && (
        <label className="checkbox-line">
          <input type="checkbox" checked={keepLocal} onChange={(event) => setKeepLocal(event.target.checked)} />
          Add the {localCount} {localCount === 1 ? "timeline" : "timelines"} on this device to the account
        </label>
      )}
      {mode === "signup" && localCount > 0 && (
        <div className="hint">
          The {localCount} {localCount === 1 ? "timeline" : "timelines"} on this device become the start of your account.
        </div>
      )}
      <button type="submit" className="small-button small-button-primary" disabled={!canSubmit}>
        {busy ? "One moment…" : `${mode === "signup" ? "Create account" : "Sign in"}${submitSuffix}`}
      </button>
      {error !== null && <div className="note">{error}</div>}
      {mode === "signup" && (
        <div className="hint">
          With an account, your timelines are stored on Chronicle’s server so every device you sign in on
          has them. Nobody else sees any of it unless you share it. The server can read what it stores —
          it is not end-to-end encrypted — and a forgotten password cannot be reset, so let your browser
          save it.
        </div>
      )}
    </form>
  );
}
