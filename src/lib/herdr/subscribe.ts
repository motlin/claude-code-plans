import {createConnection, type Socket} from "node:net";
import {createInterface, type Interface as ReadlineInterface} from "node:readline";
import {HERDR_EVENTS} from "../hook-events";
import {hmrDispose, hmrPersist} from "../hmr-persist";
import {broadcastTyped} from "../sse-broadcast";
import {getDb} from "../db";
import {retryWhileBusy} from "../db/busy";
import {
	getCurrentSessionMessageIndex,
	linkHerdrTerminalToSession,
	markSessionCompletionUnreviewed,
	pruneHerdrTerminalLinks,
	setHerdrTerminalViewed,
} from "../db/viewed-state";
import {isSessionVisible} from "../session-visibility";
import {probeHerdr, type HerdrAvailability} from "./availability";
import {herdrRequest} from "./client";
import {createHerdrPaneDiffer, extractPaneRevision} from "./pane-differ";
import {herdrPaneTable, type HerdrPaneState, type HerdrPaneTable} from "./pane-table";
import {getHerdrPanes, type HerdrPaneLink} from "./panes";
import {HerdrSessionSnapshotResultSchema} from "./schema";
import {createHerdrViewedStateTracker, type HerdrViewedStateTrackerDependencies} from "./viewed-state";

const UNPARAMETERIZED_SUBSCRIPTIONS = [
	{type: "pane.created"},
	{type: "pane.closed"},
	{type: "pane.updated"},
	{type: "pane.moved"},
	{type: "pane.exited"},
	{type: "pane.agent_detected"},
] as const;

function subscriptionRequest(paneIds: string[]): string {
	// herdr 0.8 requires pane_id on each agent-status subscription, so the
	// process-wide stream rebuilds this list from a snapshot on every connect.
	const statusSubscriptions = paneIds.map((paneId) => ({
		type: "pane.agent_status_changed",
		pane_id: paneId,
	}));
	return `${JSON.stringify({
		id: "ccp:sub",
		method: "events.subscribe",
		params: {subscriptions: [...UNPARAMETERIZED_SUBSCRIPTIONS, ...statusSubscriptions]},
	})}\n`;
}

const PUSH_EVENT_TO_SSE_EVENT: Readonly<Record<string, string>> = {
	pane_created: HERDR_EVENTS.PANE_CREATED,
	pane_closed: HERDR_EVENTS.PANE_CLOSED,
	pane_updated: HERDR_EVENTS.PANE_UPDATED,
	pane_moved: HERDR_EVENTS.PANE_MOVED,
	pane_exited: HERDR_EVENTS.PANE_EXITED,
	pane_agent_detected: HERDR_EVENTS.PANE_AGENT_DETECTED,
	pane_agent_status_changed: HERDR_EVENTS.PANE_AGENT_STATUS_CHANGED,
};

const INITIAL_RETRY_DELAY_MS = 250;
const MAXIMUM_RETRY_DELAY_MS = 10_000;
const CHANGE_HINT_RESYNC_DELAY_MS = 250;

type Timer = ReturnType<typeof setTimeout>;

interface BridgeDependencies {
	probe: () => Promise<HerdrAvailability>;
	connect: (socketPath: string) => Socket;
	createLineReader: (socket: Socket) => ReadlineInterface;
	/** Ask herdr itself for a snapshot, bypassing the pane table. */
	getSnapshot: () => Promise<HerdrPaneState | null>;
	/** Read the joined pane links, which come from `paneTable` while it is current. */
	getPanes: () => Promise<HerdrPaneLink[]>;
	paneTable: HerdrPaneTable;
	broadcast: (type: string, data: Record<string, unknown>) => void;
	schedule: (callback: () => void, delayMs: number) => Timer;
	cancel: (timer: Timer) => void;
	viewedStateTracker: Pick<ReturnType<typeof createHerdrViewedStateTracker>, "syncPanes" | "handleStatusEvent">;
}

type IndexDb = ReturnType<typeof getDb>["index"];

/**
 * Viewed-state writes for the herdr tracker. They run in the background while the indexer may hold the write lock,
 * so each waits out SQLITE_BUSY asynchronously instead of failing after the connection's short busy timeout.
 */
export function createHerdrViewedStateDbDependencies(
	getIndex: () => IndexDb,
	isVisible: (sessionId: string) => boolean,
): HerdrViewedStateTrackerDependencies {
	return {
		isSessionVisible: isVisible,
		linkTerminal: async (terminalId, sessionId) =>
			retryWhileBusy(() => {
				linkHerdrTerminalToSession(getIndex(), terminalId, sessionId);
			}),
		pruneTerminalLinks: async (sessionId, activeTerminalIds) =>
			retryWhileBusy(() => {
				pruneHerdrTerminalLinks(getIndex(), sessionId, activeTerminalIds);
			}),
		markSessionCompletionUnreviewed: async (sessionId) =>
			retryWhileBusy(() => {
				const index = getIndex();
				markSessionCompletionUnreviewed(index, sessionId, getCurrentSessionMessageIndex(index, sessionId));
			}),
		markTerminalUnviewed: async (terminalId, sessionId) =>
			retryWhileBusy(() => {
				setHerdrTerminalViewed(getIndex(), terminalId, sessionId, false);
			}),
		markTerminalViewed: async (terminalId, sessionId) =>
			retryWhileBusy(() => {
				setHerdrTerminalViewed(getIndex(), terminalId, sessionId, true);
			}),
	};
}

const defaultDependencies: BridgeDependencies = {
	probe: probeHerdr,
	connect: createConnection,
	createLineReader: (socket) => createInterface({input: socket}),
	getSnapshot: async () => {
		const response = await herdrRequest({
			id: "ccp:sub-snap",
			method: "session.snapshot",
			params: {},
		});
		if (!response.ok) return null;
		const parsed = HerdrSessionSnapshotResultSchema.safeParse(response.value);
		return parsed.success ? parsed.data.snapshot : null;
	},
	getPanes: async () => getHerdrPanes(),
	paneTable: herdrPaneTable,
	broadcast: broadcastTyped,
	schedule: setTimeout,
	cancel: clearTimeout,
	viewedStateTracker: createHerdrViewedStateTracker(
		createHerdrViewedStateDbDependencies(() => getDb().index, isSessionVisible),
	),
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseMessage(line: string): Record<string, unknown> | null {
	try {
		const message: unknown = JSON.parse(line);
		return isRecord(message) ? message : null;
	} catch {
		return null;
	}
}

function isSubscriptionStarted(message: Record<string, unknown>): boolean {
	const result = message["result"];
	return isRecord(result) && result["type"] === "subscription_started";
}

function createBridge(dependencies: BridgeDependencies): () => void {
	let stopped = false;
	// stop() can run while an await is pending; reading through a call keeps flow narrowing from pinning the flag.
	const isStopped = (): boolean => stopped;
	let socket: Socket | null = null;
	let lineReader: ReadlineInterface | null = null;
	let probeRetryTimer: Timer | null = null;
	let reconnectTimer: Timer | null = null;
	let resyncTimer: Timer | null = null;
	let probeRetryDelayMs = INITIAL_RETRY_DELAY_MS;
	let reconnectDelayMs = INITIAL_RETRY_DELAY_MS;
	let reconnectPending = false;
	let resyncRunning = false;
	let resyncAgain = false;
	let socketPath = "";
	// herdr replays pane_created for every existing pane on each subscribe, so
	// the bridge must remember what it has already announced across reconnects
	// or each replay triggers a reconnect that triggers the next replay.
	const paneDiffer = createHerdrPaneDiffer();
	const {paneTable} = dependencies;

	/**
	 * Seed the pane table from herdr. Returns the snapshot, or null after
	 * invalidating the table so readers stop trusting state herdr could not confirm.
	 */
	const reseedPaneTable = async (): Promise<HerdrPaneState | null> => {
		const snapshot = await dependencies.getSnapshot();
		if (isStopped()) return null;
		if (snapshot === null) paneTable.invalidate();
		else paneTable.seed(snapshot);
		return snapshot;
	};

	// A hint resync also reconciles the table with a fresh snapshot: herdr
	// replays old status and move events on resubscribe, which carry no
	// revision to reject them by, so pushed state alone can drift.
	const runResync = async (reconcile: boolean): Promise<void> => {
		if (stopped || resyncRunning) {
			if (!stopped) resyncAgain = true;
			return;
		}

		resyncRunning = true;
		try {
			if (reconcile) await reseedPaneTable();
			if (isStopped()) return;
			const panes = await dependencies.getPanes();
			if (!isStopped()) {
				try {
					await dependencies.viewedStateTracker.syncPanes(panes);
				} catch (error) {
					console.error(`herdr resync failed to sync viewed state for ${panes.length} panes`, error);
				}
				if (!isStopped() && paneDiffer.shouldBroadcastSnapshot(panes)) {
					dependencies.broadcast(HERDR_EVENTS.PANES_SNAPSHOT, {panes});
				}
			}
		} catch (error) {
			console.error("herdr resync failed to list panes", error);
		} finally {
			resyncRunning = false;
		}

		if (resyncAgain && !isStopped()) {
			resyncAgain = false;
			scheduleHintResync();
		}
	};

	const scheduleHintResync = (): void => {
		if (stopped || reconnectPending) return;
		if (resyncRunning) {
			resyncAgain = true;
			return;
		}
		if (resyncTimer) return;
		resyncTimer = dependencies.schedule(() => {
			resyncTimer = null;
			void runResync(true);
		}, CHANGE_HINT_RESYNC_DELAY_MS);
	};

	const connect = (paneIds: string[]): void => {
		if (stopped) return;
		reconnectPending = false;

		const nextSocket = dependencies.connect(socketPath);
		const nextLineReader = dependencies.createLineReader(nextSocket);
		socket = nextSocket;
		lineReader = nextLineReader;

		const scheduleReconnect = (): void => {
			if (stopped || reconnectPending || socket !== nextSocket) return;
			reconnectPending = true;
			// The resubscribe reseeds and resyncs, so a pending hint resync is redundant.
			if (resyncTimer) {
				dependencies.cancel(resyncTimer);
				resyncTimer = null;
			}
			nextLineReader.close();
			nextSocket.destroy();
			socket = null;
			lineReader = null;
			reconnectTimer = dependencies.schedule(() => {
				reconnectTimer = null;
				void openSubscription();
			}, reconnectDelayMs);
			reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAXIMUM_RETRY_DELAY_MS);
		};

		nextSocket.once("connect", () => {
			if (stopped || socket !== nextSocket) return;
			reconnectDelayMs = INITIAL_RETRY_DELAY_MS;
			nextSocket.write(subscriptionRequest(paneIds));
		});
		// Keep the error listener for the socket's whole life: herdr hanging up can surface as several errors
		// (ECONNRESET, then EPIPE from a pending write), and an error with no listener crashes the process.
		// Every socket error is an ordinary disconnect; scheduleReconnect ignores all but the first.
		// Losing herdr (unlike a deliberate resubscribe) means pushes stop, so the table is no longer current.
		const handleDisconnect = (): void => {
			if (stopped || reconnectPending || socket !== nextSocket) return;
			paneTable.invalidate();
			scheduleReconnect();
		};
		nextSocket.on("error", handleDisconnect);
		nextSocket.once("close", handleDisconnect);

		nextLineReader.on("line", (line) => {
			if (stopped || line.trim() === "") return;
			const message = parseMessage(line);
			if (!message || isSubscriptionStarted(message)) return;

			const pushedEvent = message["event"];
			const data = message["data"];
			if (typeof pushedEvent !== "string" || !isRecord(data)) return;

			const sseEvent = PUSH_EVENT_TO_SSE_EVENT[pushedEvent];
			if (!sseEvent) return;
			if (pushedEvent === "pane_agent_status_changed") {
				dependencies.viewedStateTracker.handleStatusEvent(data).catch((error: unknown) => {
					console.error(
						`herdr status event failed to update viewed state for pane ${String(data["pane_id"])}`,
						error,
					);
				});
			}

			if (pushedEvent === "pane_created" || pushedEvent === "pane_closed") {
				const pane = extractPaneRevision(data);
				if (pane) {
					const changed =
						pushedEvent === "pane_created"
							? paneDiffer.recordCreated(pane)
							: paneDiffer.recordClosed(pane.paneId);
					if (!changed) return;
					paneTable.apply(pushedEvent, data);
					dependencies.broadcast(sseEvent, data);
					// Reconnect to rebuild the pane-scoped agent-status subscriptions.
					scheduleReconnect();
					return;
				}
				// Without a pane id the subscription list cannot change; a resync is
				// enough and, unlike a reconnect, cannot fuel a replay loop.
				paneTable.apply(pushedEvent, data);
				dependencies.broadcast(sseEvent, data);
				scheduleHintResync();
				return;
			}

			if (pushedEvent === "pane_updated") {
				const pane = extractPaneRevision(data);
				if (pane && !paneDiffer.recordUpdated(pane)) return;
			}

			paneTable.apply(pushedEvent, data);
			dependencies.broadcast(sseEvent, data);
			scheduleHintResync();
		});
	};

	const openSubscription = async (): Promise<void> => {
		if (stopped) return;
		// One snapshot per (re)subscribe seeds the pane table, the replay
		// differ, and the pane-scoped status subscriptions.
		const snapshot = await reseedPaneTable();
		if (isStopped()) return;
		const panes = (snapshot?.panes ?? []).map((pane) => ({paneId: pane.pane_id, revision: pane.revision}));
		paneDiffer.seedKnownPanes(panes);
		// Seed terminalId-keyed transition state before subscribing. Otherwise a
		// fast done→idle push could arrive before its paneId→terminalId mapping.
		await runResync(false);
		if (isStopped()) return;
		connect(panes.map((pane) => pane.paneId));
	};

	const probeAndOpenSubscription = async (): Promise<void> => {
		const availability = await dependencies.probe();
		if (stopped) return;
		if (!availability.available) {
			probeRetryTimer = dependencies.schedule(() => {
				probeRetryTimer = null;
				void probeAndOpenSubscription();
			}, probeRetryDelayMs);
			probeRetryDelayMs = Math.min(probeRetryDelayMs * 2, MAXIMUM_RETRY_DELAY_MS);
			return;
		}

		socketPath = availability.socketPath;
		void openSubscription();
	};

	void probeAndOpenSubscription();

	return () => {
		if (stopped) return;
		stopped = true;
		if (probeRetryTimer) dependencies.cancel(probeRetryTimer);
		if (reconnectTimer) dependencies.cancel(reconnectTimer);
		if (resyncTimer) dependencies.cancel(resyncTimer);
		lineReader?.close();
		socket?.destroy();
		paneTable.invalidate();
		probeRetryTimer = null;
		reconnectTimer = null;
		resyncTimer = null;
		lineReader = null;
		socket = null;
	};
}

interface BridgeState {
	stop: (() => void) | null;
}

const bridgeState = hmrPersist<BridgeState>("herdrEventBridge", () => ({stop: null}));

/** Start the single process-wide herdr-to-SSE event bridge. */
export function startHerdrEventBridge(): () => void {
	if (bridgeState.stop) return bridgeState.stop;

	const stopBridge = createBridge(defaultDependencies);
	const stop = () => {
		stopBridge();
		if (bridgeState.stop === stop) bridgeState.stop = null;
	};
	bridgeState.stop = stop;
	return stop;
}

hmrDispose(() => {
	bridgeState.stop?.();
});

export const __testing = {
	createBridge,
	subscriptionRequest,
};
