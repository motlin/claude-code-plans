import {describe, expect, it} from "vite-plus/test";
import {TerminalHostSettingSchema} from "../src/lib/terminal-host-setting";
import {resolveTerminalHost} from "../src/lib/terminal-host";
import {detectTmux, selectTerminalHost, type TerminalHostProbes} from "../src/lib/terminal-host/selection";

function probes(herdr: boolean, tmux: boolean, calls: string[] = []): TerminalHostProbes {
	return {
		herdrAvailable: async () => {
			calls.push("herdr");
			return Promise.resolve(herdr);
		},
		tmuxAvailable: async () => {
			calls.push("tmux");
			return Promise.resolve(tmux);
		},
	};
}

describe("TerminalHostSettingSchema", () => {
	it("accepts exactly auto, herdr and tmux", () => {
		expect([
			TerminalHostSettingSchema.options,
			TerminalHostSettingSchema.safeParse("screen").success,
		]).toStrictEqual([["auto", "herdr", "tmux"], false]);
	});
});

describe("selectTerminalHost", () => {
	it("picks herdr in auto mode when its socket answers, without probing tmux", async () => {
		const calls: string[] = [];

		expect({host: await selectTerminalHost("auto", probes(true, true, calls)), calls}).toStrictEqual({
			host: "herdr",
			calls: ["herdr"],
		});
	});

	it("falls back to tmux in auto mode when herdr is down and tmux is present", async () => {
		const calls: string[] = [];

		expect({host: await selectTerminalHost("auto", probes(false, true, calls)), calls}).toStrictEqual({
			host: "tmux",
			calls: ["herdr", "tmux"],
		});
	});

	it("keeps herdr in auto mode when neither host is running, so herdr's own unavailable handling still answers", async () => {
		expect(await selectTerminalHost("auto", probes(false, false))).toBe("herdr");
	});

	it("honours an explicit choice without probing anything", async () => {
		const calls: string[] = [];

		expect({
			herdr: await selectTerminalHost("herdr", probes(false, true, calls)),
			tmux: await selectTerminalHost("tmux", probes(true, false, calls)),
			calls,
		}).toStrictEqual({herdr: "herdr", tmux: "tmux", calls: []});
	});
});

describe("detectTmux", () => {
	it("reports tmux when $TMUX is set, without asking for a server", async () => {
		const calls: string[] = [];

		expect({
			present: await detectTmux({TMUX: "/tmp/tmux-501/default,123,0"}, async () => {
				calls.push("server");
				return Promise.resolve(false);
			}),
			calls,
		}).toStrictEqual({present: true, calls: []});
	});

	it("asks for a running tmux server when $TMUX is unset or empty", async () => {
		expect([
			await detectTmux({}, async () => Promise.resolve(true)),
			await detectTmux({TMUX: ""}, async () => Promise.resolve(false)),
		]).toStrictEqual([true, false]);
	});
});

describe("resolveTerminalHost", () => {
	it("drives herdr through the herdr host and resolves tmux to no host in this slice", async () => {
		expect({
			herdr: (await resolveTerminalHost("herdr", probes(false, false))).id,
			autoWithHerdr: (await resolveTerminalHost("auto", probes(true, true))).id,
			autoWithTmuxOnly: (await resolveTerminalHost("auto", probes(false, true))).id,
			tmux: (await resolveTerminalHost("tmux", probes(true, true))).id,
		}).toStrictEqual({herdr: "herdr", autoWithHerdr: "herdr", autoWithTmuxOnly: "none", tmux: "none"});
	});

	it("answers no host with empty pane lists and refused writes", async () => {
		const host = await resolveTerminalHost("tmux", probes(false, true));
		const request = new Request("http://127.0.0.1:7526/api/herdr/prompt", {
			method: "POST",
			body: JSON.stringify({sessionId: "s", prompt: "hi"}),
		});
		const response = await host.prompt(request);

		expect({
			panes: await host.listPanes(),
			workspaces: await host.listWorkspaces(),
			placementProvider: host.placementProvider(),
			status: response.status,
			body: await response.json(),
		}).toStrictEqual({
			panes: [],
			workspaces: [],
			placementProvider: null,
			status: 503,
			body: {error: "No terminal host is available for live input", code: "no-terminal-host"},
		});
	});
});
