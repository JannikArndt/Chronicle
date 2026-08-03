// The mobile pull-up sheet, used by both the timeline list and the entry
// inspector. Hand-rolled Pointer Events rather than a library or CSS scroll
// snap: one code path for mouse/trackpad/touch, and no first UI dependency.
//
// The sheet's position is mutated straight onto the element during a drag — the
// same direct-style approach the rail uses for scroll sync — so tracking the
// finger never costs a React render. The snap physics live in sheetSnap.ts.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { nearestAnchor, rubberBandPosition } from "./sheetSnap";

// Velocity is averaged over the tail of the gesture, not the whole of it, so a
// drag that stalls before release doesn't inherit its own earlier speed.
const VELOCITY_WINDOW_MS = 120;

// A press that moves less than this, for less than this long, was a tap.
const TAP_MAX_MOVEMENT_PX = 8;
const TAP_MAX_DURATION_MS = 400;

// How far below its lowest anchor a dismissed sheet parks, so its shadow and
// rounded corners clear the screen edge.
const HIDDEN_OVERSHOOT_PX = 40;

export interface BottomSheetHandle {
  // Animates to `anchors[index]`.
  moveToAnchor(index: number): void;
  // Animates up to `anchors[index]` only if the sheet currently sits lower —
  // used when navigating into a sub-pane from the peek anchor.
  raiseToAtLeastAnchor(index: number): void;
}

interface BottomSheetProps {
  // Heights in px measured from the bottom of the screen, ascending.
  anchors: number[];
  initialAnchorIndex?: number;
  // `false` slides the sheet off-screen but keeps it mounted (and keeps its
  // scroll position), so re-opening is instant.
  open: boolean;
  // Closable sheets can be thrown away with a downward flick.
  closable?: boolean;
  onClose?: () => void;
  onPositionChange?: (position: number) => void;
  header: ReactNode;
  children: ReactNode;
  className?: string;
  // Changes when the content is a different screen rather than the same screen
  // updated. The list is scrolled back to the top, so a pane never opens
  // already scrolled down to wherever the previous one was left.
  contentKey?: string;
}

// How far the finger must travel down the content before an overscroll counts
// as "drag the sheet" rather than "the list just bounced".
const CONTENT_DRAG_THRESHOLD_PX = 4;

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startTime: number;
  startPosition: number;
  target: HTMLElement;
  samples: { time: number; position: number }[];
  // A gesture that began on the scrollable content, before it is known whether
  // the user is scrolling the list or pulling the sheet. Pending gestures move
  // nothing and never capture the pointer, so a plain scroll is untouched.
  pending: boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const BottomSheet = forwardRef<BottomSheetHandle, BottomSheetProps>(function BottomSheet(
  {
    anchors,
    initialAnchorIndex = 0,
    open,
    closable = false,
    onClose,
    onPositionChange,
    header,
    children,
    className,
    contentKey,
  },
  handleRef,
) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef(anchors[initialAnchorIndex]);
  const dragRef = useRef<DragState | null>(null);
  const hasOpenedRef = useRef(false);

  // Everything below runs from event handlers and effects that must not be
  // re-bound on every render, so the live props are read through refs.
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;
  const onPositionChangeRef = useRef(onPositionChange);
  onPositionChangeRef.current = onPositionChange;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const topAnchor = () => anchorsRef.current[anchorsRef.current.length - 1];

  // Below its highest anchor the sheet's content does not scroll at all —
  // dragging anywhere on it moves the sheet, the way iOS sheets behave.
  const isFullyRaised = () => positionRef.current >= topAnchor() - 1;

  const applyPosition = (animate: boolean) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    // The sheet is always as tall as its highest anchor and slides; animating a
    // height instead would re-layout its contents on every frame.
    sheet.style.height = `${topAnchor()}px`;
    sheet.classList.toggle("sheet-snapping", animate && !prefersReducedMotion());
    sheet.style.transform = `translateY(${topAnchor() - positionRef.current}px)`;
    listRef.current?.classList.toggle("sheet-list-locked", !isFullyRaised());
    onPositionChangeRef.current?.(positionRef.current);
  };

  const applyHidden = (animate: boolean) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.height = `${topAnchor()}px`;
    sheet.classList.toggle("sheet-snapping", animate && !prefersReducedMotion());
    sheet.style.transform = `translateY(${topAnchor() + HIDDEN_OVERSHOOT_PX}px)`;
  };

  useEffect(() => {
    if (!open) {
      applyHidden(true);
      return;
    }
    // Park off-screen without a transition, force the browser to take that as
    // the starting point, then animate up — otherwise the sheet appears to
    // slide down from wherever it last was.
    applyHidden(false);
    sheetRef.current?.getBoundingClientRect();
    // Only the very first open uses the initial anchor; after that the sheet
    // comes back at the height it was left at. Navigating between the timeline
    // and entry sheets closes one and opens the other, and resetting here made
    // every such move collapse to peek.
    if (!hasOpenedRef.current) positionRef.current = anchorsRef.current[initialAnchorIndex];
    hasOpenedRef.current = true;
    applyPosition(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAnchorIndex]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [contentKey]);

  // Rotation and URL-bar collapse move the anchors under a sheet that is
  // already on screen. Joined into a string because a fresh array literal from
  // the parent would otherwise re-run this every render.
  const anchorKey = anchors.join(",");
  useEffect(() => {
    if (!open) {
      applyHidden(false);
      return;
    }
    const [bottom] = anchorsRef.current;
    positionRef.current = Math.min(topAnchor(), Math.max(bottom, positionRef.current));
    applyPosition(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, open]);

  useImperativeHandle(handleRef, () => ({
    moveToAnchor(index: number) {
      positionRef.current = anchorsRef.current[index];
      applyPosition(true);
    },
    raiseToAtLeastAnchor(index: number) {
      const target = anchorsRef.current[index];
      if (positionRef.current >= target) return;
      positionRef.current = target;
      applyPosition(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const beginGesture = (event: ReactPointerEvent<HTMLDivElement>, pending: boolean) => {
    const target = event.target as HTMLElement;
    // A text field (in-place title editing) has to behave like a text field,
    // including its own caret placement and selection drag.
    //
    // `data-owns-gestures` is the same escape hatch for anything else that
    // drags: the date lane's handles are dragged sideways, and a few degrees of
    // vertical wobble used to promote the sheet's pending drag, which captured
    // the pointer and cut the lane's drag dead mid-gesture.
    if (target.closest("input, textarea, [data-owns-gestures]")) return;
    if (!pending) event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startTime: event.timeStamp,
      startPosition: positionRef.current,
      target,
      samples: [{ time: event.timeStamp, position: positionRef.current }],
      pending,
    };
    sheetRef.current?.classList.remove("sheet-snapping");
  };

  // The header is always a sheet handle.
  const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => beginGesture(event, false);

  // The content is a handle too, but only once it is clear the list itself
  // cannot absorb the gesture — otherwise the sheet would hijack scrolling.
  const handleContentPointerDown = (event: ReactPointerEvent<HTMLDivElement>) =>
    beginGesture(event, isFullyRaised());

  // A pending gesture becomes a sheet drag the moment the finger pulls down
  // while the list is already at its top; any other movement abandons it and
  // leaves the list to scroll natively.
  const promoteOrAbandonPendingDrag = (drag: DragState, event: ReactPointerEvent<HTMLDivElement>) => {
    const movedDown = event.clientY - drag.startClientY;
    if (Math.abs(movedDown) < CONTENT_DRAG_THRESHOLD_PX) return;
    const listAtTop = (listRef.current?.scrollTop ?? 0) <= 0;
    if (movedDown <= 0 || !listAtTop) {
      dragRef.current = null;
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.pending = false;
    // Re-anchor to here, so the sheet doesn't jump by the threshold distance.
    drag.startClientY = event.clientY;
    drag.startTime = event.timeStamp;
    drag.startPosition = positionRef.current;
    drag.samples = [{ time: event.timeStamp, position: positionRef.current }];
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.pending) {
      promoteOrAbandonPendingDrag(drag, event);
      if (dragRef.current?.pending !== false) return;
    }
    const dragged = drag.startPosition + (drag.startClientY - event.clientY);
    positionRef.current = rubberBandPosition(dragged, anchorsRef.current, closable);
    applyPosition(false);
    drag.samples.push({ time: event.timeStamp, position: positionRef.current });
    while (drag.samples.length > 2 && event.timeStamp - drag.samples[0].time > VELOCITY_WINDOW_MS) {
      drag.samples.shift();
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    // Never promoted: nothing moved, and the pointer was never captured, so the
    // native click on whatever was pressed goes through untouched.
    if (drag.pending) return;

    const first = drag.samples[0];
    const last = drag.samples[drag.samples.length - 1];
    const velocity = last.time > first.time ? (last.position - first.position) / (last.time - first.time) : 0;

    // setPointerCapture retargets the native click to the header element, which
    // silently kills taps on buttons inside the header. Re-dispatch it by hand.
    const movement = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
    const wasTap = movement < TAP_MAX_MOVEMENT_PX && event.timeStamp - drag.startTime < TAP_MAX_DURATION_MS;
    const tappedButton = wasTap ? drag.target.closest("button") : null;

    const decision = nearestAnchor(positionRef.current, velocity, anchorsRef.current, closable);
    if (decision.kind === "dismiss" && !tappedButton) {
      applyHidden(true);
      onCloseRef.current?.();
      return;
    }
    positionRef.current = decision.position;
    applyPosition(true);
    if (tappedButton instanceof HTMLElement) tappedButton.click();
  };

  return (
    <div
      ref={sheetRef}
      className={`sheet ${className ?? ""}`}
      style={{
        height: anchors[anchors.length - 1],
        transform: `translateY(${anchors[anchors.length - 1] + HIDDEN_OVERSHOOT_PX}px)`,
      }}
    >
      <div
        className="sheet-head"
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="sheet-grab" />
        {header}
      </div>
      <div
        ref={listRef}
        className="sheet-list"
        onPointerDown={handleContentPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {children}
      </div>
    </div>
  );
});
