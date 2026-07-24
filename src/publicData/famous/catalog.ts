// The famous-people catalog shown in the rail's "+ Famous people" picker.
// A spike seed of three lives; the real version would grow this (or pull from
// Wikidata — see plans/famous-people-spike.md).

import { einstein, frida, mozart } from "./lives";
import type { FamousPerson } from "./types";

export const famousCatalog: FamousPerson[] = [mozart, einstein, frida];

export function findFamousPerson(id: string): FamousPerson | undefined {
  return famousCatalog.find((person) => person.id === id);
}
