// The desktop sharing surface: a top-bar popover wrapping `SharingPanel`.
//
// Absent from the top bar entirely when the build has no Supabase project, so a
// fresh clone looks exactly as Chronicle did before sharing existed. Signing in
// is the opt-in, and until it happens nothing here touches the network.
//
// The mobile shell has no top bar; it reaches the same panel through the ⋯ menu
// (`MobileShell.tsx`).

import { useState } from "react";
import { SharingPanel } from "./SharingPanel";
import { useAppState } from "../state/store";

export function SharingMenu() {
  const configured = useAppState((s) => s.sharing.configured);
  const signedIn = useAppState((s) => s.sharing.session !== undefined);
  const [open, setOpen] = useState(false);

  if (!configured) return null;

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
              <SharingPanel />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
