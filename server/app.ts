// The HTTP application: routing, the API, and the static client — everything
// except opening a port, which `main.ts` does. Tests build one of these on an
// in-memory database and listen on port 0.

import { HttpError, Router, sendError, sendJson } from "./http";
import { createStaticSite, SECURITY_HEADERS } from "./static";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface AppConfig {
  // The built client (dist/). Undefined in tests and in `npm run dev`, where
  // Vite serves the client and proxies /api here.
  staticDir?: string;
  buildId: string;
  version: string;
  // Honour X-Forwarded-Proto/-For. True behind CapRover's nginx.
  trustProxy: boolean;
}

export interface App {
  handle(req: IncomingMessage, res: ServerResponse): void;
  close(): void;
}

const STARTED_AT = new Date().toISOString();

export function createApp(config: AppConfig): App {
  const router = new Router();
  const site = createStaticSite(config.staticDir, config.buildId);

  // `build` says the code changed; `schema` says a stored shape changed too.
  router.on("GET", "/version", ({ req, res }) => {
    sendJson(req, res, 200, {
      version: config.version,
      schema: 1,
      build: config.buildId,
      startedAt: STARTED_AT,
    });
  });
  router.on("GET", "/healthz", ({ req, res }) => sendJson(req, res, 200, { ok: true }));

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

    const matched = router.match(req.method ?? "GET", pathname);
    if (matched === "wrong-method") {
      sendError(req, res, 405, "Method not allowed.");
      return;
    }
    if (matched !== null) {
      Promise.resolve(matched.handler({ req, res, url, params: matched.params })).catch((error: unknown) => {
        if (error instanceof HttpError) {
          sendError(req, res, error.status, error.message);
          return;
        }
        console.error(`${req.method} ${pathname} failed:`, error);
        sendError(req, res, 500, "Something went wrong on the server.");
      });
      return;
    }
    if (pathname.startsWith("/api/")) {
      sendError(req, res, 404, "No such endpoint.");
      return;
    }
    if (!site.serve(req, res, pathname)) sendError(req, res, 404, "Not found.");
  };

  return {
    handle,
    close() {},
  };
}
