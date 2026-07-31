import { describe, expect, test } from "vitest";
import { ENTRY_CATEGORIES, rowsForCategory } from "./addEntryCategories";
import type { TimelineRow } from "../model/types";

function row(id: string, icon: string): TimelineRow {
  return { id, groupId: "g1", label: id, color: "#888", icon };
}

const trips = ENTRY_CATEGORIES.find((category) => category.key === "trip")!;

describe("rowsForCategory", () => {
  test("finds the one row carrying the category's icon", () => {
    const rows = [row("a", "🏠"), row("b", "✈️"), row("c", "💼")];
    expect(rowsForCategory(rows, trips).map((r) => r.id)).toEqual(["b"]);
  });

  test("returns every match, so the caller can tell 'one' from 'ambiguous'", () => {
    const rows = [row("a", "✈️"), row("b", "✈️")];
    expect(rowsForCategory(rows, trips)).toHaveLength(2);
  });

  test("returns nothing rather than guessing when no icon matches", () => {
    expect(rowsForCategory([row("a", "🏠")], trips)).toEqual([]);
  });
});

describe("the category list", () => {
  test("every category has a distinct key and icon", () => {
    expect(new Set(ENTRY_CATEGORIES.map((c) => c.key)).size).toBe(ENTRY_CATEGORIES.length);
    expect(new Set(ENTRY_CATEGORIES.map((c) => c.icon)).size).toBe(ENTRY_CATEGORIES.length);
  });

  test("every category offers tappable suggestions, so nothing needs a keyboard", () => {
    for (const category of ENTRY_CATEGORIES) {
      expect(category.suggestions.length).toBeGreaterThan(0);
    }
  });
});
