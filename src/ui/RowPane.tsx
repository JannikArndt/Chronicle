// The second pane of the timeline sheet: one timeline's identity, then its
// entries and its events, then a way to add another of either.
//
// It leads with identity (icon, colour, name — all three tapped to change),
// because that is what you came here to recognise. Navigation chrome (the back
// link, the ⋯ menu) belongs to the sheet, not to this pane.

import { useState } from "react";
import type { ReactNode } from "react";
import { moveRow, setRowShared, updateRow } from "../state/actions";
import { describePublishImpact } from "../model/sharing";
import { ancestorGroups } from "../model/dataset";
import { formatByPrecision } from "../model/fuzzyDate";
import { isForeignId, isPublicId, mergedDataset, useAppState } from "../state/store";
import { EditableLine } from "./EditableLine";
import { nextEntryStartMs } from "./nextEntryStart";
import { SheetMenuPicker } from "./SheetMenu";

// Six row colours that read clearly against both themes at bar height. Row
// colours are data (any CSS colour is valid), so these are quick picks, not a
// palette the model knows about.
const ROW_COLOR_PICKS = ["#b45309", "#4f6fa8", "#7c6aa6", "#3f7d54", "#a8433b", "#8a7a2f"];
const ROW_ICON_PICKS = ["💼", "🏠", "❤️", "🎓", "✈️", "🎨", "⚽", "🐕"];

// Which of the pane's popovers is open — the icon grid or the colour grid.
type OpenPicker = "none" | "icon" | "color";

export function RowPane({
  rowId,
  movingToGroup,
  onCloseGroupPicker,
  onOpenEntry,
  onOpenEvent,
  onAddEntry,
  onAddEvent,
}: {
  rowId: string;
  // The "Move to another group…" picker is opened from the sheet's ⋯ menu, but
  // it belongs on screen next to the timeline it will move.
  movingToGroup: boolean;
  onCloseGroupPicker: () => void;
  onOpenEntry: (entryId: string) => void;
  onOpenEvent: (eventId: string) => void;
  onAddEntry: (rowId: string, startMs: number) => void;
  onAddEvent: (rowId: string) => void;
}) {
  const state = useAppState((s) => s);
  const [picker, setPicker] = useState<OpenPicker>("none");
  const signedIn = useAppState((s) => s.sharing.session !== undefined);
  const merged = mergedDataset(state);
  const row = merged.rows.find((candidate) => candidate.id === rowId);
  if (!row) return null;

  const readOnly = isForeignId(row.id);
  const entries = merged.entries
    .filter((entry) => entry.rowId === row.id)
    .sort((a, b) => a.start.ms - b.start.ms);
  const events = merged.events
    .filter((event) => event.rowId === row.id)
    .sort((a, b) => a.date.ms - b.date.ms);

  // Public groups are read-only, so they are never a destination.
  const ownGroups = state.dataset.groups.filter((group) => !isPublicId(group.id));

  return (
    <>
      {/* The popovers live inside this wrapper so they drop directly beneath the
          row they belong to — anchored anywhere else they resolve against the
          whole sheet and land off the bottom of the screen. */}
      <div className="row-settings-identity">
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

        {movingToGroup && (
          <SheetMenuPicker
            title="Move to group"
            // A nested group is named under its full ancestor chain
            // ("Family › Finn › Finn's kid"), because on its own "Finn's kid"
            // doesn't say where in the list you'd find it.
            options={ownGroups.map((group) => {
              const path = [...ancestorGroups(state.dataset, group.id).reverse(), group];
              return {
                id: group.id,
                label: path.map((g) => g.label).join(" › "),
                current: group.id === row.groupId,
              };
            })}
            // `moveRow`, not `updateRow({ groupId })`: moving is also a
            // reposition, and the row has to land at the end of the target
            // group's rows rather than keep its old index in the array.
            onPick={(groupId) => moveRow(row.id, groupId, null)}
            onDismiss={onCloseGroupPicker}
          />
        )}
      </div>

      {/* The publish switch, same rule as the desktop rail: private until
          someone says otherwise, and legible without hovering (there is no
          hovering here anyway). Hidden entirely when signed out. */}
      {!readOnly && signedIn && (
        <button
          type="button"
          className="sheet-row"
          onClick={() => setRowShared(row.id, row.shared !== true)}
        >
          <span>{row.shared === true ? "🔗 Shared" : "🔒 Private"}</span>
          <span className="hint">
            {row.shared === true ? "Tap to make private" : describePublishImpact(state.dataset, row.id)}
          </span>
        </button>
      )}

      <div className="sheet-section">Entries · {entries.length}</div>
      {entries.length === 0 && <div className="sheet-empty">Nothing on this timeline yet.</div>}
      {entries.map((entry) => (
        <button key={entry.id} type="button" className="sheet-row" onClick={() => onOpenEntry(entry.id)}>
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
          className="sheet-add-row"
          onClick={() => onAddEntry(row.id, nextEntryStartMs(entries, Date.now()))}
        >
          ＋ Add an entry
        </button>
      )}

      <div className="sheet-section">Events · {events.length}</div>
      {events.length === 0 && <div className="sheet-empty">No moments marked on this timeline.</div>}
      {events.map((event) => (
        <button key={event.id} type="button" className="sheet-row" onClick={() => onOpenEvent(event.id)}>
          <span className="sheet-row-label">
            {event.icon ? `${event.icon} ` : ""}
            {event.title}
          </span>
          <span className="sheet-row-count">{formatByPrecision(event.date)}</span>
          <span className="sheet-chevron">›</span>
        </button>
      ))}

      {/* Same flow as adding an entry, opened on the answer that makes it a
          moment — one add idiom on mobile, not two. */}
      {!readOnly && (
        <button
          type="button"
          className="sheet-add-row"
          onClick={() => onAddEvent(row.id)}
        >
          ◆ Add an event
        </button>
      )}
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
