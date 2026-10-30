import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {
	handleHerdrRemoteControl,
	parseRemoteControlDialog,
	type HerdrRemoteControlDependencies,
} from "../src/lib/herdr/remote-control";
import {asRecord} from "../src/lib/narrow";
import {rejectCrossSite} from "../src/lib/same-origin-guard";
import type {RemoteControlState} from "../src/lib/session-state";

/** Real CLI 2.1.314 screens, read from a throwaway session's herdr pane. */
function fixture(name: string): string {
	return readFileSync(join(import.meta.dirname, `fixtures/remote-control-${name}.txt`), "utf8");
}

describe("parseRemoteControlDialog", () => {
	it("reads the dialog the CLI opens on Continue while bridged", () => {
		expect(parseRemoteControlDialog(fixture("dialog"))).toStrictEqual({
			selected: "Continue",
			movesToDisconnect: -2,
		});
	});

	it("reads the selected Show QR code row one below Disconnect", () => {
		expect(parseRemoteControlDialog(fixture("dialog-qr"))).toStrictEqual({
			selected: "Show QR code   Scan with your phone to open this session",
			movesToDisconnect: -1,
		});
	});

	it("is null on the idle screen", () => {
		expect(parseRemoteControlDialog(fixture("idle-on"))).toStrictEqual(null);
	});
});

const RULE = "─".repeat(40);
const OPTIONS = ["Disconnect this session", "Show QR code   Scan with your phone to open this session", "Continue"];

interface FakeCli {
	bridge: RemoteControlState;
	input: string;
	dialog: boolean;
	selected: number;
	prompts: string[];
	keys: string[];
	/** Whether `/remote-control` while bridged opens nothing, as if the CLI changed. */
	noDialog?: boolean;
}

function fakeCli(overrides: Partial<FakeCli> = {}): FakeCli {
	return {bridge: "on", input: "", dialog: false, selected: 2, prompts: [], keys: [], ...overrides};
}

function render(cli: FakeCli): string {
	if (cli.dialog) {
		return [
			"⏺ done",
			"   Remote Control",
			"",
			"   This session is available in the Claude mobile app and at https://claude.ai/code/session_x.",
			"",
			...OPTIONS.map((option, index) => `   ${index === cli.selected ? "❯" : " "} ${option}`),
			"",
			"   Enter to select · Esc to continue",
		].join("\n");
	}
	return ["⏺ done", RULE, `❯ ${cli.input}`, RULE, "  ⏵⏵ auto mode on (shift+tab to cycle)"].join("\n");
}

function prompt(cli: FakeCli, text: string): void {
	cli.prompts.push(text);
	if (text !== "/remote-control") return;
	if (cli.bridge === "off") cli.bridge = "on";
	else if (cli.noDialog !== true) {
		cli.dialog = true;
		cli.selected = 2;
	}
}

function press(cli: FakeCli, key: string): void {
	cli.keys.push(key);
	if (!cli.dialog) return;
	if (key === "up") cli.selected = Math.max(0, cli.selected - 1);
	else if (key === "down") cli.selected = Math.min(OPTIONS.length - 1, cli.selected + 1);
	else if (key === "esc") cli.dialog = false;
	else if (key === "enter") {
		cli.dialog = false;
		if (cli.selected === 0) cli.bridge = "off";
	}
}

function postRequest(body: unknown): Request {
	return new Request("http://127.0.0.1:7526/api/herdr/remote-control", {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(body),
	});
}

function dependencies(
	cli: FakeCli,
	overrides: Partial<HerdrRemoteControlDependencies> = {},
): HerdrRemoteControlDependencies {
	return {
		rejectRequest: rejectCrossSite,
		writesEnabled: () => true,
		ready: () => true,
		currentState: () => cli.bridge,
		resolveTarget: async () => Promise.resolve({ok: true, value: {terminalId: "terminal-1", paneId: "w1:p1"}}),
		readScreen: async () => Promise.resolve({ok: true, value: render(cli)}),
		request: async (call) => {
			const fields = asRecord(call);
			const params = asRecord(fields?.["params"]);
			const keys = params?.["keys"];
			if (fields?.["method"] === "agent.send_keys" && Array.isArray(keys)) {
				for (const key of keys) press(cli, String(key));
			}
			if (fields?.["method"] === "agent.prompt") prompt(cli, String(params?.["text"]));
			return Promise.resolve({ok: true, value: {type: "ok"}});
		},
		createRequestId: () => "ccp:remote-control:test",
		pause: async () => Promise.resolve(),
		...overrides,
	};
}

async function describeResponse(response: Response): Promise<{body: unknown; status: number}> {
	return {body: await response.json(), status: response.status};
}

const CANT_TOGGLE = "Couldn’t toggle Remote Control. Try again.";

describe("herdr Remote Control handler", () => {
	it("turns Remote Control on by prompting /remote-control, with no keys", async () => {
		const cli = fakeCli({bridge: "off"});
		const response = await handleHerdrRemoteControl(postRequest({sessionId: "s1", on: true}), dependencies(cli));
		expect({response: await describeResponse(response), cli}).toStrictEqual({
			response: {body: {ok: true}, status: 200},
			cli: {...cli, bridge: "on", prompts: ["/remote-control"], keys: []},
		});
	});

	it("turns it off by picking Disconnect this session in the dialog /remote-control opens", async () => {
		const cli = fakeCli();
		const response = await handleHerdrRemoteControl(postRequest({sessionId: "s1", on: false}), dependencies(cli));
		expect({response: await describeResponse(response), cli}).toStrictEqual({
			response: {body: {ok: true}, status: 200},
			cli: {
				...cli,
				bridge: "off",
				dialog: false,
				selected: 0,
				prompts: ["/remote-control"],
				keys: ["up", "up", "enter"],
			},
		});
	});

	it("types nothing when the bridge is already in the asked state", async () => {
		const cli = fakeCli();
		const response = await handleHerdrRemoteControl(postRequest({sessionId: "s1", on: true}), dependencies(cli));
		expect({response: await describeResponse(response), prompts: cli.prompts, keys: cli.keys}).toStrictEqual({
			response: {body: {ok: true}, status: 200},
			prompts: [],
			keys: [],
		});
	});

	it("refuses without typing when no live CLI reports a bridge", async () => {
		const cli = fakeCli();
		const response = await handleHerdrRemoteControl(
			postRequest({sessionId: "s1", on: false}),
			dependencies(cli, {currentState: () => null}),
		);
		expect({response: await describeResponse(response), prompts: cli.prompts}).toStrictEqual({
			response: {body: {error: "Remote Control isn’t available for this session."}, status: 409},
			prompts: [],
		});
	});

	it("refuses without typing while Claude is working", async () => {
		const cli = fakeCli();
		const response = await handleHerdrRemoteControl(
			postRequest({sessionId: "s1", on: false}),
			dependencies(cli, {ready: () => false}),
		);
		expect({response: await describeResponse(response), prompts: cli.prompts}).toStrictEqual({
			response: {body: {error: "Remote Control can’t be changed while Claude is working"}, status: 409},
			prompts: [],
		});
	});

	it("refuses without typing while the CLI input holds a draft", async () => {
		const cli = fakeCli({input: "half-typed"});
		const response = await handleHerdrRemoteControl(postRequest({sessionId: "s1", on: false}), dependencies(cli));
		expect({response: await describeResponse(response), prompts: cli.prompts}).toStrictEqual({
			response: {body: {error: "Clear the terminal’s input before changing Remote Control"}, status: 409},
			prompts: [],
		});
	});

	it("presses nothing when the dialog never shows", async () => {
		const cli = fakeCli({noDialog: true});
		const response = await handleHerdrRemoteControl(postRequest({sessionId: "s1", on: false}), dependencies(cli));
		expect({response: await describeResponse(response), keys: cli.keys, bridge: cli.bridge}).toStrictEqual({
			response: {body: {error: CANT_TOGGLE}, status: 409},
			keys: [],
			bridge: "on",
		});
	});

	it("backs out with Escape when the selection will not reach Disconnect", async () => {
		const cli = fakeCli();
		const deps = dependencies(cli);
		const response = await handleHerdrRemoteControl(postRequest({sessionId: "s1", on: false}), {
			...deps,
			request: async (call) => {
				// The dialog ignores arrow keys.
				const keys = asRecord(asRecord(call)?.["params"])?.["keys"];
				if (Array.isArray(keys) && (keys.includes("up") || keys.includes("down"))) {
					cli.keys.push(...keys.map(String));
					return Promise.resolve({ok: true, value: {type: "ok"}});
				}
				return deps.request(call);
			},
		});
		expect({
			response: await describeResponse(response),
			last: cli.keys.at(-1),
			enter: cli.keys.includes("enter"),
			dialog: cli.dialog,
			bridge: cli.bridge,
		}).toStrictEqual({
			response: {body: {error: CANT_TOGGLE}, status: 409},
			last: "esc",
			enter: false,
			dialog: false,
			bridge: "on",
		});
	});

	it("passes herdr's refusal of the prompt through", async () => {
		const cli = fakeCli({bridge: "off"});
		const response = await handleHerdrRemoteControl(
			postRequest({sessionId: "s1", on: true}),
			dependencies(cli, {
				request: async () => Promise.resolve({ok: false, code: "agent_not_ready", message: "not ready"}),
			}),
		);
		expect(await describeResponse(response)).toStrictEqual({
			body: {error: "not ready", code: "agent_not_ready"},
			status: 409,
		});
	});

	it("refuses when writes are disabled", async () => {
		const cli = fakeCli();
		const response = await handleHerdrRemoteControl(
			postRequest({sessionId: "s1", on: false}),
			dependencies(cli, {writesEnabled: () => false}),
		);
		expect(await describeResponse(response)).toStrictEqual({
			body: {error: "herdr writes are disabled"},
			status: 403,
		});
	});

	it("rejects a body without the target state", async () => {
		const cli = fakeCli();
		const response = await handleHerdrRemoteControl(postRequest({sessionId: "s1"}), dependencies(cli));
		expect(await describeResponse(response)).toStrictEqual({
			body: {error: "sessionId and on are required"},
			status: 400,
		});
	});
});
