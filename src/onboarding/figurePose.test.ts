import { describe, expect, test } from "vitest";
import { figurePose, hairBlend, mixHex } from "./figurePose";
import type { FigurePose } from "./figurePose";

type Person = Extract<FigurePose, { kind: "person" }>;
const person = (age: number) => figurePose(age) as Person;

describe("figurePose", () => {
  test("a baby sits", () => {
    expect(figurePose(0)).toEqual({ kind: "baby" });
    expect(figurePose(1)).toEqual({ kind: "baby" });
    expect(figurePose(2).kind).toBe("person");
  });

  test("a child grows into adult proportions by 18", () => {
    expect(person(4).grow).toBeLessThan(person(12).grow);
    expect(person(12).grow).toBeLessThan(person(18).grow);
    expect(person(18).grow).toBe(1);
    expect(person(4).heads).toBeLessThan(person(18).heads);
    expect(person(4).legShare).toBeLessThan(person(30).legShare);
  });

  test("glasses from 44, a stoop after 66, a cane from 78", () => {
    expect(person(43).glasses).toBe(false);
    expect(person(44).glasses).toBe(true);
    expect(person(66).stoop).toBe(0);
    expect(person(70).stoop).toBeGreaterThan(0);
    expect(person(77).cane).toBe(false);
    expect(person(78).cane).toBe(true);
  });

  test("shrinks a little in old age, never below 93%", () => {
    expect(person(68).grow).toBe(1);
    expect(person(100).grow).toBeCloseTo(0.93);
  });
});

describe("hair", () => {
  test("dark until 40, greying, white by 80", () => {
    expect(hairBlend(30)).toEqual({ from: "young", to: "young", t: 0 });
    expect(hairBlend(51)).toEqual({ from: "young", to: "mid", t: 0.5 });
    expect(hairBlend(80)).toEqual({ from: "mid", to: "old", t: 1 });
    expect(hairBlend(95).t).toBe(1);
  });

  test("thins from 55", () => {
    expect(person(55).hairThin).toBe(0);
    expect(person(70).hairThin).toBeGreaterThan(0);
  });
});

describe("mixHex", () => {
  test("blends two hex colours", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("rgb(128, 128, 128)");
    expect(mixHex("#fff", "#000", 0)).toBe("rgb(255, 255, 255)");
  });

  test("anything that isn't hex comes back unblended", () => {
    expect(mixHex("rgb(1, 2, 3)", "#ffffff", 0.5)).toBe("rgb(1, 2, 3)");
  });
});
