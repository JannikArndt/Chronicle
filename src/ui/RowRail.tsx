// The row-header rail (§5): real DOM, because it needs real buttons, popovers
// and native color/date inputs. It renders from the SAME layout the canvas
// uses and is translated by the canvas scroll position every frame.

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from "react";
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
  moveRow,
  reorderGroup,
  replaceDataset,
  selectRow,
  addFamousPerson,
  removeFamousRow,
  removePublicGroup,
  setFamousAlignment,
  toggleFamousPerson,
  toggleGroupCollapsed,
  toggleRowHidden,
  toggleWorldEvents,
  updateCategory,
  updatePerson,
  updateRow,
} from "../state/actions";
import { isPublicId, useAppState, userBirthMs } from "../state/store";
import type { Category, Person } from "../model/types";
import { triggerImportFlow } from "../storage/exportImport";
import { loadPublicCatalog } from "../publicData/loader";
import { famousCatalog } from "../publicData/famous/catalog";
import { parseFamousGroupId, parseFamousRowId } from "../publicData/famous/alignToAge";
import { fetchWikidataBiography, searchWikidataCandidates } from "../publicData/famous/wikidata";
import type { SparqlBinding, WikidataCandidate } from "../publicData/famous/wikidata";
import type { FamousPerson } from "../publicData/famous/types";

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

// ---------- drag-and-drop (reorder groups, move rows) ----------
// Hand-rolled Pointer Events (pointerdown/move/up + setPointerCapture) — one
// code path for mouse, trackpad, and touch, same category as the canvas
// engine's pan/zoom. No library, no HTML5 DnD (plans/rail-drag-and-drop.md).

// What the pressed handle belongs to.
type DragDescriptor = { kind: "group"; groupId: string } | { kind: "row"; rowId: string };

// Where releasing the pointer would drop it.
type DropTarget =
  | { kind: "group"; beforeGroupId: string | null }
  | { kind: "row"; targetGroupId: string; beforeRowId: string | null };

// One candidate insertion line: the drop it stands for and its on-screen Y.
interface DropSlot {
  drop: DropTarget;
  clientY: number;
}

interface ActiveDrag {
  descriptor: DragDescriptor;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  started: boolean; // pointer moved past the click threshold
  drop: DropTarget | null;
}

// A press that moves less than this is a click, not a drag.
const DRAG_START_THRESHOLD_PX = 4;
// How far outside the rail the pointer may stray before the drop is invalid.
const RAIL_BOUNDS_MARGIN_PX = 32;

interface RailDragController {
  // Y (in rail-content coordinates) of the insertion-line indicator, or null.
  indicatorTop: number | null;
  startDrag: (event: ReactPointerEvent<HTMLElement>, descriptor: DragDescriptor) => void;
  updateDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  finishDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  cancelDrag: () => void;
}

function useRailDragController(railContentRef: RefObject<HTMLDivElement>): RailDragController {
  // The drag itself lives in a ref: pointermove fires every frame and only the
  // indicator needs a re-render.
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const [indicatorTop, setIndicatorTop] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const cancelDrag = () => {
    activeDragRef.current = null;
    setIndicatorTop(null);
    setIsDragging(false);
  };

  // Escape aborts with no mutation; the captured pointer's remaining events
  // are ignored because activeDragRef is already null.
  useEffect(() => {
    if (!isDragging) return;
    const abortOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelDrag();
    };
    window.addEventListener("keydown", abortOnEscape);
    return () => window.removeEventListener("keydown", abortOnEscape);
  }, [isDragging]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>, descriptor: DragDescriptor) => {
    // Don't let the press bubble into row selection or start a text selection.
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeDragRef.current = {
      descriptor,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      started: false,
      drop: null,
    };
    setIsDragging(true);
  };

  const updateDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const activeDrag = activeDragRef.current;
    const railContent = railContentRef.current;
    if (!activeDrag || !railContent || event.pointerId !== activeDrag.pointerId) return;
    if (!activeDrag.started) {
      const distance = Math.hypot(
        event.clientX - activeDrag.startClientX,
        event.clientY - activeDrag.startClientY,
      );
      if (distance < DRAG_START_THRESHOLD_PX) return;
      activeDrag.started = true;
    }
    const slot = resolveDropSlot(railContent, activeDrag.descriptor, event.clientX, event.clientY);
    activeDrag.drop = slot?.drop ?? null;
    // The rail is scroll-translated by the engine every frame, so slot Ys are
    // read from live client rects and converted here, not from layout math.
    setIndicatorTop(slot === null ? null : slot.clientY - railContent.getBoundingClientRect().top);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const activeDrag = activeDragRef.current;
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    if (activeDrag.started && activeDrag.drop !== null) applyDrop(activeDrag.descriptor, activeDrag.drop);
    cancelDrag();
  };

  return { indicatorTop, startDrag, updateDrag, finishDrag, cancelDrag };
}

function applyDrop(descriptor: DragDescriptor, drop: DropTarget): void {
  if (descriptor.kind === "group" && drop.kind === "group") {
    reorderGroup(descriptor.groupId, drop.beforeGroupId);
  }
  if (descriptor.kind === "row" && drop.kind === "row") {
    moveRow(descriptor.rowId, drop.targetGroupId, drop.beforeRowId);
  }
}

// A rail item as read back from the live DOM. Hit-testing works on client
// rects because the engine translates the rail via direct style mutation
// every frame — layout.y alone would miss that offset.
interface RailElementInfo {
  kind: "group" | "person" | "row";
  id: string;
  isSubRow: boolean;
  rect: DOMRect;
}

function readRailElements(railContent: HTMLElement): RailElementInfo[] {
  // querySelectorAll returns document order, which is layout order.
  return Array.from(railContent.querySelectorAll<HTMLElement>("[data-rail-kind]")).map((element) => ({
    kind: element.dataset.railKind as RailElementInfo["kind"],
    id: element.dataset.railId ?? "",
    isSubRow: element.dataset.railSubRow === "true",
    rect: element.getBoundingClientRect(),
  }));
}

function resolveDropSlot(
  railContent: HTMLElement,
  descriptor: DragDescriptor,
  clientX: number,
  clientY: number,
): DropSlot | null {
  if (!isPointerInsideRailBounds(railContent, clientX, clientY)) return null;
  const elements = readRailElements(railContent);
  const slots =
    descriptor.kind === "group"
      ? computeGroupDropSlots(elements, descriptor.groupId)
      : computeRowDropSlots(elements, descriptor.rowId);
  return nearestDropSlot(slots, clientY);
}

function isPointerInsideRailBounds(railContent: HTMLElement, clientX: number, clientY: number): boolean {
  const rect = railContent.getBoundingClientRect();
  return (
    clientX >= rect.left - RAIL_BOUNDS_MARGIN_PX &&
    clientX <= rect.right + RAIL_BOUNDS_MARGIN_PX &&
    clientY >= rect.top - RAIL_BOUNDS_MARGIN_PX &&
    clientY <= rect.bottom + RAIL_BOUNDS_MARGIN_PX
  );
}

// Group drag: one slot per private group header ("before this group") plus a
// final slot after the last private item ("end of the list"). Public groups
// are read-only and never drop anchors.
function computeGroupDropSlots(elements: RailElementInfo[], draggedGroupId: string): DropSlot[] {
  const slots: DropSlot[] = [];
  let insidePrivateGroup = false;
  let lastPrivateBottom: number | null = null;
  for (const element of elements) {
    if (element.kind === "group") {
      insidePrivateGroup = !isPublicId(element.id);
      if (insidePrivateGroup && element.id !== draggedGroupId) {
        slots.push({ drop: { kind: "group", beforeGroupId: element.id }, clientY: element.rect.top });
      }
    }
    if (insidePrivateGroup) lastPrivateBottom = element.rect.bottom;
  }
  if (lastPrivateBottom !== null) {
    slots.push({ drop: { kind: "group", beforeGroupId: null }, clientY: lastPrivateBottom });
  }
  return slots;
}

// Row drag: one slot per top-level private row ("before this row") plus, per
// private group, an end-of-group slot after its last item — which for an
// empty or collapsed group is the header itself, so dropping onto a group
// header means "end of that group" (the plan's rule). Sub-rows are never
// anchors (they follow their parent) but do extend the group's bottom.
function computeRowDropSlots(elements: RailElementInfo[], draggedRowId: string): DropSlot[] {
  const slots: DropSlot[] = [];
  let currentGroupId: string | null = null; // null while inside a public group
  let currentGroupBottom = 0;
  const closeCurrentGroup = () => {
    if (currentGroupId !== null) {
      slots.push({
        drop: { kind: "row", targetGroupId: currentGroupId, beforeRowId: null },
        clientY: currentGroupBottom,
      });
    }
  };
  for (const element of elements) {
    if (element.kind === "group") {
      closeCurrentGroup();
      currentGroupId = isPublicId(element.id) ? null : element.id;
      currentGroupBottom = element.rect.bottom;
      continue;
    }
    if (currentGroupId === null) continue;
    if (element.kind === "row" && !element.isSubRow && element.id !== draggedRowId) {
      slots.push({
        drop: { kind: "row", targetGroupId: currentGroupId, beforeRowId: element.id },
        clientY: element.rect.top,
      });
    }
    currentGroupBottom = element.rect.bottom;
  }
  closeCurrentGroup();
  return slots;
}

function nearestDropSlot(slots: DropSlot[], clientY: number): DropSlot | null {
  let nearest: DropSlot | null = null;
  let nearestDistance = Infinity;
  for (const slot of slots) {
    const distance = Math.abs(slot.clientY - clientY);
    if (distance < nearestDistance) {
      nearest = slot;
      nearestDistance = distance;
    }
  }
  return nearest;
}

// The ≡ handle. A click (movement under the threshold) does nothing — the
// drag only starts once the pointer actually moves.
function RailDragHandle({
  className,
  dragController,
  descriptor,
}: {
  className: string;
  dragController: RailDragController;
  descriptor: DragDescriptor;
}) {
  return (
    <button
      type="button"
      className={`${className} rail-drag-handle`}
      title="Drag to reorder"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => dragController.startDrag(e, descriptor)}
      onPointerMove={dragController.updateDrag}
      onPointerUp={dragController.finishDrag}
      onPointerCancel={dragController.cancelDrag}
    >
      ≡
    </button>
  );
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
  const dragController = useRailDragController(railContentRef);

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
              dragController={dragController}
            />
          ))}
          {dragController.indicatorTop !== null && (
            <div className="rail-drop-indicator" style={{ top: dragController.indicatorTop }} />
          )}
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
  dragController: RailDragController;
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
  dragController,
}: RailItemProps) {
  const style = { top: item.y, height: item.height };
  const readOnly = isPublicId(item.id);
  // Whether the "align to my age" toggle can do anything (needs the user's birth date).
  const canAlignFamous = useAppState((s) => userBirthMs(s) !== undefined);
  const key = `${item.kind}:${item.id}`;
  const hoverReveal = (visible: boolean) => `icon-button hover-reveal ${visible ? "hover-reveal-visible" : ""}`;

  if (item.kind === "group" && item.group) {
    const group = item.group;
    const person = group.personId ? personById.get(group.personId) : undefined;
    const age = person ? computedAge(person) : null;
    const visible = hoveredKey === key;
    const famous = parseFamousGroupId(group.id);
    return (
      <div
        className="rail-group"
        style={style}
        data-rail-kind="group"
        data-rail-id={group.id}
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
          {famous && canAlignFamous && (
            <button
              type="button"
              className={`icon-button align-toggle ${famous.aligned ? "align-toggle-on" : ""}`}
              title={famous.aligned ? "Show real dates" : "Align to my age"}
              onClick={() => setFamousAlignment(famous.personId, !famous.aligned)}
            >
              🎂
            </button>
          )}
          {readOnly && (
            <button
              type="button"
              className={`${hoverReveal(visible)} remove-overlay`}
              title="Remove from timeline"
              onClick={() => removePublicGroup(group.id)}
            >
              ✕
            </button>
          )}
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
              <RailDragHandle
                className={hoverReveal(visible)}
                dragController={dragController}
                descriptor={{ kind: "group", groupId: group.id }}
              />
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
        data-rail-kind="person"
        data-rail-id={person.id}
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
        data-rail-kind="row"
        data-rail-id={row.id}
        data-rail-sub-row={item.isSubRow ? "true" : undefined}
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
            {/* Sub-rows are not draggable (plan scope cut) — no handle. */}
            {!item.isSubRow && (
              <RailDragHandle
                className={hoverReveal(visible)}
                dragController={dragController}
                descriptor={{ kind: "row", rowId: row.id }}
              />
            )}
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
        {(() => {
          const famousRow = parseFamousRowId(row.id);
          return famousRow ? (
            <span className="rail-actions">
              <button
                type="button"
                className={`${hoverReveal(visible)} remove-overlay`}
                title="Remove this timeline"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFamousRow(famousRow.personId, famousRow.rowKey);
                }}
              >
                ✕
              </button>
            </span>
          ) : null;
        })()}
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

  const [mode, setMode] = useState<"menu" | "world" | "famous">("menu");

  if (mode === "world") return <WorldEventsPicker back={() => setMode("menu")} />;
  if (mode === "famous") return <FamousPeoplePicker back={() => setMode("menu")} />;

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
      <button type="button" className="menu-item" onClick={() => setMode("world")}>
        🌍 World events ▸
      </button>
      <button type="button" className="menu-item" onClick={() => setMode("famous")}>
        🌟 Famous people ▸
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

// Toggle any of the bundled world-events datasets on/off. Nothing shows until
// picked here, so the catalog can grow without cluttering a fresh timeline.
function WorldEventsPicker({ back }: { back: () => void }) {
  const catalog = loadPublicCatalog();
  const activeKeys = useAppState((s) => s.activeWorldKeys);

  return (
    <div className="popover-form">
      <button type="button" className="menu-item" onClick={back}>
        ◂ Back
      </button>
      <div className="popover-title">World events</div>
      {catalog.map((item) => (
        <label key={item.key} className="menu-item picker-row">
          <input
            type="checkbox"
            checked={activeKeys.includes(item.key)}
            onChange={() => toggleWorldEvents(item.key)}
          />
          <span>{item.label}</span>
        </label>
      ))}
    </div>
  );
}

// Add a famous person's life to the timeline — a few curated suggestions plus a
// live search of Wikidata. Once added, the "🎂 align to my age" toggle lives on
// the person's group header in the rail (not here).
interface WikidataDebug {
  query: string;
  candidates: WikidataCandidate[];
  lastFetch: { name: string; bindings: SparqlBinding[]; person: FamousPerson } | null;
}

function FamousPeoplePicker({ back }: { back: () => void }) {
  const activeFamous = useAppState((s) => s.activeFamous);
  const activeIds = new Set(activeFamous.map((s) => s.person.id));

  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<WikidataCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<WikidataDebug | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  const people = candidates.filter((candidate) => candidate.isHuman);

  // Debounced Wikidata search; the trailing request wins even if earlier ones
  // resolve late (guarded by `cancelled`).
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setCandidates([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const hits = await searchWikidataCandidates(term);
        if (cancelled) return;
        setCandidates(hits);
        setDebug((prev) => ({ query: term, candidates: hits, lastFetch: prev?.lastFetch ?? null }));
      } catch {
        if (!cancelled) setCandidates([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const addFromWikidata = async (hit: WikidataCandidate) => {
    setLoadingId(hit.id);
    setError(null);
    try {
      const { person, bindings } = await fetchWikidataBiography(hit);
      addFamousPerson(person);
      setDebug((prev) => ({
        query: prev?.query ?? query,
        candidates: prev?.candidates ?? candidates,
        lastFetch: { name: person.name, bindings, person },
      }));
      setQuery("");
      setCandidates([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load from Wikidata.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="popover-form">
      <div className="picker-header">
        <button type="button" className="menu-item" onClick={back}>
          ◂ Back
        </button>
        {debug && (
          <button
            type="button"
            className={`icon-button ${showDebug ? "align-toggle-on" : ""}`}
            title="Show what Wikidata returned and how we read it"
            onClick={() => setShowDebug((v) => !v)}
          >
            🐞
          </button>
        )}
      </div>
      <div className="popover-title">Famous people</div>

      <input
        type="text"
        className="famous-search"
        placeholder="Search Wikidata (e.g. Napoleon)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {searching && <div className="picker-hint">Searching…</div>}
      {error && <div className="picker-hint picker-error">{error}</div>}
      {!searching && query.trim().length >= 2 && people.length === 0 && (
        <div className="picker-hint">No people matched — only people (Q5) are shown.</div>
      )}
      {people.map((hit) => (
        <button
          key={hit.id}
          type="button"
          className="menu-item picker-row"
          disabled={activeIds.has(hit.id) || loadingId !== null}
          onClick={() => addFromWikidata(hit)}
        >
          <span>
            {loadingId === hit.id ? "⏳" : activeIds.has(hit.id) ? "✓" : "＋"} {hit.label}
            {hit.description && <small className="picker-blurb"> — {hit.description}</small>}
          </span>
        </button>
      ))}

      {candidates.length === 0 && !searching && (
        <>
          <div className="picker-subtitle">Suggestions</div>
          {famousCatalog.map((person) => (
            <label key={person.id} className="menu-item picker-row">
              <input
                type="checkbox"
                checked={activeIds.has(person.id)}
                onChange={() => toggleFamousPerson(person)}
              />
              <span>
                {person.emoji} {person.name}
                <small className="picker-blurb"> — {person.blurb}</small>
              </span>
            </label>
          ))}
        </>
      )}

      {showDebug && debug && <WikidataDebugPanel debug={debug} onClose={() => setShowDebug(false)} />}
    </div>
  );
}

function yearOf(ms: number): number {
  return new Date(ms).getUTCFullYear();
}

// A developer view: the raw search hits (with why each was kept/dropped) and,
// for the last loaded person, the raw SPARQL rows next to how we mapped them.
function WikidataDebugPanel({ debug, onClose }: { debug: WikidataDebug; onClose: () => void }) {
  const fetched = debug.lastFetch;
  return (
    <div className="wd-debug-backdrop" onClick={onClose}>
      <div className="wd-debug" onClick={(e) => e.stopPropagation()}>
        <div className="wd-debug-head">
          <strong>Wikidata debug</strong>
          <button type="button" className="icon-button" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="wd-debug-section">
          <div className="wd-debug-title">
            Search “{debug.query}” — {debug.candidates.filter((c) => c.isHuman).length}/{debug.candidates.length} kept
            as people
          </div>
          <table className="wd-debug-table">
            <thead>
              <tr>
                <th>keep</th>
                <th>id</th>
                <th>label</th>
                <th>P31 (instance of)</th>
                <th>description</th>
              </tr>
            </thead>
            <tbody>
              {debug.candidates.map((c) => (
                <tr key={c.id} className={c.isHuman ? "" : "wd-dropped"}>
                  <td>{c.isHuman ? "✓" : "✕"}</td>
                  <td>{c.id}</td>
                  <td>{c.label}</td>
                  <td>{c.instanceOfIds.join(", ") || "—"}</td>
                  <td>{c.description ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {fetched && (
          <div className="wd-debug-section">
            <div className="wd-debug-title">
              Loaded “{fetched.name}” — birth {yearOf(fetched.person.birthMs)},{" "}
              {fetched.person.biography.entries.length} entries in {fetched.person.biography.rows.length} rows
            </div>
            <div className="wd-debug-cols">
              <div>
                <div className="wd-debug-subtitle">How we interpreted it</div>
                {fetched.person.biography.rows.map((row) => (
                  <div key={row.id} className="wd-debug-rowgroup">
                    <em>{row.label}</em>
                    <ul>
                      {fetched.person.biography.entries
                        .filter((e) => e.rowId === row.id)
                        .map((e) => (
                          <li key={e.id}>
                            {e.title} [{yearOf(e.start.ms)}–{e.end ? yearOf(e.end.ms) : "…"}]
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div>
                <div className="wd-debug-subtitle">Raw SPARQL bindings ({fetched.bindings.length})</div>
                <table className="wd-debug-table">
                  <thead>
                    <tr>
                      <th>type</th>
                      <th>label</th>
                      <th>start</th>
                      <th>end</th>
                      <th>point</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fetched.bindings.map((b, i) => (
                      <tr key={i}>
                        <td>{b.type.value}</td>
                        <td>{b.itemLabel?.value ?? ""}</td>
                        <td>{b.startDate?.value.slice(0, 10) ?? ""}</td>
                        <td>{b.endDate?.value.slice(0, 10) ?? ""}</td>
                        <td>{b.pointDate?.value.slice(0, 10) ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
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
