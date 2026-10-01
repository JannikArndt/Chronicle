// Which schools "School and after" offers, picked from where you lived as a
// child: Grundschule in Germany, Primary school in the UK, Elementary school
// in the US. The country comes from the place picked in the search (Nominatim
// fills it in), else from any place lived, else from the browser's language;
// nothing found means a neutral set. Only the chips change — every name can
// still be edited, and nothing is stored about the choice.

import type { AddChip } from "./lifeTopics";
import type { Sequence } from "./sequence";

export type SchoolSystem = "de" | "at" | "ch" | "us" | "uk" | "generic";
type CountrySystem = Exclude<SchoolSystem, "generic">;

const COUNTRIES: Record<CountrySystem, { names: string[]; label: string }> = {
  de: { names: ["germany", "deutschland"], label: "Germany" },
  at: { names: ["austria", "österreich"], label: "Austria" },
  ch: { names: ["switzerland", "schweiz", "suisse", "svizzera", "svizra"], label: "Switzerland" },
  us: { names: ["united states", "united states of america", "usa", "us"], label: "the US" },
  uk: { names: ["united kingdom", "uk", "england", "scotland", "wales", "northern ireland"], label: "the UK" },
};

export function systemForCountry(country: string | undefined): CountrySystem | undefined {
  if (!country) return undefined;
  const name = country.trim().toLowerCase();
  const found = (Object.keys(COUNTRIES) as CountrySystem[]).find((key) => COUNTRIES[key].names.includes(name));
  return found;
}

export function systemForLanguage(language: string | undefined): CountrySystem | undefined {
  if (!language) return undefined;
  const [lang, region] = language.toLowerCase().split("-");
  if (lang === "de") return region === "at" ? "at" : region === "ch" ? "ch" : "de";
  if (lang === "en" && region === "us") return "us";
  if (lang === "en" && region === "gb") return "uk";
  return undefined;
}

export interface SchoolChoice {
  system: SchoolSystem;
  // Why, in a few words — shown under the chips ("where you lived at 6").
  reason: string | null;
}

// Where you lived at 6, else anywhere you lived, else your language.
export function chooseSchoolSystem(places: Sequence | null, language: string | undefined): SchoolChoice {
  const items = places?.items.filter((item) => !item.gap) ?? [];
  const at6 = [...items].reverse().find((item) => item.at <= 6);
  const atSix = systemForCountry(at6?.place?.details?.country);
  if (atSix) return { system: atSix, reason: `Schools as in ${COUNTRIES[atSix].label}, where you lived at 6.` };
  for (const item of items) {
    const system = systemForCountry(item.place?.details?.country);
    if (system) return { system, reason: `Schools as in ${COUNTRIES[system].label}, where you lived.` };
  }
  const byLanguage = systemForLanguage(language);
  if (byLanguage) return { system: byLanguage, reason: `Schools as in ${COUNTRIES[byLanguage].label}.` };
  return { system: "generic", reason: null };
}

const AFTER_SCHOOL: AddChip[] = [
  { icon: "🌍", text: "Year abroad", label: "Year abroad", length: 1 },
  { icon: "⏸", text: "Gap", label: "", length: 3, gap: true },
];

const UNIVERSITY: AddChip[] = [
  { icon: "🎓", text: "Bachelor", label: "Bachelor", length: 3 },
  { icon: "🎓", text: "Master", label: "Master", length: 2 },
  { icon: "📜", text: "PhD", label: "PhD", length: 4 },
];

const SCHOOLS: Record<SchoolSystem, AddChip[]> = {
  de: [
    { icon: "🏫", text: "Grundschule", label: "Grundschule", length: 4, start: 6 },
    { icon: "🏫", text: "Gymnasium", label: "Gymnasium", length: 9, start: 10 },
    { icon: "🏫", text: "Realschule", label: "Realschule", length: 6, start: 10 },
    { icon: "🏫", text: "Hauptschule", label: "Hauptschule", length: 5, start: 10 },
    { icon: "🛠", text: "Ausbildung", label: "Ausbildung", length: 3, start: 16 },
  ],
  at: [
    { icon: "🏫", text: "Volksschule", label: "Volksschule", length: 4, start: 6 },
    { icon: "🏫", text: "Gymnasium", label: "Gymnasium", length: 8, start: 10 },
    { icon: "🏫", text: "Mittelschule", label: "Mittelschule", length: 4, start: 10 },
    { icon: "🛠", text: "Lehre", label: "Lehre", length: 3, start: 15 },
  ],
  ch: [
    { icon: "🏫", text: "Primarschule", label: "Primarschule", length: 6, start: 6 },
    { icon: "🏫", text: "Sekundarschule", label: "Sekundarschule", length: 3, start: 12 },
    { icon: "🏫", text: "Gymnasium", label: "Gymnasium", length: 4, start: 15 },
    { icon: "🛠", text: "Lehre", label: "Lehre", length: 3, start: 15 },
  ],
  us: [
    { icon: "🏫", text: "Elementary school", label: "Elementary school", length: 6, start: 5 },
    { icon: "🏫", text: "Middle school", label: "Middle school", length: 3, start: 11 },
    { icon: "🏫", text: "High school", label: "High school", length: 4, start: 14 },
  ],
  uk: [
    { icon: "🏫", text: "Primary school", label: "Primary school", length: 6, start: 5 },
    { icon: "🏫", text: "Secondary school", label: "Secondary school", length: 5, start: 11 },
    { icon: "🏫", text: "Sixth form", label: "Sixth form", length: 2, start: 16 },
  ],
  generic: [
    { icon: "🏫", text: "Primary school", label: "Primary school", length: 6, start: 6 },
    { icon: "🏫", text: "Secondary school", label: "Secondary school", length: 6, start: 12 },
    { icon: "🛠", text: "Apprenticeship", label: "Apprenticeship", length: 3, start: 16 },
  ],
};

export function educationChips(system: SchoolSystem): AddChip[] {
  return [...SCHOOLS[system], ...UNIVERSITY, ...AFTER_SCHOOL];
}
