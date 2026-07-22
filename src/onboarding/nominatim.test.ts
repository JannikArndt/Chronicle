import { describe, expect, test, vi } from "vitest";
import { searchPlaces } from "./nominatim";

function mockFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }) as unknown as typeof fetch;
}

describe("searchPlaces", () => {
  test("returns an empty array for very short queries without calling fetch", async () => {
    const fetchImpl = mockFetch([]);
    const result = await searchPlaces("a", fetchImpl);
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("maps Nominatim results to PlaceSuggestion", async () => {
    const fetchImpl = mockFetch([{ display_name: "Berlin, Germany", lat: "52.52", lon: "13.40" }]);
    const result = await searchPlaces("Berlin", fetchImpl);
    expect(result).toEqual([{ label: "Berlin, Germany", lat: "52.52", lon: "13.40" }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("nominatim.openstreetmap.org/search"),
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
  });

  test("returns an empty array when the request fails", async () => {
    const fetchImpl = mockFetch([], false);
    const result = await searchPlaces("Berlin", fetchImpl);
    expect(result).toEqual([]);
  });
});
