// Test harness: a real server on an ephemeral port with an in-memory database,
// and a client that keeps its own cookies and reads the event stream — so the
// tests exercise exactly the HTTP a browser would send, through the same
// routing, auth and CSRF checks as production.

import { createServer } from "node:http";
import { createApp } from "./app";
import { formatHlc } from "../src/sync/hlc";
import type { AddressInfo } from "node:net";
import type { App } from "./app";
import type { FieldChange, PushRecord, PushResult, RecordKind, ServerEvent } from "../src/sync/protocol";

export interface TestServer {
  url: string;
  app: App;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const app = createApp({
    dataDir: ":memory:",
    buildId: "test-build",
    version: "test",
    trustProxy: false,
    limits: { signUpsPerHour: 1000, signInsPer10Min: 1000 },
    passwordCost: 1024,
  });
  const server = createServer((req, res) => app.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    app,
    async close() {
      app.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

let tick = 0;
// A clock stamp in the same format the client's HLC produces. Monotonic per
// test process, so a later call always wins a conflict with an earlier one.
export function clock(node = "test"): string {
  tick += 1;
  return formatHlc({ wall: Date.now(), counter: tick % 100_000, node });
}

export function change(fields: Record<string, unknown>, node = "test"): Record<string, FieldChange> {
  const c = clock(node);
  return Object.fromEntries(Object.entries(fields).map(([key, v]) => [key, { v, c }]));
}

export function record(kind: RecordKind, id: string, owner: string, fields: Record<string, unknown>): PushRecord {
  return { id, kind, owner, fields: change(fields) };
}

export class TestClient {
  private cookie = "";
  events: ServerEvent[] = [];
  connectionId: string | undefined;
  accountId = "";
  private streamAbort: AbortController | undefined;

  constructor(private readonly base: string) {}

  async request<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(method === "GET" ? {} : { "x-chronicle": "1" }),
        ...(this.cookie === "" ? {} : { cookie: this.cookie }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie !== null) this.cookie = setCookie.split(";")[0];
    const text = await response.text();
    return { status: response.status, body: (text === "" ? undefined : JSON.parse(text)) as T };
  }

  async ok<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.request<T>(method, path, body);
    if (response.status >= 300) {
      throw new Error(`${method} ${path} → ${response.status}: ${JSON.stringify(response.body)}`);
    }
    return response.body;
  }

  async signUp(handle: string, name = handle): Promise<string> {
    const { me } = await this.ok<{ me: { id: string } }>("POST", "/api/auth/signup", { handle, password: "correct horse", name });
    this.accountId = me.id;
    return me.id;
  }

  async push(records: PushRecord[]): Promise<PushResult[]> {
    return (await this.ok<{ results: PushResult[] }>("POST", "/api/push", { records, connectionId: this.connectionId })).results;
  }

  // Opens the event stream and keeps every event in `events`.
  async connect(): Promise<void> {
    this.streamAbort = new AbortController();
    const response = await fetch(`${this.base}/api/events`, {
      headers: { cookie: this.cookie },
      signal: this.streamAbort.signal,
    });
    if (response.body === null) throw new Error("no stream");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const event = JSON.parse(line.slice(6)) as ServerEvent;
              if (event.type === "hello") this.connectionId = event.connectionId;
              this.events.push(event);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch {
        // aborted
      }
    })();
    await this.waitFor((event) => event.type === "hello");
  }

  disconnect(): void {
    this.streamAbort?.abort();
  }

  async waitFor<E extends ServerEvent>(predicate: (event: ServerEvent) => event is E, timeoutMs?: number): Promise<E>;
  async waitFor(predicate: (event: ServerEvent) => boolean, timeoutMs?: number): Promise<ServerEvent>;
  async waitFor(predicate: (event: ServerEvent) => boolean, timeoutMs = 2000): Promise<ServerEvent> {
    const started = Date.now();
    for (;;) {
      const index = this.events.findIndex(predicate);
      if (index >= 0) return this.events.splice(index, 1)[0];
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timed out waiting for an event; have: ${JSON.stringify(this.events.map((e) => e.type))}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  // Lets in-flight events land, then asserts nothing matching arrived.
  async expectNone(predicate: (event: ServerEvent) => boolean, settleMs = 150): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    const found = this.events.find(predicate);
    if (found !== undefined) throw new Error(`unexpected event: ${JSON.stringify(found)}`);
  }

  // Every record id delivered as `records` so far (and forget them).
  takeRecordIds(): string[] {
    const ids = this.events.flatMap((event) => (event.type === "records" ? event.records.map((r) => r.id) : []));
    this.events = this.events.filter((event) => event.type !== "records");
    return ids.sort();
  }
}
