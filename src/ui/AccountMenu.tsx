// The desktop top bar's account popover, wrapping `AccountPanel`. The button
// says who you are and whether you are in sync, and who else is online —
// the mobile shell reaches the same panel through its ⋯ menu.

import { useState } from "react";
import { AccountPanel } from "./AccountPanel";
import { useAppState } from "../state/store";

export function AccountMenu() {
  const account = useAppState((s) => s.sync.account);
  const status = useAppState((s) => s.sync.status);
  const peers = useAppState((s) => s.sync.peers);
  const incoming = useAppState((s) => s.sync.social?.people.incoming.length ?? 0);
  const [open, setOpen] = useState(false);
  const others = [...new Set(peers.filter((peer) => peer.accountId !== account?.id).map((peer) => peer.name))];

  return (
    <div className="data-menu">
      <button
        type="button"
        className="small-button account-button"
        title={others.length > 0 ? `Online now: ${others.join(", ")}` : undefined}
        onClick={() => setOpen(!open)}
      >
        {account === undefined ? (
          "Sign in"
        ) : (
          <>
            <span className={`sync-dot sync-status-${status}`} aria-hidden="true" />
            {account.name}
            {others.length > 0 && <span className="peer-count">👥 {others.length}</span>}
            {incoming > 0 && <span className="request-badge">{incoming}</span>}
          </>
        )}{" "}
        {open ? "▴" : "▾"}
      </button>
      {open && (
        <>
          <div className="popover-backdrop" onClick={() => setOpen(false)} />
          <div className="popover data-menu-popover account-popover">
            <div className="popover-form">
              <AccountPanel />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
