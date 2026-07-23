// The row-header rail (§5): real DOM, because it needs real buttons, popovers
// and native color/date inputs. It renders from the SAME layout the canvas
// uses and is translated by the canvas scroll position every frame.

import { useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import { categoryDeleteBlockers, collectGroupCascade, collectRowCascade, describeCascade } from "../model/cascade";
import type { Layout, LayoutItem } from "../render/layout";
import type { TimelineEngine } from "../render/engine";
import {
  addGroup,
  addPersonToGroup,
  addRow,
  addSubRow,
  deleteGroupWithCascade,
  deleteRowWithCascade,
  replaceDataset,
  selectRow,
  toggleGroupCollapsed,
  toggleRowHidden,
  updateCategory,
  updatePerson,
  updateRow,
} from "../state/actions";
import { isPublicId, useAppState } from "../state/store";
import type { Category, Person } from "../model/types";
import { triggerImportFlow } from "../storage/exportImport";

const EMOJI_QUICK_PICKS = ["💼", "🏠", "❤️", "🎓", "✈️", "🎨", "⚽", "🐕"];

type PopoverState =
  | { kind: "add-menu"; groupId: string; personId?: string; top: number }
  | { kind: "person-edit"; personId: string; groupId?: string; top: number }
  | { kind: "category-edit"; rowId: string; top: number }
  | { kind: "add-sub-row"; rowId: string; top: number }
  | { kind: "add-group"; top: number }
  | { kind: "add-person"; top: number }
  | { kind: "rail-add-menu"; top: number }
  | null;

// Popovers anchored to the rail footer's "+" button open upward from the
// bottom of the rail rather than downward from a click point.
function isFooterPopover(kind: NonNullable<PopoverState>["kind"]): boolean {
  return kind === "add-group" || kind === "add-person" || kind === "rail-add-menu";
}

interface RowRailProps {
  layout: Layout;
  railContentRef: RefObject<HTMLDivElement>;
  onStartOnboarding: () => void;
  engineRef: MutableRefObject<TimelineEngine | null>;
}

export function RowRail({ layout, railContentRef, onStartOnboarding, engineRef }: RowRailProps) {
  const dataset = useAppState((s) => s.dataset);
  const publicDatasets = useAppState((s) => s.publicDatasets);
  const hiddenRowIds = useAppState((s) => s.hiddenRowIds);
  const selectedRowId = useAppState((s) => s.selectedRowId);
  const [popover, setPopover] = useState<PopoverState>(null);
  // Which rail item's action buttons are shown (§ hover-reveal). Tracked in JS
  // rather than pure CSS :hover: Safari can leave :hover "stuck" after a fast
  // mouse-exit from these absolutely-positioned, transitioned rows, but real
  // mouseenter/mouseleave events don't have that failure mode. hoveredCategoryRowId
  // is the top-level row a hovered sub-row belongs to, so a category's own
  // buttons also light up while hovering any of its nested timelines.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hoveredCategoryRowId, setHoveredCategoryRowId] = useState<string | null>(null);

  const allPeople = [...dataset.people, ...publicDatasets.flatMap((d) => d.people)];
  const allCategories = [...dataset.categories, ...publicDatasets.flatMap((d) => d.categories)];
  const personById = new Map(allPeople.map((p) => [p.id, p]));
  const categoryById = new Map(allCategories.map((c) => [c.id, c]));

  const closePopover = () => setPopover(null);

  // pushRowTree (layout.ts) emits each top-level row immediately followed by
  // all its descendants before the next one, so a single running variable is
  // enough to know which category row each item belongs to.
  const categoryRowIds: (string | null)[] = [];
  let currentCategoryRowId: string | null = null;
  for (const item of layout.items) {
    if (item.kind === "row" && item.row && !item.isSubRow) currentCategoryRowId = item.row.id;
    categoryRowIds.push(currentCategoryRowId);
  }

  return (
    <div className="rail" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rail-scroll">
        <div className="rail-content" ref={railContentRef} style={{ height: layout.totalHeight }}>
          {layout.items.map((item, index) => (
            <RailItem
              key={`${item.kind}:${item.id}`}
              item={item}
              personById={personById}
              categoryById={categoryById}
              hiddenRowIds={hiddenRowIds}
              selectedRowId={selectedRowId}
              openPopover={setPopover}
              engineRef={engineRef}
              categoryRowId={categoryRowIds[index]}
              hoveredKey={hoveredKey}
              hoveredCategoryRowId={hoveredCategoryRowId}
              onHoverEnter={(key, categoryRowId) => {
                setHoveredKey(key);
                setHoveredCategoryRowId(categoryRowId);
              }}
              onHoverLeave={() => {
                setHoveredKey(null);
                setHoveredCategoryRowId(null);
              }}
            />
          ))}
        </div>
      </div>
      <div className="rail-footer">
        {dataset.selfPersonId === undefined && (
          <button type="button" className="small-button" onClick={onStartOnboarding}>
            ✨ Set up your timeline
          </button>
        )}
        <button
          type="button"
          className="rail-add-button"
          title="Add group, person, or import…"
          onClick={() => setPopover({ kind: "rail-add-menu", top: 0 })}
        >
          ＋
        </button>
      </div>
      {popover && (
        <Popover popover={popover} open={setPopover} close={closePopover} onStartOnboarding={onStartOnboarding} />
      )}
    </div>
  );
}

function computedAge(person: Person): string | null {
  if (person.birthDate === undefined) return null;
  const years = (Date.now() - person.birthDate) / (365.25 * 86_400_000);
  return years >= 0 ? `${Math.floor(years)}` : null;
}

function lifeSpanRange(birthDate: number): { startMs: number; endMs: number } {
  const now = Date.now();
  const padding = (now - birthDate) * 0.05;
  return { startMs: birthDate - padding, endMs: now + padding };
}

interface RailItemProps {
  item: LayoutItem;
  personById: Map<string, Person>;
  categoryById: Map<string, Category>;
  hiddenRowIds: string[];
  selectedRowId?: string;
  openPopover: (p: PopoverState) => void;
  engineRef: MutableRefObject<TimelineEngine | null>;
  categoryRowId: string | null;
  hoveredKey: string | null;
  hoveredCategoryRowId: string | null;
  onHoverEnter: (key: string, categoryRowId: string | null) => void;
  onHoverLeave: () => void;
}

function RailItem({
  item,
  personById,
  categoryById,
  hiddenRowIds,
  selectedRowId,
  openPopover,
  engineRef,
  categoryRowId,
  hoveredKey,
  hoveredCategoryRowId,
  onHoverEnter,
  onHoverLeave,
}: RailItemProps) {
  const style = { top: item.y, height: item.height };
  const readOnly = isPublicId(item.id);
  const key = `${item.kind}:${item.id}`;
  const hoverReveal = (visible: boolean) => `icon-button hover-reveal ${visible ? "hover-reveal-visible" : ""}`;

  if (item.kind === "group" && item.group) {
    const group = item.group;
    const person = group.personId ? personById.get(group.personId) : undefined;
    const age = person ? computedAge(person) : null;
    const visible = hoveredKey === key;
    return (
      <div
        className="rail-group"
        style={style}
        onMouseEnter={() => onHoverEnter(key, null)}
        onMouseLeave={onHoverLeave}
      >
        <button type="button" className="collapse-button" onClick={() => toggleGroupCollapsed(group.id)}>
          {group.collapsed ? "▸" : "▾"}
        </button>
        <span className="rail-group-label" title={group.label}>
          {group.label}
          {age !== null && <span className="age-badge">{age}</span>}
        </span>
        <span className="rail-actions">
          {person && person.birthDate !== undefined && (
            <button
              type="button"
              className={hoverReveal(visible)}
              title="Zoom to life span"
              onClick={() => {
                const { startMs, endMs } = lifeSpanRange(person.birthDate!);
                engineRef.current?.zoomToRange(startMs, endMs);
              }}
            >
              ⇔
            </button>
          )}
          {!readOnly && (
            <>
              {person && (
                <button
                  type="button"
                  className={hoverReveal(visible)}
                  title="Edit person"
                  onClick={(e) =>
                    openPopover({ kind: "person-edit", personId: person.id, groupId: group.id, top: topOf(e) })
                  }
                >
                  ⚙
                </button>
              )}
              <button
                type="button"
                className={hoverReveal(visible)}
                title="Add…"
                onClick={(e) => openPopover({ kind: "add-menu", groupId: group.id, top: topOf(e) })}
              >
                ＋
              </button>
            </>
          )}
        </span>
      </div>
    );
  }

  if (item.kind === "person" && item.person) {
    const person = item.person;
    const age = computedAge(person);
    const readOnlyPerson = isPublicId(person.id);
    const visible = hoveredKey === key;
    return (
      <div
        className="rail-person"
        style={style}
        onMouseEnter={() => onHoverEnter(key, null)}
        onMouseLeave={onHoverLeave}
      >
        <span className="rail-person-label" title={person.label}>
          {person.label}
          {age !== null && <span className="age-badge">{age}</span>}
        </span>
        <span className="rail-actions">
          {person.birthDate !== undefined && (
            <button
              type="button"
              className={hoverReveal(visible)}
              title="Zoom to life span"
              onClick={() => {
                const { startMs, endMs } = lifeSpanRange(person.birthDate!);
                engineRef.current?.zoomToRange(startMs, endMs);
              }}
            >
              ⇔
            </button>
          )}
          {!readOnlyPerson && (
            <>
              <button
                type="button"
                className={hoverReveal(visible)}
                title="Edit person"
                onClick={(e) => openPopover({ kind: "person-edit", personId: person.id, top: topOf(e) })}
              >
                ⚙
              </button>
              <button
                type="button"
                className={hoverReveal(visible)}
                title="Add…"
                onClick={(e) =>
                  openPopover({ kind: "add-menu", groupId: item.group!.id, personId: person.id, top: topOf(e) })
                }
              >
                ＋
              </button>
            </>
          )}
        </span>
      </div>
    );
  }

  if (item.kind === "row" && item.row) {
    const row = item.row;
    const category = categoryById.get(row.categoryId);
    const hidden = hiddenRowIds.includes(row.id);
    // A category (top-level) row's buttons also show while hovering any of its
    // nested timelines; a sub-row's own buttons show only on its own direct hover.
    const visible = item.isSubRow ? hoveredKey === key : hoveredKey === key || hoveredCategoryRowId === row.id;
    return (
      <div
        className={`rail-row ${item.isSubRow ? "rail-row-sub" : ""} ${row.id === selectedRowId ? "rail-row-selected" : ""}`}
        style={{ ...style, paddingLeft: 8 + item.depth * 14 }}
        onClick={() => selectRow(row.id)}
        onMouseEnter={() => onHoverEnter(key, categoryRowId)}
        onMouseLeave={onHoverLeave}
      >
        <input
          type="checkbox"
          className="rail-row-checkbox"
          checked={!hidden}
          title="Show row"
          style={{ accentColor: category?.color ?? "#888" }}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleRowHidden(row.id)}
        />
        <span className="row-icon">{category?.icon}</span>
        <span className="rail-row-label" title={row.label}>
          <span className="label-full">{row.label}</span>
          <span className="label-initial">{row.label.slice(0, 1)}</span>
        </span>
        {!isPublicId(row.id) && (
          <span className="rail-actions">
            <button
              type="button"
              className={hoverReveal(visible)}
              title="Add sub-timeline"
              onClick={(e) => {
                e.stopPropagation();
                openPopover({ kind: "add-sub-row", rowId: row.id, top: topOf(e) });
              }}
            >
              ⑃
            </button>
            <button
              type="button"
              className={hoverReveal(visible)}
              title="Edit row & category"
              onClick={(e) => {
                e.stopPropagation();
                openPopover({ kind: "category-edit", rowId: row.id, top: topOf(e) });
              }}
            >
              ⚙
            </button>
          </span>
        )}
      </div>
    );
  }

  return null;
}

function topOf(event: { currentTarget: EventTarget & HTMLElement }): number {
  const rect = event.currentTarget.getBoundingClientRect();
  return Math.min(rect.bottom + 4, window.innerHeight - 320);
}

// ---------- popovers ----------

function Popover({
  popover,
  open,
  close,
  onStartOnboarding,
}: {
  popover: NonNullable<PopoverState>;
  open: (p: PopoverState) => void;
  close: () => void;
  onStartOnboarding: () => void;
}) {
  const footer = isFooterPopover(popover.kind);
  return (
    <>
      <div className="popover-backdrop" onClick={close} />
      <div className="popover" style={{ top: footer ? undefined : popover.top, bottom: footer ? 48 : undefined }}>
        {popover.kind === "rail-add-menu" && (
          <RailAddMenu open={open} close={close} onStartOnboarding={onStartOnboarding} />
        )}
        {popover.kind === "add-group" && <AddGroupForm close={close} />}
        {popover.kind === "add-person" && <AddPersonForm close={close} />}
        {popover.kind === "add-menu" && (
          <AddMenu groupId={popover.groupId} personId={popover.personId} close={close} />
        )}
        {popover.kind === "person-edit" && (
          <PersonEditor personId={popover.personId} groupId={popover.groupId} close={close} />
        )}
        {popover.kind === "category-edit" && <CategoryEditor rowId={popover.rowId} close={close} />}
        {popover.kind === "add-sub-row" && <SubRowForm rowId={popover.rowId} close={close} />}
      </div>
    </>
  );
}

function RailAddMenu({
  open,
  close,
  onStartOnboarding,
}: {
  open: (p: PopoverState) => void;
  close: () => void;
  onStartOnboarding: () => void;
}) {
  const handleImport = () => {
    triggerImportFlow((result) => {
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      const counts = `${result.dataset.entries.length} entries in ${result.dataset.rows.length} rows`;
      if (window.confirm(`Replace your current data with this import (${counts})? This cannot be undone.`)) {
        replaceDataset(result.dataset);
      }
    });
    close();
  };

  return (
    <div className="popover-form">
      <button type="button" className="menu-item" onClick={() => open({ kind: "add-group", top: 0 })}>
        ＋ Group
      </button>
      <button type="button" className="menu-item" onClick={() => open({ kind: "add-person", top: 0 })}>
        ＋ Person
      </button>
      <button type="button" className="menu-item" onClick={handleImport}>
        ＋ Import
      </button>
      <button
        type="button"
        className="menu-item"
        onClick={() => {
          close();
          onStartOnboarding();
        }}
      >
        ✨ Replay setup assistant
      </button>
    </div>
  );
}

function AddPersonForm({ close }: { close: () => void }) {
  const [label, setLabel] = useState("");
  const submit = () => {
    addGroup(label.trim(), true);
    close();
  };
  return (
    <div className="popover-form">
      <div className="popover-title">New person</div>
      <input
        type="text"
        autoFocus
        placeholder="Name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && label.trim() !== "" && submit()}
      />
      <button
        type="button"
        className="small-button"
        disabled={label.trim() === ""}
        onClick={submit}
      >
        Add
      </button>
    </div>
  );
}

function AddGroupForm({ close }: { close: () => void }) {
  const [label, setLabel] = useState("");
  const [asPerson, setAsPerson] = useState(false);
  const submit = () => {
    addGroup(label.trim(), asPerson);
    close();
  };
  return (
    <div className="popover-form">
      <div className="popover-title">New group</div>
      <input
        type="text"
        autoFocus
        placeholder="Name (e.g. Me, Family, Work)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && label.trim() !== "" && submit()}
      />
      <label className="checkbox-line">
        <input type="checkbox" checked={asPerson} onChange={(e) => setAsPerson(e.target.checked)} />
        This group is a person
      </label>
      <button
        type="button"
        className="small-button"
        disabled={label.trim() === ""}
        onClick={submit}
      >
        Add
      </button>
    </div>
  );
}

function AddMenu({ groupId, personId, close }: { groupId: string; personId?: string; close: () => void }) {
  const dataset = useAppState((s) => s.dataset);
  const group = dataset.groups.find((g) => g.id === groupId);
  const [mode, setMode] = useState<"menu" | "person" | "row">("menu");
  const [label, setLabel] = useState("");
  // A person can only be added inside a personId-less group (§2 asymmetry).
  const canAddPerson = group !== undefined && group.personId === undefined && personId === undefined;

  const submit = () => {
    if (mode === "person") addPersonToGroup(groupId, label.trim());
    else addRow(groupId, label.trim(), personId);
    close();
  };

  if (mode === "menu") {
    return (
      <div className="popover-form">
        {canAddPerson && (
          <button type="button" className="menu-item" onClick={() => setMode("person")}>
            🧑 Person
          </button>
        )}
        <button type="button" className="menu-item" onClick={() => setMode("row")}>
          🏷️ Category (timeline row)
        </button>
        <button
          type="button"
          className="menu-item menu-item-danger"
          onClick={() => {
            const cascade = collectGroupCascade(dataset, groupId);
            if (window.confirm(`Delete group “${group?.label}”? ${describeCascade(cascade)}`)) {
              deleteGroupWithCascade(groupId);
              close();
            }
          }}
        >
          🗑 Delete group…
        </button>
      </div>
    );
  }

  return (
    <div className="popover-form">
      <div className="popover-title">{mode === "person" ? "New person" : "New timeline row"}</div>
      <input
        type="text"
        autoFocus
        placeholder={mode === "person" ? "Name" : "Label (e.g. Job, Residence)"}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && label.trim() !== "" && submit()}
      />
      <button
        type="button"
        className="small-button"
        disabled={label.trim() === ""}
        onClick={submit}
      >
        Add
      </button>
    </div>
  );
}

function PersonEditor({
  personId,
  groupId,
  close,
}: {
  personId: string;
  groupId?: string;
  close: () => void;
}) {
  const dataset = useAppState((s) => s.dataset);
  const person = dataset.people.find((p) => p.id === personId);
  if (!person) return null;
  const birthValue =
    person.birthDate !== undefined ? new Date(person.birthDate).toISOString().slice(0, 10) : "";
  return (
    <div className="popover-form">
      <div className="popover-title">Person</div>
      <input
        type="text"
        value={person.label}
        onChange={(e) => updatePerson(personId, { label: e.target.value })}
      />
      <label className="field-label">Birth date</label>
      <input
        type="date"
        value={birthValue}
        onChange={(e) => {
          const value = e.target.value;
          updatePerson(personId, {
            birthDate: value === "" ? undefined : Date.parse(`${value}T00:00:00Z`),
          });
        }}
      />
      {groupId !== undefined && (
        <button
          type="button"
          className="danger-button"
          onClick={() => {
            const cascade = collectGroupCascade(dataset, groupId);
            if (window.confirm(`Delete “${person.label}”? ${describeCascade(cascade)}`)) {
              deleteGroupWithCascade(groupId);
              close();
            }
          }}
        >
          🗑 Delete
        </button>
      )}
      <button type="button" className="small-button" onClick={close}>
        Done
      </button>
    </div>
  );
}

function CategoryEditor({ rowId, close }: { rowId: string; close: () => void }) {
  const dataset = useAppState((s) => s.dataset);
  const row = dataset.rows.find((r) => r.id === rowId);
  const category = dataset.categories.find((c) => c.id === row?.categoryId);
  if (!row || !category) return null;
  const blockers = categoryDeleteBlockers(dataset, category.id);

  return (
    <div className="popover-form">
      <div className="popover-title">Row</div>
      <input type="text" value={row.label} onChange={(e) => updateRow(rowId, { label: e.target.value })} />

      <div className="popover-title">Category “{category.label}”</div>
      <input
        type="text"
        value={category.label}
        onChange={(e) => updateCategory(category.id, { label: e.target.value })}
      />
      <div className="color-emoji-line">
        <input
          type="color"
          value={toHexColor(category.color)}
          onChange={(e) => updateCategory(category.id, { color: e.target.value })}
        />
        <input
          type="text"
          className="emoji-input"
          value={category.icon}
          maxLength={4}
          onChange={(e) => updateCategory(category.id, { icon: e.target.value })}
        />
        <span className="emoji-picks">
          {EMOJI_QUICK_PICKS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="icon-button"
              onClick={() => updateCategory(category.id, { icon: emoji })}
            >
              {emoji}
            </button>
          ))}
        </span>
      </div>
      <div className="hint">
        Category in use by {blockers.length} row{blockers.length === 1 ? "" : "s"} (
        {blockers.map((b) => b.label).join(", ")}) — it can only be deleted once no row uses it.
      </div>
      <button
        type="button"
        className="danger-button"
        onClick={() => {
          const cascade = collectRowCascade(dataset, rowId);
          if (window.confirm(`Delete row “${row.label}”? ${describeCascade(cascade)}`)) {
            deleteRowWithCascade(rowId);
            close();
          }
        }}
      >
        Delete row…
      </button>
      <button type="button" className="small-button" onClick={close}>
        Done
      </button>
    </div>
  );
}

function SubRowForm({ rowId, close }: { rowId: string; close: () => void }) {
  const [label, setLabel] = useState("");
  const submit = () => {
    addSubRow(rowId, label.trim());
    close();
  };
  return (
    <div className="popover-form">
      <div className="popover-title">New sub-timeline</div>
      <input
        type="text"
        autoFocus
        placeholder="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && label.trim() !== "" && submit()}
      />
      <button
        type="button"
        className="small-button"
        disabled={label.trim() === ""}
        onClick={submit}
      >
        Add
      </button>
    </div>
  );
}

// <input type="color"> only accepts #rrggbb; normalize other CSS colors.
function toHexColor(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fillStyle = color;
  const normalized = ctx.fillStyle;
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "#888888";
}
