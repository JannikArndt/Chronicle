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
import { SheetMenu } from "./SheetMenu";
import type { SheetMenuItem } from "./SheetMenu";

interface EntrySheetProps {
  anchors: number[];
  open: boolean;
  onClose: () => void;
  onPositionChange: (position: number) => void;
  sheetHandleRef: Ref<BottomSheetHandle>;
  // Navigates up to the timeline this entry sits on. Until the two sheets merge
  // into one navigable stack, that means closing this sheet and opening the
  // other on the right pane — which the shell owns, not this component.
  onOpenTimeline: (rowId: string) => void;
}

// An entry's own dates, as one line — the stand-in subtitle for entries that
// have none, so the peek state never shows an empty second line.
function dateRangeText(entry: TimelineEntry): string {
  const start = formatByPrecision(entry.start);
  return entry.end ? `${start} – ${formatByPrecision(entry.end)}` : `${start} – still ongoing`;
}

export function EntrySheet({
  anchors,
  open,
  onClose,
  onPositionChange,
  sheetHandleRef,
  onOpenTimeline,
}: EntrySheetProps) {
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
  const change = (patch: Partial<TimelineEntry>) => updateEntry(shown.id, patch);

  const removeEntry = () => {
    const cascade = collectEntryCascade(state.dataset, shown.id);
    if (window.confirm(`Delete “${shown.title}”? ${describeCascade(cascade)}`)) {
      deleteEntryWithCascade(shown.id);
      onClose();
    }
  };

  // A draft has nothing to remove yet — it is not in the dataset until titled.
  const menuItems: SheetMenuItem[] =
    readOnly || isDraft ? [] : [{ label: "Remove from timeline", onSelect: removeEntry, danger: true }];

  return (
    <BottomSheet
      ref={sheetHandleRef}
      className="entry-sheet"
      anchors={anchors}
      // Half, not peek: an entry opened from the timeline list was already
      // being read, and dropping it to a header-sized slot hides what you came
      // for. Tapping a bar on the canvas is the same act one step earlier.
      initialAnchorIndex={1}
      open={open}
      closable
      onClose={onClose}
      onPositionChange={onPositionChange}
      header={
        <div className="sheet-title-stack">
          <div className="pane-topbar">
            {row && (
              <button type="button" className="sheet-back" onClick={() => onOpenTimeline(row.id)}>
                ‹ {row.icon ?? "🏷️"} {row.label}
              </button>
            )}
            <SheetMenu items={menuItems} />
          </div>
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

      {/* Only ever appears on the bar, and only when the full title won't fit
          (pickBarLabel decides), so it sits below the things you always edit. */}
      <div className="sheet-section">Short name</div>
      <input
        className="entry-short-title"
        type="text"
        placeholder="Used on the timeline when the name is too long"
        value={shown.shortTitle ?? ""}
        disabled={readOnly}
        onChange={(event) => change({ shortTitle: event.target.value || undefined })}
      />

      <div className="sheet-section">Notes</div>
      <textarea
        className="entry-note"
        rows={3}
        placeholder="Add a note…"
        value={shown.description ?? ""}
        disabled={readOnly}
        onChange={(event) => change({ description: event.target.value || undefined })}
      />
    </BottomSheet>
  );
}

