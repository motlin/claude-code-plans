import { defineWebSocketHandler } from "nitro";
import { z } from "zod";
import {
  authorizeShellSocket,
  getShellRegistry,
  isLoopbackPeer,
  type ShellConnection,
} from "../../../../src/lib/shell-pty";

const PtyKeySchema = z.uuid();

const connections = new Map<string, ShellConnection>();

function detach(peerId: string): void {
  connections.get(peerId)?.detach();
  connections.delete(peerId);
}

/** Shell tab socket: speaks the `{resize,data,close}` / `{opened,data,exit,error}` protocol. */
export default defineWebSocketHandler({
  upgrade(request) {
    const rejection = authorizeShellSocket(request);
    if (rejection) throw rejection;

    const ptyKey = PtyKeySchema.safeParse(new URL(request.url).pathname.split("/").at(-1));
    if (!ptyKey.success) throw new Response("Invalid shell key", { status: 400 });
    return { context: { ptyKey: ptyKey.data } };
  },
  open(peer) {
    if (!isLoopbackPeer(peer.remoteAddress)) {
      peer.send(
        JSON.stringify({
          type: "error",
          message: "Shell tabs are only available from this computer",
        }),
      );
      peer.close(1008, "shell is local only");
      return;
    }
    const { ptyKey } = z.object({ ptyKey: PtyKeySchema }).parse(peer.context);
    const connection = getShellRegistry().attach(ptyKey, {
      send: (message) => {
        peer.send(message);
      },
      close: (code, reason) => {
        peer.close(code, reason);
      },
    });
    if (connection === null) {
      peer.send(JSON.stringify({ type: "error", message: "Shell not found" }));
      peer.close(4404, "shell not found");
      return;
    }
    connections.set(peer.id, connection);
  },
  message(peer, message) {
    connections.get(peer.id)?.input(message.text());
  },
  close(peer) {
    detach(peer.id);
  },
  error(peer) {
    detach(peer.id);
  },
});
