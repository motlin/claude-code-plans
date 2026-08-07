import { createConnection, type Socket } from "node:net";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { HERDR_EVENTS } from "../hook-events";
import { hmrDispose, hmrPersist } from "../hmr-persist";
import { broadcastTyped } from "../sse-broadcast";
import { getDb } from "../db";
import {
  getCurrentSessionMessageIndex,
  linkHerdrTerminalToSession,
  markSessionCompletionUnreviewed,
  pruneHerdrTerminalLinks,
  setHerdrTerminalViewed,
} from "../db/viewed-state";
import { isSessionVisible } from "../session-visibility";
import { probeHerdr, type HerdrAvailability } from "./availability";
import { herdrRequest } from "./client";
import { getHerdrPanes, type HerdrPaneLink } from "./panes";
import { HerdrSessionSnapshotResultSchema } from "./schema";
import {
  createHerdrViewedStateTracker,
  type HerdrViewedStateTrackerDependencies,
} from "./viewed-state";

const UNPARAMETERIZED_SUBSCRIPTIONS = [
  { type: "pane.created" },
  { type: "pane.closed" },
  { type: "pane.updated" },
  { type: "pane.moved" },
  { type: "pane.exited" },
  { type: "pane.agent_detected" },
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
    params: { subscriptions: [...UNPARAMETERIZED_SUBSCRIPTIONS, ...statusSubscriptions] },
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
  getPaneIds: () => Promise<string[]>;
  getPanes: () => Promise<HerdrPaneLink[]>;
  broadcast: (type: string, data: Record<string, unknown>) => void;
  schedule: (callback: () => void, delayMs: number) => Timer;
  cancel: (timer: Timer) => void;
  viewedStateTracker: ReturnType<typeof createHerdrViewedStateTracker>;
}

const defaultViewedStateDependencies: HerdrViewedStateTrackerDependencies = {
  isSessionVisible,
  linkTerminal: (terminalId, sessionId) => {
    linkHerdrTerminalToSession(getDb().index, terminalId, sessionId);
  },
  pruneTerminalLinks: (sessionId, activeTerminalIds) => {
    pruneHerdrTerminalLinks(getDb().index, sessionId, activeTerminalIds);
  },
  markSessionCompletionUnreviewed: (sessionId) => {
    const { index } = getDb();
    markSessionCompletionUnreviewed(
      index,
      sessionId,
      getCurrentSessionMessageIndex(index, sessionId),
    );
  },
  markTerminalUnviewed: (terminalId, sessionId) => {
    setHerdrTerminalViewed(getDb().index, terminalId, sessionId, false);
  },
  markTerminalViewed: (terminalId, sessionId) => {
    setHerdrTerminalViewed(getDb().index, terminalId, sessionId, true);
  },
};

const defaultDependencies: BridgeDependencies = {
  probe: probeHerdr,
  connect: createConnection,
  createLineReader: (socket) => createInterface({ input: socket }),
  getPaneIds: async () => {
    const response = await herdrRequest<unknown>({
      id: "ccp:sub-snap",
      method: "session.snapshot",
      params: {},
    });
    if (!response.ok) return [];
    const parsed = HerdrSessionSnapshotResultSchema.safeParse(response.value);
    return parsed.success ? parsed.data.snapshot.panes.map((pane) => pane.pane_id) : [];
  },
  getPanes: () => getHerdrPanes(),
  broadcast: broadcastTyped,
  schedule: setTimeout,
  cancel: clearTimeout,
  viewedStateTracker: createHerdrViewedStateTracker(defaultViewedStateDependencies),
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

  const runResync = async (): Promise<void> => {
    if (stopped || resyncRunning) {
      if (!stopped) resyncAgain = true;
      return;
    }

    resyncRunning = true;
    const panes = await dependencies.getPanes();
    if (!stopped) {
      dependencies.viewedStateTracker.syncPanes(panes);
      dependencies.broadcast(HERDR_EVENTS.PANES_SNAPSHOT, { panes });
    }
    resyncRunning = false;

    if (resyncAgain && !stopped) {
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
      void runResync();
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
    nextSocket.once("error", scheduleReconnect);
    nextSocket.once("close", scheduleReconnect);

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
        dependencies.viewedStateTracker.handleStatusEvent(data);
      }
      dependencies.broadcast(sseEvent, data);
      if (pushedEvent === "pane_created" || pushedEvent === "pane_closed") {
        scheduleReconnect();
        return;
      }
      scheduleHintResync();
    });
  };

  const openSubscription = async (): Promise<void> => {
    if (stopped) return;
    // Seed terminalId-keyed transition state before subscribing. Otherwise a
    // fast done→idle push could arrive before its paneId→terminalId mapping.
    await runResync();
    if (stopped) return;
    const paneIds = await dependencies.getPaneIds();
    if (!stopped) connect(paneIds);
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

const bridgeState = hmrPersist<BridgeState>("herdrEventBridge", () => ({ stop: null }));

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
