// Hand-authored biographies for the famous-people spike. Dates are deliberately
// coarse (mostly year precision) — biographies aren't day-accurate and the fuzz
// ramp reads better than false exactness. `year(y)` is a UTC Jan 1 instant.

import type { FamousPerson } from "./types";

function year(y: number): number {
  return Date.UTC(y, 0, 1);
}

export const mozart: FamousPerson = {
  id: "mozart",
  name: "W. A. Mozart",
  emoji: "🎼",
  birthMs: Date.UTC(1756, 0, 27),
  blurb: "Composer, 1756–1791",
  biography: {
    groups: [{ id: "g", label: "W. A. Mozart", collapsed: false }],
    categories: [{ id: "c", label: "Mozart", color: "#b08968", icon: "🎼" }],
    rows: [{ id: "r", groupId: "g", categoryId: "c", label: "Life & works" }],
    entries: [
      { id: "e1", rowId: "r", title: "Born in Salzburg", start: { ms: Date.UTC(1756, 0, 27), precision: "day" }, end: { ms: year(1762), precision: "year" } },
      { id: "e2", rowId: "r", title: "Child-prodigy grand tour of Europe", subtitle: "Munich, Vienna, Paris, London", start: { ms: year(1762), precision: "year" }, end: { ms: year(1766), precision: "year" } },
      { id: "e3", rowId: "r", title: "First symphony", shortTitle: "Symphony No. 1", start: { ms: year(1764), precision: "year" } },
      { id: "e4", rowId: "r", title: "Court musician, Salzburg", start: { ms: year(1773), precision: "year" }, end: { ms: year(1781), precision: "year" } },
      { id: "e5", rowId: "r", title: "Moved to Vienna as a freelance composer", start: { ms: year(1781), precision: "year" } },
      { id: "e6", rowId: "r", title: "Married Constanze Weber", start: { ms: year(1782), precision: "year" } },
      { id: "e7", rowId: "r", title: "The Marriage of Figaro", shortTitle: "Figaro", start: { ms: year(1786), precision: "year" } },
      { id: "e8", rowId: "r", title: "Don Giovanni", start: { ms: year(1787), precision: "year" } },
      { id: "e9", rowId: "r", title: "The Magic Flute", start: { ms: year(1791), precision: "year" } },
      { id: "e10", rowId: "r", title: "Died in Vienna, aged 35", start: { ms: Date.UTC(1791, 11, 5), precision: "day" } },
    ],
  },
};

export const einstein: FamousPerson = {
  id: "einstein",
  name: "Albert Einstein",
  emoji: "🧠",
  birthMs: Date.UTC(1879, 2, 14),
  blurb: "Physicist, 1879–1955",
  biography: {
    groups: [{ id: "g", label: "Albert Einstein", collapsed: false }],
    categories: [{ id: "c", label: "Einstein", color: "#4a6fa5", icon: "🧠" }],
    rows: [{ id: "r", groupId: "g", categoryId: "c", label: "Life & work" }],
    entries: [
      { id: "e1", rowId: "r", title: "Born in Ulm", start: { ms: Date.UTC(1879, 2, 14), precision: "day" } },
      { id: "e2", rowId: "r", title: "Patent clerk, Bern", start: { ms: year(1902), precision: "year" }, end: { ms: year(1909), precision: "year" } },
      { id: "e3", rowId: "r", title: "Annus Mirabilis — special relativity, E=mc²", shortTitle: "Annus Mirabilis", start: { ms: year(1905), precision: "year" } },
      { id: "e4", rowId: "r", title: "General theory of relativity", shortTitle: "General relativity", start: { ms: year(1915), precision: "year" } },
      { id: "e5", rowId: "r", title: "Nobel Prize in Physics", start: { ms: year(1921), precision: "year" } },
      { id: "e6", rowId: "r", title: "Emigrated to the US — Princeton", start: { ms: year(1933), precision: "year" }, end: { ms: year(1955), precision: "year" } },
      { id: "e7", rowId: "r", title: "Letter to Roosevelt", start: { ms: year(1939), precision: "year" } },
      { id: "e8", rowId: "r", title: "Died in Princeton, aged 76", start: { ms: Date.UTC(1955, 3, 18), precision: "day" } },
    ],
  },
};

export const frida: FamousPerson = {
  id: "frida-kahlo",
  name: "Frida Kahlo",
  emoji: "🎨",
  birthMs: Date.UTC(1907, 6, 6),
  blurb: "Painter, 1907–1954",
  biography: {
    groups: [{ id: "g", label: "Frida Kahlo", collapsed: false }],
    categories: [{ id: "c", label: "Frida Kahlo", color: "#c1424f", icon: "🎨" }],
    rows: [{ id: "r", groupId: "g", categoryId: "c", label: "Life & art" }],
    entries: [
      { id: "e1", rowId: "r", title: "Born in Coyoacán, Mexico City", start: { ms: Date.UTC(1907, 6, 6), precision: "day" } },
      { id: "e2", rowId: "r", title: "Streetcar accident — began painting while recovering", shortTitle: "Accident", start: { ms: year(1925), precision: "year" } },
      { id: "e3", rowId: "r", title: "Married Diego Rivera", start: { ms: year(1929), precision: "year" } },
      { id: "e4", rowId: "r", title: "Years in the United States", start: { ms: year(1930), precision: "year" }, end: { ms: year(1933), precision: "year" } },
      { id: "e5", rowId: "r", title: "The Two Fridas", start: { ms: year(1939), precision: "year" } },
      { id: "e6", rowId: "r", title: "First solo exhibition in Mexico", start: { ms: year(1953), precision: "year" } },
      { id: "e7", rowId: "r", title: "Died in Coyoacán, aged 47", start: { ms: Date.UTC(1954, 6, 13), precision: "day" } },
    ],
  },
};
