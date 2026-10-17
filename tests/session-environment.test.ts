import {describe, expect, it} from "vite-plus/test";

import {sessionEnvironment, sessionEnvironmentText, terminalHostLabel} from "../src/lib/session-environment";

const HERDR = {host: "herdr", paneId: "wE:p2", workspaceId: "wE"} as const;
const HERDR_NAMED = {host: "herdr", paneId: "wM:p1@later", workspaceId: "wM@later"} as const;
const TMUX = {host: "tmux", paneId: "%7", workspaceId: "work"} as const;

describe("terminalHostLabel", () => {
	it("names a pane's terminal host, with a herdr named session or the tmux session", () => {
		expect([HERDR, HERDR_NAMED, TMUX].map(terminalHostLabel)).toStrictEqual([
			"herdr",
			"herdr · later",
			"tmux · work",
		]);
	});
});

describe("sessionEnvironment", () => {
	it("labels a session by its terminal host, adding Remote Control only when bridged", () => {
		const hosts = {herdr: "herdr", tmux: "tmux · work", local: null};
		const table = Object.fromEntries(
			Object.entries(hosts).map(([name, terminalHost]) => [
				name,
				{
					plain: sessionEnvironment({terminalHost, bridged: false, live: true}),
					connected: sessionEnvironment({terminalHost, bridged: true, live: true}),
					offline: sessionEnvironment({terminalHost, bridged: true, live: false}),
				},
			]),
		);

		expect(table).toStrictEqual({
			herdr: {
				plain: {label: "herdr", remoteControl: null},
				connected: {label: "herdr", remoteControl: "Remote Control · Connected"},
				offline: {label: "herdr", remoteControl: "Remote Control · Offline"},
			},
			tmux: {
				plain: {label: "tmux · work", remoteControl: null},
				connected: {label: "tmux · work", remoteControl: "Remote Control · Connected"},
				offline: {label: "tmux · work", remoteControl: "Remote Control · Offline"},
			},
			local: {
				plain: {label: "Local", remoteControl: null},
				connected: {label: "Local", remoteControl: "Remote Control · Connected"},
				offline: {label: "Local", remoteControl: "Remote Control · Offline"},
			},
		});
	});

	it("joins the label and Remote Control status into one line", () => {
		expect([
			sessionEnvironmentText(sessionEnvironment({terminalHost: "herdr · later", bridged: true, live: true})),
			sessionEnvironmentText(sessionEnvironment({terminalHost: null, bridged: false, live: false})),
		]).toStrictEqual(["herdr · later · Remote Control · Connected", "Local"]);
	});
});
