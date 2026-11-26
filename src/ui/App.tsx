import { useEffect, useMemo, useRef, useState } from "react";
import { computeLayout } from "../render/layout";
import { hiddenIdsOf } from "../model/hidden";
import type { TimelineEngine } from "../render/engine";
import {
  cancelDatePicking,
  clearSelection,
  initializeApp,
} from "../state/actions";
import { appStore, mergedDataset, useAppState } from "../state/store";
import { CanvasHost } from "./CanvasHost";
import { DataMenu } from "./DataMenu";
import { InviteLanding, readInviteToken, readPublicLinkToken } from "./InviteLanding";
import { AccountMenu } from "./AccountMenu";
import { openPublicLink } from "../sync/engine";
import { DetailPanel } from "./DetailPanel";
import { MobileShell } from "./MobileShell";
import { RowRail } from "./RowRail";
import { SearchBar } from "./SearchBar";
import { useIsMobile } from "./useIsMobile";
import { OnboardingAssistant } from "../onboarding/OnboardingAssistant";
import type { LifeRange } from "../onboarding/OnboardingAssistant";
import { shouldShowOnboarding } from "../onboarding/shouldShowOnboarding";

export function App() {
  const loaded = useAppState((s) => s.loaded);
  const state = useAppState((s) => s);
  const isMobile = useIsMobile();
  const railContentRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<TimelineEngine | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  // Read once, on the first render, and cleared from the address bar below —
  // an invite token is a capability and should not sit in the URL, in the
  // back-button history, or in whatever the browser syncs between devices.
  const [inviteToken, setInviteToken] = useState(() => readInviteToken(window.location.hash));
  // A public link (`#/view/<token>`): someone's published timelines, shown
  // read-only next to whatever is on this device, with no account needed.
  const [viewToken] = useState(() => readPublicLinkToken(window.location.hash));
  const [viewNote, setViewNote] = useState<string | null>(null);

  useEffect(() => {
    void initializeApp();
  }, []);

  useEffect(() => {
    if (inviteToken === null && viewToken === null) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [inviteToken, viewToken]);

  useEffect(() => {
    if (!loaded || viewToken === null) return;
    openPublicLink(viewToken).then(
      (owner) => setViewNote(`Showing what ${owner} shared by link — read-only, and not saved on this device.`),
      (reason: unknown) => setViewNote(reason instanceof Error ? reason.message : "This link does not work."),
    );
  }, [loaded, viewToken]);

  useEffect(() => {
    // Someone arriving by a link came to see or join something, not to be
    // walked through setting up their own life first.
    if (inviteToken !== null || viewToken !== null) return;
    if (loaded && shouldShowOnboarding(state.dataset)) setOnboardingOpen(true);
    // Only re-check right after load — once open, later dataset changes
    // (created by the assistant itself) must not affect this decision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const layout = useMemo(
    () => computeLayout(mergedDataset(state), new Set(), hiddenIdsOf(state.hiddenRowIds, state.hiddenGroupIds)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.dataset,
      state.publicDatasets,
      state.linkDatasets,
      state.hiddenRowIds,
      state.hiddenGroupIds,
    ],
  );

  // Global keyboard handling (§6) — all ignored while typing in a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        if (event.key === "Escape") {
          // Onboarding steps always autoFocus an <input>, so Escape here
          // must still close the overlay (design spec §A) rather than only
          // blurring the field.
          if (onboardingOpen) setOnboardingOpen(false);
          // The canvas + chains start→end picking while focus stays in the
          // Title field (so the user can type while pointing at dates) —
          // without this branch, cancelling that crosshair would require
          // clicking away from the field first.
          else if (appStore.getState().pickingField) cancelDatePicking();
          else target.blur();
        }
        return;
      }
      const engine = engineRef.current;
      switch (event.key) {
        case "Escape": {
          // Priority order (§6): onboarding overlay → deselect → cancel date-picking → close panel.
          if (onboardingOpen) {
            setOnboardingOpen(false);
            break;
          }
          const current = appStore.getState();
          if (current.selectedEntryId || current.selectedRowId || current.draft) clearSelection();
          else if (current.pickingField) cancelDatePicking();
          break;
        }
        case "ArrowLeft":
          engine?.panPixels(-80, 0);
          break;
        case "ArrowRight":
          engine?.panPixels(80, 0);
          break;
        case "ArrowUp":
          engine?.panPixels(0, -60);
          break;
        case "ArrowDown":
          engine?.panPixels(0, 60);
          break;
        case "+":
        case "=":
          engine?.zoomBy(0.8);
          break;
        case "-":
          engine?.zoomBy(1.25);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onboardingOpen]);

  // The assistant ran to the end: show the life it just drew, birth to now,
  // from the top of the canvas.
  const finishOnboarding = (range?: LifeRange) => {
    setOnboardingOpen(false);
    const engine = engineRef.current;
    if (!range || !engine) return;
    engine.zoomToRange(range.startMs, range.endMs);
    engine.panPixels(0, -Number.MAX_SAFE_INTEGER);
  };

  if (!loaded) {
    return <div className="loading">Loading…</div>;
  }

  const isEmpty = state.dataset.groups.length === 0;

  return (
    <>
      {isMobile ? (
        <MobileShell
          layout={layout}
          engineRef={engineRef}
          onStartOnboarding={() => setOnboardingOpen(true)}
        />
      ) : (
        <div className="app">
          <header className="top-bar">
            <span className="app-title">Chronicle</span>
            <SearchBar />
            <AccountMenu />
            <DataMenu />
          </header>
          <div className="main-area">
            <RowRail
              layout={layout}
              railContentRef={railContentRef}
              onStartOnboarding={() => setOnboardingOpen(true)}
              engineRef={engineRef}
            />
            <CanvasHost layout={layout} railContentRef={railContentRef} engineRef={engineRef} />
            {isEmpty && (
              <div className="empty-hint">
                Start with “＋ Group” in the bottom-left — e.g. a group called “Me” that is a person.
              </div>
            )}
            <DetailPanel />
          </div>
        </div>
      )}
      {inviteToken !== null && <InviteLanding token={inviteToken} onDone={() => setInviteToken(null)} />}
      {viewNote !== null && (
        <div className="view-note">
          <span>{viewNote}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setViewNote(null)}>
            ✕
          </button>
        </div>
      )}
      {onboardingOpen && (
        <div className="assistant-overlay">
          <OnboardingAssistant onFinished={finishOnboarding} />
        </div>
      )}
    </>
  );
}
