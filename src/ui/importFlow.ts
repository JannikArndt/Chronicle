// The whole "Import JSON…" gesture: pick a file, refuse anything that is not a
// valid Chronicle export, and confirm before replacing what is already there.
//
// Both menus — the desktop Data menu and the mobile ⋯ — need exactly this, and
// the two copies that used to exist were one edit away from disagreeing about
// whether to confirm. An import that replaced a dataset without asking is a
// data-loss bug, so it lives in one place.

import { replaceDataset } from "../state/actions";
import { triggerImportFlow } from "../storage/exportImport";

// `report` receives whatever the user should be told — an error, or that the
// import happened. How it is shown (inline text, an alert) is the caller's.
export function importDatasetWithConfirmation(report: (message: string) => void): void {
  triggerImportFlow((result) => {
    if (!result.ok) {
      report(result.error);
      return;
    }
    const counts = `${result.dataset.entries.length} entries in ${result.dataset.rows.length} rows`;
    if (!window.confirm(`Replace your current data with this import (${counts})? This cannot be undone.`)) {
      return;
    }
    replaceDataset(result.dataset);
    report("Imported.");
  });
}
