import { describe, expect, test, vi } from "vitest";
import { deriveTitleSubtitle, searchPlaces } from "./nominatim";

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

  test("maps Nominatim results to a short title/subtitle/fullName PlaceSuggestion", async () => {
    const fetchImpl = mockFetch([
      {
        display_name: "123, Main Street, Springfield, Sangamon County, Illinois, 62704, United States",
        lat: "39.78",
        lon: "-89.65",
        address: {
          house_number: "123",
          road: "Main Street",
          city: "Springfield",
          state: "Illinois",
          country: "United States",
        },
      },
    ]);
    const result = await searchPlaces("Springfield", fetchImpl);
    expect(result).toEqual([
      {
        title: "123 Main Street",
        subtitle: "Springfield",
        fullName: "123, Main Street, Springfield, Sangamon County, Illinois, 62704, United States",
        lat: "39.78",
        lon: "-89.65",
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("nominatim.openstreetmap.org/search"),
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("addressdetails=1"),
      expect.anything(),
    );
  });

  test("returns an empty array when the request fails", async () => {
    const fetchImpl = mockFetch([], false);
    const result = await searchPlaces("Berlin", fetchImpl);
    expect(result).toEqual([]);
  });
});

describe("deriveTitleSubtitle", () => {
  test("uses street+number as title and city as subtitle when both are present and differ", () => {
    const result = deriveTitleSubtitle({
      display_name: "123, Main Street, Springfield, Illinois, United States",
      lat: "0",
      lon: "0",
      address: { house_number: "123", road: "Main Street", city: "Springfield" },
    });
    expect(result).toEqual({ title: "123 Main Street", subtitle: "Springfield" });
  });

  test("falls back to neighbourhood/suburb for streetLike when there's no house number or road", () => {
    const result = deriveTitleSubtitle({
      display_name: "Mitte, Berlin, Germany",
      lat: "0",
      lon: "0",
      address: { neighbourhood: "Mitte", city: "Berlin" },
    });
    expect(result).toEqual({ title: "Mitte", subtitle: "Berlin" });
  });

  test("uses just the city as title with state/country as subtitle when there's no street-level result", () => {
    const result = deriveTitleSubtitle({
      display_name: "Berlin, Germany",
      lat: "0",
      lon: "0",
      address: { city: "Berlin", country: "Germany" },
    });
    expect(result).toEqual({ title: "Berlin", subtitle: "Germany" });
  });

  test("falls back to the first display_name segment when there's no address block", () => {
    const result = deriveTitleSubtitle({
      display_name: "Somewhere Unstructured, Nowhere",
      lat: "0",
      lon: "0",
    });
    expect(result).toEqual({ title: "Somewhere Unstructured", subtitle: undefined });
  });

  test("does not duplicate the title as subtitle when streetLike equals cityLike", () => {
    const result = deriveTitleSubtitle({
      display_name: "Springfield, Illinois, United States",
      lat: "0",
      lon: "0",
      address: { neighbourhood: "Springfield", city: "Springfield", state: "Illinois" },
    });
    expect(result).toEqual({ title: "Springfield", subtitle: "Illinois" });
  });
});
