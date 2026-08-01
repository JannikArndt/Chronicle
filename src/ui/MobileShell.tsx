// The mobile shell: a full-bleed canvas with everything else floating over it.
//
// This is a different shell, not a restyled desktop one — App.tsx branches here
// once, and no media query tries to reconcile the two. The information
// architecture genuinely differs: on mobile a timeline row navigates into its
// own settings pane, on desktop it toggles in place.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { EngineView, TimelineEngine } from "../render/engine";
import type { Layout } from "../render/layout";
import { AddEntryAssistant } from "../onboarding/AddEntryAssistant";
import { clearSelection } from "../state/actions";
import { appStore, isPublicId, useAppState } from "../state/store";
import { triggerDownload, triggerImportFlow } from "../storage/exportImport";
import { replaceDataset } from "../state/actions";
import { CanvasHost } from "./CanvasHost";
import { EntrySheet } from "./EntrySheet";
import { MiniMap } from "./MiniMap";
import { RowSheet } from "./RowSheet";
import { SearchBar } from "./SearchBar";
import { useViewportHeight } from "./useIsMobile";
import type { BottomSheetHandle } from "./BottomSheet";

// Peek / half / full. The peek anchor shows the sheet's header and the first
// row or two — enough to say "your timelines live here".
const PEEK_ANCHOR_PX = 96;
const HALF_ANCHOR_FRACTION = 0.45;
const FULL_ANCHOR_FRACTION = 0.84;

// The entry inspector's peek anchor is taller: it has to hold a title and a
// subtitle, which is the whole point of the peek state.
const ENTRY_PEEK_ANCHOR_PX = 142;
const ENTRY_HALF_ANCHOR_FRACTION = 0.46;

// The FAB floats just above the sheet's top edge, and fades out once the sheet
// covers enough of the screen that "add" is no longer the obvious next action.
const FAB_GAP_ABOVE_SHEET_PX = 16;
const FAB_RESTING_OFFSET_PX = 12;
const FAB_FADE_OUT_FRACTION = 0.4;

// Index into `anchors` above — the half-screen one.
const HALF_ANCHOR_INDEX = 1;

// Breathing room between the lowest floating control and the axis beneath it.
const AXIS_CLEARANCE_PX = 8;

interface MobileShellProps {
  layout: Layout;
  engineRef: MutableRefObject<TimelineEngine | null>;
  onStartOnboarding: () => void;
}

export function MobileShell({ layout, engineRef, onStartOnboarding }: MobileShellProps) {
  // The canvas engine syncs the DOM rail's scroll through this ref; there is no
  // rail on mobile, so it stays null and the sync is a no-op.
  const railContentRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const sheetHandleRef = useRef<BottomSheetHandle>(null);
  const entrySheetHandleRef = useRef<BottomSheetHandle>(null);

  const viewportHeight = useViewportHeight();
  const anchors = useMemo(
    () => [
      PEEK_ANCHOR_PX,
      Math.round(viewportHeight * HALF_ANCHOR_FRACTION),
      Math.round(viewportHeight * FULL_ANCHOR_FRACTION),
    ],
    [viewportHeight],
  );
  const entryAnchors = useMemo(
    () => [
      ENTRY_PEEK_ANCHOR_PX,
      Math.round(viewportHeight * ENTRY_HALF_ANCHOR_FRACTION),
      Math.round(viewportHeight * FULL_ANCHOR_FRACTION),
    ],
    [viewportHeight],
  );

  const [rowSheetOpen, setRowSheetOpen] = useState(true);
  // Which timeline's settings pane the row sheet shows, held here because the
  // entry sheet navigates into it too (its "‹ Places lived" link).
  const [settingsRowId, setSettingsRowId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [addEntryOpen, setAddEntryOpen] = useState(false);

  // The inspector's visibility is derived from the store, not held here: the
  // canvas, the timeline sheet and the FAB all select entries through the same
  // actions, and any of them opening this sheet must look identical.
  const entrySheetOpen = useAppState((s) => s.draft !== undefined || s.selectedEntryId !== undefined);

  // Everything docked at the top — chips, search panel, life strip — stacks in
  // one container, and the canvas is told to start its axis below it. Measured
  // rather than computed: the strip's height changes with the timeline count
  // and the search panel grows when its filters expand.
  const topStackRef = useRef<HTMLDivElement>(null);
  const [axisTop, setAxisTop] = useState(0);
  useLayoutEffect(() => {
    const topStack = topStackRef.current;
    if (!topStack) return;
    const measure = () =>
      setAxisTop(Math.round(topStack.getBoundingClientRect().bottom) + AXIS_CLEARANCE_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(topStack);
    return () => observer.disconnect();
  }, []);

  // The strip's viewport window follows the canvas frame by frame.
  const [view, setView] = useState<EngineView | null>(null);

  // Remembered so the FAB can be put back where it belongs after it unmounts
  // and returns — its position is style, not React state.
  const sheetPositionRef = useRef(PEEK_ANCHOR_PX);

  // Written straight onto the element rather than through state: this runs on
  // every frame of a sheet drag.
  const moveFabWithSheet = (sheetPosition: number, animate: boolean) => {
    sheetPositionRef.current = sheetPosition;
    const fab = fabRef.current;
    if (!fab) return;
    fab.classList.toggle("fab-snapping", animate);
    fab.style.transform = `translateY(${-(sheetPosition + FAB_GAP_ABOVE_SHEET_PX)}px)`;
    const faded = sheetPosition > viewportHeight * FAB_FADE_OUT_FRACTION;
    fab.style.opacity = faded ? "0" : "1";
    fab.style.pointerEvents = faded ? "none" : "auto";
  };

  // With the sheet thrown away there is no edge to ride, so the FAB drops to
  // its own resting position above the safe area.
  useEffect(() => {
    if (!rowSheetOpen) moveFabWithSheet(FAB_RESTING_OFFSET_PX, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSheetOpen]);

  // Coming back from an entry surface, the FAB is a fresh element with no
  // transform on it yet.
  useEffect(() => {
    if (!entrySheetOpen) moveFabWithSheet(sheetPositionRef.current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrySheetOpen]);

  // Going "up" from an entry to the timeline it sits on. Deselecting is what
  // closes the entry sheet, since its visibility is derived from the selection.
  const showTimelineForEntry = (rowId: string) => {
    clearSelection();
    setSettingsRowId(rowId);
    setRowSheetOpen(true);
    sheetHandleRef.current?.raiseToAtLeastAnchor(HALF_ANCHOR_INDEX);
  };

  // The FAB opens the add-entry assistant — but that assistant needs somewhere
  // to put a new timeline, and a dataset with no group of your own has no such
  // place. Setup is the honest next step there.
  const startAddingEntry = () => {
    const hasSomewhereToPutIt = appStore.getState().dataset.groups.some((group) => !isPublicId(group.id));
    if (hasSomewhereToPutIt) setAddEntryOpen(true);
    else onStartOnboarding();
  };

  return (
    <div className="mobile-shell">
      <CanvasHost
        layout={layout}
        railContentRef={railContentRef}
        engineRef={engineRef}
        axisTop={axisTop}
        onViewChange={setView}
      />

      <div className="mobile-top-stack" ref={topStackRef}>
        <div className="mobile-chips">
          <button type="button" className="chip-pill" onClick={() => setSearchOpen(!searchOpen)}>
            🔍 Search
          </button>
          <button type="button" className="chip-round" aria-label="More" onClick={() => setMenuOpen(true)}>
            ⋯
          </button>
        </div>

        {searchOpen && (
          <div className="mobile-search-panel">
            <SearchBar />
          </div>
        )}

        <MiniMap layout={layout} engineRef={engineRef} view={view} />
      </div>

      {menuOpen && <MobileMenu close={() => setMenuOpen(false)} onStartOnboarding={onStartOnboarding} />}

      {!entrySheetOpen && (
        <button
          ref={fabRef}
          type="button"
          className="mobile-fab"
          aria-label="Add entry"
          onClick={startAddingEntry}
        >
          ＋
        </button>
      )}

      {!rowSheetOpen && !entrySheetOpen && (
        <button type="button" className="chip-pill mobile-reopen" onClick={() => setRowSheetOpen(true)}>
          🗂 Timelines
        </button>
      )}

      <RowSheet
        layout={layout}
        anchors={anchors}
        open={rowSheetOpen && !entrySheetOpen}
        onClose={() => setRowSheetOpen(false)}
        onPositionChange={(position) => moveFabWithSheet(position, false)}
        sheetHandleRef={sheetHandleRef}
        raiseSheet={() => sheetHandleRef.current?.raiseToAtLeastAnchor(HALF_ANCHOR_INDEX)}
        settingsRowId={settingsRowId}
        onOpenRowSettings={setSettingsRowId}
        onCloseRowSettings={() => setSettingsRowId(null)}
      />

      <EntrySheet
        anchors={entryAnchors}
        open={entrySheetOpen}
        onClose={clearSelection}
        onPositionChange={() => {}}
        sheetHandleRef={entrySheetHandleRef}
        onOpenTimeline={showTimelineForEntry}
      />

      {addEntryOpen && (
        <div className="assistant-overlay">
          <AddEntryAssistant onFinished={() => setAddEntryOpen(false)} />
        </div>
      )}
    </div>
  );
}

function MobileMenu({ close, onStartOnboarding }: { close: () => void; onStartOnboarding: () => void }) {
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
    <>
      <div className="popover-backdrop" onClick={close} />
      <div className="mobile-menu">
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            triggerDownload(appStore.getState().dataset);
            close();
          }}
        >
          ⬇️ Export JSON
        </button>
        <button type="button" className="menu-item" onClick={handleImport}>
          ⬆️ Import JSON…
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
        <div className="hint">
          Your data lives only in this browser — export regularly to back it up or move devices.
        </div>
      </div>
    </>
  );
}
