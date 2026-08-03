// One sheet, three panes: all timelines → one timeline → one entry.
//
// It used to be two sheets that swapped places, which lost the height you had
// dragged to and offered no way back. Here the panes slide sideways inside a
// single sheet, exactly like a phone's navigation stack, and the sheet itself
// never moves unless you move it.
//
// The stack is *derived*, never stored: an entry selection means the entry pane,
// otherwise an opened timeline means the row pane, otherwise the list. The
// canvas, the list and search all select through the same actions, so all three
// routes have to land in the same place — and they do, because none of them
// touches this component.

import { useState } from "react";
import type { MutableRefObject } from "react";
import { collectEntryCascade, collectRowCascade, describeCascade } from "../model/cascade";
import { formatByPrecision } from "../model/fuzzyDate";
import type { TimelineEntry } from "../model/types";
import type { TimelineEngine } from "../render/engine";
import type { Layout } from "../render/layout";
import {
  clearSelection,
  deleteEntryWithCascade,
  deleteRowWithCascade,
  selectEntry,
  toggleRowHidden,
  updateEntry,
} from "../state/actions";
import { isPublicId, mergedDataset, useAppState } from "../state/store";
import { BottomSheet } from "./BottomSheet";
import { centerOnEntry } from "./centerOnEntry";
import type { BottomSheetHandle } from "./BottomSheet";
import { EditableLine } from "./EditableLine";
import { EntryPane } from "./EntryPane";
import { RowPane } from "./RowPane";
import { SheetMenu } from "./SheetMenu";
import type { SheetMenuItem } from "./SheetMenu";
import { TimelineListPane } from "./TimelineListPane";

type PaneName = "list" | "row" | "entry";
const PANE_DEPTH: Record<PaneName, number> = { list: 0, row: 1, entry: 2 };

interface TimelineSheetProps {
  layout: Layout;
  anchors: number[];
  open: boolean;
  onClose: () => void;
  onPositionChange: (position: number) => void;
  sheetHandleRef: MutableRefObject<BottomSheetHandle | null>;
  engineRef: MutableRefObject<TimelineEngine | null>;
  // Navigating deeper pulls a peeking sheet up, so a pane isn't read through a
  // 96px slot.
  raiseSheet: () => void;
  // Which timeline is open. Owned by the shell because the pane stack is
  // derived from it and from the store, and neither belongs to this component.
  settingsRowId: string | null;
  onOpenRowSettings: (rowId: string) => void;
  onCloseRowSettings: () => void;
  onAddEntry: (rowId: string, startMs: number) => void;
  onAddTimeline: () => void;
}

// An entry's own dates, as one line — the stand-in subtitle for entries that
// have none, so the peek state never shows an empty second line.
function dateRangeText(entry: TimelineEntry): string {
  const start = formatByPrecision(entry.start);
  return entry.end ? `${start} – ${formatByPrecision(entry.end)}` : `${start} – still ongoing`;
}

export function TimelineSheet({
  layout,
  anchors,
  open,
  onClose,
  onPositionChange,
  sheetHandleRef,
  engineRef,
  raiseSheet,
  settingsRowId,
  onOpenRowSettings,
  onCloseRowSettings,
  onAddEntry,
  onAddTimeline,
}: TimelineSheetProps) {
  const state = useAppState((s) => s);
  const merged = mergedDataset(state);
  const entry = state.draft ?? merged.entries.find((candidate) => candidate.id === state.selectedEntryId);

  // Opened from the ⋯ menu, but shown inside the row pane next to the timeline
  // it will move.
  const [movingToGroup, setMovingToGroup] = useState(false);

  const pane: PaneName = entry ? "entry" : settingsRowId !== null ? "row" : "list";
  const row = merged.rows.find(
    (candidate) => candidate.id === (entry ? entry.rowId : settingsRowId),
  );
  // Where this timeline sits: its group, falling back to the person it names.
  // The person came first here once, which made the line stale the moment a
  // timeline was moved to another group — moving changes the group, never the
  // person, so the header went on naming where the row used to live.
  const ownerLabel = row
    ? (merged.groups.find((group) => group.id === row.groupId)?.label ??
      merged.people.find((person) => person.id === row.personId)?.label)
    : undefined;

  // Which way the panes slide. Derived by comparing against the last pane shown
  // rather than by keeping a history: there is only ever one way in and one way
  // out of a pane. Held in state and updated during render (the supported
  // "derived from props" pattern) rather than in a ref — a ref mutated during
  // render gets the wrong answer under StrictMode's double invocation, which
  // would silently make every Back animate forwards in dev.
  const depth = PANE_DEPTH[pane];
  const [slide, setSlide] = useState({ depth, direction: "forward" });
  if (slide.depth !== depth) {
    setSlide({ depth, direction: depth > slide.depth ? "forward" : "back" });
  }

  // What counts as "a different screen" — for the slide animation, and for
  // resetting the scroll position so a new pane never opens half scrolled.
  const paneKey = `${pane}:${entry?.id ?? row?.id ?? ""}`;

  const openRow = (rowId: string) => {
    onOpenRowSettings(rowId);
    raiseSheet();
  };

  // Back from an entry lands on its timeline, not on wherever you came from:
  // the entry may have been tapped on the canvas, and "up" is a place, not a
  // history. Deselecting is what closes the entry pane.
  const leaveEntry = () => {
    if (entry) onOpenRowSettings(entry.rowId);
    clearSelection();
  };

  const removeEntry = () => {
    if (!entry) return;
    const cascade = collectEntryCascade(state.dataset, entry.id);
    if (!window.confirm(`Delete “${entry.title}”? ${describeCascade(cascade)}`)) return;
    deleteEntryWithCascade(entry.id);
    leaveEntry();
  };

  const removeRow = () => {
    if (!row) return;
    const cascade = collectRowCascade(state.dataset, row.id);
    if (!window.confirm(`Delete row “${row.label}”? ${describeCascade(cascade)}`)) return;
    deleteRowWithCascade(row.id);
    onCloseRowSettings();
  };

  // Drops the sheet out of the way and moves the canvas to the entry — the
  // point of the app is the picture, and the sheet was covering it.
  const showOnTimeline = () => {
    if (!entry) return;
    centerOnEntry(engineRef.current, layout, entry, Date.now());
    // Peek, not closed: the entry stays selected and named at the bottom, so
    // "which one did I just find" has an answer.
    sheetHandleRef.current?.moveToAnchor(0);
  };

  const menuItems = buildMenuItems({
    pane,
    entryIsDraft: state.draft?.id === entry?.id,
    entryIsReadOnly: entry ? isPublicId(entry.id) : false,
    rowIsReadOnly: row ? isPublicId(row.id) : true,
    rowIsVisible: row ? !state.hiddenRowIds.includes(row.id) : false,
    canMoveGroups: state.dataset.groups.filter((group) => !isPublicId(group.id)).length > 1,
    onToggleRowHidden: () => row && toggleRowHidden(row.id),
    onMoveToGroup: () => setMovingToGroup(true),
    onRemoveRow: removeRow,
    onRemoveEntry: removeEntry,
  });

  return (
    <BottomSheet
      ref={sheetHandleRef}
      className="timeline-sheet"
      anchors={anchors}
      open={open}
      closable
      onClose={onClose}
      onPositionChange={onPositionChange}
      contentKey={paneKey}
      header={
        <div className="sheet-title-stack">
          <div className="pane-topbar">
            {pane === "list" ? (
              <span className="sheet-title">Timelines</span>
            ) : (
              <button
                type="button"
                className="sheet-back"
                onClick={pane === "entry" ? leaveEntry : onCloseRowSettings}
              >
                {pane === "entry" && row ? `‹ ${row.icon ?? "🏷️"} ${row.label}` : "‹ All timelines"}
              </button>
            )}
            {pane === "entry" && (
              <button type="button" className="sheet-locate" onClick={showOnTimeline}>
                Show on timeline
              </button>
            )}
            <SheetMenu items={menuItems} />
          </div>
          <PaneTitle pane={pane} layout={layout} entry={entry} ownerLabel={ownerLabel} />
        </div>
      }
    >
      <div className={`sheet-pane sheet-pane-${slide.direction}`} key={paneKey}>
        {pane === "list" && (
          <TimelineListPane layout={layout} onOpenRow={openRow} onAddTimeline={onAddTimeline} />
        )}
        {pane === "row" && settingsRowId !== null && (
          <RowPane
            rowId={settingsRowId}
            movingToGroup={movingToGroup && pane === "row"}
            onCloseGroupPicker={() => setMovingToGroup(false)}
            onOpenEntry={selectEntry}
            onAddEntry={onAddEntry}
          />
        )}
        {pane === "entry" && entry && <EntryPane entry={entry} />}
      </div>
    </BottomSheet>
  );
}

// The header's second line: what the pane is about. For an entry it is the
// editable title and subtitle, which is what makes the peek anchor useful.
function PaneTitle({
  pane,
  layout,
  entry,
  ownerLabel,
}: {
  pane: PaneName;
  layout: Layout;
  entry: TimelineEntry | undefined;
  // Whose timeline this is. Not the timeline's own name — that is editable in
  // the pane itself, and printing it twice made one of the two look stale.
  ownerLabel: string | undefined;
}) {
  const isDraft = useAppState((s) => s.draft?.id) === entry?.id && entry !== undefined;

  if (pane === "entry" && entry) {
    const readOnly = isPublicId(entry.id);
    return (
      <>
        <EditableLine
          className="sheet-title"
          value={entry.title}
          placeholder={isDraft ? "Name it to create it…" : "Untitled"}
          readOnly={readOnly}
          autoFocus={isDraft}
          onCommit={(title) => updateEntry(entry.id, { title })}
        />
        <EditableLine
          className="sheet-sub"
          value={entry.subtitle ?? ""}
          placeholder={dateRangeText(entry)}
          readOnly={readOnly}
          onCommit={(subtitle) => updateEntry(entry.id, { subtitle: subtitle || undefined })}
        />
      </>
    );
  }
  if (pane === "row") return <span className="sheet-sub">{ownerLabel ?? "Timeline"}</span>;

  const rowCount = layout.items.filter((item) => item.kind === "row").length;
  const groupCount = layout.items.filter((item) => item.kind === "group").length;
  return <span className="sheet-sub">{`${groupCount} groups · ${rowCount} timelines`}</span>;
}

// The ⋯ menu is the sheet's, not a pane's, so its contents are assembled in one
// place from what the current pane makes available.
function buildMenuItems({
  pane,
  entryIsDraft,
  entryIsReadOnly,
  rowIsReadOnly,
  rowIsVisible,
  canMoveGroups,
  onToggleRowHidden,
  onMoveToGroup,
  onRemoveRow,
  onRemoveEntry,
}: {
  pane: PaneName;
  entryIsDraft: boolean;
  entryIsReadOnly: boolean;
  rowIsReadOnly: boolean;
  rowIsVisible: boolean;
  canMoveGroups: boolean;
  onToggleRowHidden: () => void;
  onMoveToGroup: () => void;
  onRemoveRow: () => void;
  onRemoveEntry: () => void;
}): SheetMenuItem[] {
  // A draft has nothing to remove yet — it is not in the dataset until titled.
  if (pane === "entry") {
    return entryIsReadOnly || entryIsDraft
      ? []
      : [{ label: "Remove from timeline", onSelect: onRemoveEntry, danger: true }];
  }
  if (pane === "row") {
    return [
      { label: "Show on timeline", onSelect: onToggleRowHidden, checked: rowIsVisible },
      ...(rowIsReadOnly
        ? []
        : [
            ...(canMoveGroups ? [{ label: "Move to another group…", onSelect: onMoveToGroup }] : []),
            { label: "Remove timeline", onSelect: onRemoveRow, danger: true },
          ]),
    ];
  }
  return [];
}
