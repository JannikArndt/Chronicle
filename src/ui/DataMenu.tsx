// Export / import — the v1 sync path (§3). Import validates before touching
// IndexedDB. Gist sync is a KNOWN GAP, deliberately not faked (§7):
// pasting a personal access token works for power users but is not a
// solution for non-technical users, and that problem is still open.

import { useRef, useState } from "react";
import { parseImportFile, triggerDownload } from "../storage/exportImport";
import { replaceDataset } from "../state/actions";
import { useAppState } from "../state/store";

export function DataMenu() {
  const dataset = useAppState((s) => s.dataset);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const result = parseImportFile(await file.text());
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    const counts = `${result.dataset.entries.length} entries in ${result.dataset.rows.length} rows`;
    if (window.confirm(`Replace your current data with this import (${counts})? This cannot be undone.`)) {
      replaceDataset(result.dataset);
      setMessage("Imported.");
    }
  };

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
              <button type="button" className="menu-item" onClick={() => fileInputRef.current?.click()}>
                ⬆️ Import JSON…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                  event.target.value = "";
                }}
              />
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
