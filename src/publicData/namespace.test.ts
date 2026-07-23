import { describe, expect, test } from "vitest";
import { namespaceDataset } from "./namespace";
import { emptyDataset } from "../model/dataset";
import type { TimelineDataset } from "../model/types";

function fixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.groups = [{ id: "g-1", label: "Apple", collapsed: false }];
  ds.categories = [
    { id: "cat-1", label: "Releases", color: "#888", icon: "📱" },
  ];
  ds.rows = [
    { id: "row-1", groupId: "g-1", categoryId: "cat-1", label: "iPhone" },
    { id: "row-2", groupId: "g-1", categoryId: "cat-1", label: "Details", parentRowId: "row-1" },
  ];
  ds.entries = [
    {
      id: "e-1",
      rowId: "row-1",
      title: "iPhone",
      start: { ms: 0, precision: "day" },
    },
    {
      id: "e-2",
      rowId: "row-2",
      title: "Launch event",
      start: { ms: 0, precision: "day" },
      parentEntryId: "e-1",
    },
  ];
  return ds;
}

describe("namespaceDataset", () => {
  test("prefixes every id and every reference with pub:<stem>:", () => {
    const ds = namespaceDataset(fixture(), "iphone-releases");
    expect(ds.groups[0].id).toBe("pub:iphone-releases:g-1");
    expect(ds.rows[0].groupId).toBe("pub:iphone-releases:g-1");
    expect(ds.rows[1].parentRowId).toBe("pub:iphone-releases:row-1");
    expect(ds.entries[0].rowId).toBe("pub:iphone-releases:row-1");
    expect(ds.entries[1].parentEntryId).toBe("pub:iphone-releases:e-1");
    expect(ds.categories[0].id).toBe("pub:iphone-releases:cat-1");
    expect(ds.rows[0].categoryId).toBe("pub:iphone-releases:cat-1");
  });

  test("leaves absent optional references undefined", () => {
    const ds = namespaceDataset(fixture(), "x");
    expect(ds.rows[0].parentRowId).toBeUndefined();
    expect(ds.entries[0].parentEntryId).toBeUndefined();
    expect(ds.groups[0].personId).toBeUndefined();
  });

  test("does not mutate the input", () => {
    const input = fixture();
    namespaceDataset(input, "x");
    expect(input.groups[0].id).toBe("g-1");
  });
});
