// The sharing surface — plans/sharing-feature-design.md phase 1.
//
// Absent from the top bar entirely when the build has no Supabase project, so a
// fresh clone looks exactly as Chronicle did before sharing existed. Signing in
// is the opt-in, and until it happens nothing here touches the network.

import { useState } from "react";
import { createInviteLink, refreshGrants, requestMagicLink, revokeGrant, signOut } from "../sharing/sync";
import { useAppState } from "../state/store";
import type { InviteDraft } from "../sharing/backend";
import type { Group } from "../model/types";

export function SharingMenu() {
  const sharing = useAppState((s) => s.sharing);
  const groups = useAppState((s) => s.dataset.groups);
  const sharedRowCount = useAppState((s) => s.dataset.rows.filter((row) => row.shared === true).length);
  const [open, setOpen] = useState(false);

  if (!sharing.configured) return null;

  const signedIn = sharing.session !== undefined;
  return (
    <div className="data-menu">
      <button type="button" className="small-button" onClick={() => setOpen(!open)}>
        {signedIn ? "Sharing" : "Share"} {open ? "▴" : "▾"}
      </button>
      {open && (
        <>
          <div className="popover-backdrop" onClick={() => setOpen(false)} />
          <div className="popover data-menu-popover">
            <div className="popover-form">
              {signedIn ? (
                <SignedIn groups={groups} sharedRowCount={sharedRowCount} />
              ) : (
                <SignIn />
              )}
              {sharing.status === "error" && sharing.error !== undefined && (
                <div className="note">{sharing.error}</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const status = useAppState((s) => s.sharing.status);

  return (
    <>
      <div className="hint">
        Chronicle works entirely offline. Sign in only if you want to share timelines with someone —
        nothing leaves this device until you do.
      </div>
      {sent ? (
        <div className="note">Check your inbox for a sign-in link.</div>
      ) : (
        <>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button
            type="button"
            className="menu-item"
            disabled={email.trim() === "" || status === "syncing"}
            onClick={() => {
              void requestMagicLink(email.trim()).then(() => setSent(true));
            }}
          >
            ✉️ Email me a sign-in link
          </button>
          <div className="hint">No password. The link signs you in on this device.</div>
        </>
      )}
    </>
  );
}

function SignedIn({ groups, sharedRowCount }: { groups: Group[]; sharedRowCount: number }) {
  const session = useAppState((s) => s.sharing.session);
  const grants = useAppState((s) => s.sharing.grants);
  const mirrors = useAppState((s) => s.sharing.mirrors);
  const [copied, setCopied] = useState<string | null>(null);

  const invite = async (draft: InviteDraft, label: string) => {
    const link = await createInviteLink(draft);
    await navigator.clipboard.writeText(link).catch(() => undefined);
    setCopied(`${label}: link copied. Send it however you like — it expires in 30 days.`);
  };

  const topLevelGroups = groups.filter((group) => group.parentGroupId === undefined);

  return (
    <>
      <div className="hint">
        Signed in as {session?.email}.{" "}
        <button type="button" className="link-button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      <div className="note">
        {sharedRowCount === 0
          ? "Nothing is shared yet. Use the 🔒 button on a timeline in the rail to publish it."
          : `${sharedRowCount} ${sharedRowCount === 1 ? "timeline is" : "timelines are"} shared.`}
      </div>

      <div className="hint">Invite someone to a group</div>
      {topLevelGroups.map((group) => (
        <div key={group.id} className="share-invite-row">
          <span className="share-invite-label" title={group.label}>
            {group.label}
          </span>
          <button
            type="button"
            className="small-button"
            onClick={() => void invite({ subjectKind: "group", subjectId: group.id, role: "reader" }, group.label)}
          >
            Can view
          </button>
          {/* Co-ownership is how "invite my dad to fill in his own group" works:
              he edits it, and his edits come back to me. */}
          <button
            type="button"
            className="small-button"
            onClick={() => void invite({ subjectKind: "group", subjectId: group.id, role: "owner" }, group.label)}
          >
            Can edit
          </button>
        </div>
      ))}
      {copied !== null && <div className="note">{copied}</div>}

      <div className="hint">Who can see your timelines</div>
      {grants.length === 0 ? (
        <div className="note">Nobody yet.</div>
      ) : (
        grants.map((grant) => (
          <div key={grant.id} className="share-invite-row">
            <span className="share-invite-label">{grant.granteeName}</span>
            <button type="button" className="small-button" onClick={() => void revokeGrant(grant.id)}>
              Stop sharing
            </button>
          </div>
        ))
      )}
      <button type="button" className="link-button" onClick={() => void refreshGrants()}>
        Refresh
      </button>

      {mirrors.length > 0 && (
        <>
          <div className="hint">Shared with you</div>
          {mirrors.map((mirror) => (
            <div key={mirror.ownerAccountId} className="note">
              {mirror.ownerName} — {mirror.dataset.rows.length}{" "}
              {mirror.dataset.rows.length === 1 ? "timeline" : "timelines"}
              {mirror.role === "owner" ? " (you can edit these)" : ""}
            </div>
          ))}
        </>
      )}

      {/* The honest register the project uses for the Gist gap. Both of these
          are true and neither is obvious, so neither is buried. */}
      <div className="hint">
        Shared timelines are stored on Chronicle’s server and are readable by it — they are not
        end-to-end encrypted. Sharing is also not recallable: revoking stops future access, but
        anyone who could already see something may have kept a copy.
      </div>
      <div className="hint">
        Signing in is not a backup. Only the timelines you publish are uploaded; everything else
        stays in this browser, so keep exporting.
      </div>
    </>
  );
}
