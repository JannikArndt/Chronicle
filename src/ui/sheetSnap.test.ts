import { describe, expect, it } from "vitest";
import { DISMISS_MARGIN_PX, nearestAnchor, projectPosition, rubberBandPosition } from "./sheetSnap";

const ANCHORS = [96, 400, 700];

describe("nearestAnchor", () => {
  it("snaps to the closest anchor when the sheet is released at rest", () => {
    expect(nearestAnchor(120, 0, ANCHORS, false)).toEqual({ kind: "anchor", position: 96 });
    expect(nearestAnchor(330, 0, ANCHORS, false)).toEqual({ kind: "anchor", position: 400 });
    expect(nearestAnchor(690, 0, ANCHORS, false)).toEqual({ kind: "anchor", position: 700 });
  });

  it("lets an upward flick from the bottom anchor sail past the middle one", () => {
    // Released just above the bottom anchor, but travelling fast enough that the
    // projection lands nearer the top anchor than the middle one.
    const flickUp = nearestAnchor(150, 3, ANCHORS, false);
    expect(flickUp).toEqual({ kind: "anchor", position: 700 });
  });

  it("settles a slow upward drag on the anchor it is actually near", () => {
    // Same release point as the flick above, a sixth of the speed: the
    // projection barely moves, so the sheet falls back to the bottom anchor.
    expect(nearestAnchor(150, 0.5, ANCHORS, false)).toEqual({ kind: "anchor", position: 96 });
    // Dragged most of the way to the middle anchor, a slow flick carries it there.
    expect(nearestAnchor(330, 0.5, ANCHORS, false)).toEqual({ kind: "anchor", position: 400 });
  });

  it("dismisses a closable sheet flicked below its lowest anchor", () => {
    const decision = nearestAnchor(96 - DISMISS_MARGIN_PX - 1, 0, ANCHORS, true);
    expect(decision.kind).toBe("dismiss");
    // The fallback anchor is still reported, for a caller that cancels the dismiss.
    expect(decision.position).toBe(96);
  });

  it("never dismisses a sheet that is not closable", () => {
    expect(nearestAnchor(-200, -4, ANCHORS, false).kind).toBe("anchor");
  });

  it("does not dismiss when the downward drag stops short of the margin", () => {
    expect(nearestAnchor(96 - DISMISS_MARGIN_PX + 1, 0, ANCHORS, true).kind).toBe("anchor");
  });

  it("dismisses on a fast downward flick even from above the lowest anchor", () => {
    expect(nearestAnchor(200, -2, ANCHORS, true).kind).toBe("dismiss");
  });
});

describe("projectPosition", () => {
  it("projects ahead of the finger in the direction of travel", () => {
    expect(projectPosition(300, 1)).toBeGreaterThan(300);
    expect(projectPosition(300, -1)).toBeLessThan(300);
    expect(projectPosition(300, 0)).toBe(300);
  });
});

describe("rubberBandPosition", () => {
  it("tracks the finger 1:1 inside the anchor range", () => {
    expect(rubberBandPosition(250, ANCHORS, false)).toBe(250);
  });

  it("resists dragging above the top anchor", () => {
    expect(rubberBandPosition(800, ANCHORS, false)).toBe(700 + 100 * 0.25);
  });

  it("barely resists a closable sheet dragged below its lowest anchor", () => {
    expect(rubberBandPosition(0, ANCHORS, true)).toBeCloseTo(96 - 96 * 0.85);
  });

  it("resists a non-closable sheet dragged below its lowest anchor", () => {
    expect(rubberBandPosition(0, ANCHORS, false)).toBeCloseTo(96 - 96 * 0.25);
  });
});
