import {describe, expect, it} from "vite-plus/test";
import {HERDR_EVENTS} from "../src/lib/event-names";
import {createHerdrReconnectState} from "../src/lib/herdr/reconnect-state";

describe("herdr reconnect state", () => {
	it("reports reconnecting while any server's bridge is reconnecting and broadcasts only the overall changes", () => {
		const broadcasts: Array<{type: string; data: Record<string, unknown>}> = [];
		const state = createHerdrReconnectState(new Set(), (type, data) => broadcasts.push({type, data}));

		const before = state.isReconnecting();
		state.set("/test/default.sock", true);
		state.set("/test/later.sock", true);
		state.set("/test/default.sock", true);
		state.set("/test/default.sock", false);
		const oneStillReconnecting = state.isReconnecting();
		state.set("/test/later.sock", false);
		state.set("/test/later.sock", false);

		expect({before, oneStillReconnecting, after: state.isReconnecting(), broadcasts}).toStrictEqual({
			before: false,
			oneStillReconnecting: true,
			after: false,
			broadcasts: [
				{type: HERDR_EVENTS.CONNECTION_CHANGED, data: {reconnecting: true}},
				{type: HERDR_EVENTS.CONNECTION_CHANGED, data: {reconnecting: false}},
			],
		});
	});
});
