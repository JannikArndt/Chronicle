import { describe, expect, it } from "vitest";
import { ALIGNED_LABEL_SUFFIX, buildFamousDataset, famousKey } from "./alignToAge";
import { mozart } from "./lives";

describe("buildFamousDataset — unaligned", () => {
  it("keeps the person's real calendar dates", () => {
    const dataset = buildFamousDataset(mozart);
    const born = dataset.entries.find((entry) => entry.title.startsWith("Born"))!;
    expect(born.start.ms).toBe(mozart.birthMs);
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
});

describe("buildFamousDataset — aligned to the user's age", () => {
  const userBirthMs = Date.UTC(1990, 5, 15);

  it("shifts the person's birth onto the user's birth", () => {
    const dataset = buildFamousDataset(mozart, userBirthMs);
    const born = dataset.entries.find((entry) => entry.title.startsWith("Born"))!;
    expect(born.start.ms).toBe(userBirthMs);
  });

  it("preserves every gap — a fact at the person's age N sits at the user's age N", () => {
    const dataset = buildFamousDataset(mozart, userBirthMs);
    const offset = userBirthMs - mozart.birthMs;
    for (const shifted of dataset.entries) {
      const original = mozart.biography.entries.find((entry) => shifted.id.endsWith(`:${entry.id}`))!;
      expect(shifted.start.ms).toBe(original.start.ms + offset);
      if (original.end) expect(shifted.end!.ms).toBe(original.end.ms + offset);
    }
  });

  it("preserves fuzzy-date precision through the shift", () => {
    const dataset = buildFamousDataset(mozart, userBirthMs);
    const firstSymphony = dataset.entries.find((entry) => entry.title.includes("symphony"))!;
    expect(firstSymphony.start.precision).toBe("year");
  });

  it("marks the group as aligned and uses a distinct namespace", () => {
    const dataset = buildFamousDataset(mozart, userBirthMs);
    expect(dataset.groups[0].label).toBe(`W. A. Mozart${ALIGNED_LABEL_SUFFIX}`);
    expect(dataset.groups[0].id).toBe(`pub:${famousKey("mozart", true)}:g`);
  });
});
