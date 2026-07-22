// Thin React wrapper around the framework-agnostic TimelineEngine: owns the
// <canvas>, feeds store state in, translates engine callbacks into actions,
// and mirrors the engine's vertical scroll into the DOM rail every frame.

import { useEffect, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import { TimelineEngine } from "../render/engine";
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
}

export function CanvasHost({ layout, railContentRef, engineRef }: CanvasHostProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const engine = new TimelineEngine(canvas, {
      onSelectEntry: selectEntry,
      onSelectRow: (rowId) => (rowId ? selectRow(rowId) : clearSelection()),
      onRequestDraft: startDraft,
      onPickDate: commitPickedDate,
      onScrollSync: (scrollY) => {
        const rail = railContentRef.current;
        if (rail) rail.style.transform = `translateY(${-scrollY}px)`;
      },
    });
    engineRef.current = engine;
    // Exposed for end-to-end tests driving the canvas by coordinates.
    (window as unknown as { __chronicleEngine?: TimelineEngine }).__chronicleEngine = engine;

    const feedEngine = () => {
      const state = appStore.getState();
      engine.setInput({
        dataset: mergedDataset(state),
        layout: layoutRef.current,
        selectedEntryId: state.selectedEntryId ?? state.draft?.id,
        selectedRowId: state.selectedRowId,
        draft: state.draft,
        emphasizedEntryIds: computeEmphasis(mergedDataset(state), state.search, state.filters),
        picking: state.pickingField !== undefined,
      });
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

  // Layout changes (rows added, groups collapsed) re-feed the engine even
  // though the store subscription fired before this prop updated.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const state = appStore.getState();
    engine.setInput({
      dataset: mergedDataset(state),
      layout,
      selectedEntryId: state.selectedEntryId ?? state.draft?.id,
      selectedRowId: state.selectedRowId,
      draft: state.draft,
      emphasizedEntryIds: computeEmphasis(mergedDataset(state), state.search, state.filters),
      picking: state.pickingField !== undefined,
    });
  }, [layout, engineRef]);

  return <canvas ref={canvasRef} className="timeline-canvas" />;
}
