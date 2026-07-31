// The mobile presentation of the selected entry. Same store fields and same
// actions as the desktop DetailPanel — no second source of truth — but a very
// different shape: at its peek anchor it shows only the title and subtitle, so
// tapping a bar answers "what is this?" and everything else is one pull away.

import { useRef } from "react";
import type { Ref } from "react";
import { collectEntryCascade, describeCascade } from "../model/cascade";
import { formatByPrecision } from "../model/fuzzyDate";
import type { TimelineEntry } from "../model/types";
import { deleteEntryWithCascade, updateEntry } from "../state/actions";
import { isPublicId, mergedDataset, useAppState } from "../state/store";
import { BottomSheet } from "./BottomSheet";
import type { BottomSheetHandle } from "./BottomSheet";
import { DateRangeEditor } from "./DateRangeEditor";
import { EditableLine } from "./EditableLine";

interface EntrySheetProps {
  anchors: number[];
  open: boolean;
  onClose: () => void;
  onPositionChange: (position: number) => void;
  sheetHandleRef: Ref<BottomSheetHandle>;
}

// An entry's own dates, as one line — the stand-in subtitle for entries that
// have none, so the peek state never shows an empty second line.
function dateRangeText(entry: TimelineEntry): string {
  const start = formatByPrecision(entry.start);
  return entry.end ? `${start} – ${formatByPrecision(entry.end)}` : `${start} – ongoing`;
}

export function EntrySheet({ anchors, open, onClose, onPositionChange, sheetHandleRef }: EntrySheetProps) {
  const state = useAppState((s) => s);
  const merged = mergedDataset(state);
  const entry = state.draft ?? merged.entries.find((candidate) => candidate.id === state.selectedEntryId);

  // Keep the last entry while the sheet slides away, so its contents don't
  // blank out mid-animation.
  const lastEntryRef = useRef<TimelineEntry | undefined>(entry);
  if (entry) lastEntryRef.current = entry;
  const shown = entry ?? lastEntryRef.current;
  if (!shown) return null;

  const readOnly = isPublicId(shown.id);
  const isDraft = state.draft?.id === shown.id;
  const row = merged.rows.find((candidate) => candidate.id === shown.rowId);
  const group = merged.groups.find((candidate) => candidate.id === row?.groupId);
  const person = merged.people.find((candidate) => candidate.id === row?.personId);
  const change = (patch: Partial<TimelineEntry>) => updateEntry(shown.id, patch);

  return (
    <BottomSheet
      ref={sheetHandleRef}
      className="entry-sheet"
      anchors={anchors}
      open={open}
      closable
      onClose={onClose}
      onPositionChange={onPositionChange}
      header={
        <div className="sheet-title-stack">
          <EditableLine
            className="sheet-title"
            value={shown.title}
            placeholder={isDraft ? "Name it to create it…" : "Untitled"}
            readOnly={readOnly}
            autoFocus={isDraft}
            onCommit={(title) => change({ title })}
          />
          <EditableLine
            className="sheet-sub"
            value={shown.subtitle ?? ""}
            placeholder={dateRangeText(shown)}
            readOnly={readOnly}
            onCommit={(subtitle) => change({ subtitle: subtitle || undefined })}
          />
        </div>
      }
    >
      <div className="sheet-section">When</div>
      <DateRangeEditor start={shown.start} end={shown.end} disabled={readOnly} onChange={change} />

      <div className="sheet-section">Connected</div>
      <div className="entry-chips">
        {group && group.label !== row?.label && <span className="entry-chip">{group.label}</span>}
        {row && (
          <span className="entry-chip">
            {row.icon ?? "🏷️"} {row.label}
          </span>
        )}
        {person && <span className="entry-chip">👤 {person.label}</span>}
      </div>

      <div className="sheet-section">Notes</div>
      <textarea
        className="entry-note"
        rows={3}
        placeholder="Add a note…"
        value={shown.description ?? ""}
        disabled={readOnly}
        onChange={(event) => change({ description: event.target.value || undefined })}
      />

      {!readOnly && !isDraft && (
        <button
          type="button"
          className="sheet-danger-button"
          onClick={() => {
            const cascade = collectEntryCascade(state.dataset, shown.id);
            if (window.confirm(`Delete “${shown.title}”? ${describeCascade(cascade)}`)) {
              deleteEntryWithCascade(shown.id);
              onClose();
            }
          }}
        >
          Remove from timeline
        </button>
      )}
    </BottomSheet>
  );
}

