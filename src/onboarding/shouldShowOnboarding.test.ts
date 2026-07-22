import { describe, expect, test } from "vitest";
import { shouldShowOnboarding } from "./shouldShowOnboarding";
import { emptyDataset } from "../model/dataset";

describe("shouldShowOnboarding", () => {
  test("true for a completely fresh dataset", () => {
    expect(shouldShowOnboarding(emptyDataset())).toBe(true);
  });

  test("false once selfPersonId is set", () => {
    const dataset = { ...emptyDataset(), selfPersonId: "person-1" };
    expect(shouldShowOnboarding(dataset)).toBe(false);
  });

  test("false once the user has created a group manually, even without selfPersonId", () => {
    const dataset = emptyDataset();
    dataset.groups.push({ id: "g1", label: "Someone", collapsed: false });
    expect(shouldShowOnboarding(dataset)).toBe(false);
  });
});
