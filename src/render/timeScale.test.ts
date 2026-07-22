import { describe, expect, test } from "vitest";
import { MAX_MS_PER_PX, MIN_MS_PER_PX, clampScale, msToX, panBy, xToMs, zoomAt } from "./timeScale";
import { DAY_MS } from "../model/fuzzyDate";

const T0 = Date.UTC(2020, 0, 1);

describe("time scale", () => {
  const scale = { startMs: T0, msPerPx: DAY_MS };

  test("ms↔px round-trips", () => {
    expect(msToX(scale, T0)).toBe(0);
    expect(msToX(scale, T0 + 10 * DAY_MS)).toBe(10);
    expect(xToMs(scale, 10)).toBe(T0 + 10 * DAY_MS);
  });

  test("panBy shifts start by pixel distance", () => {
    expect(panBy(scale, 5).startMs).toBe(T0 + 5 * DAY_MS);
  });

  test("zoomAt keeps the time under the anchor fixed", () => {
    const anchorX = 200;
    const before = xToMs(scale, anchorX);
    const zoomed = zoomAt(scale, anchorX, 0.5);
    expect(xToMs(zoomed, anchorX)).toBeCloseTo(before, 5);
    expect(zoomed.msPerPx).toBe(DAY_MS * 0.5);
  });

  test("clampScale bounds msPerPx", () => {
    expect(clampScale({ startMs: T0, msPerPx: 1 }).msPerPx).toBe(MIN_MS_PER_PX);
    expect(clampScale({ startMs: T0, msPerPx: 1e15 }).msPerPx).toBe(MAX_MS_PER_PX);
  });
});
