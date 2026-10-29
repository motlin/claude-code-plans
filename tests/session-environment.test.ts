import {describe, expect, it} from "vite-plus/test";

import {
	registryRemoteControl,
	sessionEnvironment,
	sessionEnvironmentText,
	terminalHostLabel,
} from "../src/lib/session-environment";

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

describe("registryRemoteControl", () => {
	it("reads the bridge from the live registry entry: on with its claude.ai url, off once torn down, null without a live process", () => {
		expect({
			bridged: registryRemoteControl({bridgeSessionId: "session_x"}),
			cse: registryRemoteControl({bridgeSessionId: "cse_y"}),
			tornDown: registryRemoteControl({bridgeSessionId: null}),
			olderCli: registryRemoteControl({}),
			noEntry: registryRemoteControl(null),
		}).toStrictEqual({
			bridged: {state: "on", url: "https://claude.ai/code/session_x"},
			cse: {state: "on", url: "https://claude.ai/code/session_y"},
			tornDown: {state: "off", url: null},
			olderCli: null,
			noEntry: null,
		});
	});
});

describe("sessionEnvironment", () => {
	it("labels a session by its terminal host, carrying its Remote Control state", () => {
		const hosts = {herdr: "herdr", tmux: "tmux · work", local: null};
		const table = Object.fromEntries(
			Object.entries(hosts).map(([name, terminalHost]) => [
				name,
				{
					ended: sessionEnvironment({terminalHost, remoteControl: null}),
					on: sessionEnvironment({terminalHost, remoteControl: "on"}),
					off: sessionEnvironment({terminalHost, remoteControl: "off"}),
				},
			]),
		);

		expect(table).toStrictEqual({
			herdr: {
				ended: {label: "herdr", remoteControl: null},
				on: {label: "herdr", remoteControl: "on"},
				off: {label: "herdr", remoteControl: "off"},
			},
			tmux: {
				ended: {label: "tmux · work", remoteControl: null},
				on: {label: "tmux · work", remoteControl: "on"},
				off: {label: "tmux · work", remoteControl: "off"},
			},
			local: {
				ended: {label: "Local", remoteControl: null},
				on: {label: "Local", remoteControl: "on"},
				off: {label: "Local", remoteControl: "off"},
			},
		});
	});

	it("joins the label and Remote Control on or off into one line", () => {
		expect([
			sessionEnvironmentText(sessionEnvironment({terminalHost: "herdr · later", remoteControl: "on"})),
			sessionEnvironmentText(sessionEnvironment({terminalHost: "tmux · work", remoteControl: "off"})),
			sessionEnvironmentText(sessionEnvironment({terminalHost: null, remoteControl: null})),
		]).toStrictEqual(["herdr · later · Remote Control on", "tmux · work · Remote Control off", "Local"]);
	});
});
