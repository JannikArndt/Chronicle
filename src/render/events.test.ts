import { describe, expect, test } from "vitest";
import { DAY_MS } from "../model/fuzzyDate";
import {
  EVENT_HIDDEN_ABOVE_MS_PER_PX,
  EVENT_SOLID_BELOW_MS_PER_PX,
  eventLabelText,
  eventMarkerOpacity,
  eventsVisible,
  layoutEventMarkers,
} from "./events";
import type { TimelineEvent } from "../model/types";
import type { TimeScale } from "./timeScale";

const YEAR_MS = 365.25 * DAY_MS;

function event(id: string, ms: number, title = id, extra: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id, rowId: "r1", title, date: { ms, precision: "day" }, ...extra };
}

// Every character is 10px wide — enough to reason about which labels fit.
const measure = (text: string) => text.length * 10;

describe("eventMarkerOpacity", () => {
  test("is 0 across a whole life and 1 up close", () => {
    // ~40 years across a 1200px window: far too coarse for a point in time.
    expect(eventMarkerOpacity({ startMs: 0, msPerPx: (40 * YEAR_MS) / 1200 })).toBe(0);
    // A month across the same window.
    expect(eventMarkerOpacity({ startMs: 0, msPerPx: (30 * DAY_MS) / 1200 })).toBe(1);
  });

  test("ramps rather than switching, so markers fade in as you zoom", () => {
    const middle = (EVENT_HIDDEN_ABOVE_MS_PER_PX + EVENT_SOLID_BELOW_MS_PER_PX) / 2;
    expect(eventMarkerOpacity({ startMs: 0, msPerPx: middle })).toBeCloseTo(0.5, 5);
  });

  test("eventsVisible is false exactly where nothing would be painted", () => {
    expect(eventsVisible({ startMs: 0, msPerPx: EVENT_HIDDEN_ABOVE_MS_PER_PX })).toBe(false);
    expect(eventsVisible({ startMs: 0, msPerPx: EVENT_HIDDEN_ABOVE_MS_PER_PX - 1 })).toBe(true);
  });
});

describe("layoutEventMarkers", () => {
  // 1px = 1 day, so an event's x is its date in days.
  const scale: TimeScale = { startMs: 0, msPerPx: DAY_MS };

  test("places pins at their own instant, in date order", () => {
    const markers = layoutEventMarkers(
      [event("b", 30 * DAY_MS), event("a", 10 * DAY_MS)],
      scale,
      1000,
      measure,
    );
    expect(markers.map((marker) => marker.event.id)).toEqual(["a", "b"]);
    expect(markers.map((marker) => marker.x)).toEqual([10, 30]);
  });

  test("culls markers whose pin is off screen", () => {
    const markers = layoutEventMarkers(
      [event("left", -100 * DAY_MS), event("in", 50 * DAY_MS), event("right", 5000 * DAY_MS)],
      scale,
      1000,
      measure,
    );
    expect(markers.map((marker) => marker.event.id)).toEqual(["in"]);
  });

  test("the precision band is the date's own fuzz, so a day-precise event has none", () => {
    const [exact, vague] = layoutEventMarkers(
      [
        event("exact", 100 * DAY_MS),
        { ...event("vague", 400 * DAY_MS), date: { ms: 400 * DAY_MS, precision: "year" } },
      ],
      scale,
      1000,
      measure,
    );
    expect(exact.xFuzzStart).toBe(exact.x);
    expect(exact.xFuzzEnd).toBe(exact.x);
    // "year" is ±182 days, and one day is one pixel here.
    expect(vague.xFuzzEnd - vague.xFuzzStart).toBe(364);
  });

  test("a label stops before the next marker instead of running under it", () => {
    const [first] = layoutEventMarkers(
      [event("a", 10 * DAY_MS, "First kiss"), event("b", 60 * DAY_MS)],
      scale,
      1000,
      measure,
    );
    // Pin at 10, label starts at 19, next pin at 60 less 8px clearance → 33px.
    expect(measure(first.label)).toBeLessThanOrEqual(33);
    expect(first.label.endsWith("…")).toBe(true);
  });

  test("drops the label entirely when the gap is too narrow to say anything", () => {
    const [crowded] = layoutEventMarkers(
      [event("a", 10 * DAY_MS, "First kiss"), event("b", 25 * DAY_MS)],
      scale,
      1000,
      measure,
    );
    expect(crowded.label).toBe("");
    expect(crowded.labelWidth).toBe(0);
    // The pin survives: a moment you cannot label is still a moment you can tap.
    expect(crowded.x).toBe(10);
  });

  test("the last marker's label is clamped to the viewport, not to infinity", () => {
    const [only] = layoutEventMarkers(
      [event("a", 900 * DAY_MS, "A very long event title indeed")],
      scale,
      1000,
      measure,
    );
    expect(only.labelX + measure(only.label)).toBeLessThanOrEqual(1000);
  });

  test("an icon rides in front of the title", () => {
    expect(eventLabelText(event("a", 0, "First kiss", { icon: "💋" }))).toBe("💋 First kiss");
    expect(eventLabelText(event("a", 0, "First kiss"))).toBe("First kiss");
  });
});
