// Thin React wrapper around the framework-agnostic TimelineEngine: owns the
// <canvas>, feeds store state in, translates engine callbacks into actions,
// and mirrors the engine's vertical scroll into the DOM rail every frame.

import { useEffect, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import { TimelineEngine } from "../render/engine";
import type { EngineInput } from "../render/engine";
import type { Layout } from "../render/layout";
import {
  clearSelection,
  commitPickedDate,
  selectEntry,
  selectRow,
  startDraft,
} from "../state/actions";
import { appStore, mergedDataset } from "../state/store";
import { computeEmphasis } from "../state/emphasis";

interface CanvasHostProps {
  layout: Layout;
  railContentRef: RefObject<HTMLDivElement>;
  engineRef: MutableRefObject<TimelineEngine | null>;
  // Pixels to leave empty above the axis — the mobile shell floats controls there.
  axisTop?: number;
  // Called on every change to the visible time span (the minimap follows it).
  onViewChange?: (startMs: number, endMs: number) => void;
}

// The engine takes its whole input in one call, and two different effects below
// have to produce it, so it is built in one place.
function engineInputFor(layout: Layout, axisTop: number): EngineInput {
  const state = appStore.getState();
  return {
    dataset: mergedDataset(state),
    layout,
    selectedEntryId: state.selectedEntryId ?? state.draft?.id,
    selectedRowId: state.selectedRowId,
    draft: state.draft,
    emphasizedEntryIds: computeEmphasis(mergedDataset(state), state.search, state.filters),
    picking: state.pickingField !== undefined,
    axisTop,
  };
}

export function CanvasHost({
  layout,
  railContentRef,
  engineRef,
  axisTop = 0,
  onViewChange,
}: CanvasHostProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const axisTopRef = useRef(axisTop);
  axisTopRef.current = axisTop;
  // Read through a ref: the engine's callbacks are bound once, at construction.
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const engine = new TimelineEngine(canvas, {
      onSelectEntry: selectEntry,
      onSelectRow: (rowId) => (rowId ? selectRow(rowId) : clearSelection()),
      onRequestDraft: startDraft,
      onPickDate: commitPickedDate,
      onViewChange: (startMs, endMs) => onViewChangeRef.current?.(startMs, endMs),
      onScrollSync: (scrollY) => {
        const rail = railContentRef.current;
        if (rail) rail.style.transform = `translateY(${-scrollY}px)`;
      },
    });
    engineRef.current = engine;
    // Exposed for end-to-end tests driving the canvas by coordinates.
    const testHooks = window as unknown as { __chronicleEngine?: TimelineEngine; __chronicleStore?: typeof appStore };
    testHooks.__chronicleEngine = engine;
    testHooks.__chronicleStore = appStore;

    const feedEngine = () => {
      engine.setInput(engineInputFor(layoutRef.current, axisTopRef.current));
    };
    feedEngine();
    const unsubscribe = appStore.subscribe(feedEngine);

    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      engine.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    });
    observer.observe(canvas);

    return () => {
      unsubscribe();
      observer.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, [engineRef, railContentRef]);

  // Layout and axis-offset changes re-feed the engine even though the store
  // subscription fired before these props updated.
  useEffect(() => {
    engineRef.current?.setInput(engineInputFor(layout, axisTop));
  }, [layout, axisTop, engineRef]);

  return <canvas ref={canvasRef} className="timeline-canvas" />;
}
