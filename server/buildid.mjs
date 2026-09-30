// One hash over every file that actually ships, so `/version` can tell a
// browser (or the deploy workflow) "this is what's really running" — not the
// git SHA, which changes on commits that touch nothing a browser downloads,
// and not a hand-bumped version number, which someone forgets.
//
// SERVED lists every file and directory a client can fetch, or that changes
// what the server does when it answers a request. Tests and docs are skipped:
// a change there must not make every open tab reload.
//
// Usage:
//   node server/buildid.mjs            -> prints the hash, nothing else
//   import { buildId } from "./buildid.mjs"
//
// The Docker build writes the result to dist-server/BUILD_ID (the runtime
// image carries no sources to hash), and deploy.yml runs this same script on
// the pushed commit and polls /version until the two agree.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const SERVED = [
  "package.json",
  "package-lock.json",
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "Dockerfile",
  "src",
  "server",
  "scripts/build-server.mjs",
  "public-data",
];

function skipped(path) {
  return path.endsWith(".test.ts") || path.endsWith(".md");
}

function walk(path) {
  const stat = statSync(path);
  if (stat.isFile()) return skipped(path) ? [] : [path];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

export function buildId() {
  const hash = createHash("sha256");
  const files = SERVED.flatMap((p) => walk(join(ROOT, p)))
    .map((file) => relative(ROOT, file).split(sep).join("/"))
    .sort();
  for (const file of files) {
    hash.update(file);
    hash.update(readFileSync(join(ROOT, file)));
  }
  return hash.digest("hex").slice(0, 12);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(buildId());
}
