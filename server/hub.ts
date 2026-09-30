// Live connections: one Server-Sent Events stream per open tab.
//
// SSE rather than WebSockets because it is plain HTTP — it passes through
// CapRover's nginx without the per-app "WebSocket support" switch, which is
// exactly the kind of setting that silently breaks live editing months later.
// The other direction never needed a socket anyway: edits are POSTs.

import { randomUUID } from "node:crypto";
import type { Peer, ServerEvent } from "../src/sync/protocol";
import type { IncomingMessage, ServerResponse } from "node:http";

// nginx closes an idle proxied response after 60 s by default.
const HEARTBEAT_MS = 25_000;
// Open tabs per account. Generous for real use (phones, laptops, forgotten
// tabs), and a bound on what one account can make the server hold open.
const MAX_STREAMS_PER_ACCOUNT = 20;

interface LiveConnection {
  id: string;
  accountId: string;
  name: string;
  res: ServerResponse;
  focusId: string | null;
}

export interface PresencePolicy {
  // Whose presence may this account see? Its own other devices and its
  // connections — never a stranger's.
  relevantAccounts(accountId: string): Set<string>;
  canRead(viewer: string, recordId: string): boolean;
}

export class Hub {
  private readonly connections = new Map<string, LiveConnection>();
  private readonly byAccount = new Map<string, Set<string>>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  presence: PresencePolicy | undefined;

  constructor(private readonly buildId: string) {
    this.heartbeat = setInterval(() => {
      for (const connection of this.connections.values()) connection.res.write(": ping\n\n");
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  open(req: IncomingMessage, res: ServerResponse, accountId: string, name: string): string {
    // Over the limit, the oldest stream makes way: it is the tab most likely
    // to have been forgotten, and it reconnects by itself if it is not.
    const existing = this.byAccount.get(accountId);
    if (existing !== undefined && existing.size >= MAX_STREAMS_PER_ACCOUNT) {
      const oldest = existing.values().next().value;
      if (oldest !== undefined) {
        this.connections.get(oldest)?.res.end();
        this.close(oldest);
      }
    }
    const id = randomUUID();
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      // Tells nginx not to buffer the stream — without it, events sit in a
      // proxy buffer until it fills, which is to say: not live.
      "x-accel-buffering": "no",
    });
    res.write("retry: 3000\n\n");
    const connection: LiveConnection = { id, accountId, name, res, focusId: null };
    this.connections.set(id, connection);
    let ids = this.byAccount.get(accountId);
    if (ids === undefined) this.byAccount.set(accountId, (ids = new Set()));
    ids.add(id);

    this.write(connection, { type: "hello", build: this.buildId, connectionId: id, accountId, serverTime: Date.now() });
    req.on("close", () => this.close(id));
    this.presenceChanged(accountId);
    return id;
  }

  private close(id: string): void {
    const connection = this.connections.get(id);
    if (connection === undefined) return;
    this.connections.delete(id);
    const ids = this.byAccount.get(connection.accountId);
    ids?.delete(id);
    if (ids?.size === 0) this.byAccount.delete(connection.accountId);
    this.presenceChanged(connection.accountId);
  }

  private write(connection: LiveConnection, event: ServerEvent): void {
    connection.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  isOnline(accountId: string): boolean {
    return this.byAccount.has(accountId);
  }

  onlineAccounts(): string[] {
    return [...this.byAccount.keys()];
  }

  owns(connectionId: string, accountId: string): boolean {
    return this.connections.get(connectionId)?.accountId === accountId;
  }

  // To every open tab of the account, except the one that caused the change
  // (it already has the result, from the response to its own request).
  send(accountId: string, event: ServerEvent, exceptConnection?: string): void {
    for (const id of this.byAccount.get(accountId) ?? []) {
      if (id === exceptConnection) continue;
      const connection = this.connections.get(id);
      if (connection !== undefined) this.write(connection, event);
    }
  }

  rename(accountId: string, name: string): void {
    for (const id of this.byAccount.get(accountId) ?? []) {
      const connection = this.connections.get(id);
      if (connection !== undefined) connection.name = name;
    }
    this.presenceChanged(accountId);
  }

  setFocus(connectionId: string, focusId: string | null): void {
    const connection = this.connections.get(connectionId);
    if (connection === undefined || connection.focusId === focusId) return;
    connection.focusId = focusId;
    this.presenceChanged(connection.accountId);
  }

  // Someone came, went or looked at something else: everyone who may see
  // them gets a fresh list. Lists are short (a family, not a stadium), so
  // resending whole lists is simpler than patching them and cannot drift.
  presenceChanged(accountId: string): void {
    const policy = this.presence;
    if (policy === undefined) return;
    const audience = new Set([accountId, ...policy.relevantAccounts(accountId)]);
    for (const recipient of audience) {
      if (this.isOnline(recipient)) this.sendPeers(recipient);
    }
  }

  sendPeers(recipient: string): void {
    const policy = this.presence;
    if (policy === undefined) return;
    const visibleAccounts = new Set([recipient, ...policy.relevantAccounts(recipient)]);
    const peers: Peer[] = [];
    for (const connection of this.connections.values()) {
      if (!visibleAccounts.has(connection.accountId)) continue;
      const focusId =
        connection.focusId !== null && policy.canRead(recipient, connection.focusId) ? connection.focusId : null;
      peers.push({ connectionId: connection.id, accountId: connection.accountId, name: connection.name, focusId });
    }
    for (const id of this.byAccount.get(recipient) ?? []) {
      const connection = this.connections.get(id);
      if (connection === undefined) continue;
      this.write(connection, { type: "peers", peers: peers.filter((peer) => peer.connectionId !== id) });
    }
  }

  // Every stream ends on shutdown; browsers reconnect to the next container.
  closeAll(): void {
    clearInterval(this.heartbeat);
    for (const connection of this.connections.values()) connection.res.end();
    this.connections.clear();
    this.byAccount.clear();
  }
}
