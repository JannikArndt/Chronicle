// The add flows, in the same sheet everything else on mobile lives in.
//
// They used to be a modal overlay: a dimmed screen that swallowed every gesture,
// so the canvas froze the moment you started adding to it. That is the wrong
// promise — you add an entry *to a picture*, and the picture is what tells you
// which year you meant. Here the flow is a BottomSheet like any other, so it
// drags, snaps and flicks away identically, and tapping the canvas above it
// drops it to its peek anchor instead of doing nothing.

import { useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { BottomSheet } from "./BottomSheet";
import type { BottomSheetHandle } from "./BottomSheet";

// Peek is only the header — an assistant has nothing useful to show in 60px, so
// its peek state means "parked, tap to come back".
const PEEK_ANCHOR_PX = 62;
const HALF_ANCHOR_FRACTION = 0.55;
const FULL_ANCHOR_FRACTION = 0.88;

const PEEK_ANCHOR_INDEX = 0;
const FULL_ANCHOR_INDEX = 2;

interface AssistantSheetProps {
  title: string;
  viewportHeight: number;
  // Flicking the sheet away abandons the flow, the same gesture and the same
  // meaning as everywhere else.
  onDismiss: () => void;
  children: ReactNode;
}

export function AssistantSheet({ title, viewportHeight, onDismiss, children }: AssistantSheetProps) {
  const sheetHandleRef = useRef<BottomSheetHandle>(null);
  const scrimRef = useRef<HTMLDivElement>(null);

  const anchors = useMemo(
    () => [
      PEEK_ANCHOR_PX,
      Math.round(viewportHeight * HALF_ANCHOR_FRACTION),
      Math.round(viewportHeight * FULL_ANCHOR_FRACTION),
    ],
    [viewportHeight],
  );

  // The scrim is what "outside" means. It only takes taps while the sheet is
  // raised: parked at peek there is nothing to minimise, and the canvas must be
  // as pannable then as it is with no flow open at all. Written straight onto
  // the element because this runs on every frame of a drag.
  const trackScrim = (sheetPosition: number) => {
    const scrim = scrimRef.current;
    if (!scrim) return;
    const raised = sheetPosition > anchors[PEEK_ANCHOR_INDEX] + 1;
    scrim.style.pointerEvents = raised ? "auto" : "none";
  };

  return (
    <>
      <div
        ref={scrimRef}
        className="assistant-sheet-scrim"
        onClick={() => sheetHandleRef.current?.moveToAnchor(PEEK_ANCHOR_INDEX)}
      />
      <BottomSheet
        ref={sheetHandleRef}
        className="sheet-assistant"
        anchors={anchors}
        initialAnchorIndex={FULL_ANCHOR_INDEX}
        open
        closable
        onClose={onDismiss}
        onPositionChange={trackScrim}
        header={<span className="sheet-title">{title}</span>}
      >
        {children}
      </BottomSheet>
    </>
  );
}
