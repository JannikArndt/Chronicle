// The Chronicle canvas engine — a plain, framework-agnostic TS module (§8).
// It owns the viewport (time scale + vertical scroll), the rAF draw loop,
// virtualization, and all pointer/wheel/pinch input on the canvas. React owns
// everything DOM (rail, panels) and feeds state in via setInput().

import { computeLayout } from "./layout";
import type { Layout, LayoutItem } from "./layout";
import { ROW_HEIGHT } from "./layout";
import { barGeometry, gradientStops, labelAnchorX, labelLimitX, pickBarLabel, truncateToWidth } from "./bars";
import type { BarGeometry } from "./bars";
import { EVENT_PIN_RADIUS_PX, eventMarkerOpacity, layoutEventMarkers } from "./events";
import type { EventMarker } from "./events";
import { clampScale, msToX, panBy, scaleForRange, xToMs, zoomAt } from "./timeScale";
import type { TimeScale } from "./timeScale";
import { computeTicks, snapForScale } from "./timeAxis";
import { formatFuzzyDate } from "../model/fuzzyDate";
import { faviconUrl } from "../model/favicon";
import type { Precision, TimelineDataset, TimelineEntry, TimelineEvent, TimelineRow } from "../model/types";
import { birthDateForRow } from "../model/dataset";

const FAVICON_SIZE_PX = 12;
const FAVICON_GAP_PX = 4;

// Breathing room between a truncated label and the bar that clamped it.
const LABEL_END_PADDING_PX = 6;

// Minimum gap between two axis titles before the pinned one gives way.
const AXIS_LABEL_GAP_PX = 10;

// An event marker's pin head sits near the top of its row, with the label
// beside it. These two numbers are what keeps that label's plate clear of the
// bar labels below it, which are centred on the bar itself: at ROW_HEIGHT the
// plate ends where a bar label's ascender begins.
const EVENT_PIN_TOP_OFFSET_PX = 7;
const EVENT_LABEL_PLATE_HEIGHT_PX = 13;
const EVENT_LABEL_PLATE_PADDING_PX = 4;

export const AXIS_HEIGHT = 46;
const PLUS_RADIUS = 11;
const MIN_GAP_FOR_PLUS_PX = 48;

// What separates a tap from the end of a pan. A finger never holds perfectly
// still, so movement alone is not enough — a slow, short drag is still a drag.
const TAP_MAX_MOVEMENT_PX = 9;
const TAP_MAX_DURATION_MS = 350;
// Fingers are wider than bars: a tap this close to a bar still counts as on it.
const TAP_SLOP_PX = 4;

// Fallback palette used if CSS custom properties aren't resolvable (e.g. no
// document, as in unit tests) — mirrors the light theme in src/ui/styles.css.
const FALLBACK_COLORS = {
  background: "#fafaf8",
  axisBackground: "#f1f0ec",
  axisBorder: "#d8d6d0",
  axisCoarseText: "#57534e",
  axisFineText: "#a8a29e",
  gridline: "#eceae5",
  gridlineCoarse: "#dedcd5",
  groupBand: "#efeee9",
  rowSelected: "rgba(120, 140, 200, 0.10)",
  barText: "#292524",
  barTextInverse: "#ffffff",
  connector: "#8b7bb8",
  guide: "#c2410c",
  inactiveHatch: "rgba(120, 120, 120, 0.18)",
  plusFill: "#6d8bc7",
  bracket: "rgba(80, 76, 70, 0.55)",
  event: "#4a4340",
};

export type ColorTable = typeof FALLBACK_COLORS;

// The canvas is painted by JS, not CSS, so it can't pick up the OS dark-mode
// media query on its own — read the same custom properties the DOM UI uses
// (defined in src/ui/styles.css) so the two never mismatch. Exported because
// the minimap is a second canvas and must not grow a colour table of its own.
export function readThemeColors(): ColorTable {
  if (typeof document === "undefined") return FALLBACK_COLORS;
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };
  return {
    background: read("--color-bg", FALLBACK_COLORS.background),
    axisBackground: read("--color-bg-hover", FALLBACK_COLORS.axisBackground),
    axisBorder: read("--color-border-strong", FALLBACK_COLORS.axisBorder),
    axisCoarseText: read("--color-text-secondary", FALLBACK_COLORS.axisCoarseText),
    axisFineText: read("--color-text-faint", FALLBACK_COLORS.axisFineText),
    gridline: read("--color-canvas-gridline", FALLBACK_COLORS.gridline),
    gridlineCoarse: read("--color-canvas-gridline-strong", FALLBACK_COLORS.gridlineCoarse),
    groupBand: read("--color-bg-subtle", FALLBACK_COLORS.groupBand),
    rowSelected: read("--color-canvas-row-selected", FALLBACK_COLORS.rowSelected),
    barText: read("--color-text", FALLBACK_COLORS.barText),
    barTextInverse: FALLBACK_COLORS.barTextInverse, // white-on-accent stays white in both themes
    connector: read("--color-connector", FALLBACK_COLORS.connector),
    guide: read("--color-accent", FALLBACK_COLORS.guide),
    inactiveHatch: read("--color-hatch", FALLBACK_COLORS.inactiveHatch),
    plusFill: read("--color-info", FALLBACK_COLORS.plusFill),
    bracket: read("--color-canvas-bracket", FALLBACK_COLORS.bracket),
    event: read("--color-canvas-event", FALLBACK_COLORS.event),
  };
}

export interface EngineCallbacks {
  onSelectEntry: (entryId: string) => void;
  onSelectEvent: (eventId: string) => void;
  onSelectRow: (rowId: string | undefined, clickTimeMs: number) => void;
  onRequestDraft: (rowId: string, startMs: number) => void;
  onPickDate: (ms: number, precision: Precision) => void;
  onScrollSync: (scrollY: number) => void;
  // Fired whenever the visible window changes, so an overview (the mobile
  // minimap) can track pan, pinch and vertical scroll frame by frame.
  onViewChange?: (view: EngineView) => void;
}

// What part of the whole timeline is on screen: a time span across, and a slice
// of the laid-out rows down. Both are needed by the minimap, and reporting them
// together is what keeps its window from lagging one axis behind the other.
export interface EngineView {
  startMs: number;
  endMs: number;
  // In layout pixels, measured from the top of the first row.
  scrollY: number;
  visibleHeight: number;
  totalHeight: number;
}

export interface EngineInput {
  dataset: TimelineDataset;
  layout: Layout;
  selectedEntryId?: string;
  selectedEventId?: string;
  selectedRowId?: string;
  draft?: TimelineEntry;
  // Entry ids that should stand out; null when no search/filter is active.
  emphasizedEntryIds: Set<string> | null;
  // The same, for events. A separate set rather than one mixed bag: the two are
  // looked up in different loops and an id from the wrong entity would silently
  // dim nothing.
  emphasizedEventIds: Set<string> | null;
  picking: boolean;
  // Pixels of canvas left empty above the axis header. The mobile shell floats
  // its chips over the canvas, and the axis has to start below them or the
  // years are unreadable. Desktop leaves this at 0.
  axisTop?: number;
}

interface EntryHit {
  // The hit box, which extends past the bar to cover a label drawn outside it.
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  // The bar's own width. Overlapping entries are resolved in favour of the
  // narrowest, and a long label must not make its entry look narrow.
  barWidth: number;
  entry: TimelineEntry;
}

interface EventHit {
  // The box, which covers the pin and whatever label was drawn beside it.
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  // The pin itself — two overlapping boxes are resolved by which moment the
  // finger is actually nearest to.
  pinX: number;
  event: TimelineEvent;
}

interface PlusHit {
  x: number;
  y: number;
  rowId: string;
  startMs: number;
}

export class TimelineEngine {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;

  scale: TimeScale;
  scrollY = 0;

  private input: EngineInput;
  private dirty = true;
  private rafHandle = 0;
  private destroyed = false;

  private entryHits: EntryHit[] = [];
  private eventHits: EventHit[] = [];
  private plusHits: PlusHit[] = [];
  private pointerDown?: {
    x: number;
    y: number;
    time: number;
    scale: TimeScale;
    scrollY: number;
    moved: boolean;
    // Peak distance from the press point, so a gesture that wanders and comes
    // back is not mistaken for a tap.
    maxMovement: number;
  };
  private activePointers = new Map<number, { x: number; y: number }>();
  private pinchStart?: { distance: number; midX: number; scale: TimeScale };
  private hoverX: number | null = null;
  private lastEmittedView: EngineView | null = null;
  private hatchPattern: CanvasPattern | null = null;
  // Resolved once at construction and re-resolved on OS theme change (see
  // attachEvents) — never a second hardcoded color table that could drift
  // from the DOM UI's CSS custom properties.
  private colors: ColorTable = FALLBACK_COLORS;
  // Removes all canvas listeners on destroy — without this, React StrictMode's
  // dev double-mount leaves a zombie engine still handling pointer input.
  private eventAbort = new AbortController();
  // Where the user last clicked in an empty selected row — that's where its
  // single "+" appears (§6).
  private emptyRowClick: { rowId: string; ms: number } | null = null;
  // Favicon images for entries with a website (§5), keyed by favicon URL.
  // No explicit repaint trigger needed on load — the rAF loop below already
  // repaints every frame, so a newly-loaded image just appears next frame.
  private faviconCache = new Map<string, HTMLImageElement | "loading" | "error">();

  constructor(
    private canvas: HTMLCanvasElement,
    private callbacks: EngineCallbacks,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.colors = readThemeColors();
    const now = Date.now();
    const YEAR_MS = 365.25 * 86_400_000;
    // Initial view: the last ~30 years with a little future margin.
    this.scale = { startMs: now - 30 * YEAR_MS, msPerPx: (35 * YEAR_MS) / Math.max(canvas.clientWidth, 600) };
    const emptySet: TimelineDataset = {
      schemaVersion: 1,
      groups: [],
      rows: [],
      entries: [],
      events: [],
    };
    this.input = {
      dataset: emptySet,
      layout: computeLayout(emptySet, new Set()),
      emphasizedEntryIds: null,
      emphasizedEventIds: null,
      picking: false,
    };
    this.attachEvents();
    this.loop();
  }

  // ---------- public API ----------

  setInput(input: EngineInput): void {
    // Forget the remembered click position once its row is deselected —
    // but not on the state update caused by that very click.
    if (this.emptyRowClick && input.selectedRowId !== this.emptyRowClick.rowId) this.emptyRowClick = null;
    this.input = input;
    this.requestDraw();
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.requestDraw();
  }

  panPixels(dx: number, dy: number): void {
    this.scale = clampScale(panBy(this.scale, dx));
    this.setScrollY(this.scrollY + dy);
    this.requestDraw();
  }

  zoomBy(factor: number, anchorX?: number): void {
    this.scale = zoomAt(this.scale, anchorX ?? this.width / 2, factor);
    this.requestDraw();
  }

  jumpToNow(): void {
    this.scale = { ...this.scale, startMs: Date.now() - (this.width / 2) * this.scale.msPerPx };
    this.requestDraw();
  }

  zoomToRange(startMs: number, endMs: number): void {
    this.scale = scaleForRange(startMs, endMs, this.width);
    this.requestDraw();
  }

  // Re-centres on an instant at the current zoom — dragging the minimap moves
  // the view without changing how far in the user was.
  centerOnMs(ms: number): void {
    this.scale = clampScale({ ...this.scale, startMs: ms - (this.width / 2) * this.scale.msPerPx });
    this.requestDraw();
  }

  // The vertical counterpart, in layout pixels — the minimap's other axis.
  centerOnLayoutY(y: number): void {
    this.setScrollY(y - (this.height - this.contentTop()) / 2);
    this.requestDraw();
  }

  requestDraw(): void {
    this.dirty = true;
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafHandle);
    this.eventAbort.abort();
  }

  // ---------- internals ----------

  // The y where rows begin: everything above it belongs to the axis header and
  // to whatever the host floats above it.
  private contentTop(): number {
    return (this.input.axisTop ?? 0) + AXIS_HEIGHT;
  }

  private setScrollY(value: number): void {
    const maxScroll = Math.max(0, this.input.layout.totalHeight - (this.height - this.contentTop()) + 40);
    this.scrollY = Math.min(maxScroll, Math.max(0, value));
    this.callbacks.onScrollSync(this.scrollY);
  }

  private loop = (): void => {
    if (this.destroyed) return;
    if (this.dirty && this.width > 0) {
      this.dirty = false;
      this.draw();
    }
    this.rafHandle = requestAnimationFrame(this.loop);
  };

  // ---------- input ----------

  private attachEvents(): void {
    // touch-action: none is what stops iOS Safari page zoom/scroll from
    // fighting the canvas gestures (§9) — set here so it can't be forgotten.
    this.canvas.style.touchAction = "none";

    // Re-read the CSS custom properties and repaint when the OS flips
    // light/dark live — otherwise the canvas would only ever match whichever
    // theme was active at mount time.
    if (typeof window !== "undefined" && window.matchMedia) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener(
          "change",
          () => {
            this.colors = readThemeColors();
            this.hatchPattern = null; // cached pattern baked in the old hatch color
            this.requestDraw();
          },
          { signal: this.eventAbort.signal },
        );
    }

    this.canvas.addEventListener("pointerdown", (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      this.activePointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
      if (this.activePointers.size === 2) {
        const [a, b] = [...this.activePointers.values()];
        this.pinchStart = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          midX: (a.x + b.x) / 2,
          scale: this.scale,
        };
        this.pointerDown = undefined;
      } else {
        this.pointerDown = {
          x: event.offsetX,
          y: event.offsetY,
          time: event.timeStamp,
          scale: this.scale,
          scrollY: this.scrollY,
          moved: false,
          maxMovement: 0,
        };
      }
    }, { signal: this.eventAbort.signal });

    this.canvas.addEventListener("pointermove", (event) => {
      if (this.activePointers.has(event.pointerId)) {
        this.activePointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
      }
      if (this.input.picking) {
        this.hoverX = event.offsetX;
        this.requestDraw();
      }
      if (this.pinchStart && this.activePointers.size === 2) {
        const [a, b] = [...this.activePointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > 0) {
          const factor = this.pinchStart.distance / distance;
          this.scale = zoomAt(this.pinchStart.scale, this.pinchStart.midX, factor);
          this.requestDraw();
        }
        return;
      }
      if (!this.pointerDown) return;
      const dx = event.offsetX - this.pointerDown.x;
      const dy = event.offsetY - this.pointerDown.y;
      this.pointerDown.maxMovement = Math.max(this.pointerDown.maxMovement, Math.hypot(dx, dy));
      if (!this.pointerDown.moved && Math.hypot(dx, dy) < 4) return;
      this.pointerDown.moved = true;
      // Drag pans BOTH axes at once — horizontal-only panning was explicitly
      // called out as broken during discovery (§6).
      this.scale = clampScale(panBy(this.pointerDown.scale, -dx));
      this.scrollY = this.pointerDown.scrollY; // setScrollY clamps + syncs
      this.setScrollY(this.pointerDown.scrollY - dy);
      this.requestDraw();
    }, { signal: this.eventAbort.signal });

    const endPointer = (event: PointerEvent) => {
      // A tap, not merely "a press that didn't pan": panning starts after 4px,
      // but a finger that drifts a little and lifts straight away still meant
      // to tap, and one that creeps 8px over two seconds did not. The time
      // limit is for fingers only — a mouse can rest on a button all day and
      // still be clicking it.
      const press = this.pointerDown;
      const heldTooLong =
        event.pointerType !== "mouse" && event.timeStamp - (press?.time ?? 0) >= TAP_MAX_DURATION_MS;
      const wasTap = press !== undefined && press.maxMovement < TAP_MAX_MOVEMENT_PX && !heldTooLong;
      this.activePointers.delete(event.pointerId);
      if (this.activePointers.size < 2) this.pinchStart = undefined;
      if (wasTap) this.handleClick(event.offsetX, event.offsetY);
      this.pointerDown = undefined;
    };
    this.canvas.addEventListener("pointerup", endPointer, { signal: this.eventAbort.signal });
    this.canvas.addEventListener("pointercancel", (event) => {
      this.activePointers.delete(event.pointerId);
      if (this.activePointers.size < 2) this.pinchStart = undefined;
      this.pointerDown = undefined;
    }, { signal: this.eventAbort.signal });

    this.canvas.addEventListener("pointerleave", () => {
      if (this.hoverX !== null) {
        this.hoverX = null;
        this.requestDraw();
      }
    }, { signal: this.eventAbort.signal });

    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (event.ctrlKey) {
          // ctrl+wheel is how browsers report trackpad pinch (§6).
          this.zoomBy(Math.exp(event.deltaY * 0.01), event.offsetX);
        } else {
          this.panPixels(event.deltaX, event.deltaY);
        }
      },
      { passive: false, signal: this.eventAbort.signal },
    );
  }

  private handleClick(x: number, y: number): void {
    if (this.input.picking) {
      const snapped = snapForScale(this.scale, xToMs(this.scale, x), this.width);
      this.callbacks.onPickDate(snapped.ms, snapped.precision);
      this.hoverX = null;
      return;
    }
    for (const plus of this.plusHits) {
      if (Math.hypot(plus.x - x, plus.y - y) <= PLUS_RADIUS + 4) {
        this.callbacks.onRequestDraft(plus.rowId, plus.startMs);
        return;
      }
    }
    // Event markers are checked before bars: a pin is a point drawn ON TOP of
    // whatever bar it sits over, and a target of a few pixels loses every
    // ambiguous tap to the bar behind it otherwise.
    const touchedEvents = this.eventHits.filter(
      (hit) =>
        x >= hit.x0 - TAP_SLOP_PX &&
        x <= hit.x1 + TAP_SLOP_PX &&
        y >= hit.y0 - TAP_SLOP_PX &&
        y <= hit.y1 + TAP_SLOP_PX,
    );
    if (touchedEvents.length > 0) {
      // Nearest pin wins, not the first: two markers whose labels overlap are
      // resolved by which moment the finger actually landed on.
      const nearest = touchedEvents.reduce((best, hit) =>
        Math.abs(hit.pinX - x) < Math.abs(best.pinX - x) ? hit : best,
      );
      this.callbacks.onSelectEvent(nearest.event.id);
      return;
    }
    // Every row is concurrent, so a tap can land on several overlapping bars.
    // The narrowest wins: a short entry drawn on top of a long one is otherwise
    // impossible to select, while the long one stays reachable everywhere else.
    const touchedEntries = this.entryHits.filter(
      (hit) =>
        x >= hit.x0 - TAP_SLOP_PX &&
        x <= hit.x1 + TAP_SLOP_PX &&
        y >= hit.y0 - TAP_SLOP_PX &&
        y <= hit.y1 + TAP_SLOP_PX,
    );
    if (touchedEntries.length > 0) {
      const narrowest = touchedEntries.reduce((best, hit) => (hit.barWidth < best.barWidth ? hit : best));
      this.callbacks.onSelectEntry(narrowest.entry.id);
      return;
    }
    const contentY = y - this.contentTop() + this.scrollY;
    const rowItem = this.input.layout.items.find(
      (item) => item.kind === "row" && contentY >= item.y && contentY <= item.y + item.height,
    );
    const clickTimeMs = xToMs(this.scale, x);
    if (rowItem?.row) {
      this.emptyRowClick = { rowId: rowItem.row.id, ms: clickTimeMs };
      this.callbacks.onSelectRow(rowItem.row.id, clickTimeMs);
    } else {
      this.callbacks.onSelectRow(undefined, clickTimeMs);
    }
  }

  // ---------- drawing ----------

  private draw(): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(0, 0, this.width, this.height);

    this.entryHits = [];
    this.eventHits = [];
    this.plusHits = [];

    const ticks = computeTicks(this.scale, this.width);

    // Content area (clipped below the axis header).
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.contentTop(), this.width, this.height - this.contentTop());
    ctx.clip();
    ctx.translate(0, this.contentTop() - this.scrollY);
    this.drawGridlines(ticks);
    this.drawContent();
    ctx.restore();

    // Axis header LAST but strictly in this order: background/border first,
    // then text — repainting the background after the text silently erased
    // the axis in an early build (§5) and must never happen again.
    this.drawAxisHeader(ticks);

    if (this.input.picking && this.hoverX !== null) this.drawPickGuide(this.hoverX);

    this.emitViewChangeIfMoved();
  }

  // Announced from the draw loop rather than from each pan/zoom entry point:
  // every one of them ends in a repaint, so this catches all of them once.
  private emitViewChangeIfMoved(): void {
    const view: EngineView = {
      startMs: this.scale.startMs,
      endMs: xToMs(this.scale, this.width),
      scrollY: this.scrollY,
      visibleHeight: this.height - this.contentTop(),
      totalHeight: this.input.layout.totalHeight,
    };
    const last = this.lastEmittedView;
    if (
      last &&
      last.startMs === view.startMs &&
      last.endMs === view.endMs &&
      last.scrollY === view.scrollY &&
      last.visibleHeight === view.visibleHeight &&
      last.totalHeight === view.totalHeight
    ) {
      return;
    }
    this.lastEmittedView = view;
    this.callbacks.onViewChange?.(view);
  }

  private drawGridlines(ticks: { fine: { ms: number }[]; coarse: { ms: number }[] }): void {
    const { ctx } = this;
    const y0 = this.scrollY;
    const y1 = this.scrollY + this.height - this.contentTop();
    for (const [tickList, color] of [
      [ticks.fine, this.colors.gridline],
      [ticks.coarse, this.colors.gridlineCoarse],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const tick of tickList) {
        const x = Math.round(msToX(this.scale, tick.ms)) + 0.5;
        if (x < -1 || x > this.width + 1) continue;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      ctx.stroke();
    }
  }

  private visibleRowItems(): LayoutItem[] {
    const top = this.scrollY - ROW_HEIGHT;
    const bottom = this.scrollY + this.height - this.contentTop() + ROW_HEIGHT;
    return this.input.layout.items.filter((item) => item.y + item.height >= top && item.y <= bottom);
  }

  private drawContent(): void {
    const { ctx } = this;
    const nowMs = Date.now();
    const visible = this.visibleRowItems();
    const emphasis = this.input.emphasizedEntryIds;
    const selectedEntry =
      this.input.dataset.entries.find((e) => e.id === this.input.selectedEntryId) ??
      (this.input.draft?.id === this.input.selectedEntryId ? this.input.draft : undefined);
    const relatedIds = selectedEntry ? this.relatedEntryIds(selectedEntry) : null;

    for (const item of visible) {
      if (item.kind === "group") {
        ctx.fillStyle = this.colors.groupBand;
        ctx.fillRect(0, item.y, this.width, item.height - 6);
        continue;
      }
      if (item.kind === "subgroup") continue;
      if (item.row && !item.hidden) this.drawRow(item, nowMs, emphasis, relatedIds);
    }

    if (selectedEntry) this.drawConnectors(selectedEntry, visible, nowMs);
    if (this.input.draft) this.drawDraft(this.input.draft, visible, nowMs);
  }


  private drawRow(
    item: LayoutItem,
    nowMs: number,
    emphasis: Set<string> | null,
    relatedIds: Set<string> | null,
  ): void {
    const { ctx } = this;
    const row = item.row!;
    const color = row.color ?? "#888";

    if (row.id === this.input.selectedRowId) {
      ctx.fillStyle = this.colors.rowSelected;
      ctx.fillRect(0, item.y - 2, this.width, item.height + 4);
    }

    // Inactive band before the birth of whoever this timeline belongs to (§5).
    const birthDate = birthDateForRow(this.input.dataset, row);
    if (birthDate !== undefined) {
      const birthX = msToX(this.scale, birthDate);
      if (birthX > 0) {
        ctx.fillStyle = this.getHatchPattern();
        ctx.fillRect(0, item.y + 4, Math.min(birthX, this.width), item.height - 8);
      }
    }

    const entries = this.input.dataset.entries
      .filter((e) => e.rowId === row.id)
      .sort((a, b) => a.start.ms - b.start.ms);

    // Every bar's geometry up front, because a label's width budget depends on
    // where its neighbours start — not just on its own bar.
    const geometries = entries.map((entry) => barGeometry(entry, this.scale, nowMs));

    entries.forEach((entry, index) => {
      const geom = geometries[index];
      if (geom.xVisualEnd < 0 || geom.xVisualStart > this.width) return;
      let alpha = 1;
      if (emphasis && !emphasis.has(entry.id)) alpha = 0.22;
      if (relatedIds && !relatedIds.has(entry.id)) alpha = Math.min(alpha, 0.25);
      const limit = labelLimitX(index, geometries, this.width);
      this.drawBar(entry, geom, item, color, alpha, entry.id === this.input.selectedEntryId, limit);
      if (row.parentRowId) this.drawSubEntryBracket(entry, geom, item);
    });

    // Above the bars, because a moment happened *on* this timeline — and below
    // the plus affordances, which are the one thing that must never be covered.
    this.drawEvents(item, relatedIds !== null);

    if (row.id === this.input.selectedRowId && !this.input.draft) {
      this.drawPlusAffordances(row, entries, item, nowMs);
    }
  }

  // Every event on one row, drawn as a pin with the label beside it — and only
  // once the view is fine enough for a point in time to mean anything
  // (src/render/events.ts owns that rule and the fade that goes with it).
  private drawEvents(item: LayoutItem, anEntryIsSelected: boolean): void {
    const zoomOpacity = eventMarkerOpacity(this.scale);
    const emphasis = this.input.emphasizedEventIds;
    const row = item.row!;
    let events = this.input.dataset.events.filter((event) => event.rowId === row.id);
    // A search is a request to find something, so a matching moment is drawn
    // even at a zoom that would otherwise hide it — dimming the whole timeline
    // and then showing no match is search telling a lie. Only the matches are
    // drawn there, so the declutter below has just them to space out.
    if (zoomOpacity === 0) {
      if (emphasis === null) return;
      events = events.filter((event) => emphasis.has(event.id));
    }
    if (events.length === 0) return;

    const { ctx } = this;
    // A compact row is a dense overview band with no room for text; the pins
    // still mark where the moments are.
    const labelled = !item.compact;
    ctx.save();
    ctx.font = "11px -apple-system, system-ui, sans-serif";
    const markers = layoutEventMarkers(
      events,
      this.scale,
      this.width,
      labelled ? (text) => ctx.measureText(text).width : () => 0,
    );
    for (const marker of markers) {
      const matched = emphasis?.has(marker.event.id) ?? false;
      let alpha = matched ? 1 : zoomOpacity;
      if (emphasis && !matched) alpha *= 0.22;
      // An entry selection focuses the picture on that entry and what it is
      // connected to; an event is never part of that, so it recedes with
      // everything else rather than staying the brightest thing on the row.
      if (anEntryIsSelected && marker.event.id !== this.input.selectedEventId) alpha = Math.min(alpha, 0.25);
      this.drawEventMarker(marker, item, alpha, labelled);
    }
    ctx.restore();
  }

  private drawEventMarker(marker: EventMarker, item: LayoutItem, alpha: number, labelled: boolean): void {
    const { ctx } = this;
    const selected = marker.event.id === this.input.selectedEventId;
    const pinY = item.y + (item.compact ? item.height / 2 : EVENT_PIN_TOP_OFFSET_PX);
    const top = item.y + 3;
    const bottom = item.y + item.height - 3;
    const x = Math.round(marker.x) + 0.5;

    ctx.save();
    ctx.globalAlpha = alpha;

    // The precision band first, under everything: "somewhere in this window",
    // the same claim a bar's fuzzy edge makes.
    const bandWidth = marker.xFuzzEnd - marker.xFuzzStart;
    if (bandWidth >= 2) {
      ctx.fillStyle = colorWithAlpha(this.colors.event, 0.1);
      ctx.fillRect(marker.xFuzzStart, top, bandWidth, bottom - top);
    }

    // Stem, then head. The head is outlined in the canvas background so it
    // stays visible against a bar of any colour underneath it.
    ctx.strokeStyle = colorWithAlpha(this.colors.event, 0.55);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();

    const radius = item.compact ? EVENT_PIN_RADIUS_PX - 1 : EVENT_PIN_RADIUS_PX;
    ctx.beginPath();
    ctx.moveTo(x, pinY - radius);
    ctx.lineTo(x + radius, pinY);
    ctx.lineTo(x, pinY + radius);
    ctx.lineTo(x - radius, pinY);
    ctx.closePath();
    ctx.fillStyle = this.colors.event;
    ctx.fill();
    ctx.strokeStyle = this.colors.background;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (selected) {
      ctx.strokeStyle = this.colors.guide;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, pinY, radius + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // The label sits on a plate of the canvas's own background: it is drawn
    // over bars, and 11px text straight onto a coloured bar is unreadable.
    if (labelled && marker.label !== "") {
      const plateY = pinY - EVENT_LABEL_PLATE_HEIGHT_PX / 2;
      ctx.fillStyle = colorWithAlpha(this.colors.background, 0.85);
      roundRectPath(
        ctx,
        marker.labelX - EVENT_LABEL_PLATE_PADDING_PX,
        plateY,
        marker.labelWidth + EVENT_LABEL_PLATE_PADDING_PX * 2,
        EVENT_LABEL_PLATE_HEIGHT_PX,
        4,
      );
      ctx.fill();
      ctx.fillStyle = selected ? this.colors.guide : this.colors.barText;
      ctx.textBaseline = "middle";
      ctx.fillText(marker.label, marker.labelX, pinY);
    }
    ctx.restore();

    // The whole row height is the tap target, and the label widens it — a pin
    // is 8px across, which is nothing to a thumb.
    this.eventHits.push({
      x0: marker.x - EVENT_PIN_RADIUS_PX,
      x1: Math.max(marker.x + EVENT_PIN_RADIUS_PX, labelled ? marker.labelX + marker.labelWidth : 0),
      pinX: marker.x,
      y0: item.y - this.scrollY + this.contentTop(),
      y1: item.y + item.height - this.scrollY + this.contentTop(),
      event: marker.event,
    });
  }

  private drawBar(
    entry: TimelineEntry,
    geom: BarGeometry,
    item: LayoutItem,
    color: string,
    alpha: number,
    selected: boolean,
    // Where the next bar on this row starts; the label may not reach it.
    labelLimit: number,
  ): void {
    const { ctx } = this;
    const verticalPadding = item.compact ? 3 : 6;
    const top = item.y + verticalPadding;
    const barHeight = item.height - verticalPadding * 2;
    const x0 = geom.xVisualStart;
    const x1 = geom.xVisualEnd;
    const width = Math.max(x1 - x0, 2);

    ctx.save();
    ctx.globalAlpha = alpha;

    // One continuous alpha-ramp gradient across the whole bar (§5) — never a
    // solid rect butted against a separate gradient rect.
    let fill: string | CanvasGradient = color;
    const stops = gradientStops(geom);
    if (stops.some((s) => s.alpha < 1) && width > 3) {
      const gradient = ctx.createLinearGradient(x0, 0, x1, 0);
      for (const stop of stops) gradient.addColorStop(stop.offset, colorWithAlpha(color, stop.alpha));
      fill = gradient;
    }

    ctx.beginPath();
    if (geom.ongoing) {
      // Open arrow taper instead of a hard stop (§5).
      const arrow = Math.min(14, width);
      ctx.moveTo(x0, top);
      ctx.lineTo(x1 - arrow, top);
      ctx.lineTo(x1, top + barHeight / 2);
      ctx.lineTo(x1 - arrow, top + barHeight);
      ctx.lineTo(x0, top + barHeight);
      ctx.closePath();
    } else {
      roundRectPath(ctx, x0, top, width, barHeight, 5);
    }
    ctx.fillStyle = fill;
    ctx.fill();

    // Diagonal hatch over circa-precision fuzzy edges (§5).
    if (entry.start.precision === "circa" && geom.xSolidStart > x0) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = this.getHatchPattern();
      ctx.fillRect(x0, top, geom.xSolidStart - x0, barHeight);
      ctx.restore();
    }
    if (entry.end?.precision === "circa" && geom.xVisualEnd > geom.xSolidEnd) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = this.getHatchPattern();
      ctx.fillRect(geom.xSolidEnd, top, geom.xVisualEnd - geom.xSolidEnd, barHeight);
      ctx.restore();
    }

    // Accent, not text colour: at mobile bar heights a dark outline reads as
    // part of the bar rather than as "this one is selected".
    if (selected) {
      ctx.strokeStyle = this.colors.guide;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Label anchored inside the near-opaque span so it stays legible (§5),
    // swapping to shortTitle when the full title overflows the bar, with a
    // favicon (if entry.website is set and its icon has loaded) in front.
    // In a compact (collapsed-area) row the bar carries its ROW's label — the
    // rail no longer shows it — in a smaller font, with no favicon.
    let labelText: string;
    let iconSpace = 0;
    let icon: CanvasImageSource | undefined;
    if (item.compact) {
      ctx.font = "10px -apple-system, system-ui, sans-serif";
      labelText = item.row?.label ?? entry.title;
    } else {
      ctx.font = "12px -apple-system, system-ui, sans-serif";
      const iconUrl = entry.website ? faviconUrl(entry.website, FAVICON_SIZE_PX) : undefined;
      icon = iconUrl ? this.getFaviconImage(iconUrl) : undefined;
      iconSpace = icon ? FAVICON_SIZE_PX + FAVICON_GAP_PX : 0;
      const titleWidth = ctx.measureText(entry.title).width;
      const useShortTitle =
        pickBarLabel(entry, geom, titleWidth + iconSpace) === "shortTitle" && !!entry.shortTitle;
      labelText = useShortTitle ? entry.shortTitle! : entry.title;
    }
    // Clamped to the neighbouring bar, then cut to fit. Before this, a long
    // title was drawn at full length across the bar next to it AND had that
    // width folded into its own tap target below — which is what made the
    // covered entry unselectable.
    const labelX = labelAnchorX(geom, ctx.measureText(labelText).width + iconSpace, this.width);
    const available = labelLimit - labelX - iconSpace - LABEL_END_PADDING_PX;
    labelText = truncateToWidth(labelText, available, (candidate) => ctx.measureText(candidate).width);
    const textWidth = labelText === "" ? 0 : ctx.measureText(labelText).width;

    ctx.fillStyle = readableTextColor(colorToRgb(this.ctx, color), this.colors);
    ctx.textBaseline = "middle";
    if (icon) {
      ctx.drawImage(icon, labelX, top + barHeight / 2 - FAVICON_SIZE_PX / 2, FAVICON_SIZE_PX, FAVICON_SIZE_PX);
    }
    if (labelText !== "") ctx.fillText(labelText, labelX + iconSpace, top + barHeight / 2);
    ctx.restore();

    // The label still widens the tap target — that is how a one-pixel bar stays
    // tappable — but it can no longer reach past the neighbour it was clamped
    // to, so it cannot steal that entry's taps.
    this.entryHits.push({
      x0: Math.min(x0, labelX),
      x1: Math.max(x1, labelX + iconSpace + textWidth),
      y0: item.y + 6 - this.scrollY + this.contentTop(),
      y1: item.y + item.height - 6 - this.scrollY + this.contentTop(),
      barWidth: width,
      entry,
    });
  }

  // Lazily loads and caches a favicon image; returns undefined until it has
  // finished loading (no manual repaint needed — the rAF loop already repaints
  // every frame, so a completed load just appears on the next one).
  private getFaviconImage(url: string): HTMLImageElement | undefined {
    const cached = this.faviconCache.get(url);
    if (cached === "loading" || cached === "error") return undefined;
    if (cached) return cached;
    this.faviconCache.set(url, "loading");
    const image = new Image();
    image.onload = () => this.faviconCache.set(url, image);
    image.onerror = () => this.faviconCache.set(url, "error");
    image.src = url;
    return undefined;
  }

  // Sub-timeline bracket (§5): vertical line from the attached parent entry
  // down to the sub-entry, with a notch "cut into" the parent bar.
  private drawSubEntryBracket(entry: TimelineEntry, geom: BarGeometry, item: LayoutItem): void {
    const { ctx } = this;
    const row = item.row!;
    const parentRow = this.input.dataset.rows.find((r) => r.id === row.parentRowId);
    if (!parentRow) return;
    const parentItem = this.input.layout.items.find((i) => i.kind === "row" && i.id === parentRow.id);
    if (!parentItem) return;

    const parentEntries = this.input.dataset.entries.filter((e) => e.rowId === parentRow.id);
    let parent: TimelineEntry | undefined;
    if (entry.parentEntryId) {
      // Explicit attachment overrides resolution and can span non-overlapping ranges.
      parent = this.input.dataset.entries.find((e) => e.id === entry.parentEntryId);
    } else {
      parent =
        parentEntries.find(
          (e) => e.start.ms <= entry.start.ms && (e.end?.ms ?? Number.POSITIVE_INFINITY) >= entry.start.ms,
        ) ??
        parentEntries
          .filter((e) => e.start.ms <= entry.start.ms)
          .sort((a, b) => b.start.ms - a.start.ms)[0];
    }
    if (!parent) return; // no qualifying parent entry → no bracket (§5)

    const x = Math.round(Math.max(geom.xVisualStart, msToX(this.scale, parent.start.ms))) + 0.5;
    if (x < -1 || x > this.width + 1) return;
    const parentTop = parentItem.y + 6;
    const parentBottom = parentItem.y + parentItem.height - 6;
    const subMid = item.y + item.height / 2;

    ctx.save();
    ctx.strokeStyle = this.colors.bracket;
    ctx.lineWidth = 1.5;
    // Notch across the parent bar where the bracket meets it.
    ctx.beginPath();
    ctx.moveTo(x, parentTop);
    ctx.lineTo(x, parentBottom);
    // Then down to the sub-entry's vertical center.
    ctx.lineTo(x, subMid);
    ctx.lineTo(Math.max(x, geom.xVisualStart), subMid);
    ctx.stroke();
    ctx.restore();
  }

  private drawPlusAffordances(
    row: TimelineRow,
    entries: TimelineEntry[],
    item: LayoutItem,
    nowMs: number,
  ): void {
    const spots: { x: number; startMs: number }[] = [];
    if (entries.length === 0) {
      const clicked = this.emptyRowClick?.rowId === row.id ? this.emptyRowClick.ms : xToMs(this.scale, this.width / 2);
      spots.push({ x: msToX(this.scale, clicked), startMs: clicked });
    } else {
      const first = entries[0];
      const firstX = msToX(this.scale, first.start.ms);
      if (firstX > PLUS_RADIUS * 3) {
        spots.push({ x: firstX - 30, startMs: xToMs(this.scale, firstX - 30) });
      }
      for (let i = 0; i < entries.length - 1; i++) {
        const endMs = entries[i].end?.ms ?? nowMs;
        const gapStartX = msToX(this.scale, endMs);
        const gapEndX = msToX(this.scale, entries[i + 1].start.ms);
        // Only offer a target where the on-screen gap is wide enough (§6).
        if (gapEndX - gapStartX >= MIN_GAP_FOR_PLUS_PX) {
          spots.push({ x: (gapStartX + gapEndX) / 2, startMs: endMs });
        }
      }
      const last = entries[entries.length - 1];
      const lastEndMs = last.end?.ms ?? nowMs;
      const lastX = msToX(this.scale, lastEndMs);
      spots.push({ x: lastX + 30, startMs: lastEndMs });
    }

    const { ctx } = this;
    for (const spot of spots) {
      if (spot.x < -PLUS_RADIUS || spot.x > this.width + PLUS_RADIUS) continue;
      const y = item.y + item.height / 2;
      ctx.save();
      ctx.fillStyle = this.colors.plusFill;
      ctx.beginPath();
      ctx.arc(spot.x, y, PLUS_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(spot.x - 5, y);
      ctx.lineTo(spot.x + 5, y);
      ctx.moveTo(spot.x, y - 5);
      ctx.lineTo(spot.x, y + 5);
      ctx.stroke();
      ctx.restore();
      this.plusHits.push({
        x: spot.x,
        y: y - this.scrollY + this.contentTop(),
        rowId: row.id,
        startMs: spot.startMs,
      });
    }
  }

  // Connections are drawn ONLY while an entry is selected (§6).
  private relatedEntryIds(selected: TimelineEntry): Set<string> {
    const related = new Set<string>([selected.id]);
    if (selected.parentEntryId) related.add(selected.parentEntryId);
    for (const entry of this.input.dataset.entries) {
      if (entry.parentEntryId === selected.id) related.add(entry.id);
    }
    return related;
  }

  private drawConnectors(selected: TimelineEntry, visible: LayoutItem[], nowMs: number): void {
    const { ctx } = this;
    const findItem = (rowId: string) => visible.find((i) => i.kind === "row" && i.id === rowId);
    const selectedItem = findItem(selected.rowId);
    if (!selectedItem) return;
    const from = {
      x: msToX(this.scale, selected.start.ms + ((selected.end?.ms ?? nowMs) - selected.start.ms) / 2),
      y: selectedItem.y + selectedItem.height / 2,
    };
    ctx.save();
    ctx.strokeStyle = this.colors.connector;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    for (const id of this.relatedEntryIds(selected)) {
      if (id === selected.id) continue;
      const entry = this.input.dataset.entries.find((e) => e.id === id);
      if (!entry) continue;
      const item = findItem(entry.rowId);
      if (!item) continue;
      const to = {
        x: msToX(this.scale, entry.start.ms + ((entry.end?.ms ?? nowMs) - entry.start.ms) / 2),
        y: item.y + item.height / 2,
      };
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.bezierCurveTo(from.x, (from.y + to.y) / 2, to.x, (from.y + to.y) / 2, to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawDraft(draft: TimelineEntry, visible: LayoutItem[], nowMs: number): void {
    const item = visible.find((i) => i.kind === "row" && i.id === draft.rowId);
    if (!item?.row) return;
    const geom = barGeometry(draft, this.scale, nowMs);
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = item.row.color ?? "#888";
    ctx.lineWidth = 2;
    const width = Math.max(geom.xVisualEnd - geom.xVisualStart, 24);
    roundRectPath(ctx, geom.xVisualStart, item.y + 6, width, item.height - 12, 5);
    ctx.stroke();
    ctx.restore();
  }

  private drawAxisHeader(ticks: ReturnType<typeof computeTicks>): void {
    const { ctx } = this;
    const top = this.input.axisTop ?? 0;
    const bottom = this.contentTop();
    // 1. Background and border FIRST.
    ctx.fillStyle = this.colors.axisBackground;
    ctx.fillRect(0, top, this.width, AXIS_HEIGHT);
    ctx.strokeStyle = this.colors.axisBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, bottom - 0.5);
    ctx.lineTo(this.width, bottom - 0.5);
    ctx.stroke();

    // 2. Tick marks and text ON TOP — never repaint the background after this.
    ctx.textBaseline = "middle";
    ctx.font = "600 12px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = this.colors.axisCoarseText;
    // The coarse label is never culled on the left: it is pinned to the edge
    // instead. Scrolled to 2012–2019 there is no decade boundary on screen at
    // all, and culling it left the axis showing years with nothing above them.
    // It gives way as soon as the next period's own label would collide.
    ticks.coarse.forEach((tick, index) => {
      const x = msToX(this.scale, tick.ms);
      if (x > this.width) return;
      const next = ticks.coarse[index + 1];
      const nextX = next ? msToX(this.scale, next.ms) : Infinity;
      const pinnedX = Math.max(x + 4, 4);
      if (nextX < pinnedX + ctx.measureText(tick.label).width + AXIS_LABEL_GAP_PX) return;
      ctx.fillText(tick.label, pinnedX, top + 14);
    });
    ctx.font = "11px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = this.colors.axisFineText;
    for (const tick of ticks.fine) {
      const x = msToX(this.scale, tick.ms);
      if (x < -60 || x > this.width) continue;
      ctx.fillText(tick.label, x + 4, top + 32);
    }
  }

  private drawPickGuide(x: number): void {
    const { ctx } = this;
    const snapped = snapForScale(this.scale, xToMs(this.scale, x), this.width);
    const guideX = Math.round(msToX(this.scale, snapped.ms)) + 0.5;
    ctx.save();
    ctx.strokeStyle = this.colors.guide;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(guideX, 0);
    ctx.lineTo(guideX, this.height);
    ctx.stroke();

    const label = formatFuzzyDate({ ms: snapped.ms, precision: snapped.precision });
    ctx.font = "12px -apple-system, system-ui, sans-serif";
    const width = ctx.measureText(label).width + 14;
    const boxX = Math.min(guideX + 8, this.width - width - 4);
    ctx.fillStyle = this.colors.guide;
    roundRectPath(ctx, boxX, 52, width, 22, 5);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, boxX + 7, 63);
    ctx.restore();
  }

  private getHatchPattern(): CanvasPattern {
    if (this.hatchPattern) return this.hatchPattern;
    const tile = document.createElement("canvas");
    tile.width = 8;
    tile.height = 8;
    const tctx = tile.getContext("2d")!;
    tctx.strokeStyle = this.colors.inactiveHatch;
    tctx.lineWidth = 1.5;
    tctx.beginPath();
    tctx.moveTo(-2, 10);
    tctx.lineTo(10, -2);
    tctx.moveTo(-2, 2);
    tctx.lineTo(2, -2);
    tctx.stroke();
    this.hatchPattern = this.ctx.createPattern(tile, "repeat")!;
    return this.hatchPattern;
  }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Resolve any CSS color to rgb via the canvas itself, then derive alpha
// variants and a readable label color. Cached per color string.
const rgbCache = new Map<string, { r: number; g: number; b: number }>();

function colorToRgb(ctx: CanvasRenderingContext2D, color: string): { r: number; g: number; b: number } {
  const cached = rgbCache.get(color);
  if (cached) return cached;
  ctx.save();
  ctx.fillStyle = color;
  const normalized = ctx.fillStyle as string;
  ctx.restore();
  let rgb = { r: 136, g: 136, b: 136 };
  const hexMatch = /^#([0-9a-f]{6})$/i.exec(normalized);
  const rgbMatch = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(normalized);
  if (hexMatch) {
    rgb = {
      r: parseInt(hexMatch[1].slice(0, 2), 16),
      g: parseInt(hexMatch[1].slice(2, 4), 16),
      b: parseInt(hexMatch[1].slice(4, 6), 16),
    };
  } else if (rgbMatch) {
    rgb = { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
  }
  rgbCache.set(color, rgb);
  return rgb;
}

let scratchCtx: CanvasRenderingContext2D | null = null;

function colorWithAlpha(color: string, alpha: number): string {
  if (!scratchCtx) scratchCtx = document.createElement("canvas").getContext("2d")!;
  const { r, g, b } = colorToRgb(scratchCtx, color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function readableTextColor(rgb: { r: number; g: number; b: number }, colors: ColorTable): string {
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.6 ? colors.barText : colors.barTextInverse;
}
