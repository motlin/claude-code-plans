import {describe, expect, it} from "vite-plus/test";

import {nextStreamDrop, streamDropHint} from "../src/lib/stream-drop";

describe("nextStreamDrop", () => {
	it("starts a drop on reconnecting, shows a reopen in flight as connecting, and ends it on connected", () => {
		expect({
			firstConnect: nextStreamDrop(null, "connecting"),
			connected: nextStreamDrop(null, "connected"),
			drops: nextStreamDrop(null, "reconnecting"),
			reopening: nextStreamDrop("reconnecting", "connecting"),
			failsAgain: nextStreamDrop("connecting", "reconnecting"),
			recovers: nextStreamDrop("connecting", "connected"),
			recoversFromBrowserRetry: nextStreamDrop("reconnecting", "connected"),
		}).toStrictEqual({
			firstConnect: null,
			connected: null,
			drops: "reconnecting",
			reopening: "connecting",
			failsAgain: "reconnecting",
			recovers: null,
			recoversFromBrowserRetry: null,
		});
	});
});

describe("streamDropHint", () => {
	it("uses upstream's Environment row words, with no ellipsis", () => {
		expect([streamDropHint("reconnecting"), streamDropHint("connecting")]).toStrictEqual([
			"Reconnecting",
			"Connecting",
		]);
	});
});
