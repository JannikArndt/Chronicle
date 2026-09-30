// Entry point of the Chronicle server: read the environment, open the
// database, listen. Everything else lives in `app.ts` so the tests can build
// the same application without a port or a disk.
//
// Environment:
//   PORT         default 80 (CapRover's default container HTTP port)
//   DATA_DIR     default /data — must be a persistent volume in production
//   STATIC_DIR   default <this file>/../dist
//   TRUST_PROXY  default true — CapRover's nginx sets X-Forwarded-*

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";

const here = dirname(fileURLToPath(import.meta.url));

function readBuildId(): string {
  const file = join(here, "BUILD_ID");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "dev";
}

const port = Number(process.env.PORT ?? 80);
const staticDir = process.env.STATIC_DIR ?? join(here, "..", "dist");

const app = createApp({
  staticDir: existsSync(staticDir) ? staticDir : undefined,
  buildId: readBuildId(),
  version: process.env.npm_package_version ?? "2.0.0",
  trustProxy: process.env.TRUST_PROXY !== "false",
});

const server = createServer((req, res) => app.handle(req, res));
server.listen(port, () => {
  console.log(`chronicle listening on :${port}`);
});

// CapRover stops the old container with SIGTERM on every deploy. Closing
// cleanly lets open event streams end (clients reconnect to the new
// container) and the database checkpoint its write-ahead log.
function shutdown(): void {
  console.log("shutting down");
  app.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
