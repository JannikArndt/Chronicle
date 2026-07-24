// Dynamic famous-people loading from Wikidata — no backend, no API key. Both
// endpoints are CORS-open to browsers:
//   - search:  wbsearchentities (the MediaWiki action API, origin=*)
//   - details: the WDQS SPARQL endpoint (query.wikidata.org)
//
// A person's biography is assembled from a single SPARQL query covering
// residences (P551), education (P69), positions/employers (P39/P108) and
// notable works (P800), plus birth (P569) and death (P570). Every entry gets an
// explicit end date — an open end renders as an ongoing arrow, which is wrong
// for a historical life (see the "generally include an end date" requirement).

import type { FamousBiography, FamousPerson } from "./types";

export interface WikidataSearchResult {
  id: string; // Q-number, e.g. "Q254"
  label: string;
  description?: string;
}

// A search hit annotated with what kind of thing it is, so the picker can keep
// only people (P31 = human, Q5) and the debug view can show what got filtered
// out and why.
export interface WikidataCandidate extends WikidataSearchResult {
  isHuman: boolean;
  instanceOfIds: string[]; // P31 values, e.g. ["Q5"] for a human, ["Q515"] for a city
}

const HUMAN_QID = "Q5";
const SEARCH_ENDPOINT = "https://www.wikidata.org/w/api.php";
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

// wbsearchentities can't filter by type, so we search, then fetch P31 (instance
// of) for every hit in one wbgetentities call and mark which ones are people.
// Both calls are on the CORS-open action API (origin=*), no WDQS UA policy.
export async function searchWikidataCandidates(query: string): Promise<WikidataCandidate[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const searchUrl =
    `${SEARCH_ENDPOINT}?action=wbsearchentities&type=item&limit=8&language=en&uselang=en&format=json&origin=*` +
    `&search=${encodeURIComponent(trimmed)}`;
  const searchResponse = await fetch(searchUrl);
  if (!searchResponse.ok) throw new Error(`Wikidata search failed (${searchResponse.status})`);
  const searchData = (await searchResponse.json()) as {
    search?: { id: string; label?: string; description?: string }[];
  };
  const hits = (searchData.search ?? []).map((hit) => ({
    id: hit.id,
    label: hit.label ?? hit.id,
    description: hit.description,
  }));
  if (hits.length === 0) return [];

  const ids = hits.map((hit) => hit.id).join("|");
  const claimsUrl = `${SEARCH_ENDPOINT}?action=wbgetentities&ids=${ids}&props=claims&format=json&origin=*`;
  const claimsResponse = await fetch(claimsUrl);
  const entities = claimsResponse.ok
    ? ((await claimsResponse.json()) as { entities?: Record<string, { claims?: Record<string, unknown[]> }> }).entities
    : undefined;

  return hits.map((hit) => {
    const claims = entities?.[hit.id]?.claims ?? {};
    const instanceOfIds = (claims.P31 ?? [])
      .map((claim) => (claim as { mainsnak?: { datavalue?: { value?: { id?: string } } } }).mainsnak?.datavalue?.value?.id)
      .filter((id): id is string => Boolean(id));
    return { ...hit, instanceOfIds, isHuman: instanceOfIds.includes(HUMAN_QID) };
  });
}

// People-only search for the picker's happy path.
export async function searchWikidataPeople(query: string): Promise<WikidataSearchResult[]> {
  return (await searchWikidataCandidates(query)).filter((candidate) => candidate.isHuman);
}

// The four rows a Wikidata life maps onto. `key` also names the SPARQL ?type.
const WIKIDATA_ROWS = [
  { key: "place", label: "Places lived", icon: "🏠", color: "#6b8e6b" },
  { key: "education", label: "Education", icon: "🎓", color: "#4a6fa5" },
  { key: "career", label: "Career", icon: "💼", color: "#8a6d3b" },
  { key: "work", label: "Works", icon: "🎨", color: "#b08968" },
] as const;

type RowKey = (typeof WIKIDATA_ROWS)[number]["key"];

function buildQuery(qid: string): string {
  const ranged = (property: string, type: RowKey) => `{
    wd:${qid} p:${property} ?st. ?st ps:${property} ?item.
    OPTIONAL { ?st pq:P580 ?startDate. } OPTIONAL { ?st pq:P582 ?endDate. }
    BIND("${type}" AS ?type)
  }`;
  return `SELECT ?type ?itemLabel ?startDate ?endDate ?pointDate ?birth ?death WHERE {
    OPTIONAL { wd:${qid} wdt:P569 ?birth. }
    OPTIONAL { wd:${qid} wdt:P570 ?death. }
    { BIND("meta" AS ?type) }
    UNION ${ranged("P551", "place")}
    UNION ${ranged("P69", "education")}
    UNION ${ranged("P39", "career")}
    UNION ${ranged("P108", "career")}
    UNION {
      wd:${qid} p:P800 ?st. ?st ps:P800 ?item.
      OPTIONAL { ?item wdt:P577 ?pointDate. }
      BIND("work" AS ?type)
    }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
  } LIMIT 300`;
}

export interface SparqlBinding {
  type: { value: string };
  itemLabel?: { value: string };
  startDate?: { value: string };
  endDate?: { value: string };
  pointDate?: { value: string };
  birth?: { value: string };
  death?: { value: string };
}

async function runSparql(qid: string): Promise<SparqlBinding[]> {
  const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(buildQuery(qid))}`;
  const response = await fetch(url, { headers: { Accept: "application/sparql-results+json" } });
  if (!response.ok) throw new Error(`Wikidata query failed (${response.status})`);
  const data = (await response.json()) as { results?: { bindings?: SparqlBinding[] } };
  return data.results?.bindings ?? [];
}

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

// Assemble a FamousPerson from raw SPARQL bindings. Exported for unit testing
// with fixture bindings, so the mapping is verified without a network call.
export function bindingsToPerson(
  qid: string,
  name: string,
  description: string | undefined,
  bindings: SparqlBinding[],
): FamousPerson {
  const ms = (binding?: { value: string }): number | undefined => {
    if (!binding) return undefined;
    const parsed = Date.parse(binding.value);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const birthMs = ms(bindings.find((b) => b.birth)?.birth);
  const deathMs = ms(bindings.find((b) => b.death)?.death);
  const fallbackEnd = deathMs ?? Date.now();

  // Group entries by row, deduping identical items and dropping undated ones.
  const byRow = new Map<RowKey, FamousBiography["entries"]>();
  const seen = new Set<string>();
  let earliestStart = Number.POSITIVE_INFINITY;

  for (const binding of bindings) {
    const type = binding.type.value as RowKey | "meta";
    if (type === "meta") continue;
    const label = binding.itemLabel?.value;
    if (!label) continue;

    const start = ms(binding.startDate) ?? ms(binding.pointDate) ?? ms(binding.endDate);
    if (start === undefined) continue;

    const isPoint = binding.startDate === undefined && binding.pointDate !== undefined;
    let end = ms(binding.endDate) ?? (isPoint ? start + YEAR_MS : fallbackEnd);
    if (end <= start) end = start + YEAR_MS;

    const dedupeKey = `${type}|${label}|${start}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    earliestStart = Math.min(earliestStart, start);

    const rowEntries = byRow.get(type) ?? [];
    rowEntries.push({
      id: `${type}-${rowEntries.length}`,
      rowId: `r-${type}`,
      title: label,
      start: { ms: start, precision: "year" },
      end: { ms: end, precision: "year" },
    });
    byRow.set(type, rowEntries);
  }

  const usedRows = WIKIDATA_ROWS.filter((row) => byRow.has(row.key));
  if (usedRows.length === 0) {
    throw new Error(`No timeline data found on Wikidata for ${name}.`);
  }

  const biography: FamousBiography = {
    groups: [{ id: "g", label: name, collapsed: false }],
    categories: usedRows.map((r) => ({ id: `c-${r.key}`, label: r.label, color: r.color, icon: r.icon })),
    rows: usedRows.map((r) => ({ id: `r-${r.key}`, groupId: "g", categoryId: `c-${r.key}`, label: r.label })),
    entries: usedRows.flatMap((r) => byRow.get(r.key)!),
  };

  return {
    id: qid,
    name,
    emoji: "⭐",
    // Alignment needs a real birth; if Wikidata has none, anchor on the first
    // dated event so "at my age" still does something sensible.
    birthMs: birthMs ?? (earliestStart === Number.POSITIVE_INFINITY ? Date.now() : earliestStart),
    blurb: description ?? "From Wikidata",
    biography,
  };
}

export interface WikidataFetchResult {
  person: FamousPerson;
  bindings: SparqlBinding[]; // the raw SPARQL rows, kept for the debug view
}

export async function fetchWikidataBiography(result: WikidataSearchResult): Promise<WikidataFetchResult> {
  const bindings = await runSparql(result.id);
  const person = bindingsToPerson(result.id, result.label, result.description, bindings);
  return { person, bindings };
}
