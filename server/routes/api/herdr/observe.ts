import { defineWebSocketHandler } from "nitro";
import { z } from "zod";
import {
  observeHerdrSession,
  type TerminalObserverSocket,
} from "../../../../src/lib/herdr/terminal-observer";
import { hmrDispose } from "../../../../src/lib/hmr-persist";
import { rejectCrossSite } from "../../../../src/lib/same-origin-guard";

const QuerySchema = z.object({
  sessionId: z.string().min(1),
  columns: z.coerce.number().int().positive().max(500),
  rows: z.coerce.number().int().positive().max(500),
});

interface Connection {
  close: () => void;
  observer: { stop: () => void } | null;
  stopped: boolean;
}

const connections = new Map<string, Connection>();

function stopConnection(peerId: string): void {
  const connection = connections.get(peerId);
  if (!connection) return;
  connection.stopped = true;
  connection.observer?.stop();
  connections.delete(peerId);
}

export default defineWebSocketHandler({
  upgrade(request) {
    const rejection = rejectCrossSite(request);
    if (rejection) throw rejection;

    const url = new URL(request.url);
    const query = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success) throw new Response("Invalid terminal observer query", { status: 400 });
    return { context: query.data };
  },
  async open(peer) {
    const query = QuerySchema.parse(peer.context);
    const connection: Connection = {
      close: () => peer.close(1012, "terminal observer server restarted"),
      observer: null,
      stopped: false,
    };
    stopConnection(peer.id);
    connections.set(peer.id, connection);
    const socket: TerminalObserverSocket = {
      send: (message) => {
        peer.send(message);
      },
      close: (code, reason) => {
        peer.close(code, reason);
      },
    };

    try {
      const observer = await observeHerdrSession(
        query.sessionId,
        query.columns,
        query.rows,
        socket,
      );
      if (connection.stopped) observer.stop();
      else connection.observer = observer;
    } catch (error) {
      connections.delete(peer.id);
      const message = error instanceof Error ? error.message : String(error);
      peer.send(JSON.stringify({ type: "observer.error", message }));
      peer.close(1011, "terminal observer failed");
    }
  },
  close(peer) {
    stopConnection(peer.id);
  },
  error(peer) {
    stopConnection(peer.id);
  },
});

hmrDispose(() => {
  for (const connection of connections.values()) {
    connection.stopped = true;
    connection.observer?.stop();
    connection.close();
  }
  connections.clear();
});
