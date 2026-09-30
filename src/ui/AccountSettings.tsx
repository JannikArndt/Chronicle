// The account itself: its name, its passkeys, its password, signing out and
// deleting it.
//
// Changes that could take an account over — adding a passkey, setting a
// password, removing a passkey, deleting the account — are only accepted
// from a session that proved who it is in the last few minutes. When the
// server says "confirm it's you", the action is parked, `ConfirmIdentity`
// asks for a passkey or the password, and the action runs again.

import { useEffect, useState } from "react";
import {
  addPasskey,
  changePassword,
  confirmIdentity,
  deleteAccount,
  refreshPasskeys,
  removePasskey,
  renamePasskey,
  signOut,
  updateAccount,
} from "../sync/engine";
import { ApiError } from "../sync/api";
import { PasskeyCancelled, passkeysSupported } from "../sync/passkeys";
import { useAppState } from "../state/store";
import { ERROR_CONFIRM_IDENTITY, MIN_PASSWORD_LENGTH } from "../sync/protocol";
import type { PasskeyInfo } from "../sync/protocol";

function describe(reason: unknown): string | null {
  if (reason instanceof PasskeyCancelled) return null;
  return reason instanceof Error ? reason.message : "That did not work.";
}

function when(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function AccountSettings() {
  const account = useAppState((s) => s.sync.account)!;
  const pendingChanges = useAppState((s) => s.sync.pending);
  const passkeys = useAppState((s) => s.sync.passkeys);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(account.name);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // The action waiting for "confirm it's you", to run again once confirmed.
  const [parked, setParked] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (open) void refreshPasskeys();
  }, [open]);

  const attempt = async (action: () => Promise<void>, done?: string): Promise<void> => {
    setMessage(null);
    try {
      await action();
      if (done !== undefined) setMessage(done);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === ERROR_CONFIRM_IDENTITY) {
        setParked(() => action);
        return;
      }
      setMessage(describe(reason));
    }
  };

  const leave = () => {
    const warning =
      pendingChanges > 0
        ? `${pendingChanges} ${pendingChanges === 1 ? "change has" : "changes have"} not reached the server yet and will be lost. Sign out anyway?`
        : "Sign out? Your timelines leave this device; they stay in your account.";
    if (window.confirm(warning)) void signOut();
  };

  const remove = () => {
    const sure = window.confirm(
      "Deleting your account removes every timeline you own from the server, for everyone you shared them with. It cannot be undone. Delete it?",
    );
    if (sure) void attempt(() => deleteAccount());
  };

  return (
    <section className="account-section">
      <button type="button" className="menu-item" onClick={() => setOpen(!open)}>
        <span className="menu-item-icon">⚙</span>Account {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="popover-form">
          <label className="hint" htmlFor="account-name">
            Your name, as others see it
          </label>
          <input
            id="account-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name.trim() !== "" && name.trim() !== account.name) void updateAccount({ name: name.trim() });
            }}
          />

          {parked !== null && (
            <ConfirmIdentity
              hasPassword={account.hasPassword}
              hasPasskeys={(passkeys?.length ?? 0) > 0}
              onConfirmed={() => {
                const action = parked;
                setParked(null);
                void attempt(action);
              }}
              onCancel={() => setParked(null)}
            />
          )}

          <div className="popover-title">Passkeys</div>
          <PasskeyList passkeys={passkeys} attempt={attempt} />
          {passkeysSupported() ? (
            <button type="button" className="small-button" onClick={() => void attempt(addPasskey, "Passkey added.")}>
              🔑 Add a passkey on this device
            </button>
          ) : (
            <div className="hint">This browser cannot make passkeys.</div>
          )}

          <div className="popover-title">{account.hasPassword ? "Password" : "Password (optional)"}</div>
          <form
            className="popover-form"
            onSubmit={(event) => {
              event.preventDefault();
              void attempt(async () => {
                await changePassword(account.hasPassword ? current : undefined, next);
                setCurrent("");
                setNext("");
              }, account.hasPassword ? "Password changed. Your other devices were signed out." : "Password set.");
            }}
          >
            <input type="text" name="username" autoComplete="username" value={account.handle} readOnly hidden />
            {account.hasPassword && (
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Current password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            )}
            <input
              type="password"
              autoComplete="new-password"
              placeholder={account.hasPassword ? "New password" : `A password, as a second way in (${MIN_PASSWORD_LENGTH}+ characters)`}
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
            <button
              type="submit"
              className="small-button"
              disabled={(account.hasPassword && current === "") || next.length < MIN_PASSWORD_LENGTH}
            >
              {account.hasPassword ? "Change password" : "Set password"}
            </button>
          </form>

          {message !== null && <div className="note">{message}</div>}

          <div className="popover-actions">
            <button type="button" className="menu-item" onClick={leave}>
              <span className="menu-item-icon">🚪</span>Sign out
            </button>
            <button type="button" className="menu-item menu-item-danger" onClick={remove}>
              <span className="menu-item-icon">🗑</span>Delete account…
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function PasskeyList({
  passkeys,
  attempt,
}: {
  passkeys: PasskeyInfo[] | undefined;
  attempt: (action: () => Promise<void>, done?: string) => Promise<void>;
}) {
  if (passkeys === undefined) return <div className="hint">Loading…</div>;
  if (passkeys.length === 0) {
    return <div className="hint">None yet. A passkey signs you in with Face ID, a fingerprint or your device PIN.</div>;
  }
  return (
    <>
      {passkeys.map((passkey) => (
        <div key={passkey.id} className="share-invite-row passkey-row">
          <input
            className="passkey-name"
            defaultValue={passkey.name}
            aria-label="Passkey name"
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value !== "" && value !== passkey.name) void attempt(() => renamePasskey(passkey.id, value));
            }}
          />
          <span className="hint" title={passkey.backedUp ? "Synced by your password manager" : "Only on the device that made it"}>
            {passkey.backedUp ? "synced · " : ""}
            {passkey.lastUsedAt === null ? `added ${when(passkey.createdAt)}` : `used ${when(passkey.lastUsedAt)}`}
          </span>
          <button
            type="button"
            className="small-button"
            title="Remove this passkey"
            onClick={() => {
              if (window.confirm(`Remove the passkey “${passkey.name}”? It will no longer sign you in.`)) {
                void attempt(() => removePasskey(passkey.id));
              }
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </>
  );
}

// "Confirm it's you": a passkey if the account has one, the password if it
// has one — whichever the person reaches for.
function ConfirmIdentity({
  hasPassword,
  hasPasskeys,
  onConfirmed,
  onCancel,
}: {
  hasPassword: boolean;
  hasPasskeys: boolean;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const confirm = (proof: { password: string } | "passkey") => {
    setError(null);
    confirmIdentity(proof).then(onConfirmed, (reason: unknown) => setError(describe(reason)));
  };
  return (
    <div className="confirm-identity">
      <div className="hint">For this change, confirm it’s you.</div>
      {hasPasskeys && passkeysSupported() && (
        <button type="button" className="small-button small-button-primary" onClick={() => confirm("passkey")}>
          🔑 Confirm with a passkey
        </button>
      )}
      {hasPassword && (
        <form
          className="share-invite-row"
          onSubmit={(event) => {
            event.preventDefault();
            confirm({ password });
          }}
        >
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="submit" className="small-button" disabled={password === ""}>
            Confirm
          </button>
        </form>
      )}
      <button type="button" className="link-button" onClick={onCancel}>
        Cancel
      </button>
      {error !== null && <div className="note">{error}</div>}
    </div>
  );
}
