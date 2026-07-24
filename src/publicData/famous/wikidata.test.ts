import { describe, expect, it } from "vitest";
import { bindingsToPerson } from "./wikidata";

// Minimal SPARQL bindings resembling what WDQS returns for a person.
const bindings = [
  { type: { value: "meta" }, birth: { value: "1879-03-14T00:00:00Z" }, death: { value: "1955-04-18T00:00:00Z" } },
  {
    type: { value: "place" },
    itemLabel: { value: "Bern" },
    startDate: { value: "1902-01-01T00:00:00Z" },
    endDate: { value: "1909-01-01T00:00:00Z" },
  },
  {
    type: { value: "place" },
    itemLabel: { value: "Princeton" }, // open-ended residence — no end qualifier
    startDate: { value: "1933-01-01T00:00:00Z" },
  },
  {
    type: { value: "work" },
    itemLabel: { value: "Theory of relativity" }, // point event via publication date
    pointDate: { value: "1915-01-01T00:00:00Z" },
  },
  // Two overlapping jobs → two lanes under "Career".
  {
    type: { value: "career" },
    itemLabel: { value: "Patent office" },
    startDate: { value: "1902-01-01T00:00:00Z" },
    endDate: { value: "1909-01-01T00:00:00Z" },
  },
  {
    type: { value: "career" },
    itemLabel: { value: "University of Berlin" },
    startDate: { value: "1914-01-01T00:00:00Z" },
    endDate: { value: "1933-01-01T00:00:00Z" },
  },
  {
    type: { value: "partner" },
    itemLabel: { value: "Mileva Marić" },
    startDate: { value: "1903-01-01T00:00:00Z" },
    endDate: { value: "1919-01-01T00:00:00Z" },
  },
  // A child — birth date is on the child, no end (still alive → capped at today).
  { type: { value: "child" }, itemLabel: { value: "Hans Albert Einstein" }, startDate: { value: "1904-01-01T00:00:00Z" } },
];

describe("bindingsToPerson", () => {
  it("reads birth as the alignment anchor", () => {
    const person = bindingsToPerson("Q937", "Albert Einstein", "physicist", bindings);
    expect(person.birthMs).toBe(Date.UTC(1879, 2, 14));
  });

  it("keeps flat rows (places, works) as plain rows with entries", () => {
    const person = bindingsToPerson("Q937", "Albert Einstein", "physicist", bindings);
    const places = person.biography.rows.find((r) => r.label === "Places lived")!;
    expect(places.parentRowId).toBeUndefined();
    expect(person.biography.entries.filter((e) => e.rowId === places.id)).toHaveLength(2);
  });

  it("splits overlapping jobs into sub-rows under a Career parent", () => {
    const person = bindingsToPerson("Q937", "Albert Einstein", "physicist", bindings);
    const career = person.biography.rows.find((r) => r.label === "Career" && r.parentRowId === undefined)!;
    const laneRows = person.biography.rows.filter((r) => r.parentRowId === career.id);
    expect(laneRows.map((r) => r.label)).toEqual(["Patent office", "University of Berlin"]);
    // The parent row is just a header — the entries live on the sub-rows.
    expect(person.biography.entries.some((e) => e.rowId === career.id)).toBe(false);
    expect(person.biography.entries.filter((e) => laneRows.some((r) => r.id === e.rowId))).toHaveLength(2);
  });

  it("adds partners and children (children as their own lanes)", () => {
    const person = bindingsToPerson("Q937", "Albert Einstein", "physicist", bindings);
    expect(person.biography.entries.some((e) => e.title === "Mileva Marić")).toBe(true);
    const childRow = person.biography.rows.find((r) => r.label === "Hans Albert Einstein")!;
    expect(childRow.parentRowId).toBeDefined();
    const childEntry = person.biography.entries.find((e) => e.rowId === childRow.id)!;
    expect(childEntry.end!.ms).toBeGreaterThan(childEntry.start.ms); // capped, not open-ended
  });

  it("closes an open-ended residence at the death date, not an ongoing arrow", () => {
    const person = bindingsToPerson("Q937", "Albert Einstein", "physicist", bindings);
    const princeton = person.biography.entries.find((e) => e.title === "Princeton")!;
    expect(princeton.end).toBeDefined();
    expect(princeton.end!.ms).toBe(Date.UTC(1955, 3, 18));
  });

  it("gives a point-in-time work a finite span so it renders as a bar", () => {
    const person = bindingsToPerson("Q937", "Albert Einstein", "physicist", bindings);
    const work = person.biography.entries.find((e) => e.title === "Theory of relativity")!;
    expect(work.end!.ms).toBeGreaterThan(work.start.ms);
  });

  it("throws when Wikidata has no dated events to place", () => {
    const onlyMeta = [{ type: { value: "meta" }, birth: { value: "1900-01-01T00:00:00Z" } }];
    expect(() => bindingsToPerson("Q1", "Nobody", undefined, onlyMeta)).toThrow(/No timeline data/);
  });
});
