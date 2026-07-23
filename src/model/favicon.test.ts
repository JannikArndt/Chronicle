import { describe, expect, test } from "vitest";
import { faviconUrl } from "./favicon";

describe("faviconUrl", () => {
  test("adds https:// to a bare domain", () => {
    expect(faviconUrl("example.com", 16)).toBe(
      "https://www.google.com/s2/favicons?domain=example.com&sz=16",
    );
  });

  test("extracts the hostname from a full URL with a path", () => {
    expect(faviconUrl("https://example.com/some/page?x=1", 32)).toBe(
      "https://www.google.com/s2/favicons?domain=example.com&sz=32",
    );
  });

  test("returns undefined for a malformed value", () => {
    expect(faviconUrl("not a url at all !!", 16)).toBeUndefined();
  });

  test("returns undefined for an empty string", () => {
    expect(faviconUrl("", 16)).toBeUndefined();
  });
});
