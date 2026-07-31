// The rail's job on mobile: a pull-up sheet listing every timeline, and a
// per-timeline settings pane one tap deeper.
//
// Rows NAVIGATE here; on desktop they toggle. That difference in information
// architecture is why this is a separate component rather than a restyled
// RowRail — see plans/mobile-shell.md.

import { useState } from "react";
import type { Ref } from "react";
import { collectRowCascade, describeCascade } from "../model/cascade";
import type { TimelineRow } from "../model/types";
import { deleteRowWithCascade, selectEntry, toggleRowHidden, updateRow } from "../state/actions";
import { isPublicId, mergedDataset, useAppState } from "../state/store";
import type { Layout } from "../render/layout";
import { BottomSheet } from "./BottomSheet";
import type { BottomSheetHandle } from "./BottomSheet";

// Six row colours that read clearly against both themes at bar height. Row
// colours are data (any CSS colour is valid), so these are quick picks, not a
// palette the model knows about.
const ROW_COLOR_PICKS = ["#b45309", "#4f6fa8", "#7c6aa6", "#3f7d54", "#a8433b", "#8a7a2f"];
const ROW_ICON_PICKS = ["💼", "🏠", "❤️", "🎓", "✈️", "🎨", "⚽", "🐕"];

interface RowSheetProps {
  layout: Layout;
  anchors: number[];
  open: boolean;
  onClose: () => void;
  onPositionChange: (position: number) => void;
  sheetHandleRef: Ref<BottomSheetHandle>;
  // Called when a row's entry is tapped, so the shell can open the inspector.
  onOpenEntry: (entryId: string) => void;
  // Navigating into a sub-pane pulls a peeking sheet up, so the pane isn't read
  // through a 96px slot.
  raiseSheet: () => void;
}

export function RowSheet({
  layout,
  anchors,
  open,
  onClose,
  onPositionChange,
  sheetHandleRef,
  onOpenEntry,
  raiseSheet,
}: RowSheetProps) {
  const state = useAppState((s) => s);
  const merged = mergedDataset(state);
  const [settingsRowId, setSettingsRowId] = useState<string | null>(null);

  const self = merged.people.find((person) => person.id === state.dataset.selfPersonId);
  const rowCount = layout.items.filter((item) => item.kind === "row").length;
  const birthYear = self?.birthDate === undefined ? null : new Date(self.birthDate).getUTCFullYear();
  const summary = [birthYear === null ? null : `b. ${birthYear}`, `${rowCount} timelines`]
    .filter(Boolean)
    .join(" · ");

  const openRowSettings = (rowId: string) => {
    setSettingsRowId(rowId);
    raiseSheet();
  };

  return (
    <BottomSheet
      ref={sheetHandleRef}
      className="row-sheet"
      anchors={anchors}
      open={open}
      closable
      onClose={onClose}
      onPositionChange={onPositionChange}
      header={
        <div className="sheet-title-row">
          <span className="sheet-title">{self?.label ?? "Your timelines"}</span>
          <span className="sheet-sub">{summary}</span>
        </div>
      }
    >
      {settingsRowId === null ? (
        <TimelineList layout={layout} onOpenRow={openRowSettings} />
      ) : (
        <RowSettingsPane
          rowId={settingsRowId}
          onBack={() => setSettingsRowId(null)}
          onOpenEntry={onOpenEntry}
        />
      )}
    </BottomSheet>
  );
}

// Rendered from the same computeLayout() result the canvas paints from, so the
// list can never drift from what is on screen. Groups are section headers —
// an early flat list read as "where did my grouping go".
function TimelineList({ layout, onOpenRow }: { layout: Layout; onOpenRow: (rowId: string) => void }) {
  const state = useAppState((s) => s);
  const merged = mergedDataset(state);
  const hidden = new Set(state.hiddenRowIds);

  return (
    <>
      {layout.items.map((item) => {
        if (item.kind === "group") {
          return (
            <div key={item.id} className="sheet-section">
              {item.group?.label}
            </div>
          );
        }
        if (item.kind === "person") {
          return (
            <div key={item.id} className="sheet-subsection">
              {item.person?.label}
            </div>
          );
        }
        const row = item.row!;
        const entryCount = merged.entries.filter((entry) => entry.rowId === row.id).length;
        return (
          <button
            key={row.id}
            type="button"
            className={`sheet-row ${hidden.has(row.id) ? "sheet-row-hidden" : ""}`}
            style={{ paddingLeft: 8 + item.depth * 14 }}
            onClick={() => onOpenRow(row.id)}
          >
            <span className="sheet-row-emoji">{row.icon ?? "🏷️"}</span>
            <span className="sheet-row-label">{row.label}</span>
            <span className="sheet-row-count">{entryCount}</span>
            <span className="sheet-chevron">›</span>
          </button>
        );
      })}
    </>
  );
}

function RowSettingsPane({
  rowId,
  onBack,
  onOpenEntry,
}: {
  rowId: string;
  onBack: () => void;
  onOpenEntry: (entryId: string) => void;
}) {
  const state = useAppState((s) => s);
  const merged = mergedDataset(state);
  const row = merged.rows.find((candidate) => candidate.id === rowId);
  if (!row) return null;

  const readOnly = isPublicId(row.id);
  const group = merged.groups.find((candidate) => candidate.id === row.groupId);
  const visible = !state.hiddenRowIds.includes(row.id);
  const entries = merged.entries
    .filter((entry) => entry.rowId === row.id)
    .sort((a, b) => a.start.ms - b.start.ms);

  return (
    <>
      <button type="button" className="sheet-back" onClick={onBack}>
        ‹ All timelines
      </button>
      <div className="row-settings-head">
        <span className="row-settings-emoji">{row.icon ?? "🏷️"}</span>
        <span className="row-settings-name">{row.label}</span>
      </div>

      <div className="sheet-section">Group</div>
      <div className="sheet-row sheet-row-static">
        <span className="sheet-row-label">{group?.label ?? "—"}</span>
        <span className="sheet-soon-tag">moving soon</span>
      </div>

      <button type="button" className="sheet-row" onClick={() => toggleRowHidden(row.id)}>
        <span className="sheet-row-label">Show on timeline</span>
        <span className={`switch ${visible ? "switch-on" : ""}`} role="switch" aria-checked={visible} />
      </button>

      {!readOnly && <RowAppearance row={row} />}

      <div className="sheet-section">Entries · {entries.length}</div>
      {entries.length === 0 && <div className="sheet-empty">Nothing on this timeline yet.</div>}
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="sheet-row"
          onClick={() => {
            selectEntry(entry.id);
            onOpenEntry(entry.id);
          }}
        >
          <span className="sheet-row-label">{entry.title}</span>
          <span className="sheet-row-count">
            {new Date(entry.start.ms).getUTCFullYear()}–
            {entry.end ? new Date(entry.end.ms).getUTCFullYear() : "now"}
          </span>
          <span className="sheet-chevron">›</span>
        </button>
      ))}

      {!readOnly && (
        <button
          type="button"
          className="sheet-danger-button"
          onClick={() => {
            const cascade = collectRowCascade(state.dataset, row.id);
            if (window.confirm(`Delete row “${row.label}”? ${describeCascade(cascade)}`)) {
              deleteRowWithCascade(row.id);
              onBack();
            }
          }}
        >
          Remove timeline
        </button>
      )}
    </>
  );
}

// Colour and icon are the row's own fields now that Category is gone — the
// canvas, this sheet and the minimap all read them from here.
function RowAppearance({ row }: { row: TimelineRow }) {
  return (
    <>
      <div className="sheet-section">Colour</div>
      <div className="pick-row">
        {ROW_COLOR_PICKS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Colour ${color}`}
            className={`color-dot ${row.color === color ? "color-dot-selected" : ""}`}
            style={{ background: color }}
            onClick={() => updateRow(row.id, { color })}
          />
        ))}
      </div>

      <div className="sheet-section">Icon</div>
      <div className="pick-row">
        {ROW_ICON_PICKS.map((icon) => (
          <button
            key={icon}
            type="button"
            className={`icon-pick ${row.icon === icon ? "icon-pick-selected" : ""}`}
            onClick={() => updateRow(row.id, { icon })}
          >
            {icon}
          </button>
        ))}
      </div>
    </>
  );
}
