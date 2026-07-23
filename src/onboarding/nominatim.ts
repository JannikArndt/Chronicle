// OpenStreetMap Nominatim place search: no API key, no backend to hide one
// behind. Debouncing to stay under the 1 req/sec usage policy happens in
// PlaceAutocompleteInput, not here — this module is a thin, DI-friendly
// fetch wrapper so it's testable without mocking globals.

export interface PlaceSuggestion {
  title: string;
  subtitle?: string;
  fullName: string; // = display_name
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

export async function searchPlaces(query: string, fetchImpl: typeof fetch = fetch): Promise<PlaceSuggestion[]> {
  if (query.trim().length < 2) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&q=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return [];
  const results = (await response.json()) as NominatimResult[];
  return results.map((r) => {
    const { title, subtitle } = deriveTitleSubtitle(r);
    return { title, subtitle, fullName: r.display_name, lat: r.lat, lon: r.lon };
  });
}
