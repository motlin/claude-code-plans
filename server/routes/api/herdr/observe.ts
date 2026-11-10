import {defineWebSocketHandler} from "nitro";
import {
	getTerminalHost,
	TerminalStreamQuerySchema,
	type TerminalObserverSocket,
} from "../../../../src/lib/terminal-host";
import {hmrDispose} from "../../../../src/lib/hmr-persist";
import {isLoopbackPeer, LOCAL_ONLY_CLOSE_REASON} from "../../../../src/lib/loopback-guard";
import {rejectCrossSite} from "../../../../src/lib/same-origin-guard";

interface Connection {
	close: () => void;
	observer: {stop: () => void} | null;
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
		const searchParams = Object.fromEntries(url.searchParams);
		const query = TerminalStreamQuerySchema.safeParse(searchParams);
		if (!query.success) throw new Response("Invalid terminal observer query", {status: 400});
		return {context: searchParams};
	},
	async open(peer) {
		if (!isLoopbackPeer(peer.remoteAddress)) {
			peer.close(1008, LOCAL_ONLY_CLOSE_REASON);
			return;
		}
		const query = TerminalStreamQuerySchema.parse(peer.context);
		const connection: Connection = {
			close: () => {
				peer.close(1012, "terminal observer server restarted");
			},
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
			const host = await getTerminalHost();
			const {target, columns, rows} = query;
			const observer =
				target.kind === "pane"
					? await host.observePane(target.paneId, columns, rows, socket)
					: await host.observe(target.sessionId, columns, rows, socket);
			if (connection.stopped) observer.stop();
			else connection.observer = observer;
		} catch (error) {
			connections.delete(peer.id);
			const message = error instanceof Error ? error.message : String(error);
			peer.send(JSON.stringify({type: "observer.error", message}));
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
