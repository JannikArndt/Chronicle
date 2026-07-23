// Pure-logic tests for BirthDateInput. This project has no React component
// testing precedent/dependency (no @testing-library), so we exercise the
// extracted pure functions directly rather than rendering the component.

import { describe, expect, it } from "vitest";
import { isValidCalendarDate, localeDateOrder } from "./BirthDateInput";

describe("isValidCalendarDate", () => {
  it("accepts an ordinary date", () => {
    expect(isValidCalendarDate(1990, 6, 15)).toBe(true);
  });

  it("accepts a leap day", () => {
    expect(isValidCalendarDate(2000, 2, 29)).toBe(true);
  });

  it("rejects February 30th", () => {
    expect(isValidCalendarDate(2001, 2, 30)).toBe(false);
  });

  it("rejects February 29th on a non-leap year", () => {
    expect(isValidCalendarDate(2001, 2, 29)).toBe(false);
  });

  it("rejects a month out of range", () => {
    expect(isValidCalendarDate(2001, 13, 1)).toBe(false);
    expect(isValidCalendarDate(2001, 0, 1)).toBe(false);
  });

  it("rejects a day out of range", () => {
    expect(isValidCalendarDate(2001, 1, 32)).toBe(false);
    expect(isValidCalendarDate(2001, 1, 0)).toBe(false);
  });

  it("rejects April 31st", () => {
    expect(isValidCalendarDate(2001, 4, 31)).toBe(false);
  });
});

describe("localeDateOrder", () => {
  it("returns exactly the three date segment kinds", () => {
    const order = localeDateOrder();
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(["day", "month", "year"]));
  });
});
