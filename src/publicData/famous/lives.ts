// Hand-authored sample biographies. These are NOT shown in the app any more —
// the picker is Wikidata-search only — they remain purely as offline TEST
// FIXTURES for the alignment and store-wiring tests (a real FamousPerson with a
// known shape, so those tests don't need a network call).
//
// Each person is split into Places lived, Education, Works, mirroring the
// multi-row shape the Wikidata loader produces. Every entry has an explicit end
// date on purpose: an open end renders as an ongoing arrow, wrong for a finished
// historical life.

import type { FamousBiography, FamousPerson } from "./types";

function year(y: number): number {
  return Date.UTC(y, 0, 1);
}

interface LifeItem {
  title: string;
  from: number; // year
  to: number; // year
  shortTitle?: string;
}

interface LifeRows {
  places: LifeItem[];
  education: LifeItem[];
  works: LifeItem[];
}

// The three rows share ids/colors across people; namespacing keeps them unique.
const ROW_DEFINITIONS = [
  { key: "places", label: "Places lived", icon: "🏠", color: "#6b8e6b" },
  { key: "education", label: "Education", icon: "🎓", color: "#4a6fa5" },
  { key: "works", label: "Works", icon: "🎨", color: "#b08968" },
] as const;

function buildBiography(name: string, rows: LifeRows): FamousBiography {
  const entries: FamousBiography["entries"] = [];
  for (const definition of ROW_DEFINITIONS) {
    rows[definition.key].forEach((item, index) => {
      entries.push({
        id: `${definition.key}-${index}`,
        rowId: `r-${definition.key}`,
        title: item.title,
        shortTitle: item.shortTitle,
        start: { ms: year(item.from), precision: "year" },
        end: { ms: year(item.to), precision: "year" },
      });
    });
  }
  return {
    groups: [{ id: "g", label: name, collapsed: false }],
    categories: ROW_DEFINITIONS.map((d) => ({ id: `c-${d.key}`, label: d.label, color: d.color, icon: d.icon })),
    rows: ROW_DEFINITIONS.map((d) => ({ id: `r-${d.key}`, groupId: "g", categoryId: `c-${d.key}`, label: d.label })),
    entries,
  };
}

export const mozart: FamousPerson = {
  id: "mozart",
  name: "W. A. Mozart",
  emoji: "🎼",
  birthMs: Date.UTC(1756, 0, 27),
  blurb: "Composer, 1756–1791",
  biography: buildBiography("W. A. Mozart", {
    places: [
      { title: "Salzburg", from: 1756, to: 1781 },
      { title: "Vienna", from: 1781, to: 1791 },
    ],
    education: [{ title: "Taught by his father Leopold", from: 1761, to: 1773, shortTitle: "Tutored by Leopold" }],
    works: [
      { title: "Grand tour of Europe as a child prodigy", from: 1762, to: 1766, shortTitle: "Grand tour" },
      { title: "Symphony No. 1", from: 1764, to: 1765 },
      { title: "The Marriage of Figaro", from: 1786, to: 1787, shortTitle: "Figaro" },
      { title: "Don Giovanni", from: 1787, to: 1788 },
      { title: "The Magic Flute", from: 1791, to: 1791 },
    ],
  }),
};

export const einstein: FamousPerson = {
  id: "einstein",
  name: "Albert Einstein",
  emoji: "🧠",
  birthMs: Date.UTC(1879, 2, 14),
  blurb: "Physicist, 1879–1955",
  biography: buildBiography("Albert Einstein", {
    places: [
      { title: "Ulm & Munich", from: 1879, to: 1895 },
      { title: "Zurich", from: 1896, to: 1902 },
      { title: "Bern", from: 1902, to: 1909 },
      { title: "Berlin", from: 1914, to: 1933 },
      { title: "Princeton", from: 1933, to: 1955 },
    ],
    education: [
      { title: "ETH Zurich", from: 1896, to: 1900 },
      { title: "PhD, University of Zurich", from: 1901, to: 1905, shortTitle: "PhD Zurich" },
    ],
    works: [
      { title: "Special relativity (Annus Mirabilis)", from: 1905, to: 1906, shortTitle: "Special relativity" },
      { title: "General theory of relativity", from: 1915, to: 1916, shortTitle: "General relativity" },
      { title: "Nobel Prize in Physics", from: 1921, to: 1922 },
    ],
  }),
};

export const frida: FamousPerson = {
  id: "frida-kahlo",
  name: "Frida Kahlo",
  emoji: "🎨",
  birthMs: Date.UTC(1907, 6, 6),
  blurb: "Painter, 1907–1954",
  biography: buildBiography("Frida Kahlo", {
    places: [
      { title: "Coyoacán, Mexico City", from: 1907, to: 1930, shortTitle: "Coyoacán" },
      { title: "United States", from: 1930, to: 1933 },
      { title: "Coyoacán, Mexico City", from: 1933, to: 1954, shortTitle: "Coyoacán" },
    ],
    education: [{ title: "National Preparatory School", from: 1922, to: 1925, shortTitle: "Prep School" }],
    works: [
      { title: "The Two Fridas", from: 1939, to: 1940 },
      { title: "The Broken Column", from: 1944, to: 1945 },
      { title: "First solo exhibition in Mexico", from: 1953, to: 1954, shortTitle: "Solo exhibition" },
    ],
  }),
};
