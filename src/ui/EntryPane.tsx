// The third pane of the timeline sheet: one entry, editable.
//
// Same store fields and same actions as the desktop DetailPanel — no second
// source of truth. The title and subtitle are not here but in the sheet's
// header, so that the peek anchor answers "what is this?" without opening.

import type { TimelineEntry } from "../model/types";
import { updateEntry } from "../state/actions";
import { isForeignId } from "../state/store";
import { DateRangeEditor } from "./DateRangeEditor";

export function EntryPane({ entry }: { entry: TimelineEntry }) {
  const readOnly = isForeignId(entry.id);
  const change = (patch: Partial<TimelineEntry>) => updateEntry(entry.id, patch);

  return (
    <>
      <div className="sheet-section">When</div>
      <DateRangeEditor start={entry.start} end={entry.end} disabled={readOnly} onChange={change} />

      {/* Only ever appears on the bar, and only when the full title won't fit
          (pickBarLabel decides), so it sits below the things you always edit. */}
      <div className="sheet-section">Short name</div>
      <input
        className="entry-short-title"
        type="text"
        placeholder="Used on the timeline when the name is too long"
        value={entry.shortTitle ?? ""}
        disabled={readOnly}
        onChange={(event) => change({ shortTitle: event.target.value || undefined })}
      />

      <div className="sheet-section">Notes</div>
      <textarea
        className="entry-note"
        rows={3}
        placeholder="Add a note…"
        value={entry.description ?? ""}
        disabled={readOnly}
        onChange={(event) => change({ description: event.target.value || undefined })}
      />
    </>
  );
}
