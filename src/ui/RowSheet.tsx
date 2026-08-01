// The rail's job on mobile: a pull-up sheet listing every timeline, and a
// per-timeline settings pane one tap deeper.
//
// Rows NAVIGATE here; on desktop they toggle. That difference in information
// architecture is why this is a separate component rather than a restyled
// RowRail — see plans/mobile-shell.md.

import { useState } from "react";
import type { ReactNode, Ref } from "react";
import { collectRowCascade, describeCascade } from "../model/cascade";
import { deleteRowWithCascade, selectEntry, toggleRowHidden, updateRow } from "../state/actions";
import { isPublicId, mergedDataset, useAppState } from "../state/store";
import type { Layout } from "../render/layout";
import { BottomSheet } from "./BottomSheet";
import type { BottomSheetHandle } from "./BottomSheet";
import { EditableLine } from "./EditableLine";
import { SheetMenu, SheetMenuPicker } from "./SheetMenu";
import type { SheetMenuItem } from "./SheetMenu";

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
  // Navigating into a sub-pane pulls a peeking sheet up, so the pane isn't read
  // through a 96px slot.
  raiseSheet: () => void;
  // Which timeline's pane is open, owned by the shell rather than this
  // component: the entry sheet navigates here too, and it can only do that if
  // something above both sheets holds the destination.
  settingsRowId: string | null;
  onOpenRowSettings: (rowId: string) => void;
  onCloseRowSettings: () => void;
}

export function RowSheet({
  layout,
  anchors,
  open,
  onClose,
  onPositionChange,
  sheetHandleRef,
  raiseSheet,
  settingsRowId,
  onOpenRowSettings,
  onCloseRowSettings,
}: RowSheetProps) {
  const state = useAppState((s) => s);
  const merged = mergedDataset(state);

  const self = merged.people.find((person) => person.id === state.dataset.selfPersonId);
  const rowCount = layout.items.filter((item) => item.kind === "row").length;
  const birthYear = self?.birthDate === undefined ? null : new Date(self.birthDate).getUTCFullYear();
  const summary = [birthYear === null ? null : `b. ${birthYear}`, `${rowCount} timelines`]
    .filter(Boolean)
    .join(" · ");

  const openRowSettings = (rowId: string) => {
    onOpenRowSettings(rowId);
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
        <RowSettingsPane rowId={settingsRowId} onBack={onCloseRowSettings} />
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

// Which of the pane's three popovers is open — the icon grid, the colour grid,
// or the list of groups this timeline could move to.
type OpenPicker = "none" | "icon" | "color" | "group";

// The pane leads with the timeline's identity (icon, colour, name — all three
// tapped to change), then its entries, and keeps settings and destructive
// actions out of the way at the bottom and in the ⋯ menu.
//
// Selecting an entry here opens the inspector sheet, because that sheet is
// driven by the same `selectedEntryId` the canvas writes — no extra plumbing.
function RowSettingsPane({ rowId, onBack }: { rowId: string; onBack: () => void }) {
  const state = useAppState((s) => s);
  const [picker, setPicker] = useState<OpenPicker>("none");
  const merged = mergedDataset(state);
  const row = merged.rows.find((candidate) => candidate.id === rowId);
  if (!row) return null;

  const readOnly = isPublicId(row.id);
  const visible = !state.hiddenRowIds.includes(row.id);
  const entries = merged.entries
    .filter((entry) => entry.rowId === row.id)
    .sort((a, b) => a.start.ms - b.start.ms);

  // Public groups are read-only, so they are never a destination.
  const ownGroups = state.dataset.groups.filter((group) => !isPublicId(group.id));

  const removeTimeline = () => {
    const cascade = collectRowCascade(state.dataset, row.id);
    if (window.confirm(`Delete row “${row.label}”? ${describeCascade(cascade)}`)) {
      deleteRowWithCascade(row.id);
      onBack();
    }
  };

  const menuItems: SheetMenuItem[] = readOnly
    ? []
    : [
        ...(ownGroups.length > 1
          ? [{ label: "Move to another group…", onSelect: () => setPicker("group") }]
          : []),
        { label: "Remove timeline", onSelect: removeTimeline, danger: true },
      ];

  return (
    <>
      <div className="pane-topbar">
        <button type="button" className="sheet-back" onClick={onBack}>
          ‹ All timelines
        </button>
        <SheetMenu items={menuItems} />
      </div>

      <div className="row-settings-head">
        <button
          type="button"
          className="row-settings-emoji"
          aria-label="Change icon"
          disabled={readOnly}
          onClick={() => setPicker("icon")}
        >
          {row.icon ?? "🏷️"}
        </button>
        <button
          type="button"
          className="row-settings-swatch"
          aria-label="Change colour"
          style={{ background: row.color }}
          disabled={readOnly}
          onClick={() => setPicker("color")}
        />
        <EditableLine
          className="row-settings-name"
          value={row.label}
          placeholder="Untitled timeline"
          readOnly={readOnly}
          onCommit={(label) => updateRow(row.id, { label })}
        />
      </div>

      {picker === "icon" && (
        <PickerPopover title="Icon" onDismiss={() => setPicker("none")}>
          <div className="pick-row">
            {ROW_ICON_PICKS.map((icon) => (
              <button
                key={icon}
                type="button"
                className={`icon-pick ${row.icon === icon ? "icon-pick-selected" : ""}`}
                onClick={() => {
                  updateRow(row.id, { icon });
                  setPicker("none");
                }}
              >
                {icon}
              </button>
            ))}
          </div>
        </PickerPopover>
      )}

      {picker === "color" && (
        <PickerPopover title="Colour" onDismiss={() => setPicker("none")}>
          <div className="pick-row">
            {ROW_COLOR_PICKS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Colour ${color}`}
                className={`color-dot ${row.color === color ? "color-dot-selected" : ""}`}
                style={{ background: color }}
                onClick={() => {
                  updateRow(row.id, { color });
                  setPicker("none");
                }}
              />
            ))}
          </div>
        </PickerPopover>
      )}

      {picker === "group" && (
        <SheetMenuPicker
          title="Move to group"
          options={ownGroups.map((group) => ({
            id: group.id,
            label: group.label,
            current: group.id === row.groupId,
          }))}
          onPick={(groupId) => updateRow(row.id, { groupId })}
          onDismiss={() => setPicker("none")}
        />
      )}

      <div className="sheet-section">Entries · {entries.length}</div>
      {entries.length === 0 && <div className="sheet-empty">Nothing on this timeline yet.</div>}
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="sheet-row"
          onClick={() => selectEntry(entry.id)}
        >
          <span className="sheet-row-label">{entry.title}</span>
          <span className="sheet-row-count">
            {new Date(entry.start.ms).getUTCFullYear()}–
            {entry.end ? new Date(entry.end.ms).getUTCFullYear() : "now"}
          </span>
          <span className="sheet-chevron">›</span>
        </button>
      ))}

      <div className="sheet-section">Settings</div>
      <button type="button" className="sheet-row" onClick={() => toggleRowHidden(row.id)}>
        <span className="sheet-row-label">Show on timeline</span>
        <span className={`switch ${visible ? "switch-on" : ""}`} role="switch" aria-checked={visible} />
      </button>
    </>
  );
}

// The icon and colour grids share the menu's backdrop-and-card treatment, so
// tapping the swatch feels like the same kind of thing as tapping ⋯.
function PickerPopover({
  title,
  onDismiss,
  children,
}: {
  title: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="popover-backdrop" onClick={onDismiss} />
      <div className="sheet-menu">
        <div className="sheet-menu-title">{title}</div>
        {children}
      </div>
    </>
  );
}
