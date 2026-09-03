// The row-header rail (§5): real DOM, because it needs real buttons, popovers
// and native color/date inputs. It renders from the SAME layout the canvas
// uses and is translated by the canvas scroll position every frame.

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { canBreakOut, describeBreakOut } from "../model/breakOut";
import { collectGroupCascade, collectRowCascade, describeCascade } from "../model/cascade";
import { groupHeaderHeight } from "../render/layout";
import { ROW_STRIPES, rowStripes } from "../render/rowStripes";
import type { Layout, LayoutItem } from "../render/layout";
import type { TimelineEngine } from "../render/engine";
import {
  addEvent,
  addGroup,
  addRow,
  addSubGroup,
  breakOutRow,
  copyGroup,
  copyRow,
  deleteGroupWithCascade,
  deleteRowWithCascade,
  moveGroup,
  moveRow,
  selectEvent,
  selectRow,
  addFamousPerson,
  removeFamousRow,
  removePublicGroup,
  setFamousAlignment,
  toggleGroupCollapsed,
  setRowShared,
  toggleRowHidden,
  updateGroup,
  updateRow,
} from "../state/actions";
import { isForeignId, useAppState, userBirthMs } from "../state/store";
import { formatFuzzyDate } from "../model/fuzzyDate";
import { ACCEPTED_DATE_FORMATS_HINT, parseDateInput } from "../model/parseDateInput";
import type { Group, TimelineRow } from "../model/types";
import type { RailChildRef } from "../model/dataset";
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
  | { kind: "add-event"; rowId: string; top: number }
  | { kind: "add-group"; top: number }
  | { kind: "add-row"; top: number }
  | { kind: "rail-add-menu"; top: number }
  | null;

// Popovers anchored to the rail footer's "+" button open upward from the
// bottom of the rail rather than downward from a click point.
function isFooterPopover(kind: NonNullable<PopoverState>["kind"]): boolean {
  return kind === "add-group" || kind === "add-row" || kind === "rail-add-menu";
}

// ---------- drag-and-drop (move or, with Alt/Option held, copy) ----------
// Hand-rolled Pointer Events (pointerdown/move/up + setPointerCapture) — one
// code path for mouse, trackpad, and touch, same category as the canvas
// engine's pan/zoom. No library, no HTML5 DnD (plans/rail-drag-and-drop.md).
// Groups and timelines both nest arbitrarily now, so a drop target names its
// CONTAINER (a group id, or null for the root) rather than assuming one fixed
// level — the same shape computeLayout() itself uses.

// What the pressed handle belongs to — a rail child of either kind, since
// groups and timelines share one ordered sequence per container (schema v10).
type DragDescriptor = RailChildRef;

// Where releasing the pointer would drop it: a container (`null` = the root,
// no group at all) and the sibling to land in front of — of EITHER kind, which
// is what lets a group be dropped between two timelines and a timeline between
// two groups. `before: null` appends at the end of that container.
interface DropTarget {
  parentGroupId: string | null;
  before: RailChildRef | null;
}

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
  copy: boolean; // Alt/Option held — drop duplicates instead of moving
}

// A press that moves less than this is a click, not a drag.
const DRAG_START_THRESHOLD_PX = 4;
// How far outside the rail the pointer may stray before the drop is invalid.
const RAIL_BOUNDS_MARGIN_PX = 32;

interface RailDragController {
  // Y (in rail-content coordinates) of the insertion-line indicator, or null.
  indicatorTop: number | null;
  // Whether the drag in progress would copy rather than move (Alt/Option is
  // held) — drives the indicator's styling.
  isCopy: boolean;
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
  const [isCopy, setIsCopy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const cancelDrag = () => {
    activeDragRef.current = null;
    setIndicatorTop(null);
    setIsCopy(false);
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
      copy: event.altKey,
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
    activeDrag.copy = event.altKey;
    setIsCopy(event.altKey);
    const slot = resolveDropSlot(railContent, activeDrag.descriptor, event.clientX, event.clientY);
    activeDrag.drop = slot?.drop ?? null;
    // The rail is scroll-translated by the engine every frame, so slot Ys are
    // read from live client rects and converted here, not from layout math.
    setIndicatorTop(slot === null ? null : slot.clientY - railContent.getBoundingClientRect().top);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const activeDrag = activeDragRef.current;
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    if (activeDrag.started && activeDrag.drop !== null) {
      applyDrop(activeDrag.descriptor, activeDrag.drop, activeDrag.copy);
    }
    cancelDrag();
  };

  return { indicatorTop, isCopy, startDrag, updateDrag, finishDrag, cancelDrag };
}

function applyDrop(descriptor: DragDescriptor, drop: DropTarget, copy: boolean): void {
  if (descriptor.kind === "group") {
    const groupId = copy ? copyGroup(descriptor.id) : descriptor.id;
    if (groupId) moveGroup(groupId, drop.parentGroupId, drop.before);
    return;
  }
  const rowId = copy ? copyRow(descriptor.id) : descriptor.id;
  if (rowId) moveRow(rowId, drop.parentGroupId, drop.before);
}

// A rail item as read back from the live DOM. Hit-testing works on client
// rects because the engine translates the rail via direct style mutation
// every frame — layout.y alone would miss that offset.
interface RailElementInfo {
  kind: "group" | "row";
  id: string;
  depth: number;
  rect: DOMRect;
}

function readRailElements(railContent: HTMLElement): RailElementInfo[] {
  // querySelectorAll returns document order, which is layout order.
  return Array.from(railContent.querySelectorAll<HTMLElement>("[data-rail-kind]")).map((element) => ({
    kind: element.dataset.railKind as RailElementInfo["kind"],
    id: element.dataset.railId ?? "",
    depth: Number(element.dataset.railDepth ?? "0"),
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
  return nearestDropSlot(computeDropSlots(elements, descriptor), clientY);
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

// Reconstructs, purely from the DOM's depth-first order (the same order
// computeLayout() builds it in), which private group directly contains each
// element, and — for every private group — the Y position just past its own
// last descendant, at any nesting depth. Both drop-slot functions below share
// this: "before a sibling" reads `containerId`, "append as the last child"
// reads `groupBottom`.
function analyzeContainers(elements: RailElementInfo[]): {
  containerId: (string | null)[];
  groupBottom: Map<string, number>;
} {
  const containerAtDepth: (string | null)[] = [null];
  const containerId: (string | null)[] = [];
  const groupBottom = new Map<string, number>();
  // Open private groups, deepest last — a foreign (public/mirror) group is
  // never pushed, since nothing under it is a valid drop target.
  const openGroups: { id: string; depth: number }[] = [];

  const closeGroupsAtOrBelow = (depth: number) => {
    while (openGroups.length > 0 && openGroups[openGroups.length - 1].depth >= depth) openGroups.pop();
  };

  elements.forEach((element, index) => {
    closeGroupsAtOrBelow(element.depth);
    for (const group of openGroups) groupBottom.set(group.id, element.rect.bottom);
    containerId[index] = containerAtDepth[element.depth] ?? null;
    if (element.kind === "group") {
      const isPrivate = !isForeignId(element.id);
      if (isPrivate) openGroups.push({ id: element.id, depth: element.depth });
      containerAtDepth[element.depth + 1] = isPrivate ? element.id : null;
    }
  });
  return { containerId, groupBottom };
}

// One "before this child" slot per private rail item at any depth — of either
// kind, whatever is being dragged, which is the whole of "any order of groups
// and timelines mixed". Plus one "append as the last child" slot per private
// group (from `groupBottom`) and one "append at the very end" for the root.
// A group being dragged contributes no slots for itself; its DESCENDANTS still
// do, and `moveGroup`'s cycle guard is what refuses those.
function computeDropSlots(elements: RailElementInfo[], dragged: DragDescriptor): DropSlot[] {
  const { containerId, groupBottom } = analyzeContainers(elements);
  const slots: DropSlot[] = [];
  elements.forEach((element, index) => {
    if (isForeignId(element.id)) return;
    if (element.kind === dragged.kind && element.id === dragged.id) return;
    slots.push({
      drop: {
        parentGroupId: containerId[index],
        before: { kind: element.kind, id: element.id },
      },
      clientY: element.rect.top,
    });
  });
  for (const [groupId, bottom] of groupBottom) {
    if (dragged.kind === "group" && groupId === dragged.id) continue;
    slots.push({ drop: { parentGroupId: groupId, before: null }, clientY: bottom });
  }
  const last = elements[elements.length - 1];
  if (last) slots.push({ drop: { parentGroupId: null, before: null }, clientY: last.rect.bottom });
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
// drag only starts once the pointer actually moves. Holding Alt/Option while
// dragging copies instead of moving (checked live, so pressing or releasing
// it mid-drag switches modes).
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
      title="Drag to move — hold Alt/Option to copy"
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
  const state = useAppState((s) => s);
  const dataset = state.dataset;
  const hiddenRowIds = state.hiddenRowIds;
  const selectedRowId = state.selectedRowId;
  const [popover, setPopover] = useState<PopoverState>(null);
  // Which rail item's action buttons are shown (§ hover-reveal). Tracked in JS
  // rather than pure CSS :hover: Safari can leave :hover "stuck" after a fast
  // mouse-exit from these absolutely-positioned, transitioned rows, but real
  // mouseenter/mouseleave events don't have that failure mode.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const dragController = useRailDragController(railContentRef);

  const closePopover = () => setPopover(null);

  return (
    <div className="rail" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rail-scroll">
        <div className="rail-content" ref={railContentRef} style={{ height: layout.totalHeight }}>
          {/* Behind the bands and the items, and from the same pure
              `rowStripes()` the canvas paints — the rail and the canvas share
              one scroll position, so a stripe that disagreed would be visible
              as a step at the rail's edge. Opacity carries `strength`, which
              is the same trick the canvas plays with globalAlpha. */}
          {rowStripes(layout.items).map((stripe, index) => (
            <div
              key={`stripe:${index}`}
              className="rail-row-stripe"
              style={{ top: stripe.y, height: stripe.height, opacity: ROW_STRIPES.strength }}
            />
          ))}
          {layout.items
            .filter((item) => item.kind === "group" && item.subtreeEndY !== undefined)
            .map((item) => (
              <div
                key={`band:${item.id}`}
                className="rail-group-band"
                style={{ top: item.y, height: item.subtreeEndY! - item.y }}
              />
            ))}
          {layout.items.map((item) => (
            <RailItem
              key={`${item.kind}:${item.id}`}
              item={item}
              hiddenRowIds={hiddenRowIds}
              selectedRowId={selectedRowId}
              openPopover={setPopover}
              engineRef={engineRef}
              hoveredKey={hoveredKey}
              onHoverEnter={setHoveredKey}
              onHoverLeave={() => setHoveredKey(null)}
              dragController={dragController}
            />
          ))}
          {dragController.indicatorTop !== null && (
            <div
              className={`rail-drop-indicator ${dragController.isCopy ? "rail-drop-indicator-copy" : ""}`}
              style={{ top: dragController.indicatorTop }}
            />
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
  return computedAgeFromBirth(group.birthDate);
}

// Shared by a group's own birthDate and a row's (own, or inherited from the
// nearest ancestor group) — a birth date reads the same age badge wherever it
// sits, since either kind of item can independently be a person.
function computedAgeFromBirth(birthDate: number): string | null {
  const years = (Date.now() - birthDate) / (365.25 * 86_400_000);
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
  selectedRowId?: string;
  openPopover: (p: PopoverState) => void;
  engineRef: MutableRefObject<TimelineEngine | null>;
  hoveredKey: string | null;
  onHoverEnter: (key: string) => void;
  onHoverLeave: () => void;
  dragController: RailDragController;
}

function RailItem({
  item,
  hiddenRowIds,
  selectedRowId,
  openPopover,
  engineRef,
  hoveredKey,
  onHoverEnter,
  onHoverLeave,
  dragController,
}: RailItemProps) {
  // `summaries` is set on exactly the collapsed groups (src/render/layout.ts),
  // so it answers "is this collapsed" without re-deriving the rule — and it
  // covers a public group, whose collapse lives in `collapsedGroupIds` rather
  // than on the group itself. It decides the ▸/▾ glyph and nothing else about
  // how this reads: a group's name looks the same collapsed or not, and the
  // same as a timeline's.
  const collapsed = item.summaries !== undefined;
  // A collapsed group's layout item is as tall as the summary bars the canvas
  // stacks in it (`lanes × ROW_HEIGHT`) — but the rail shows no bars, only the
  // name, so its box is the height that group's HEADER would have had while
  // expanded. Two things follow, and both are the point: the name sits on the
  // first line instead of floating in the middle of bars it does not label,
  // and — since `item.y` no longer changes with the collapse state either —
  // it sits at exactly the same pixel whether the group is open or shut.
  // Collapsing a group must not make its own name move.
  const style = { top: item.y, height: collapsed ? groupHeaderHeight(item.depth) : item.height };
  const readOnly = isForeignId(item.id);
  // Whether the "align to my age" toggle can do anything (needs the user's birth date).
  const canAlignFamous = useAppState((s) => userBirthMs(s) !== undefined);

  const key = `${item.kind}:${item.id}`;
  const hoverReveal = (visible: boolean) => `icon-button hover-reveal ${visible ? "hover-reveal-visible" : ""}`;

  // One block for every group, at any nesting depth — depth alone drives
  // header size and indentation (§ hierarchy through indentation and font
  // size); the shaded background comes from `.rail-group-band` behind it.
  if (item.kind === "group" && item.group) {
    const group = item.group;
    const age = computedAge(group);
    const visible = hoveredKey === key;
    const famous = item.depth === 0 ? parseFamousGroupId(group.id) : null;
    return (
      <div
        className="rail-group"
        style={{ ...style, paddingLeft: 8 + item.depth * 14 }}
        data-rail-kind="group"
        data-rail-id={group.id}
        data-rail-depth={item.depth}
        onMouseEnter={() => onHoverEnter(key)}
        onMouseLeave={onHoverLeave}
      >
        <button type="button" className="collapse-button" onClick={() => toggleGroupCollapsed(group.id)}>
          {collapsed ? "▸" : "▾"}
        </button>
        {group.icon && <span className="row-icon">{group.icon}</span>}
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
          {readOnly && item.depth === 0 && (
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
              <RailDragHandle
                className={hoverReveal(visible)}
                dragController={dragController}
                descriptor={{ kind: "group", id: group.id }}
              />
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
    // The row's own birthDate only — not a group's inherited one (§ pre-birth
    // fade uses birthDateForRow for that approximation; the badge states a
    // specific age, which would be wrong for a nested row that just hasn't
    // had its own birth date entered yet, e.g. a child dragged under a
    // parent's group).
    const age = row.birthDate === undefined ? null : computedAgeFromBirth(row.birthDate);
    const visible = hoveredKey === key;
    return (
      <div
        className={`rail-row ${row.id === selectedRowId ? "rail-row-selected" : ""}`}
        style={{ ...style, paddingLeft: 8 + item.depth * 14 }}
        data-rail-kind="row"
        data-rail-id={row.id}
        data-rail-depth={item.depth}
        onClick={() => selectRow(row.id)}
        onMouseEnter={() => onHoverEnter(key)}
        onMouseLeave={onHoverLeave}
      >
        <input
          type="checkbox"
          className="rail-row-checkbox"
          checked={!hidden}
          title="Show row"
          style={{ accentColor: row.color ?? "#888" }}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleRowHidden(row.id)}
        />
        <span className="row-icon">{row.icon}</span>
        <span className="rail-row-label" title={row.label}>
          <span className="label-full">{row.label}</span>
          <span className="label-initial">{row.label.slice(0, 1)}</span>
          {age !== null && <span className="age-badge">{age}</span>}
        </span>
        {!isForeignId(row.id) && (
          <span className="rail-actions">
            <ShareToggle row={row} visible={visible} />
            <RailDragHandle
              className={hoverReveal(visible)}
              dragController={dragController}
              descriptor={{ kind: "row", id: row.id }}
            />
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
        {popover.kind === "add-row" && <AddTopLevelRowForm close={close} />}
        {popover.kind === "add-menu" && <AddMenu groupId={popover.groupId} close={close} />}
        {popover.kind === "group-edit" && <GroupEditor groupId={popover.groupId} close={close} />}
        {popover.kind === "row-edit" && <RowEditor rowId={popover.rowId} close={close} />}
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
      <button type="button" className="menu-item" onClick={() => open({ kind: "add-row", top: 0 })}>
        ＋ Timeline
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

// A timeline that needs no group at all — the footer's other top-level "+".
function AddTopLevelRowForm({ close }: { close: () => void }) {
  const [label, setLabel] = useState("");
  const submit = () => {
    addRow(undefined, label.trim());
    close();
  };
  return (
    <div className="popover-form">
      <div className="popover-title">New timeline</div>
      <input
        type="text"
        autoFocus
        placeholder="Label (e.g. Job, Residence)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && label.trim() !== "" && submit()}
      />
      <button type="button" className="small-button" disabled={label.trim() === ""} onClick={submit}>
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

  const submit = () => {
    if (mode === "subgroup") addSubGroup(groupId, label.trim());
    else addRow(groupId, label.trim());
    close();
  };

  if (mode === "menu") {
    return (
      <div className="popover-form">
        <button type="button" className="menu-item" onClick={() => setMode("subgroup")}>
          🧑 Person or sub-group
        </button>
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
      <div className="row-edit-line">
        <input
          type="color"
          value={toHexColor(group.color ?? "#888888")}
          onChange={(e) => updateGroup(groupId, { color: e.target.value })}
        />
        <input
          type="text"
          className="emoji-input"
          value={group.icon ?? ""}
          maxLength={4}
          onChange={(e) => updateGroup(groupId, { icon: e.target.value || undefined })}
        />
        <input
          type="text"
          className="row-edit-name"
          value={group.label}
          onChange={(e) => updateGroup(groupId, { label: e.target.value })}
        />
      </div>
      <span className="emoji-picks">
        {EMOJI_QUICK_PICKS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="icon-button"
            onClick={() => updateGroup(groupId, { icon: emoji })}
          >
            {emoji}
          </button>
        ))}
      </span>
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
  const birthValue = row.birthDate !== undefined ? new Date(row.birthDate).toISOString().slice(0, 10) : "";

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
      <label className="field-label">Birth date — if this timeline is itself a person</label>
      <input
        type="date"
        value={birthValue}
        onChange={(e) => {
          const value = e.target.value;
          updateRow(rowId, { birthDate: value === "" ? undefined : Date.parse(`${value}T00:00:00Z`) });
        }}
      />
      {canBreakOut(dataset, rowId) && (
        <button
          type="button"
          className="small-button"
          onClick={() => {
            if (window.confirm(describeBreakOut(dataset, rowId))) {
              breakOutRow(rowId);
              close();
            }
          }}
        >
          Break out into timelines…
        </button>
      )}
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
