// Everything about you and the people you share with, in one panel: sign in,
// your connection to the server, people (connections, requests,
// suggestions), what is shared with you and what you share, and the account
// itself. The desktop top bar (`AccountMenu.tsx`) and the mobile ⋯ menu
// render this same component, so the disclosures cannot drift apart.

import { useState } from "react";
import {
  acceptConnection,
  cancelInvite,
  changePassword,
  createInviteLink,
  declineConnection,
  deleteAccount,
  deletePublicLink,
  disconnect,
  dismissSuggestion,
  requestConnection,
  revokeGrant,
  signOut,
  updateAccount,
} from "../sync/engine";
import { useAppState } from "../state/store";
import { SignInForm } from "./SignInForm";
import { roleVerb, subjectLabel } from "./subjects";
import { MIN_PASSWORD_LENGTH } from "../sync/protocol";
import type { GrantInfo } from "../sync/protocol";

export function AccountPanel() {
  const account = useAppState((s) => s.sync.account);
  if (account === undefined) {
    return (
      <>
        <div className="hint">
          Chronicle works entirely on this device. An account adds your other devices, and the people you
          choose to share timelines with.
        </div>
        <SignInForm initialMode="signup" />
      </>
    );
  }
  return <SignedIn />;
}

function SignedIn() {
  const account = useAppState((s) => s.sync.account)!;
  const sessionExpired = useAppState((s) => s.sync.sessionExpired);
  return (
    <div className="account-panel">
      <div className="account-head">
        <span className="account-name">{account.name}</span>
        <span className="hint">@{account.handle}</span>
      </div>
      <SyncStatus />
      {sessionExpired && (
        <>
          <div className="note">You were signed out on this device. Sign in again to keep syncing.</div>
          <SignInForm fixedHandle={account.handle} />
        </>
      )}
      <PeopleSection />
      <SharedWithMe />
      <YourShares />
      <AccountSettings />
    </div>
  );
}

export function SyncStatus() {
  const status = useAppState((s) => s.sync.status);
  const pending = useAppState((s) => s.sync.pending);
  const error = useAppState((s) => s.sync.error);
  const label =
    status === "online"
      ? pending > 0
        ? `Saving ${pending} ${pending === 1 ? "change" : "changes"}…`
        : "Synced"
      : status === "connecting"
        ? "Connecting…"
        : `Offline${pending > 0 ? ` — ${pending} ${pending === 1 ? "change waits" : "changes wait"} here until you are back` : " — changes are kept here"}`;
  return (
    <>
      <div className={`sync-status sync-status-${status}`}>
        <span className="sync-dot" aria-hidden="true" />
        {label}
      </div>
      {error !== undefined && <div className="note">{error}</div>}
    </>
  );
}

function CopyableLink({ url }: { url: string }) {
  return (
    <div className="copyable-link">
      <input readOnly value={url} onFocus={(event) => event.target.select()} />
      <div className="hint">Copied. Send it however you like — it works once, for 30 days.</div>
    </div>
  );
}

async function copy(text: string): Promise<void> {
  await navigator.clipboard?.writeText(text).catch(() => undefined);
}

function PeopleSection() {
  const social = useAppState((s) => s.sync.social);
  const peers = useAppState((s) => s.sync.peers);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const online = new Set(peers.map((peer) => peer.accountId));

  const run = (action: () => Promise<void>) => {
    setError(null);
    action().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "That did not work."));
  };

  return (
    <section className="account-section">
      <div className="popover-title">People</div>
      <button
        type="button"
        className="menu-item"
        onClick={() =>
          run(async () => {
            const url = await createInviteLink(null, null);
            await copy(url);
            setLink(url);
          })
        }
      >
        <span className="menu-item-icon">🔗</span>Invite someone to connect
      </button>
      {link !== null && <CopyableLink url={link} />}
      {social === undefined && <div className="hint">Loading…</div>}
      {social?.people.incoming.map((person) => (
        <div key={person.id} className="share-invite-row">
          <span className="share-invite-label">{person.name} wants to connect</span>
          <button type="button" className="small-button" onClick={() => run(() => acceptConnection(person.id))}>
            Accept
          </button>
          <button type="button" className="small-button" onClick={() => run(() => declineConnection(person.id))}>
            ✕
          </button>
        </div>
      ))}
      {social?.people.connections.length === 0 && (
        <div className="hint">No connections yet. An invite link connects you both the moment it is opened.</div>
      )}
      {social?.people.connections.map((person) => (
        <div key={person.id} className="share-invite-row">
          <span className="share-invite-label">
            {online.has(person.id) && <span className="online-dot" title="Online now" />}
            {person.name}
          </span>
          <button
            type="button"
            className="small-button"
            title="Disconnect — also ends everything shared between you two"
            onClick={() => {
              if (window.confirm(`Disconnect from ${person.name}? Everything you share with each other stops being shared.`)) {
                run(() => disconnect(person.id));
              }
            }}
          >
            ✕
          </button>
        </div>
      ))}
      {social?.people.outgoing.map((person) => (
        <div key={person.id} className="hint">
          Waiting for {person.name} to accept.
        </div>
      ))}
      {(social?.people.suggestions.length ?? 0) > 0 && <div className="hint">You might know</div>}
      {social?.people.suggestions.map((person) => (
        <div key={person.id} className="share-invite-row">
          <span className="share-invite-label" title={`Connected to ${person.via.map((v) => v.name).join(", ")}`}>
            {person.name} <span className="hint">via {person.via.map((v) => v.name).join(", ")}</span>
          </span>
          <button type="button" className="small-button" onClick={() => run(() => requestConnection(person.id))}>
            Connect
          </button>
          <button type="button" className="small-button" onClick={() => run(() => dismissSuggestion(person.id))}>
            ✕
          </button>
        </div>
      ))}
      {error !== null && <div className="note">{error}</div>}
    </section>
  );
}

function SharedWithMe() {
  // Select the stable object and derive from it: a selector that built a
  // fresh `[]` on every call would never compare equal and re-render forever.
  const social = useAppState((s) => s.sync.social);
  const received = social?.grants.received ?? [];
  const dataset = useAppState((s) => s.dataset);
  if (received.length === 0) return null;
  return (
    <section className="account-section">
      <div className="popover-title">Shared with you</div>
      {received.map((grant) => (
        <div key={grant.id} className="share-invite-row">
          <span className="share-invite-label">
            {grant.owner.name}: {roleVerb(grant.role)} {subjectLabel(grant.subject, dataset)}
          </span>
          <button
            type="button"
            className="small-button"
            title="Stop showing this here"
            onClick={() => void revokeGrant(grant.id)}
          >
            Leave
          </button>
        </div>
      ))}
    </section>
  );
}

function grantLine(grant: GrantInfo, dataset: Parameters<typeof subjectLabel>[1]): string {
  const what = grant.subject.kind === "all" ? "everything you publish" : subjectLabel(grant.subject, dataset);
  return `${grant.grantee.name} can ${roleVerb(grant.role)} ${what}`;
}

function YourShares() {
  const social = useAppState((s) => s.sync.social);
  const dataset = useAppState((s) => s.dataset);
  if (social === undefined) return null;
  const { given } = social.grants;
  if (given.length === 0 && social.invites.length === 0 && social.links.length === 0) return null;
  return (
    <section className="account-section">
      <div className="popover-title">You share</div>
      {given.map((grant) => (
        <div key={grant.id} className="share-invite-row">
          <span className="share-invite-label">{grantLine(grant, dataset)}</span>
          <button type="button" className="small-button" onClick={() => void revokeGrant(grant.id)}>
            Stop
          </button>
        </div>
      ))}
      {social.invites.map((invite) => (
        <div key={invite.id} className="share-invite-row">
          <span className="share-invite-label">
            Unused invite link{invite.subject === null ? "" : ` to ${roleVerb(invite.role)} ${subjectLabel(invite.subject, dataset)}`}
          </span>
          <button type="button" className="small-button" onClick={() => void cancelInvite(invite.id)}>
            Cancel
          </button>
        </div>
      ))}
      {social.links.map((link) => (
        <div key={link.id} className="share-invite-row">
          <span className="share-invite-label">Public link to {subjectLabel(link.subject, dataset)}</span>
          <button type="button" className="small-button" onClick={() => void deletePublicLink(link.id)}>
            Turn off
          </button>
        </div>
      ))}
      <div className="hint">
        Sharing is not recallable: stopping ends future access, but anyone who could already see something may
        have kept a copy.
      </div>
    </section>
  );
}

function AccountSettings() {
  const account = useAppState((s) => s.sync.account)!;
  const pending = useAppState((s) => s.sync.pending);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(account.name);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const leave = () => {
    const warning =
      pending > 0
        ? `${pending} ${pending === 1 ? "change has" : "changes have"} not reached the server yet and will be lost. Sign out anyway?`
        : "Sign out? Your timelines leave this device; they stay in your account.";
    if (window.confirm(warning)) void signOut();
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
          <form
            className="popover-form"
            onSubmit={(event) => {
              event.preventDefault();
              changePassword(current, next).then(
                () => {
                  setCurrent("");
                  setNext("");
                  setMessage("Password changed. Your other devices were signed out.");
                },
                (reason: unknown) => setMessage(reason instanceof Error ? reason.message : "That did not work."),
              );
            }}
          >
            <input type="text" name="username" autoComplete="username" value={account.handle} readOnly hidden />
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
            <button type="submit" className="small-button" disabled={current === "" || next.length < MIN_PASSWORD_LENGTH}>
              Change password
            </button>
          </form>
          {message !== null && <div className="note">{message}</div>}
          <div className="popover-actions">
            <button type="button" className="menu-item" onClick={leave}>
              <span className="menu-item-icon">🚪</span>Sign out
            </button>
            <button
              type="button"
              className="menu-item menu-item-danger"
              onClick={() => {
                const password = window.prompt(
                  "Deleting your account removes every timeline you own from the server, for everyone you shared them with. It cannot be undone.\n\nType your password to confirm:",
                );
                if (password) {
                  deleteAccount(password).catch((reason: unknown) =>
                    setMessage(reason instanceof Error ? reason.message : "That did not work."),
                  );
                }
              }}
            >
              <span className="menu-item-icon">🗑</span>Delete account…
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
