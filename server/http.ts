// The few HTTP helpers the server needs, on plain node:http. There is no
// framework on purpose: the whole API is a couple of dozen JSON routes and
// one event stream, and a dependency-free server image is one less thing to
// keep patched.

import { gzipSync } from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // Machine-readable, for the few errors a client acts on rather than just
    // shows (see ERROR_CONFIRM_IDENTITY in the protocol).
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
}

export type RouteHandler = (ctx: RequestContext) => Promise<void> | void;

interface Route {
  method: string;
  parts: string[];
  handler: RouteHandler;
}

// `/api/invites/:token` style patterns. Segment-wise, so a parameter never
// swallows a slash.
export class Router {
  private routes: Route[] = [];

  on(method: string, pattern: string, handler: RouteHandler): void {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
  }

  match(method: string, pathname: string): { handler: RouteHandler; params: Record<string, string> } | "wrong-method" | null {
    const segments = pathname.split("/").filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      if (route.parts.length !== segments.length) continue;
      const params: Record<string, string> = {};
      const ok = route.parts.every((part, index) => {
        if (part.startsWith(":")) {
          params[part.slice(1)] = decodeURIComponent(segments[index]);
          return true;
        }
        return part === segments[index];
      });
      if (!ok) continue;
      pathMatched = true;
      if (route.method === method) return { handler: route.handler, params };
    }
    return pathMatched ? "wrong-method" : null;
  }
}

const JSON_LIMIT_BYTES = 8 * 1024 * 1024;

export async function readJson<T>(req: IncomingMessage, limit = JSON_LIMIT_BYTES): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "Request body too large.");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

function acceptsGzip(req: IncomingMessage): boolean {
  return /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
}

// Pull responses carry a whole account's worth of records; JSON of that shape
// compresses around eight to one, which is the difference between a phone
// waiting and not.
export function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  const raw = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (raw.length > 1024 && acceptsGzip(req)) {
    const gz = gzipSync(raw);
    res.writeHead(status, { ...headers, "content-encoding": "gzip", vary: "accept-encoding", "content-length": gz.length });
    res.end(gz);
    return;
  }
  res.writeHead(status, { ...headers, "content-length": raw.length });
  res.end(raw);
}

export function sendError(req: IncomingMessage, res: ServerResponse, status: number, message: string, code?: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  sendJson(req, res, status, code === undefined ? { error: message } : { error: message, code });
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (header === undefined) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

// Behind CapRover's nginx the socket is plain HTTP; the original scheme and
// client address arrive as forwarded headers. Trusted only when configured,
// since anybody can send those headers to a server that is reachable directly.
export function isSecureRequest(req: IncomingMessage, trustProxy: boolean): boolean {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
    if (forwarded !== "") return forwarded === "https";
  }
  return (req.socket as { encrypted?: boolean }).encrypted === true;
}

export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    if (forwarded !== "") return forwarded;
  }
  return req.socket.remoteAddress ?? "unknown";
}
