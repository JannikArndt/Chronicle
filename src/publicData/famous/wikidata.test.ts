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
];

describe("bindingsToPerson", () => {
  it("reads birth as the alignment anchor", () => {
    const person = bindingsToPerson("Q937", "Albert Einstein", "physicist", bindings);
    expect(person.birthMs).toBe(Date.UTC(1879, 2, 14));
  });

  it("groups entries into the mapped rows", () => {
    const person = bindingsToPerson("Q937", "Albert Einstein", "physicist", bindings);
    expect(person.biography.rows.map((r) => r.label)).toEqual(["Places lived", "Works"]);
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
