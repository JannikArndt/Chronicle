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

// The rows a Wikidata life maps onto. `key` also names the SPARQL ?type.
// `layout: "lanes"` means each item gets its own sub-row, so overlapping things
// (concurrent jobs, siblings growing up in parallel) are visible as separate
// lanes instead of bars stacked on top of each other.
const WIKIDATA_ROWS = [
  { key: "place", label: "Places lived", icon: "🏠", color: "#6b8e6b", layout: "flat" },
  { key: "education", label: "Education", icon: "🎓", color: "#4a6fa5", layout: "flat" },
  { key: "career", label: "Career", icon: "💼", color: "#8a6d3b", layout: "lanes" },
  { key: "partner", label: "Partners", icon: "❤️", color: "#c1424f", layout: "flat" },
  { key: "child", label: "Children", icon: "👶", color: "#d08c34", layout: "lanes" },
  { key: "work", label: "Works", icon: "🎨", color: "#b08968", layout: "flat" },
  { key: "award", label: "Awards", icon: "🏆", color: "#b8973a", layout: "flat" },
] as const;

type RowKey = (typeof WIKIDATA_ROWS)[number]["key"];

// Cap lane rows so a person with dozens of children/positions can't explode the
// rail; the debug view still shows everything that came back.
const MAX_LANES_PER_ROW = 14;

export function buildQuery(qid: string): string {
  // A statement with start/end date qualifiers (P580/P582): residence, job, marriage.
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
    UNION ${ranged("P26", "partner")}
    UNION ${ranged("P451", "partner")}
    UNION {
      wd:${qid} wdt:P40 ?item.
      OPTIONAL { ?item wdt:P569 ?startDate. } OPTIONAL { ?item wdt:P570 ?endDate. }
      BIND("child" AS ?type)
    }
    UNION {
      wd:${qid} p:P800 ?st. ?st ps:P800 ?item.
      OPTIONAL { ?item wdt:P577 ?pointDate. }
      BIND("work" AS ?type)
    }
    UNION {
      wd:${qid} p:P166 ?st. ?st ps:P166 ?item.
      OPTIONAL { ?st pq:P585 ?pointDate. }
      BIND("award" AS ?type)
    }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
  } LIMIT 400`;
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

  // First pass: reduce each binding to a dated item, deduped per type by label.
  interface Item {
    title: string;
    startMs: number;
    endMs: number;
  }
  const byType = new Map<RowKey, Item[]>();
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

    const dedupeKey = `${type}|${label}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    earliestStart = Math.min(earliestStart, start);

    const items = byType.get(type) ?? [];
    items.push({ title: label, startMs: start, endMs: end });
    byType.set(type, items);
  }

  // Second pass: turn items into rows. Flat rows hold their items as entries;
  // "lanes" rows become a parent header row with one sub-row per item, so
  // overlaps read as parallel lanes.
  const usedSpecs = WIKIDATA_ROWS.filter((spec) => byType.has(spec.key));
  if (usedSpecs.length === 0) {
    throw new Error(`No timeline data found on Wikidata for ${name}.`);
  }

  const categories: FamousBiography["categories"] = [];
  const rows: FamousBiography["rows"] = [];
  const entries: FamousBiography["entries"] = [];

  for (const spec of usedSpecs) {
    const items = byType.get(spec.key)!.sort((a, b) => a.startMs - b.startMs);
    const categoryId = `c-${spec.key}`;
    const parentRowId = `r-${spec.key}`;
    categories.push({ id: categoryId, label: spec.label, color: spec.color, icon: spec.icon });
    rows.push({ id: parentRowId, groupId: "g", categoryId, label: spec.label });

    if (spec.layout === "lanes") {
      items.slice(0, MAX_LANES_PER_ROW).forEach((item, index) => {
        const rowId = `${parentRowId}-${index}`;
        rows.push({ id: rowId, groupId: "g", categoryId, label: item.title, parentRowId });
        entries.push({
          id: `${spec.key}-${index}`,
          rowId,
          title: item.title,
          start: { ms: item.startMs, precision: "year" },
          end: { ms: item.endMs, precision: "year" },
        });
      });
    } else {
      items.forEach((item, index) => {
        entries.push({
          id: `${spec.key}-${index}`,
          rowId: parentRowId,
          title: item.title,
          start: { ms: item.startMs, precision: "year" },
          end: { ms: item.endMs, precision: "year" },
        });
      });
    }
  }

  const biography: FamousBiography = {
    groups: [{ id: "g", label: name, collapsed: false }],
    categories,
    rows,
    entries,
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
