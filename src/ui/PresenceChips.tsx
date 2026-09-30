// "Dad is here too": who else has this entry, event or timeline open right
// now. The server only reports someone's focus to people who can see the
// same record, so anything that arrives here is safe to show.
//
// This is the mitigation for the one thing field-level merging cannot do —
// two people typing into the same field at the same moment, where the later
// keystroke wins. Seeing each other is how two people avoid that.

import { useAppState } from "../state/store";

export function PresenceChips({ ids }: { ids: string[] }) {
  const peers = useAppState((s) => s.sync.peers);
  const me = useAppState((s) => s.sync.account?.id);
  const here = peers.filter((peer) => peer.focusId !== null && ids.includes(peer.focusId));
  if (here.length === 0) return null;
  const names = [...new Set(here.map((peer) => (peer.accountId === me ? "You, on another device" : peer.name)))];
  return (
    <div className="presence-chips" aria-live="polite">
      {names.map((name) => (
        <span key={name} className="presence-chip">
          <span className="online-dot" aria-hidden="true" />
          {name}
        </span>
      ))}
    </div>
  );
}
