import { describe, expect, test } from "vitest";
import { chooseSchoolSystem, educationChips, systemForCountry, systemForLanguage } from "./schoolSystems";
import type { Sequence, SequenceItem } from "./sequence";

function place(label: string, at: number, country?: string): SequenceItem {
  return { key: label, label, fallback: label, at, gap: false, place: { title: label, details: { fullName: label, country } } };
}
const places = (...items: SequenceItem[]): Sequence => ({ items, end: null });

describe("chooseSchoolSystem", () => {
  test("where you lived at 6 decides", () => {
    const choice = chooseSchoolSystem(places(place("Boston", 0, "United States"), place("Hamburg", 4, "Deutschland"), place("London", 20, "United Kingdom")), "en-US");
    expect(choice.system).toBe("de");
    expect(choice.reason).toBe("Schools as in Germany, where you lived at 6.");
  });

  test("without a country at 6, any place with one", () => {
    expect(chooseSchoolSystem(places(place("Hamburg", 0), place("Wien", 20, "Österreich")), undefined).system).toBe("at");
  });

  test("without any country, the browser's language; then a neutral set", () => {
    expect(chooseSchoolSystem(places(place("Hamburg", 0)), "de-DE").system).toBe("de");
    expect(chooseSchoolSystem(places(), "en-GB").system).toBe("uk");
    expect(chooseSchoolSystem(null, "fr-FR")).toEqual({ system: "generic", reason: null });
  });
});

describe("names", () => {
  test("countries in English and in their own language", () => {
    expect(systemForCountry("Germany")).toBe("de");
    expect(systemForCountry("Schweiz")).toBe("ch");
    expect(systemForCountry("France")).toBeUndefined();
    expect(systemForLanguage("de-AT")).toBe("at");
    expect(systemForLanguage("en")).toBeUndefined();
  });

  test("Germany starts with Grundschule; every set ends with university, a year abroad and a gap", () => {
    expect(educationChips("de")[0]).toMatchObject({ text: "Grundschule", start: 6, length: 4 });
    for (const system of ["de", "at", "ch", "us", "uk", "generic"] as const) {
      const texts = educationChips(system).map((chip) => chip.text);
      expect(texts.slice(-5)).toEqual(["Bachelor", "Master", "PhD", "Year abroad", "Gap"]);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });
});
