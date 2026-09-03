import { describe, expect, test } from "vitest";
import { faviconUrl, nameIcon } from "./favicon";

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

describe("nameIcon", () => {
  test("prefers the favicon over the emoji", () => {
    expect(nameIcon({ icon: "💼", website: "acme.com" }, 16)).toEqual({
      kind: "favicon",
      url: "https://www.google.com/s2/favicons?domain=acme.com&sz=16",
    });
  });

  test("falls back to the emoji when there is no site", () => {
    expect(nameIcon({ icon: "💼" }, 16)).toEqual({ kind: "emoji", emoji: "💼" });
  });

  test("falls back to the emoji when the site is unparseable", () => {
    expect(nameIcon({ icon: "💼", website: "not a url at all !!" }, 16)).toEqual({
      kind: "emoji",
      emoji: "💼",
    });
  });

  test("is undefined when there is neither", () => {
    expect(nameIcon({}, 16)).toBeUndefined();
    expect(nameIcon({ icon: "  " }, 16)).toBeUndefined();
  });
});
