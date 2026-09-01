import { useEffect, useMemo, useRef, useState } from "react";
import { computeLayout } from "../render/layout";
import type { TimelineEngine } from "../render/engine";
import {
  cancelDatePicking,
  clearSelection,
  initializeApp,
} from "../state/actions";
import { appStore, mergedDataset, useAppState } from "../state/store";
import { CanvasHost } from "./CanvasHost";
import { DataMenu } from "./DataMenu";
import { InviteLanding, readInviteToken } from "./InviteLanding";
import { SharingMenu } from "./SharingMenu";
import { DetailPanel } from "./DetailPanel";
import { MobileShell } from "./MobileShell";
import { RowRail } from "./RowRail";
import { SearchBar } from "./SearchBar";
import { useIsMobile } from "./useIsMobile";
import { IdentityBirthPlacesAssistant } from "../onboarding/IdentityBirthPlacesAssistant";
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

  useEffect(() => {
    void initializeApp();
  }, []);

  useEffect(() => {
    if (inviteToken === null) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [inviteToken]);

  useEffect(() => {
    if (loaded && shouldShowOnboarding(state.dataset)) setOnboardingOpen(true);
    // Only re-check right after load — once open, later dataset changes
    // (created by the assistant itself) must not affect this decision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const layout = useMemo(
    () => computeLayout(mergedDataset(state), new Set(), new Set(state.hiddenRowIds)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.dataset, state.publicDatasets, state.sharing.mirrors, state.hiddenRowIds],
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
            <SharingMenu />
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
      {onboardingOpen && (
        <div className="assistant-overlay">
          <IdentityBirthPlacesAssistant onFinished={() => setOnboardingOpen(false)} />
        </div>
      )}
    </>
  );
}
