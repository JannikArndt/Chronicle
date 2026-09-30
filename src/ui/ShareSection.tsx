// Sharing one timeline or one group: who can see or edit it, adding a
// connection, an invite link for someone new, and a public link for anyone.
// Opened from the ⚙ of a group or timeline on desktop and from a timeline's
// pane on mobile.
//
// Someone else's record shows whose it is instead — you can only share what
// is yours.

import { useState } from "react";
import { createInviteLink, createPublicLink, deletePublicLink, grantAccess, revokeGrant } from "../sync/engine";
import { setGroupShareByDefault, setRowShared } from "../state/actions";
import { isOwnId, useAppState } from "../state/store";
import { describePublishImpact } from "../model/sharing";
import { ancestorGroups } from "../model/dataset";
import { PillSelector } from "./PillSelector";
import { roleVerb } from "./subjects";
import type { GrantInfo, Role } from "../sync/protocol";

export function ShareSection({ kind, id }: { kind: "group" | "row"; id: string }) {
  const state = useAppState((s) => s);
  const account = state.sync.account;
  if (account === undefined) {
    return <div className="hint">Create an account or sign in (top right, or the ⋯ menu) to share this with someone.</div>;
  }
  if (!isOwnId(id, state)) return <SharedByOthers id={id} />;
  return <OwnShare kind={kind} id={id} />;
}

function SharedByOthers({ id }: { id: string }) {
  const meta = useAppState((s) => s.sync.meta.get(id));
  const names = useAppState((s) => s.sync.names);
  if (meta === undefined) return null;
  const owner = names[meta.owner] ?? "someone";
  return (
    <div className="hint">
      {owner} shares this with you — you can {meta.access === "edit" ? "edit" : "view"} it. Only {owner} can
      share it further.
    </div>
  );
}

function OwnShare({ kind, id }: { kind: "group" | "row"; id: string }) {
  const dataset = useAppState((s) => s.dataset);
  const social = useAppState((s) => s.sync.social);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const record = kind === "group" ? dataset.groups.find((g) => g.id === id) : dataset.rows.find((r) => r.id === id);
  if (record === undefined) return null;

  const run = (action: () => Promise<void>) => {
    setError(null);
    action().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "That did not work."));
  };

  // The groups this one sits in: a grant on any of them reaches here too.
  const containerId = kind === "group" ? id : (record as { groupId?: string }).groupId;
  const covering = new Set<string>(
    containerId === undefined ? [] : [containerId, ...ancestorGroups(dataset, containerId).map((group) => group.id)],
  );
  const grants = social?.grants.given ?? [];
  const direct = grants.filter((grant) => grant.subject.id === id && grant.subject.kind === kind);
  const inherited = grants.filter(
    (grant) => grant.subject.kind === "all" || (grant.subject.kind === "group" && covering.has(grant.subject.id) && grant.subject.id !== id),
  );
  const directIds = new Set(direct.map((grant) => grant.grantee.id));
  const candidates = (social?.people.connections ?? []).filter((person) => !directIds.has(person.id));
  const links = (social?.links ?? []).filter((l) => l.subject.id === id);
  const shared = (record as { shared?: boolean }).shared === true;

  const inviteLink = (role: Role) =>
    run(async () => {
      const url = await createInviteLink({ kind, id }, role);
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      setLink(url);
    });

  return (
    <div className="share-section">
      {kind === "row" ? (
        <label className="checkbox-line" title={shared ? undefined : describePublishImpact(dataset, id)}>
          <input type="checkbox" checked={shared} onChange={(event) => setRowShared(id, event.target.checked)} />
          🔗 Published — people who can view the group it is in see it
        </label>
      ) : (
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={(record as { shareByDefault?: boolean }).shareByDefault === true}
            onChange={(event) => setGroupShareByDefault(id, event.target.checked)}
          />
          New timelines in here start published
        </label>
      )}

      <div className="popover-title">Who has access</div>
      {direct.length === 0 && inherited.length === 0 && <div className="hint">Only you.</div>}
      {direct.map((grant) => (
        <DirectGrant key={grant.id} grant={grant} onChange={(role) => run(() => grantAccess(grant.grantee.id, grant.subject, role))} />
      ))}
      {inherited.map((grant) => (
        <div key={grant.id} className="share-invite-row">
          <span className="share-invite-label">
            {grant.grantee.name} can {roleVerb(grant.role)}
            {grant.role === "viewer" && kind === "row" && !shared ? " (once published)" : ""} —{" "}
            {grant.subject.kind === "all" ? "shares everything" : "shares a group it is in"}
          </span>
        </div>
      ))}

      {candidates.length > 0 && <div className="popover-title">Add someone you are connected to</div>}
      {candidates.map((person) => (
        <div key={person.id} className="share-invite-row">
          <span className="share-invite-label">{person.name}</span>
          <button type="button" className="small-button" onClick={() => run(() => grantAccess(person.id, { kind, id }, "viewer"))}>
            View
          </button>
          <button type="button" className="small-button" onClick={() => run(() => grantAccess(person.id, { kind, id }, "editor"))}>
            Edit
          </button>
        </div>
      ))}

      <div className="popover-title">Invite someone new</div>
      <div className="share-invite-row">
        <button type="button" className="small-button" onClick={() => inviteLink("viewer")}>
          🔗 Link to view
        </button>
        <button type="button" className="small-button" onClick={() => inviteLink("editor")}>
          🔗 Link to edit
        </button>
      </div>
      {link !== null && (
        <div className="copyable-link">
          <input readOnly value={link} onFocus={(event) => event.target.select()} />
          <div className="hint">Copied. It works once, for 30 days, and connects you with whoever opens it.</div>
        </div>
      )}

      <div className="popover-title">Public link</div>
      {links.length === 0 ? (
        <button
          type="button"
          className="small-button"
          onClick={() =>
            run(async () => {
              const url = await createPublicLink({ kind, id });
              await navigator.clipboard?.writeText(url).catch(() => undefined);
              setLink(url);
            })
          }
        >
          🌐 Create a link anyone can view
        </button>
      ) : (
        links.map((l) => (
          <div key={l.id} className="share-invite-row">
            <span className="share-invite-label">Anyone with the link can view the published part</span>
            <button type="button" className="small-button" onClick={() => run(() => deletePublicLink(l.id))}>
              Turn off
            </button>
          </div>
        ))
      )}
      {error !== null && <div className="note">{error}</div>}
      <div className="hint">
        Viewers only ever see published timelines; editors see and change everything in here. Shared data is
        stored readable by the server, and sharing is not recallable.
      </div>
    </div>
  );
}

function DirectGrant({ grant, onChange }: { grant: GrantInfo; onChange: (role: Role) => void }) {
  return (
    <div className="share-invite-row">
      <span className="share-invite-label">{grant.grantee.name}</span>
      <PillSelector<Role>
        options={[
          { value: "viewer", icon: "👁", label: "View" },
          { value: "editor", icon: "✎", label: "Edit" },
        ]}
        value={grant.role}
        onChange={onChange}
      />
      <button type="button" className="small-button" title="Stop sharing with them" onClick={() => void revokeGrant(grant.id)}>
        ✕
      </button>
    </div>
  );
}
