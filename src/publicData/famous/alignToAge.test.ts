import { describe, expect, it } from "vitest";
import { ALIGNED_LABEL_SUFFIX, buildFamousDataset, famousKey, parseFamousGroupId } from "./alignToAge";
import { mozart } from "./lives";

// Salzburg is Mozart's first "Places lived" entry — a stable anchor for the
// shift assertions that doesn't depend on the exact biography wording.
const salzburgOriginalStart = Date.UTC(1756, 0, 1);

describe("buildFamousDataset — unaligned", () => {
  it("keeps the person's real calendar dates", () => {
    const dataset = buildFamousDataset(mozart);
    const salzburg = dataset.entries.find((entry) => entry.title === "Salzburg")!;
    expect(salzburg.start.ms).toBe(salzburgOriginalStart);
  });

  it("namespaces ids so a public dataset never collides with private data", () => {
    const dataset = buildFamousDataset(mozart);
    expect(dataset.groups[0].id).toBe(`pub:${famousKey("mozart", false)}:g`);
    expect(dataset.entries.every((entry) => entry.id.startsWith("pub:"))).toBe(true);
  });

  it("leaves the group label unadorned", () => {
    const dataset = buildFamousDataset(mozart);
    expect(dataset.groups[0].label).toBe("W. A. Mozart");
  });

  it("gives every entry an explicit end date", () => {
    const dataset = buildFamousDataset(mozart);
    expect(dataset.entries.every((entry) => entry.end !== undefined)).toBe(true);
  });
});

describe("buildFamousDataset — aligned to the user's age", () => {
  const userBirthMs = Date.UTC(1990, 5, 15);
  const offset = userBirthMs - mozart.birthMs;

  it("shifts the whole life by (user birth − person birth)", () => {
    const dataset = buildFamousDataset(mozart, userBirthMs);
    const salzburg = dataset.entries.find((entry) => entry.title === "Salzburg")!;
    expect(salzburg.start.ms).toBe(salzburgOriginalStart + offset);
  });

  it("preserves every gap — a fact at the person's age N sits at the user's age N", () => {
    const dataset = buildFamousDataset(mozart, userBirthMs);
    for (const shifted of dataset.entries) {
      const original = mozart.biography.entries.find((entry) => shifted.id.endsWith(`:${entry.id}`))!;
      expect(shifted.start.ms).toBe(original.start.ms + offset);
      if (original.end) expect(shifted.end!.ms).toBe(original.end.ms + offset);
    }
  });

  it("preserves fuzzy-date precision through the shift", () => {
    const dataset = buildFamousDataset(mozart, userBirthMs);
    const salzburg = dataset.entries.find((entry) => entry.title === "Salzburg")!;
    expect(salzburg.start.precision).toBe("year");
  });

  it("marks the group as aligned and uses a distinct namespace", () => {
    const dataset = buildFamousDataset(mozart, userBirthMs);
    expect(dataset.groups[0].label).toBe(`W. A. Mozart${ALIGNED_LABEL_SUFFIX}`);
    expect(dataset.groups[0].id).toBe(`pub:${famousKey("mozart", true)}:g`);
  });
});

describe("parseFamousGroupId", () => {
  it("recovers person and alignment from a rendered group id", () => {
    expect(parseFamousGroupId("pub:famous-mozart:g")).toEqual({ personId: "mozart", aligned: false });
    expect(parseFamousGroupId("pub:famous-mozart-aligned:g")).toEqual({ personId: "mozart", aligned: true });
  });

  it("round-trips a hyphenated person id", () => {
    expect(parseFamousGroupId("pub:famous-frida-kahlo-aligned:r-places")).toEqual({
      personId: "frida-kahlo",
      aligned: true,
    });
  });

  it("returns null for non-famous groups", () => {
    expect(parseFamousGroupId("pub:us-presidents:g-1")).toBeNull();
    expect(parseFamousGroupId("g-private-123")).toBeNull();
  });
});
