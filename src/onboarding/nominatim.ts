// OpenStreetMap Nominatim place search: no API key, no backend to hide one
// behind. Debouncing to stay under the 1 req/sec usage policy happens in
// PlaceAutocompleteInput, not here — this module is a thin, DI-friendly
// fetch wrapper so it's testable without mocking globals.

export interface PlaceSuggestion {
  label: string;
  lat: string;
  lon: string;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

export async function searchPlaces(query: string, fetchImpl: typeof fetch = fetch): Promise<PlaceSuggestion[]> {
  if (query.trim().length < 2) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return [];
  const results = (await response.json()) as NominatimResult[];
  return results.map((r) => ({ label: r.display_name, lat: r.lat, lon: r.lon }));
}
