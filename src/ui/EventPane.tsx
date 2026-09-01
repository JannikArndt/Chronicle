// The sheet's fourth pane: one event, editable.
//
// Shorter than `EntryPane` on purpose — an event is a moment, so there is one
// date instead of a range, no "still ongoing" and no short name (a pin's label
// is already clamped to whatever room the next pin leaves). The title and icon
// live in the sheet's header, exactly as an entry's do, so the peek state
// answers "what is this?" without opening.

import type { TimelineEvent } from "../model/types";
import { snapMsToPrecision } from "../model/fuzzyDate";
import { updateEvent } from "../state/actions";
import { isForeignId } from "../state/store";
import { DateBlock } from "./DateRangeEditor";

export function EventPane({ event }: { event: TimelineEvent }) {
  const readOnly = isForeignId(event.id);
  const change = (patch: Partial<TimelineEvent>) => updateEvent(event.id, patch);

  return (
    <>
      <div className="sheet-section">When</div>
      <div className="date-editor">
        <div className="date-editor-blocks">
          <DateBlock
            caption="Happened"
            value={event.date}
            disabled={readOnly}
            onCommitMs={(ms, precision) => change({ date: { ...event.date, ms, precision } })}
            // Coarsening a date re-anchors it mid-period, the same rule the
            // range editor follows — otherwise "1998" would keep a day and a
            // month nobody chose.
            onCommitPrecision={(precision) =>
              change({ date: { ...event.date, ms: snapMsToPrecision(event.date.ms, precision), precision } })
            }
            refuseOngoing="A moment has one date — “still ongoing” belongs to an entry."
          />
        </div>
        <div className="hint">Events appear on the timeline once you zoom in.</div>
      </div>

      <div className="sheet-section">Notes</div>
      <textarea
        className="entry-note"
        rows={3}
        placeholder="Add a note…"
        value={event.description ?? ""}
        disabled={readOnly}
        onChange={(input) => change({ description: input.target.value || undefined })}
      />
    </>
  );
}
