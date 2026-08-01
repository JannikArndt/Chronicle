// Export / import — the v1 sync path (§3). Import validates before touching
// IndexedDB. Gist sync is a KNOWN GAP, deliberately not faked (§7):
// pasting a personal access token works for power users but is not a
// solution for non-technical users, and that problem is still open.

import { useState } from "react";
import { triggerDownload } from "../storage/exportImport";
import { useAppState } from "../state/store";
import { importDatasetWithConfirmation } from "./importFlow";

export function DataMenu() {
  const dataset = useAppState((s) => s.dataset);
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
              <button type="button" className="menu-item" onClick={() => triggerDownload(dataset)}>
                ⬇️ Export JSON
              </button>
              <button type="button" className="menu-item" onClick={handleImport}>
                ⬆️ Import JSON…
              </button>
              <div className="hint">
                Your data lives only in this browser (IndexedDB) — export regularly to back it up or
                move devices.
              </div>
              <button type="button" className="menu-item" disabled title="Not built yet">
                ☁️ Sync via GitHub Gist — planned
              </button>
              <div className="hint">
                Known gap: Gist sync via personal access token suits power users only; a
                non-technical-user story doesn't exist yet and isn't faked here.
              </div>
              {message && <div className="note">{message}</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
