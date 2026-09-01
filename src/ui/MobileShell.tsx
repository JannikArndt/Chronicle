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
import { AddTimelineAssistant } from "../onboarding/AddTimelineAssistant";
import { clearSelection, selectEntry, setSearch } from "../state/actions";
import { appStore, isPublicId, mergedDataset, useAppState } from "../state/store";
import { triggerDownload } from "../storage/exportImport";
import { AssistantSheet } from "./AssistantSheet";
import { CanvasHost } from "./CanvasHost";
import { importDatasetWithConfirmation } from "./importFlow";
import { SharingPanel } from "./SharingPanel";
import { WorldEventsPicker } from "./WorldEventsPicker";
import { centerOnEntry } from "./centerOnEntry";
import { MiniMap } from "./MiniMap";
import { TimelineSheet } from "./TimelineSheet";
import { useViewportHeight } from "./useIsMobile";
import type { BottomSheetHandle } from "./BottomSheet";

// Peek / half / full. The peek anchor shows the sheet's header and the first
// row or two — enough to say "your timelines live here".
const PEEK_ANCHOR_PX = 96;
const HALF_ANCHOR_FRACTION = 0.45;
const FULL_ANCHOR_FRACTION = 0.84;

// The entry pane's peek anchor is taller: it has to hold a title and a
// subtitle, which is the whole point of the peek state.
const ENTRY_PEEK_ANCHOR_PX = 142;

// The FAB floats just above the sheet's top edge, and fades out once the sheet
// covers enough of the screen that "add" is no longer the obvious next action.
const FAB_GAP_ABOVE_SHEET_PX = 16;
const FAB_RESTING_OFFSET_PX = 12;
const FAB_FADE_OUT_FRACTION = 0.4;

// Index into `anchors` above — the half-screen one.
const HALF_ANCHOR_INDEX = 1;

// Breathing room between the lowest floating control and the axis beneath it.
const AXIS_CLEARANCE_PX = 8;

// What the add flow was opened with. An empty object is the FAB — "add
// something, somewhere". With a row it came from that timeline's pane, which
// answers two of the flow's questions before it starts.
interface AddEntryRequest {
  rowId?: string;
  startMs?: number;
}

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

  const viewportHeight = useViewportHeight();

  const [sheetKeptOpen, setSheetKeptOpen] = useState(true);
  // Which timeline the sheet's middle pane shows. Held here rather than in the
  // sheet because selecting an entry anywhere — canvas, list, search — has to
  // be able to say which timeline "back" leads to.
  const [settingsRowId, setSettingsRowId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [addEntry, setAddEntry] = useState<AddEntryRequest | null>(null);
  const [addTimelineOpen, setAddTimelineOpen] = useState(false);

  // Derived from the store, not held here: the canvas, the list and search all
  // select entries and events through the same actions, and each of them must
  // open the matching pane identically.
  const recordOpen = useAppState(
    (s) => s.draft !== undefined || s.selectedEntryId !== undefined || s.selectedEventId !== undefined,
  );
  const sheetOpen = sheetKeptOpen || recordOpen;

  // One anchor set for one sheet — except its peek height, which has to hold
  // whatever the current pane's header is: a title for the list, a title *and*
  // a subtitle for an entry or an event. Changing it mid-life is safe: the
  // sheet clamps its position into the new anchors.
  const anchors = useMemo(
    () => [
      recordOpen ? ENTRY_PEEK_ANCHOR_PX : PEEK_ANCHOR_PX,
      Math.round(viewportHeight * HALF_ANCHOR_FRACTION),
      Math.round(viewportHeight * FULL_ANCHOR_FRACTION),
    ],
    [viewportHeight, recordOpen],
  );

  // Everything docked at the top — the chips and the life strip — stacks in one
  // container, and the canvas is told to start its axis below it. Measured
  // rather than computed: the strip's height changes with the timeline count.
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

  // Written straight onto the element rather than through state: this runs on
  // every frame of a sheet drag.
  const moveFabWithSheet = (sheetPosition: number, animate: boolean) => {
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
    if (!sheetOpen) moveFabWithSheet(FAB_RESTING_OFFSET_PX, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen]);

  // Opening a timeline's pane means the sheet is open, and saying so here is
  // load-bearing: the sheet may currently be on screen only because an entry is
  // selected (tapped on the canvas after flicking the sheet away). Going back
  // from that entry to its timeline deselects it, and without this the sheet
  // would slide shut instead of showing the pane you asked for.
  const openRowPane = (rowId: string) => {
    setSettingsRowId(rowId);
    setSheetKeptOpen(true);
  };

  // Flicking the sheet away also drops whatever it was showing — leaving an
  // entry selected on the canvas with nothing on screen naming it is the state
  // that reads as "the app lost my tap".
  const closeSheet = () => {
    clearSelection();
    setSettingsRowId(null);
    setSheetKeptOpen(false);
  };

  // The add flow needs somewhere to put a new timeline, and a dataset with no
  // group of your own has no such place. Setup is the honest next step there.
  const startAdding = (request: AddEntryRequest) => {
    const hasSomewhereToPutIt = appStore.getState().dataset.groups.some((group) => !isPublicId(group.id));
    if (hasSomewhereToPutIt) setAddEntry(request);
    else onStartOnboarding();
  };

  // Same guard as adding an entry: a new timeline needs a group of your own.
  const startAddingTimeline = () => {
    const hasSomewhereToPutIt = appStore.getState().dataset.groups.some((group) => !isPublicId(group.id));
    if (hasSomewhereToPutIt) setAddTimelineOpen(true);
    else onStartOnboarding();
  };

  // The new timeline's own pane is the useful place to land: it lists what was
  // just entered and offers "add an entry" for the ones that were forgotten.
  const showNewTimeline = (rowId: string) => {
    setAddTimelineOpen(false);
    setSettingsRowId(rowId);
    setSheetKeptOpen(true);
    sheetHandleRef.current?.raiseToAtLeastAnchor(HALF_ANCHOR_INDEX);
  };

  // Closing the add flow *on* what it made: the canvas moves to the new entry
  // and the sheet opens on it. Adding something and being returned to an
  // unchanged screen is what made the old flow feel like it had failed.
  const showNewEntry = (entryId: string) => {
    setAddEntry(null);
    const entry = mergedDataset(appStore.getState()).entries.find(
      (candidate) => candidate.id === entryId,
    );
    if (!entry) return;
    setSettingsRowId(entry.rowId);
    setSheetKeptOpen(true);
    selectEntry(entryId);
    centerOnEntry(engineRef.current, layout, entry, Date.now());
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
          <MobileSearchChip open={searchOpen} setOpen={setSearchOpen} />
          <button type="button" className="chip-round" aria-label="More" onClick={() => setMenuOpen(true)}>
            ⋯
          </button>
        </div>

        <MiniMap layout={layout} engineRef={engineRef} view={view} />
      </div>

      {menuOpen && <MobileMenu close={() => setMenuOpen(false)} onStartOnboarding={onStartOnboarding} />}

      <button
        ref={fabRef}
        type="button"
        className="mobile-fab"
        aria-label="Add entry"
        onClick={() => startAdding({})}
      >
        ＋
      </button>

      {!sheetOpen && (
        <button type="button" className="chip-pill mobile-reopen" onClick={() => setSheetKeptOpen(true)}>
          🗂 Timelines
        </button>
      )}

      <TimelineSheet
        layout={layout}
        anchors={anchors}
        open={sheetOpen}
        onClose={closeSheet}
        onPositionChange={(position) => moveFabWithSheet(position, false)}
        sheetHandleRef={sheetHandleRef}
        engineRef={engineRef}
        raiseSheet={() => sheetHandleRef.current?.raiseToAtLeastAnchor(HALF_ANCHOR_INDEX)}
        settingsRowId={settingsRowId}
        onOpenRowSettings={openRowPane}
        onCloseRowSettings={() => setSettingsRowId(null)}
        onAddEntry={(rowId, startMs) => startAdding({ rowId, startMs })}
        onAddTimeline={startAddingTimeline}
      />

      {addEntry && (
        <AssistantSheet
          title="Add an entry"
          viewportHeight={viewportHeight}
          onDismiss={() => setAddEntry(null)}
        >
          <AddEntryAssistant
            startOnRowId={addEntry.rowId}
            startMs={addEntry.startMs}
            onFinished={() => setAddEntry(null)}
            onShowEntry={showNewEntry}
          />
        </AssistantSheet>
      )}

      {addTimelineOpen && (
        <AssistantSheet
          title="New timeline"
          viewportHeight={viewportHeight}
          onDismiss={() => setAddTimelineOpen(false)}
        >
          <AddTimelineAssistant
            onFinished={() => setAddTimelineOpen(false)}
            onShowTimeline={showNewTimeline}
          />
        </AssistantSheet>
      )}
    </div>
  );
}

// The chip *becomes* the field. An earlier build opened a second bar below the
// chips instead, which pushed the strip and the axis down the screen every time
// you searched — a toolbar for one input. Filters are gone with it: matches
// emphasize and everything else dims, which is the filtering that earns its
// space on a phone.
function MobileSearchChip({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const search = useAppState((s) => s.search);

  if (!open) {
    return (
      <button type="button" className="chip-pill" onClick={() => setOpen(true)}>
        <span aria-hidden="true">🔍</span>
        {/* The live query stays visible while collapsed — otherwise the dimmed
            canvas has no on-screen explanation. */}
        <span className="chip-label">{search === "" ? "Search" : search}</span>
      </button>
    );
  }

  // Closing always clears: leaving half the timeline dimmed behind a control
  // that is no longer on screen is how you get a "broken app" report.
  const close = () => {
    setSearch("");
    setOpen(false);
  };

  return (
    <div className="chip-pill chip-search">
      <span aria-hidden="true">🔍</span>
      <input
        type="search"
        className="chip-search-input"
        placeholder="Search titles, people, places…"
        value={search}
        autoFocus
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") close();
        }}
      />
      <button type="button" className="chip-search-close" aria-label="Close search" onClick={close}>
        ✕
      </button>
    </div>
  );
}

function MobileMenu({ close, onStartOnboarding }: { close: () => void; onStartOnboarding: () => void }) {
  const [showingWorldEvents, setShowingWorldEvents] = useState(false);
  const [showingSharing, setShowingSharing] = useState(false);
  const sharingConfigured = useAppState((s) => s.sharing.configured);
  const signedIn = useAppState((s) => s.sharing.session !== undefined);

  const handleImport = () => {
    importDatasetWithConfirmation((message) => window.alert(message));
    close();
  };

  if (showingWorldEvents) {
    return (
      <>
        <div className="popover-backdrop" onClick={close} />
        <div className="mobile-menu">
          <WorldEventsPicker back={() => setShowingWorldEvents(false)} />
        </div>
      </>
    );
  }

  // The mobile counterpart of the desktop top bar's Sharing popover — same
  // panel, reached through this menu because the mobile shell has no top bar.
  // A sub-view rather than its own sheet: signing in and copying an invite link
  // are short errands, and `TimelineSheet` is the one navigational sheet.
  if (showingSharing) {
    return (
      <>
        <div className="popover-backdrop" onClick={close} />
        <div className="mobile-menu">
          <button type="button" className="menu-item" onClick={() => setShowingSharing(false)}>
            ‹ Back
          </button>
          <SharingPanel />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="popover-backdrop" onClick={close} />
      <div className="mobile-menu">
        {/* The one rail action that translates to a phone unchanged: it is a
            list of checkboxes, not a layout. ＋ Group, ＋ Person and 🌟 Famous
            people still have no mobile home — see the backlog. */}
        <button type="button" className="menu-item" onClick={() => setShowingWorldEvents(true)}>
          🌍 World events…
        </button>
        {sharingConfigured && (
          <button type="button" className="menu-item" onClick={() => setShowingSharing(true)}>
            {signedIn ? "🔗 Sharing…" : "🔗 Share with someone…"}
          </button>
        )}
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
