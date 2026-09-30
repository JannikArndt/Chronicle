// The server's event stream, read with fetch rather than EventSource: the
// same code runs in the browser and in the Node tests, and a closed stream
// comes back as a promise the engine can await instead of an auto-reconnect
// it cannot see into.

import { transportFetch } from "./api";
import type { ServerEvent } from "./protocol";

export interface LiveStream {
  close(): void;
  // Resolves when the stream ends for any reason. `status` is the HTTP status
  // if the server refused it (401 means the session is gone).
  closed: Promise<{ status?: number }>;
}

export function openLiveStream(onEvent: (event: ServerEvent) => void): LiveStream {
  const abort = new AbortController();
  const closed = (async (): Promise<{ status?: number }> => {
    let response: Response;
    try {
      response = await transportFetch("/api/events", { signal: abort.signal, headers: { accept: "text/event-stream" } });
    } catch {
      return {};
    }
    if (!response.ok || response.body === null) return { status: response.status };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return {};
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = chunk
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          if (data !== "") {
            try {
              onEvent(JSON.parse(data) as ServerEvent);
            } catch (error) {
              console.error("chronicle: bad event", error);
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      return {};
    }
  })();
  return { close: () => abort.abort(), closed };
}
