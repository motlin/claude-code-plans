import { SSE_EVENTS } from "./hook-events";
import { hmrPersist } from "./hmr-persist";

// Persisted across HMR reloads so reconnecting clients aren't dropped
// during dev hot-swaps of the watcher module.
const clients = hmrPersist("watcherClients", () => new Set<ReadableStreamDefaultController>());

const encoder = new TextEncoder();

export function broadcastTyped(type: string, data: Record<string, unknown>): void {
  const payload = encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const client of clients) {
    try {
      client.enqueue(payload);
    } catch {
      clients.delete(client);
    }
  }
}

export function broadcast(): void {
  broadcastTyped(SSE_EVENTS.CONTENT_UPDATED, {});
}

export function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller);
}

export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller);
}

/** Number of SSE clients currently subscribed to `/api/events`. */
export function sseClientCount(): number {
  return clients.size;
}
