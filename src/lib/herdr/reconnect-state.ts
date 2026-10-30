import {HERDR_EVENTS} from "../event-names";
import {hmrPersist} from "../hmr-persist";
import {broadcastTyped} from "../sse-broadcast";

export interface HerdrReconnectState {
	/** Record whether the bridge for `socketPath` is resubscribing after losing herdr. */
	set: (socketPath: string, reconnecting: boolean) => void;
	/** True while any herdr server's bridge is resubscribing after losing herdr. */
	isReconnecting: () => boolean;
}

/**
 * Track the bridges that lost herdr and are waiting to resubscribe, broadcasting
 * `CONNECTION_CHANGED` when the overall answer flips so a held prompt can say it
 * is waiting for the terminal to reconnect.
 */
export function createHerdrReconnectState(
	reconnectingSockets: Set<string>,
	broadcast: (type: string, data: Record<string, unknown>) => void,
): HerdrReconnectState {
	return {
		set: (socketPath, reconnecting) => {
			const before = reconnectingSockets.size > 0;
			if (reconnecting) reconnectingSockets.add(socketPath);
			else reconnectingSockets.delete(socketPath);
			const after = reconnectingSockets.size > 0;
			if (before !== after) broadcast(HERDR_EVENTS.CONNECTION_CHANGED, {reconnecting: after});
		},
		isReconnecting: () => reconnectingSockets.size > 0,
	};
}

export const herdrReconnectState = createHerdrReconnectState(
	hmrPersist<Set<string>>("herdrReconnectingSockets", () => new Set()),
	broadcastTyped,
);
