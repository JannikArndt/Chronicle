// OpenStreetMap Nominatim place search: no API key, no backend to hide one
// behind. Debouncing to stay under the 1 req/sec usage policy happens in
// PlaceAutocompleteInput, not here — this module is a thin, DI-friendly
// fetch wrapper so it's testable without mocking globals.

export interface PlaceSuggestion {
  title: string;
  subtitle?: string;
  fullName: string; // = display_name
  street?: string;
  city?: string;
  country?: string;
  lat: string;
  lon: string;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
}

// Derives a short human title (and optional secondary subtitle) from
// Nominatim's structured address block: street+number+city when there's a
// meaningful street-level result, otherwise just the city, otherwise the
// first comma-segment of the full display name.
export function deriveTitleSubtitle(result: NominatimResult): { title: string; subtitle?: string } {
  const address = result.address;
  const cityLike = address?.city ?? address?.town ?? address?.village ?? address?.municipality;
  const streetLike =
    [address?.house_number, address?.road].filter(Boolean).join(" ") || address?.neighbourhood || address?.suburb;

  if (streetLike && cityLike && streetLike !== cityLike) {
    return { title: streetLike, subtitle: cityLike };
  }
  if (cityLike) {
    return { title: cityLike, subtitle: address?.state ?? address?.country };
  }
  return { title: result.display_name.split(",")[0].trim(), subtitle: undefined };
}

// Derives the structured street/city/country components (distinct from the
// short display title/subtitle above) from the same address block, for
// storing on Entity.place so callers who want more than a display string
// (e.g. a future map view) have it without re-parsing fullName.
export function deriveAddressComponents(result: NominatimResult): { street?: string; city?: string; country?: string } {
  const address = result.address;
  const street = [address?.house_number, address?.road].filter(Boolean).join(" ") || undefined;
  const city = address?.city ?? address?.town ?? address?.village ?? address?.municipality;
  const country = address?.country;
  return { street, city, country };
}

// Composes the visible "title, subtitle" text for a suggestion — e.g.
// "Hauptstraße 12, Berlin" rather than just "Hauptstraße 12" — so selecting a
// street-level result doesn't drop the city context from what's shown.
export function formatSuggestionText(suggestion: PlaceSuggestion): string {
  return suggestion.subtitle ? `${suggestion.title}, ${suggestion.subtitle}` : suggestion.title;
}

export async function searchPlaces(query: string, fetchImpl: typeof fetch = fetch): Promise<PlaceSuggestion[]> {
  if (query.trim().length < 2) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&q=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return [];
  const results = (await response.json()) as NominatimResult[];
  const suggestions = results.map((r) => {
    const { title, subtitle } = deriveTitleSubtitle(r);
    const { street, city, country } = deriveAddressComponents(r);
    return { title, subtitle, fullName: r.display_name, street, city, country, lat: r.lat, lon: r.lon };
  });
  return dedupeSuggestions(suggestions);
}

// Nominatim can return near-duplicate results (same address, different
// internal ids) — collapse anything with identical title/subtitle/fullName,
// keeping the first occurrence.
function dedupeSuggestions(suggestions: PlaceSuggestion[]): PlaceSuggestion[] {
  const seenKeys = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = `${suggestion.title}|${suggestion.subtitle ?? ""}|${suggestion.fullName}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
}
