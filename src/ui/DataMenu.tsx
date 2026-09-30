// Export / import. Import validates before touching anything. Signed in, an
// export is your own records only (`ownDataset`) and an import replaces your
// own records only — what others share with you is theirs to change.

import { useState } from "react";
import { triggerDownload } from "../storage/exportImport";
import { ownDataset, useAppState } from "../state/store";
import { importDatasetWithConfirmation } from "./importFlow";

export function DataMenu() {
  const state = useAppState((s) => s);
  const signedIn = state.sync.account !== undefined;
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleImport = () => importDatasetWithConfirmation(setMessage);

  return (
    <div className="data-menu">
      <button type="button" className="small-button" onClick={() => setOpen(!open)}>
        Data {open ? "▴" : "▾"}
      </button>
      {open && (
        <>
          <div className="popover-backdrop" onClick={() => setOpen(false)} />
          <div className="popover data-menu-popover">
            <div className="popover-form">
              <button type="button" className="menu-item" onClick={() => triggerDownload(ownDataset(state))}>
                ⬇️ Export JSON
              </button>
              <button type="button" className="menu-item" onClick={handleImport}>
                ⬆️ Import JSON…
              </button>
              <div className="hint">
                {signedIn
                  ? "An export holds your own timelines — never what others share with you. Importing replaces your own timelines in your account."
                  : "Your data lives only in this browser (IndexedDB) — export regularly, or create an account to keep it on every device."}
              </div>
              {message && <div className="note">{message}</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
