// Pure snap/velocity math for the mobile BottomSheet. Kept out of the
// component so the physics that make the sheet feel like iOS can be unit-tested
// — the DOM half is not tested, same as the canvas painting.
//
// A sheet's `position` is its height in px measured from the bottom of the
// screen: bigger means pulled further up. Velocity is px per ms, so a downward
// flick is negative.

// How far ahead of the finger a release is projected. Long enough that a flick
// from the bottom anchor can sail past the middle one — snapping to the nearest
// anchor by position alone was immediately called out as "not feeling like iOS".
export const FLICK_PROJECTION_MS = 170;

// A closable sheet is thrown away when the projection lands this far below its
// lowest anchor.
export const DISMISS_MARGIN_PX = 50;

// Resistance past the ends of the anchor range. Dragging above the top anchor is
// stiff; dragging a closable sheet below its lowest anchor is nearly free,
// because that gesture is on its way to dismissing the sheet.
const RESISTANCE_ABOVE_TOP_ANCHOR = 0.25;
const RESISTANCE_BELOW_BOTTOM_ANCHOR = 0.25;
const RESISTANCE_BELOW_BOTTOM_ANCHOR_WHEN_CLOSABLE = 0.85;

export interface SnapDecision {
  // "dismiss" is only ever returned for a closable sheet. `position` still
  // carries the anchor the sheet would snap to, so a caller that decides not to
  // dismiss after all (a tap misread as a flick) has somewhere to land.
  kind: "anchor" | "dismiss";
  position: number;
}

// Rubber-banding: the finger is tracked 1:1 inside the anchor range and
// resisted outside it.
export function rubberBandPosition(rawPosition: number, anchors: number[], closable: boolean): number {
  const bottom = anchors[0];
  const top = anchors[anchors.length - 1];
  if (rawPosition > top) return top + (rawPosition - top) * RESISTANCE_ABOVE_TOP_ANCHOR;
  if (rawPosition < bottom) {
    const resistance = closable
      ? RESISTANCE_BELOW_BOTTOM_ANCHOR_WHEN_CLOSABLE
      : RESISTANCE_BELOW_BOTTOM_ANCHOR;
    return bottom + (rawPosition - bottom) * resistance;
  }
  return rawPosition;
}

// Where the sheet would coast to if the finger let go here at this speed.
export function projectPosition(position: number, velocityPxPerMs: number): number {
  return position + velocityPxPerMs * FLICK_PROJECTION_MS;
}

export function nearestAnchor(
  position: number,
  velocityPxPerMs: number,
  anchors: number[],
  closable: boolean,
): SnapDecision {
  const projected = projectPosition(position, velocityPxPerMs);
  let best = anchors[0];
  for (const anchor of anchors) {
    if (Math.abs(anchor - projected) < Math.abs(best - projected)) best = anchor;
  }
  const dismissed = closable && projected < anchors[0] - DISMISS_MARGIN_PX;
  return { kind: dismissed ? "dismiss" : "anchor", position: best };
}
