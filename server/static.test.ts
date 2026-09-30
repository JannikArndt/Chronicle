import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startTestServer } from "./testkit";
import type { TestServer } from "./testkit";

let server: TestServer;

beforeAll(async () => {
  const dist = mkdtempSync(join(tmpdir(), "chronicle-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<html><head><!--BUILD--></head><body>app</body></html>");
  writeFileSync(join(dist, "assets", "app-abc123.js"), "console.log('app');".repeat(100));
  server = await startTestServer({ staticDir: dist });
});
afterAll(async () => {
  await server.close();
});

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${server.url}${path}`, { headers });

describe("the static client", () => {
  test("index.html carries the build id and is never cached", async () => {
    const response = await get("/");
    expect(await response.text()).toContain('<meta name="app-build" content="test-build" />');
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  test("hashed assets are cached forever, and compressed when asked", async () => {
    const response = await get("/assets/app-abc123.js", { "accept-encoding": "gzip" });
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(await response.text()).toContain("console.log");
  });

  test("a route gets the app; a missing file is a 404, never HTML with a script's name", async () => {
    expect(await (await get("/some/route")).text()).toContain("app");
    expect((await get("/assets/app-old999.js")).status).toBe(404);
    expect((await get("/missing.js")).status).toBe(404);
  });

  test("nothing outside dist/ can be reached", async () => {
    const response = await get("/..%2f..%2f..%2fetc%2fpasswd");
    expect(await response.text()).not.toContain("root:");
  });
});

describe("behind the production proxy", () => {
  test("signing up over plain HTTP is refused; over HTTPS it works and the cookie is Secure", async () => {
    const proxied = await startTestServer({ trustProxy: true });
    try {
      const attempt = (proto: string) =>
        fetch(`${proxied.url}/api/auth/signup`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-chronicle": "1", "x-forwarded-proto": proto },
          body: JSON.stringify({ handle: `user${proto}`, password: "correct horse", name: "U" }),
        });
      expect((await attempt("http")).status).toBe(403);
      const secure = await attempt("https");
      expect(secure.status).toBe(201);
      expect(secure.headers.get("set-cookie")).toContain("Secure");
      expect(secure.headers.get("strict-transport-security")).toContain("max-age");
    } finally {
      await proxied.close();
    }
  });
});
