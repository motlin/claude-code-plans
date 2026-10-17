import {describe, expect, it} from "vite-plus/test";

import {sessionEnvironment, sessionEnvironmentText} from "../src/lib/session-environment";

const HERDR = {host: "herdr", paneId: "wE:p2", workspaceId: "wE"} as const;
const HERDR_NAMED = {host: "herdr", paneId: "wM:p1@later", workspaceId: "wM@later"} as const;
const TMUX = {host: "tmux", paneId: "%7", workspaceId: "work"} as const;

describe("sessionEnvironment", () => {
	it("labels a session by its terminal host, adding Remote Control only when bridged", () => {
		const hosts = {herdr: HERDR, herdrNamed: HERDR_NAMED, tmux: TMUX, local: null};
		const table = Object.fromEntries(
			Object.entries(hosts).map(([name, pane]) => [
				name,
				{
					plain: sessionEnvironment({pane, bridged: false, live: true}),
					connected: sessionEnvironment({pane, bridged: true, live: true}),
					offline: sessionEnvironment({pane, bridged: true, live: false}),
				},
			]),
		);

		expect(table).toStrictEqual({
			herdr: {
				plain: {label: "herdr", remoteControl: null},
				connected: {label: "herdr", remoteControl: "Remote Control · Connected"},
				offline: {label: "herdr", remoteControl: "Remote Control · Offline"},
			},
			herdrNamed: {
				plain: {label: "herdr · later", remoteControl: null},
				connected: {label: "herdr · later", remoteControl: "Remote Control · Connected"},
				offline: {label: "herdr · later", remoteControl: "Remote Control · Offline"},
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
			sessionEnvironmentText(sessionEnvironment({pane: HERDR_NAMED, bridged: true, live: true})),
			sessionEnvironmentText(sessionEnvironment({pane: null, bridged: false, live: false})),
		]).toStrictEqual(["herdr · later · Remote Control · Connected", "Local"]);
	});
});
