// Serves the built client from dist/.
//
// Three caching rules, and they are the whole of the update story on the
// server side: hashed files under /assets/ never change, so they are cached
// forever; index.html is never cached, so a reload always sees the newest
// build; and index.html carries that build's id in a <meta> tag, so an open
// tab can compare itself to /version without guessing (src/ui/fresh.ts).

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { gzipSync } from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".webmanifest"]);

// Where the page is allowed to reach: itself, the favicon service, and the
// two lookups the add-flows make (place names, famous people). Anything else
// a shared record could smuggle in — a script, a frame, a beacon — is refused
// by the browser.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://www.google.com https://*.gstatic.com",
  "connect-src 'self' https://nominatim.openstreetmap.org https://www.wikidata.org https://query.wikidata.org",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

interface CachedFile {
  raw: Buffer;
  gzip?: Buffer;
  type: string;
  cacheControl: string;
}

export interface StaticSite {
  // True if the request was answered.
  serve(req: IncomingMessage, res: ServerResponse, pathname: string): boolean;
}

export function createStaticSite(distDir: string | undefined, buildId: string): StaticSite {
  const root = distDir === undefined ? undefined : normalize(distDir);
  const cache = new Map<string, CachedFile>();

  const load = (relativePath: string): CachedFile | undefined => {
    if (root === undefined) return undefined;
    const cached = cache.get(relativePath);
    if (cached !== undefined) return cached;
    const absolute = normalize(join(root, relativePath));
    // Path traversal: whatever the URL said, the file must be inside dist/.
    if (absolute !== root && !absolute.startsWith(root.endsWith(sep) ? root : root + sep)) return undefined;
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return undefined;

    const extension = extname(absolute);
    let raw = readFileSync(absolute);
    const isIndex = relativePath === "index.html";
    if (isIndex) {
      raw = Buffer.from(
        raw.toString("utf8").replace("<!--BUILD-->", `<meta name="app-build" content="${buildId}" />`),
      );
    }
    const file: CachedFile = {
      raw,
      gzip: COMPRESSIBLE.has(extension) && raw.length > 1024 ? gzipSync(raw) : undefined,
      type: CONTENT_TYPES[extension] ?? "application/octet-stream",
      cacheControl: isIndex
        ? "no-cache"
        : relativePath.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600",
    };
    cache.set(relativePath, file);
    return file;
  };

  const send = (req: IncomingMessage, res: ServerResponse, file: CachedFile): void => {
    const headers: Record<string, string | number> = {
      ...SECURITY_HEADERS,
      "content-type": file.type,
      "cache-control": file.cacheControl,
    };
    if (file.type.startsWith("text/html")) headers["content-security-policy"] = CONTENT_SECURITY_POLICY;
    const gzip = file.gzip !== undefined && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
    const body = gzip ? file.gzip! : file.raw;
    if (file.gzip !== undefined) headers.vary = "accept-encoding";
    if (gzip) headers["content-encoding"] = "gzip";
    headers["content-length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  };

  return {
    serve(req, res, pathname) {
      if (req.method !== "GET" && req.method !== "HEAD") return false;
      let relativePath: string;
      try {
        relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
      } catch {
        return false;
      }
      const file = relativePath === "" ? load("index.html") : load(relativePath);
      if (file !== undefined) {
        send(req, res, file);
        return true;
      }
      // A missing hashed asset is a real 404 (a stale tab asking for last
      // build's chunk); anything else is a client-side route and gets the app.
      if (relativePath.startsWith("assets/")) return false;
      const index = load("index.html");
      if (index === undefined) return false;
      send(req, res, index);
      return true;
    },
  };
}
