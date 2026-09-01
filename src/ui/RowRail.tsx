// The row-header rail (§5): real DOM, because it needs real buttons, popovers
// and native color/date inputs. It renders from the SAME layout the canvas
// uses and is translated by the canvas scroll position every frame.

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { collectGroupCascade, collectRowCascade, describeCascade } from "../model/cascade";
import type { Layout, LayoutItem } from "../render/layout";
import type { TimelineEngine } from "../render/engine";
import {
  addEvent,
  addGroup,
  addRow,
  addSubGroup,
  addSubRow,
  deleteGroupWithCascade,
  deleteRowWithCascade,
  moveRow,
  reorderGroup,
  selectEvent,
  selectRow,
  addFamousPerson,
  removeFamousRow,
  removePublicGroup,
  setFamousAlignment,
  toggleGroupCollapsed,
  toggleRowCollapsed,
  setRowShared,
  toggleRowHidden,
  updateGroup,
  updateRow,
} from "../state/actions";
import { isForeignId, useAppState, userBirthMs } from "../state/store";
import { formatFuzzyDate } from "../model/fuzzyDate";
import { ACCEPTED_DATE_FORMATS_HINT, parseDateInput } from "../model/parseDateInput";
import type { Group, TimelineRow } from "../model/types";
import { describePublishImpact } from "../model/sharing";
import { importDatasetWithConfirmation } from "./importFlow";
import { WorldEventsPicker } from "./WorldEventsPicker";
import { parseFamousGroupId, parseFamousRowId } from "../publicData/famous/alignToAge";
import { fetchWikidataBiography, searchWikidataCandidates } from "../publicData/famous/wikidata";
import type { SparqlBinding, WikidataCandidate } from "../publicData/famous/wikidata";
import type { FamousPerson } from "../publicData/famous/types";

const EMOJI_QUICK_PICKS = ["💼", "🏠", "❤️", "🎓", "✈️", "🎨", "⚽", "🐕"];

type PopoverState =
  | { kind: "add-menu"; groupId: string; top: number }
  | { kind: "group-edit"; groupId: string; top: number }
  | { kind: "row-edit"; rowId: string; top: number }
  | { kind: "add-sub-row"; rowId: string; top: number }
  | { kind: "add-event"; rowId: string; top: number }
  | { kind: "add-group"; top: number }
  | { kind: "rail-add-menu"; top: number }
  | null;

// Popovers anchored to the rail footer's "+" button open upward from the
// bottom of the rail rather than downward from a click point.
function isFooterPopover(kind: NonNullable<PopoverState>["kind"]): boolean {
  return kind === "add-group" || kind === "rail-add-menu";
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
  kind: "group" | "subgroup" | "row";
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
      insidePrivateGroup = !isForeignId(element.id);
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
// A sub-group header opens a group of its own: dropping a row under "Finn"
// files it in Finn, which is now the whole of "whose timeline is this".
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
    if (element.kind === "group" || element.kind === "subgroup") {
      closeCurrentGroup();
      currentGroupId = isForeignId(element.id) ? null : element.id;
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
  const hiddenRowIds = useAppState((s) => s.hiddenRowIds);
  const selectedRowId = useAppState((s) => s.selectedRowId);
  const [popover, setPopover] = useState<PopoverState>(null);
  // Which rail item's action buttons are shown (§ hover-reveal). Tracked in JS
  // rather than pure CSS :hover: Safari can leave :hover "stuck" after a fast
  // mouse-exit from these absolutely-positioned, transitioned rows, but real
  // mouseenter/mouseleave events don't have that failure mode. hoveredTopRowId
  // is the top-level row a hovered sub-row belongs to, so a top-level row's own
  // buttons also light up while hovering any of its nested timelines.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hoveredTopRowId, setHoveredTopRowId] = useState<string | null>(null);
  const dragController = useRailDragController(railContentRef);

  const closePopover = () => setPopover(null);

  // pushRowTree (layout.ts) emits each top-level row immediately followed by
  // all its descendants before the next one, so a single running variable is
  // enough to know which top-level row each item belongs to.
  const topRowIds: (string | null)[] = [];
  let currentTopRowId: string | null = null;
  for (const item of layout.items) {
    if (item.kind === "row" && item.row && !item.isSubRow) currentTopRowId = item.row.id;
    topRowIds.push(currentTopRowId);
  }

  // Rows that have sub-rows get a collapse toggle (like a group). Derived from
  // the layout so it reflects exactly what's rendered.
  const parentRowIds = new Set(
    layout.items.map((item) => item.row?.parentRowId).filter((id): id is string => !!id),
  );

  return (
    <div className="rail" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rail-scroll">
        <div className="rail-content" ref={railContentRef} style={{ height: layout.totalHeight }}>
          {layout.items.map((item, index) => (
            <RailItem
              key={`${item.kind}:${item.id}`}
              item={item}
              hiddenRowIds={hiddenRowIds}
              parentRowIds={parentRowIds}
              selectedRowId={selectedRowId}
              openPopover={setPopover}
              engineRef={engineRef}
              topRowId={topRowIds[index]}
              hoveredKey={hoveredKey}
              hoveredTopRowId={hoveredTopRowId}
              onHoverEnter={(key, topRowId) => {
                setHoveredKey(key);
                setHoveredTopRowId(topRowId);
              }}
              onHoverLeave={() => {
                setHoveredKey(null);
                setHoveredTopRowId(null);
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
        {dataset.selfGroupId === undefined && (
          <button type="button" className="small-button" onClick={onStartOnboarding}>
            ✨ Set up your timeline
          </button>
        )}
        <button
          type="button"
          className="rail-add-button"
          title="Add group or import…"
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

function computedAge(group: Group): string | null {
  if (group.birthDate === undefined) return null;
  const years = (Date.now() - group.birthDate) / (365.25 * 86_400_000);
  return years >= 0 ? `${Math.floor(years)}` : null;
}

function lifeSpanRange(birthDate: number): { startMs: number; endMs: number } {
  const now = Date.now();
  const padding = (now - birthDate) * 0.05;
  return { startMs: birthDate - padding, endMs: now + padding };
}

interface RailItemProps {
  item: LayoutItem;
  hiddenRowIds: string[];
  parentRowIds: Set<string>;
  selectedRowId?: string;
  openPopover: (p: PopoverState) => void;
  engineRef: MutableRefObject<TimelineEngine | null>;
  topRowId: string | null;
  hoveredKey: string | null;
  hoveredTopRowId: string | null;
  onHoverEnter: (key: string, topRowId: string | null) => void;
  onHoverLeave: () => void;
  dragController: RailDragController;
}

function RailItem({
  item,
  hiddenRowIds,
  parentRowIds,
  selectedRowId,
  openPopover,
  engineRef,
  topRowId,
  hoveredKey,
  hoveredTopRowId,
  onHoverEnter,
  onHoverLeave,
  dragController,
}: RailItemProps) {
  const style = { top: item.y, height: item.height };
  const readOnly = isForeignId(item.id);
  // Whether the "align to my age" toggle can do anything (needs the user's birth date).
  const canAlignFamous = useAppState((s) => userBirthMs(s) !== undefined);
  const collapsedRowIds = useAppState((s) => s.collapsedRowIds);

  // Compact sub-rows live only on the canvas (their parent is collapsed) — the
  // rail drops them, so the bars carry their own labels instead.
  if (item.compact) return null;
  const key = `${item.kind}:${item.id}`;
  const hoverReveal = (visible: boolean) => `icon-button hover-reveal ${visible ? "hover-reveal-visible" : ""}`;

  // One block for a group and for a sub-group: since Person was folded into
  // Group they differ only in header size, in being draggable, and in whether
  // they can hold children of their own.
  if ((item.kind === "group" || item.kind === "subgroup") && item.group) {
    const group = item.group;
    const isSubGroup = item.kind === "subgroup";
    const age = computedAge(group);
    const visible = hoveredKey === key;
    const famous = isSubGroup ? null : parseFamousGroupId(group.id);
    return (
      <div
        className={isSubGroup ? "rail-subgroup" : "rail-group"}
        style={style}
        data-rail-kind={item.kind}
        data-rail-id={group.id}
        onMouseEnter={() => onHoverEnter(key, null)}
        onMouseLeave={onHoverLeave}
      >
        <button type="button" className="collapse-button" onClick={() => toggleGroupCollapsed(group.id)}>
          {group.collapsed ? "▸" : "▾"}
        </button>
        <span className={isSubGroup ? "rail-subgroup-label" : "rail-group-label"} title={group.label}>
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
          {readOnly && !isSubGroup && (
            <button
              type="button"
              className={`${hoverReveal(visible)} remove-overlay`}
              title="Remove from timeline"
              onClick={() => removePublicGroup(group.id)}
            >
              ✕
            </button>
          )}
          {group.birthDate !== undefined && (
            <button
              type="button"
              className={hoverReveal(visible)}
              title="Zoom to life span"
              onClick={() => {
                const { startMs, endMs } = lifeSpanRange(group.birthDate!);
                engineRef.current?.zoomToRange(startMs, endMs);
              }}
            >
              ⇔
            </button>
          )}
          {!readOnly && (
            <>
              {!isSubGroup && (
                <RailDragHandle
                  className={hoverReveal(visible)}
                  dragController={dragController}
                  descriptor={{ kind: "group", groupId: group.id }}
                />
              )}
              <button
                type="button"
                className={hoverReveal(visible)}
                title="Edit group"
                onClick={(e) => openPopover({ kind: "group-edit", groupId: group.id, top: topOf(e) })}
              >
                ⚙
              </button>
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

  if (item.kind === "row" && item.row) {
    const row = item.row;
    const hidden = hiddenRowIds.includes(row.id);
    // Compact-collapse is an overlay (public) feature; keep the hide-checkbox for
    // the user's own parent rows so private sub-timelines stay hideable.
    const canCollapse = parentRowIds.has(row.id) && readOnly;
    const collapsed = collapsedRowIds.includes(row.id);
    // A top-level row's buttons also show while hovering any of its nested
    // timelines; a sub-row's own buttons show only on its own direct hover.
    const visible = item.isSubRow ? hoveredKey === key : hoveredKey === key || hoveredTopRowId === row.id;
    return (
      <div
        className={`rail-row ${item.isSubRow ? "rail-row-sub" : ""} ${row.id === selectedRowId ? "rail-row-selected" : ""}`}
        style={{ ...style, paddingLeft: 8 + item.depth * 14 }}
        data-rail-kind="row"
        data-rail-id={row.id}
        data-rail-sub-row={item.isSubRow ? "true" : undefined}
        onClick={() => selectRow(row.id)}
        onMouseEnter={() => onHoverEnter(key, topRowId)}
        onMouseLeave={onHoverLeave}
      >
        {canCollapse ? (
          <button
            type="button"
            className="row-collapse-button"
            title={collapsed ? "Expand timelines" : "Collapse into a compact band"}
            onClick={(e) => {
              e.stopPropagation();
              toggleRowCollapsed(row.id);
            }}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        ) : (
          <input
            type="checkbox"
            className="rail-row-checkbox"
            checked={!hidden}
            title="Show row"
            style={{ accentColor: row.color ?? "#888" }}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleRowHidden(row.id)}
          />
        )}
        <span className="row-icon">{row.icon}</span>
        <span className="rail-row-label" title={row.label}>
          <span className="label-full">{row.label}</span>
          <span className="label-initial">{row.label.slice(0, 1)}</span>
        </span>
        {!isForeignId(row.id) && (
          <span className="rail-actions">
            <ShareToggle row={row} visible={visible} />
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
              title="Add event — a moment on this timeline"
              onClick={(e) => {
                e.stopPropagation();
                openPopover({ kind: "add-event", rowId: row.id, top: topOf(e) });
              }}
            >
              ◆
            </button>
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
              title="Edit row"
              onClick={(e) => {
                e.stopPropagation();
                openPopover({ kind: "row-edit", rowId: row.id, top: topOf(e) });
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
        {popover.kind === "add-menu" && <AddMenu groupId={popover.groupId} close={close} />}
        {popover.kind === "group-edit" && <GroupEditor groupId={popover.groupId} close={close} />}
        {popover.kind === "row-edit" && <RowEditor rowId={popover.rowId} close={close} />}
        {popover.kind === "add-sub-row" && <SubRowForm rowId={popover.rowId} close={close} />}
        {popover.kind === "add-event" && <AddEventForm rowId={popover.rowId} close={close} />}
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
    importDatasetWithConfirmation((message) => window.alert(message));
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
      <div className="popover-title">Add a famous person</div>

      <input
        type="text"
        className="famous-search"
        placeholder="Search anyone on Wikidata…"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />

      {query.trim().length < 2 && !searching && (
        <div className="picker-hint">Scientists, artists, leaders, athletes — anyone with a Wikidata page.</div>
      )}
      {searching && <div className="picker-hint">Searching…</div>}
      {error && <div className="picker-hint picker-error">{error}</div>}
      {!searching && query.trim().length >= 2 && people.length === 0 && (
        <div className="picker-hint">No people found for “{query.trim()}”.</div>
      )}

      {people.map((hit) => {
        const added = activeIds.has(hit.id);
        const loading = loadingId === hit.id;
        return (
          <button
            key={hit.id}
            type="button"
            className="menu-item wd-result"
            disabled={added || loadingId !== null}
            onClick={() => addFromWikidata(hit)}
          >
            <span className="wd-result-mark">{loading ? "⏳" : added ? "✓" : "＋"}</span>
            <span className="wd-result-text">
              <span className="wd-result-name">{hit.label}</span>
              {hit.description && <span className="wd-result-desc">{hit.description}</span>}
            </span>
          </button>
        );
      })}

      {people.length > 0 && <div className="picker-footer">Data from Wikidata</div>}

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

// There is no separate "new person" form any more: a person is a group with a
// birth date, so the date field is the whole difference and it is offered here.
function AddGroupForm({ close }: { close: () => void }) {
  const [label, setLabel] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const submit = () => {
    addGroup(label.trim(), birthDate === "" ? undefined : Date.parse(`${birthDate}T00:00:00Z`));
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
      <label className="field-label">Birth date — if this group is a person</label>
      <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
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

function AddMenu({ groupId, close }: { groupId: string; close: () => void }) {
  const dataset = useAppState((s) => s.dataset);
  const group = dataset.groups.find((g) => g.id === groupId);
  const [mode, setMode] = useState<"menu" | "subgroup" | "row">("menu");
  const [label, setLabel] = useState("");
  // Only one level of nesting is drawn, so a sub-group can't take children.
  const canAddSubGroup = group !== undefined && group.parentGroupId === undefined;

  const submit = () => {
    if (mode === "subgroup") addSubGroup(groupId, label.trim());
    else addRow(groupId, label.trim());
    close();
  };

  if (mode === "menu") {
    return (
      <div className="popover-form">
        {canAddSubGroup && (
          <button type="button" className="menu-item" onClick={() => setMode("subgroup")}>
            🧑 Person or sub-group
          </button>
        )}
        <button type="button" className="menu-item" onClick={() => setMode("row")}>
          🏷️ Timeline row
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
      <div className="popover-title">{mode === "subgroup" ? "New sub-group" : "New timeline row"}</div>
      <input
        type="text"
        autoFocus
        placeholder={mode === "subgroup" ? "Name" : "Label (e.g. Job, Residence)"}
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

function GroupEditor({ groupId, close }: { groupId: string; close: () => void }) {
  const dataset = useAppState((s) => s.dataset);
  const group = dataset.groups.find((g) => g.id === groupId);
  if (!group) return null;
  const birthValue =
    group.birthDate !== undefined ? new Date(group.birthDate).toISOString().slice(0, 10) : "";
  return (
    <div className="popover-form">
      <div className="popover-title">Group</div>
      <input
        type="text"
        value={group.label}
        onChange={(e) => updateGroup(groupId, { label: e.target.value })}
      />
      <label className="field-label">Birth date — if this group is a person</label>
      <input
        type="date"
        value={birthValue}
        onChange={(e) => {
          const value = e.target.value;
          updateGroup(groupId, {
            birthDate: value === "" ? undefined : Date.parse(`${value}T00:00:00Z`),
          });
        }}
      />
      <button
        type="button"
        className="danger-button"
        onClick={() => {
          const cascade = collectGroupCascade(dataset, groupId);
          if (window.confirm(`Delete “${group.label}”? ${describeCascade(cascade)}`)) {
            deleteGroupWithCascade(groupId);
            close();
          }
        }}
      >
        🗑 Delete
      </button>
      <button type="button" className="small-button" onClick={close}>
        Done
      </button>
    </div>
  );
}

function RowEditor({ rowId, close }: { rowId: string; close: () => void }) {
  const dataset = useAppState((s) => s.dataset);
  const row = dataset.rows.find((r) => r.id === rowId);
  if (!row) return null;

  return (
    <div className="popover-form">
      <div className="popover-title">Row</div>
      <div className="row-edit-line">
        <input
          type="color"
          value={toHexColor(row.color ?? "#888888")}
          onChange={(e) => updateRow(rowId, { color: e.target.value })}
        />
        <input
          type="text"
          className="emoji-input"
          value={row.icon ?? ""}
          maxLength={4}
          onChange={(e) => updateRow(rowId, { icon: e.target.value || undefined })}
        />
        <input
          type="text"
          className="row-edit-name"
          value={row.label}
          onChange={(e) => updateRow(rowId, { label: e.target.value })}
        />
      </div>
      <span className="emoji-picks">
        {EMOJI_QUICK_PICKS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="icon-button"
            onClick={() => updateRow(rowId, { icon: emoji })}
          >
            {emoji}
          </button>
        ))}
      </span>
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

// A moment, in two fields. It opens on the instant last clicked on this row —
// pointing at a spot on the timeline and naming it is the shortest honest path
// to "first kiss, roughly there", and the typed date's own precision is what
// the event keeps ("1998" stays a year, not a false 1 July).
function AddEventForm({ rowId, close }: { rowId: string; close: () => void }) {
  const clickedMs = useAppState((state) =>
    state.selectedRowId === rowId ? state.selectedRowClickMs : undefined,
  );
  const [title, setTitle] = useState("");
  const [dateText, setDateText] = useState(() =>
    formatFuzzyDate({ ms: clickedMs ?? Date.now(), precision: "day" }),
  );
  const parsed = parseDateInput(dateText);
  const canSubmit = title.trim() !== "" && parsed.kind === "date";

  const submit = () => {
    if (parsed.kind !== "date") return;
    const id = addEvent(rowId, title.trim(), { ms: parsed.ms, precision: parsed.precision });
    // Selecting it opens the detail panel on the thing just created, which is
    // where a note or a place goes — the form deliberately asks for neither.
    selectEvent(id);
    close();
  };

  return (
    <div className="popover-form">
      <div className="popover-title">New event</div>
      <input
        type="text"
        autoFocus
        placeholder="What happened"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
      />
      <input
        type="text"
        placeholder="When"
        value={dateText}
        onChange={(e) => setDateText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
      />
      <div className="hint">
        {parsed.kind === "date" ? "Events show up once you zoom in." : ACCEPTED_DATE_FORMATS_HINT}
      </div>
      <button type="button" className="small-button" disabled={!canSubmit} onClick={submit}>
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

// Publishing is per-timeline (schema v7), and this is the switch. Unlike every
// other rail action it does NOT hover-reveal once it is on: "who can see this"
// has to be legible at a glance rather than discoverable by hovering, and a
// share control that hides itself is how someone forgets what they published.
//
// Absent entirely when signed out, so a local-only Chronicle looks exactly as
// it did before sharing existed.
function ShareToggle({ row, visible }: { row: TimelineRow; visible: boolean }) {
  const signedIn = useAppState((s) => s.sharing.session !== undefined);
  const dataset = useAppState((s) => s.dataset);
  if (!signedIn) return null;

  const shared = row.shared === true;
  const impact = describePublishImpact(dataset, row.id);
  return (
    <button
      type="button"
      className={
        shared ? "icon-button share-toggle-on" : `icon-button hover-reveal ${visible ? "hover-reveal-visible" : ""}`
      }
      title={
        shared
          ? `Shared with the people you have invited. Click to make it private again.\n\nSharing is not recallable — anyone who could already see it may have kept a copy.`
          : `Private. Click to share it with the people you have invited.\n\n${impact}`
      }
      onClick={(e) => {
        e.stopPropagation();
        setRowShared(row.id, !shared);
      }}
    >
      {shared ? "🔗" : "🔒"}
    </button>
  );
}
