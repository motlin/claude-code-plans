import {defineWebSocketHandler} from "nitro";
import {z} from "zod";
import {
	authorizeTerminalControl,
	controlHerdrSession,
	type TerminalController,
} from "../../../../src/lib/herdr/terminal-controller";
import type {TerminalObserverSocket} from "../../../../src/lib/herdr/terminal-observer";
import {hmrDispose} from "../../../../src/lib/hmr-persist";

const QuerySchema = z.object({
	sessionId: z.string().min(1),
	columns: z.coerce.number().int().positive().max(500),
	rows: z.coerce.number().int().positive().max(500),
});

interface Connection {
	close: () => void;
	controller: TerminalController | null;
	/** Frames that arrive while the herdr target is still resolving. */
	pending: string[];
	stopped: boolean;
}

const MAXIMUM_PENDING_FRAMES = 256;

const connections = new Map<string, Connection>();

function stopConnection(peerId: string): void {
	const connection = connections.get(peerId);
	if (!connection) return;
	connection.stopped = true;
	connection.controller?.stop();
	connections.delete(peerId);
}

/** Interactive twin of `observe`, gated by the herdr writes setting. */
export default defineWebSocketHandler({
	upgrade(request) {
		const rejection = authorizeTerminalControl(request);
		if (rejection) throw rejection;

		const url = new URL(request.url);
		const query = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
		if (!query.success) throw new Response("Invalid terminal control query", {status: 400});
		return {context: query.data};
	},
	async open(peer) {
		const query = QuerySchema.parse(peer.context);
		const connection: Connection = {
			close: () => peer.close(1012, "terminal control server restarted"),
			controller: null,
			pending: [],
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
			const controller = await controlHerdrSession(query.sessionId, query.columns, query.rows, socket);
			if (connection.stopped) {
				controller.stop();
				return;
			}
			connection.controller = controller;
			for (const message of connection.pending.splice(0)) controller.input(message);
		} catch (error) {
			connections.delete(peer.id);
			const message = error instanceof Error ? error.message : String(error);
			peer.send(JSON.stringify({type: "observer.error", message}));
			peer.close(1011, "terminal control failed");
		}
	},
	message(peer, message) {
		const connection = connections.get(peer.id);
		if (!connection || connection.stopped) return;
		const text = message.text();
		if (connection.controller) connection.controller.input(text);
		else if (connection.pending.length < MAXIMUM_PENDING_FRAMES) connection.pending.push(text);
		else peer.close(1008, "terminal control backlog exceeded");
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
		connection.controller?.stop();
		connection.close();
	}
	connections.clear();
});
