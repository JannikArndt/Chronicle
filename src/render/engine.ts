// The Chronicle canvas engine — a plain, framework-agnostic TS module (§8).
// It owns the viewport (time scale + vertical scroll), the rAF draw loop,
// virtualization, and all pointer/wheel/pinch input on the canvas. React owns
// everything DOM (rail, panels) and feeds state in via setInput().

import { computeLayout } from "./layout";
import type { Layout, LayoutItem } from "./layout";
import { ROW_HEIGHT } from "./layout";
import { barGeometry, gradientStops, labelAnchorX } from "./bars";
import type { BarGeometry } from "./bars";
import { clampScale, msToX, panBy, scaleForRange, xToMs, zoomAt } from "./timeScale";
import type { TimeScale } from "./timeScale";
import { computeTicks, snapForScale } from "./timeAxis";
import { formatFuzzyDate } from "../model/fuzzyDate";
import type { Precision, TimelineDataset, TimelineEntry, TimelineRow } from "../model/types";

export const AXIS_HEIGHT = 46;
const PLUS_RADIUS = 11;
const MIN_GAP_FOR_PLUS_PX = 48;

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
};

type ColorTable = typeof FALLBACK_COLORS;

// The canvas is painted by JS, not CSS, so it can't pick up the OS dark-mode
// media query on its own — read the same custom properties the DOM UI uses
// (defined in src/ui/styles.css) so the two never mismatch.
function readThemeColors(): ColorTable {
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
  };
}

export interface EngineCallbacks {
  onSelectEntry: (entryId: string) => void;
  onSelectRow: (rowId: string | undefined, clickTimeMs: number) => void;
  onRequestDraft: (rowId: string, startMs: number) => void;
  onPickDate: (ms: number, precision: Precision) => void;
  onScrollSync: (scrollY: number) => void;
}

export interface EngineInput {
  dataset: TimelineDataset;
  layout: Layout;
  selectedEntryId?: string;
  selectedRowId?: string;
  draft?: TimelineEntry;
  // Entry ids that should stand out; null when no search/filter is active.
  emphasizedEntryIds: Set<string> | null;
  picking: boolean;
}

interface EntryHit {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  entry: TimelineEntry;
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
  private plusHits: PlusHit[] = [];
  private pointerDown?: { x: number; y: number; scale: TimeScale; scrollY: number; moved: boolean };
  private activePointers = new Map<number, { x: number; y: number }>();
  private pinchStart?: { distance: number; midX: number; scale: TimeScale };
  private hoverX: number | null = null;
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
      people: [],
      groups: [],
      categories: [],
      rows: [],
      entities: [],
      entries: [],
    };
    this.input = {
      dataset: emptySet,
      layout: computeLayout(emptySet, new Set()),
      emphasizedEntryIds: null,
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

  requestDraw(): void {
    this.dirty = true;
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafHandle);
    this.eventAbort.abort();
  }

  // ---------- internals ----------

  private setScrollY(value: number): void {
    const maxScroll = Math.max(0, this.input.layout.totalHeight - (this.height - AXIS_HEIGHT) + 40);
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
          scale: this.scale,
          scrollY: this.scrollY,
          moved: false,
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
      const wasTap = this.pointerDown && !this.pointerDown.moved;
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
      const snapped = snapForScale(this.scale, xToMs(this.scale, x));
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
    for (const hit of this.entryHits) {
      if (x >= hit.x0 && x <= hit.x1 && y >= hit.y0 && y <= hit.y1) {
        this.callbacks.onSelectEntry(hit.entry.id);
        return;
      }
    }
    const contentY = y - AXIS_HEIGHT + this.scrollY;
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
    this.plusHits = [];

    const ticks = computeTicks(this.scale, this.width);

    // Content area (clipped below the axis header).
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, AXIS_HEIGHT, this.width, this.height - AXIS_HEIGHT);
    ctx.clip();
    ctx.translate(0, AXIS_HEIGHT - this.scrollY);
    this.drawGridlines(ticks);
    this.drawContent();
    ctx.restore();

    // Axis header LAST but strictly in this order: background/border first,
    // then text — repainting the background after the text silently erased
    // the axis in an early build (§5) and must never happen again.
    this.drawAxisHeader(ticks);

    if (this.input.picking && this.hoverX !== null) this.drawPickGuide(this.hoverX);
  }

  private drawGridlines(ticks: { fine: { ms: number }[]; coarse: { ms: number }[] }): void {
    const { ctx } = this;
    const y0 = this.scrollY;
    const y1 = this.scrollY + this.height - AXIS_HEIGHT;
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
    const bottom = this.scrollY + this.height - AXIS_HEIGHT + ROW_HEIGHT;
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
      if (item.kind === "person") continue;
      if (item.row) this.drawRow(item, nowMs, emphasis, relatedIds);
    }

    if (selectedEntry) this.drawConnectors(selectedEntry, visible, nowMs);
    if (this.input.draft) this.drawDraft(this.input.draft, visible, nowMs);
  }

  private categoryOf(row: TimelineRow) {
    return this.input.dataset.categories.find((c) => c.id === row.categoryId);
  }

  private personOf(row: TimelineRow) {
    const group = this.input.dataset.groups.find((g) => g.id === row.groupId);
    const personId = row.personId ?? group?.personId;
    return personId ? this.input.dataset.people.find((p) => p.id === personId) : undefined;
  }

  private drawRow(
    item: LayoutItem,
    nowMs: number,
    emphasis: Set<string> | null,
    relatedIds: Set<string> | null,
  ): void {
    const { ctx } = this;
    const row = item.row!;
    const category = this.categoryOf(row);
    const color = category?.color ?? "#888";

    if (row.id === this.input.selectedRowId) {
      ctx.fillStyle = this.colors.rowSelected;
      ctx.fillRect(0, item.y - 2, this.width, item.height + 4);
    }

    // Inactive band before the person's birth (§5).
    const person = this.personOf(row);
    if (person?.birthDate !== undefined) {
      const birthX = msToX(this.scale, person.birthDate);
      if (birthX > 0) {
        ctx.fillStyle = this.getHatchPattern();
        ctx.fillRect(0, item.y + 4, Math.min(birthX, this.width), item.height - 8);
      }
    }

    const entries = this.input.dataset.entries
      .filter((e) => e.rowId === row.id)
      .sort((a, b) => a.start.ms - b.start.ms);

    for (const entry of entries) {
      const geom = barGeometry(entry, this.scale, nowMs);
      if (geom.xVisualEnd < 0 || geom.xVisualStart > this.width) continue;
      let alpha = 1;
      if (emphasis && !emphasis.has(entry.id)) alpha = 0.22;
      if (relatedIds && !relatedIds.has(entry.id)) alpha = Math.min(alpha, 0.25);
      this.drawBar(entry, geom, item, color, alpha, entry.id === this.input.selectedEntryId);
      if (row.parentRowId) this.drawSubEntryBracket(entry, geom, item);
    }

    if (row.id === this.input.selectedRowId && !this.input.draft) {
      this.drawPlusAffordances(row, entries, item, nowMs);
    }
  }

  private drawBar(
    entry: TimelineEntry,
    geom: BarGeometry,
    item: LayoutItem,
    color: string,
    alpha: number,
    selected: boolean,
  ): void {
    const { ctx } = this;
    const top = item.y + 6;
    const barHeight = item.height - 12;
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

    if (selected) {
      ctx.strokeStyle = this.colors.barText;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Label anchored inside the near-opaque span so it stays legible (§5).
    ctx.font = "12px -apple-system, system-ui, sans-serif";
    const textWidth = ctx.measureText(entry.title).width;
    const labelX = labelAnchorX(geom, textWidth, this.width);
    ctx.fillStyle = readableTextColor(colorToRgb(this.ctx, color), this.colors);
    ctx.textBaseline = "middle";
    ctx.fillText(entry.title, labelX, top + barHeight / 2);
    ctx.restore();

    this.entryHits.push({
      x0: Math.min(x0, labelX),
      x1: Math.max(x1, labelX + textWidth),
      y0: item.y + 6 - this.scrollY + AXIS_HEIGHT,
      y1: item.y + item.height - 6 - this.scrollY + AXIS_HEIGHT,
      entry,
    });
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
        y: y - this.scrollY + AXIS_HEIGHT,
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
      if (selected.linkedEntityIds.length > 0 && entry.linkedEntityIds.some((id) => selected.linkedEntityIds.includes(id))) {
        related.add(entry.id);
      }
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
    ctx.strokeStyle = this.categoryOf(item.row)?.color ?? "#888";
    ctx.lineWidth = 2;
    const width = Math.max(geom.xVisualEnd - geom.xVisualStart, 24);
    roundRectPath(ctx, geom.xVisualStart, item.y + 6, width, item.height - 12, 5);
    ctx.stroke();
    ctx.restore();
  }

  private drawAxisHeader(ticks: ReturnType<typeof computeTicks>): void {
    const { ctx } = this;
    // 1. Background and border FIRST.
    ctx.fillStyle = this.colors.axisBackground;
    ctx.fillRect(0, 0, this.width, AXIS_HEIGHT);
    ctx.strokeStyle = this.colors.axisBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, AXIS_HEIGHT - 0.5);
    ctx.lineTo(this.width, AXIS_HEIGHT - 0.5);
    ctx.stroke();

    // 2. Tick marks and text ON TOP — never repaint the background after this.
    ctx.textBaseline = "middle";
    ctx.font = "600 12px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = this.colors.axisCoarseText;
    for (const tick of ticks.coarse) {
      const x = msToX(this.scale, tick.ms);
      if (x < -60 || x > this.width) continue;
      ctx.fillText(tick.label, Math.max(x + 4, 4), 14);
    }
    ctx.font = "11px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = this.colors.axisFineText;
    for (const tick of ticks.fine) {
      const x = msToX(this.scale, tick.ms);
      if (x < -60 || x > this.width) continue;
      ctx.fillText(tick.label, x + 4, 32);
    }
  }

  private drawPickGuide(x: number): void {
    const { ctx } = this;
    const snapped = snapForScale(this.scale, xToMs(this.scale, x));
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
