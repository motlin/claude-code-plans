import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {
	handleHerdrRewind,
	parseMessageSelector,
	parseRewindConfirm,
	readComposerInput,
	visibleText,
	type HerdrRewindDependencies,
} from "../src/lib/herdr/rewind";
import {asRecord} from "../src/lib/narrow";
import {rejectCrossSite} from "../src/lib/same-origin-guard";

/** Real CLI 2.1.310 screens, read from a throwaway session's herdr pane. */
function fixture(name: string): string {
	return readFileSync(join(import.meta.dirname, `fixtures/rewind-${name}.txt`), "utf8");
}

describe("readComposerInput", () => {
	it("reads an empty input box", () => {
		expect(readComposerInput(fixture("idle"))).toStrictEqual("");
	});

	it("reads the prompt the CLI prefilled after a rewind", () => {
		expect(readComposerInput(fixture("after"))).toStrictEqual(
			"Use the Write tool to create c.txt containing just: delta",
		);
	});

	it("treats the empty box's placeholder as empty", () => {
		expect(readComposerInput(`${"─".repeat(20)}\n❯ Try "fix lint errors"\n${"─".repeat(20)}\n`)).toStrictEqual("");
	});

	it("is null without an input box", () => {
		expect(readComposerInput(fixture("selector-current"))).toStrictEqual(null);
	});
});

describe("visibleText", () => {
	const suggestion = readFileSync(join(import.meta.dirname, "fixtures/rewind-suggestion.ansi"), "utf8");

	it("keeps the CLI's dim prompt suggestion as plain text", () => {
		expect(readComposerInput(visibleText(suggestion))).toStrictEqual("Reply with just the word delta");
	});

	it("drops the dim suggestion so an otherwise empty input box reads empty", () => {
		expect(readComposerInput(visibleText(suggestion, {dropDim: true}))).toStrictEqual("");
	});

	it("keeps text that is not dim, including a 24-bit colour whose numbers contain a 2", () => {
		expect(
			visibleText("\u001b[1mtyped\u001b[22m \u001b[2mghost\u001b[0m \u001b[38;2;2;2;2mgrey\u001b[0m\r\n", {
				dropDim: true,
			}),
		).toStrictEqual("typed  grey\n");
	});
});

describe("parseMessageSelector", () => {
	it("reads the (current) row the selector opens on", () => {
		expect(parseMessageSelector(fixture("selector-current"))).toStrictEqual({selected: "(current)"});
	});

	it("reads the selected prompt row, skipping file-change and scroll lines", () => {
		expect(parseMessageSelector(fixture("selector-write"))).toStrictEqual({
			selected: "Use the Write tool to create c.txt containing just: delta",
		});
	});

	it("is null for the confirm step and the idle screen", () => {
		expect([parseMessageSelector(fixture("confirm")), parseMessageSelector(fixture("idle"))]).toStrictEqual([
			null,
			null,
		]);
	});
});

describe("parseRewindConfirm", () => {
	it("reads the quoted prompt and the numbered restore options", () => {
		expect(parseRewindConfirm(fixture("confirm"))).toStrictEqual({
			quote: "Use the Write tool to create c.txt containing just: delta",
			options: {
				"Restore code and conversation": 1,
				"Restore conversation": 2,
				"Restore code": 3,
				"Summarize from here": 4,
				"Summarize up to here": 5,
			},
		});
	});

	it("is null for the selector list", () => {
		expect(parseRewindConfirm(fixture("selector-write"))).toStrictEqual(null);
	});
});

const RULE = "─".repeat(40);

interface FakeCli {
	prompts: string[];
	/** Whether the CLI has file checkpointing on, so Enter opens the restore options. */
	checkpointing: boolean;
	input: string;
	mode: "idle" | "selector" | "confirm";
	selected: number;
	lastEscAt: number | null;
	keys: string[];
	/** Rows the fake renders with a different text, to model a stale browser view. */
	rowText?: (prompt: string) => string;
}

function fakeCli(prompts: string[], overrides: Partial<FakeCli> = {}): FakeCli {
	return {
		prompts,
		checkpointing: false,
		input: "",
		mode: "idle",
		selected: 0,
		lastEscAt: null,
		keys: [],
		...overrides,
	};
}

function render(cli: FakeCli): string {
	const composer = [RULE, `❯ ${cli.input}`, RULE, "  ⏵⏵ auto mode on (shift+tab to cycle)"];
	if (cli.mode === "idle") return ["⏺ gamma", ...composer].join("\n");
	if (cli.mode === "confirm") {
		const prompt = cli.prompts[cli.selected] ?? "";
		return [
			"   Rewind",
			"   Confirm you want to restore to the point before you sent this message:",
			`   │ ${prompt}`,
			"   │ (43s ago)",
			"   The conversation will be forked.",
			"   ❯ 1. Restore code and conversation",
			"     2. Restore conversation",
			"     3. Restore code",
			"     4. Never mind",
		].join("\n");
	}
	const rows = [...cli.prompts.map((prompt) => cli.rowText?.(prompt) ?? prompt), "(current)"];
	return [
		"⏺ gamma",
		"   Rewind",
		"   Restore and fork the conversation to the point before…",
		...rows.map((row, index) => `   ${index === cli.selected ? "❯" : " "} ${row}`),
		"   Enter to continue · Esc to cancel",
	].join("\n");
}

function restore(cli: FakeCli): void {
	cli.input = cli.prompts[cli.selected] ?? "";
	cli.prompts = cli.prompts.slice(0, cli.selected);
	cli.mode = "idle";
}

function press(cli: FakeCli, key: string, now: number): void {
	cli.keys.push(key);
	if (key === "esc") {
		if (cli.mode === "confirm") cli.mode = "selector";
		else if (cli.mode === "selector") cli.mode = "idle";
		else if (cli.lastEscAt !== null && now - cli.lastEscAt <= 1) {
			cli.mode = "selector";
			cli.selected = cli.prompts.length;
		}
		cli.lastEscAt = cli.mode === "idle" ? now : null;
		return;
	}
	cli.lastEscAt = null;
	if (cli.mode === "selector" && key === "up") cli.selected = Math.max(0, cli.selected - 1);
	else if (cli.mode === "selector" && key === "enter" && cli.selected < cli.prompts.length) {
		if (cli.checkpointing) cli.mode = "confirm";
		else restore(cli);
	} else if (cli.mode === "confirm" && (key === "1" || key === "2")) restore(cli);
}

function postRequest(body: unknown): Request {
	return new Request("http://127.0.0.1:7526/api/herdr/rewind", {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(body),
	});
}

function dependencies(cli: FakeCli, overrides: Partial<HerdrRewindDependencies> = {}): HerdrRewindDependencies {
	let tick = 0;
	return {
		rejectRequest: rejectCrossSite,
		writesEnabled: () => true,
		ready: () => true,
		resolveTarget: async () => Promise.resolve({ok: true, value: {terminalId: "terminal-1", paneId: "w1:p1"}}),
		readScreen: async () => Promise.resolve({ok: true, value: render(cli)}),
		request: async (call) => {
			const fields = asRecord(call);
			const keys = asRecord(fields?.["params"])?.["keys"];
			if (fields?.["method"] === "agent.send_keys" && Array.isArray(keys)) {
				for (const key of keys) press(cli, String(key), tick);
			}
			return Promise.resolve({ok: true, value: {type: "ok"}});
		},
		createRequestId: () => "ccp:rewind:test",
		pause: async () => {
			tick += 1;
			return Promise.resolve();
		},
		...overrides,
	};
}

async function describeResponse(response: Response): Promise<{body: unknown; status: number}> {
	return {body: await response.json(), status: response.status};
}

const PROMPTS = ["Reply alpha", "Reply beta", "Reply gamma"];
const CANT_REWIND = "Can’t rewind to this message.";

describe("herdr rewind handler", () => {
	it("opens the selector, steps up to target 1 of 3 and restores the conversation", async () => {
		const cli = fakeCli(PROMPTS);
		const response = await handleHerdrRewind(
			postRequest({sessionId: "session-1", stepsBack: 2, text: "Reply beta"}),
			dependencies(cli),
		);
		expect({response: await describeResponse(response), keys: cli.keys, input: cli.input}).toStrictEqual({
			response: {body: {ok: true}, status: 200},
			keys: ["esc", "esc", "up", "up", "enter"],
			input: "Reply beta",
		});
	});

	it("picks Restore conversation from the options when file checkpointing is on", async () => {
		const cli = fakeCli(PROMPTS, {checkpointing: true});
		const response = await handleHerdrRewind(
			postRequest({sessionId: "session-1", stepsBack: 3, text: "Reply alpha"}),
			dependencies(cli),
		);
		expect({response: await describeResponse(response), keys: cli.keys, prompts: cli.prompts}).toStrictEqual({
			response: {body: {ok: true}, status: 200},
			keys: ["esc", "esc", "up", "up", "up", "enter", "2"],
			prompts: [],
		});
	});

	it("picks Restore code and conversation when asked to restore both", async () => {
		const cli = fakeCli(PROMPTS, {checkpointing: true});
		const response = await handleHerdrRewind(
			postRequest({sessionId: "session-1", stepsBack: 1, text: "Reply gamma", restore: "both"}),
			dependencies(cli),
		);
		expect({response: await describeResponse(response), keys: cli.keys}).toStrictEqual({
			response: {body: {ok: true}, status: 200},
			keys: ["esc", "esc", "up", "enter", "1"],
		});
	});

	it("refuses without a key while the pane is working", async () => {
		const cli = fakeCli(PROMPTS);
		const response = await handleHerdrRewind(
			postRequest({sessionId: "session-1", stepsBack: 1, text: "Reply gamma"}),
			dependencies(cli, {ready: () => false}),
		);
		expect({response: await describeResponse(response), keys: cli.keys}).toStrictEqual({
			response: {body: {error: "Rewind is unavailable while Claude is working"}, status: 409},
			keys: [],
		});
	});

	it("rewinds past the CLI's dim prompt suggestion in an empty input box", async () => {
		const cli = fakeCli(PROMPTS);
		const deps = dependencies(cli);
		const response = await handleHerdrRewind(
			postRequest({sessionId: "session-1", stepsBack: 1, text: "Reply gamma"}),
			{
				...deps,
				readScreen: async (sessionId, paneId) => {
					const screen = await deps.readScreen(sessionId, paneId);
					if (!screen.ok || cli.mode !== "idle" || cli.input !== "") return screen;
					return {ok: true, value: screen.value.replace("❯ ", "❯ \u001b[2mReply delta\u001b[0m")};
				},
			},
		);
		expect({response: await describeResponse(response), keys: cli.keys}).toStrictEqual({
			response: {body: {ok: true}, status: 200},
			keys: ["esc", "esc", "up", "enter"],
		});
	});

	it("refuses without a key while the CLI input holds a draft", async () => {
		const cli = fakeCli(PROMPTS, {input: "half-typed"});
		const response = await handleHerdrRewind(
			postRequest({sessionId: "session-1", stepsBack: 1, text: "Reply gamma"}),
			dependencies(cli),
		);
		expect({response: await describeResponse(response), keys: cli.keys}).toStrictEqual({
			response: {body: {error: "Clear the terminal's input before rewinding"}, status: 409},
			keys: [],
		});
	});

	it("refuses without a live terminal", async () => {
		const cli = fakeCli(PROMPTS);
		const response = await handleHerdrRewind(
			postRequest({sessionId: "session-1", stepsBack: 1, text: "Reply gamma"}),
			dependencies(cli, {
				resolveTarget: async () =>
					Promise.resolve({ok: false, code: "session-not-found", message: "not attached"}),
			}),
		);
		expect(await describeResponse(response)).toStrictEqual({
			body: {error: "Rewind is unavailable while the computer running this session is offline"},
			status: 409,
		});
	});

	it("aborts with Escape when the selected row is not the target's text", async () => {
		const cli = fakeCli(PROMPTS);
		const response = await handleHerdrRewind(
			postRequest({sessionId: "session-1", stepsBack: 2, text: "Reply gamma"}),
			dependencies(cli),
		);
		expect({response: await describeResponse(response), keys: cli.keys, mode: cli.mode}).toStrictEqual({
			response: {body: {error: CANT_REWIND}, status: 409},
			keys: ["esc", "esc", "up", "up", "esc"],
			mode: "idle",
		});
	});

	it("matches a row the CLI truncated with an ellipsis", async () => {
		const cli = fakeCli(PROMPTS, {rowText: (prompt) => `${prompt.slice(0, 7)}…`});
		const response = await handleHerdrRewind(
			postRequest({sessionId: "session-1", stepsBack: 2, text: "Reply beta"}),
			dependencies(cli),
		);
		expect(await describeResponse(response)).toStrictEqual({body: {ok: true}, status: 200});
	});

	it("aborts with Escape when the selector never opens", async () => {
		const cli = fakeCli(PROMPTS);
		const response = await handleHerdrRewind(
			postRequest({sessionId: "session-1", stepsBack: 1, text: "Reply gamma"}),
			dependencies(cli, {
				readScreen: async () => Promise.resolve({ok: true, value: render({...cli, mode: "idle"})}),
			}),
		);
		expect({response: await describeResponse(response), keys: cli.keys}).toStrictEqual({
			response: {body: {error: CANT_REWIND}, status: 409},
			keys: ["esc", "esc", "esc"],
		});
	});

	it("aborts out of the confirm step when its quote is another prompt", async () => {
		const cli = fakeCli(PROMPTS, {checkpointing: true, rowText: () => "Reply…"});
		const response = await handleHerdrRewind(
			postRequest({sessionId: "session-1", stepsBack: 1, text: "Reply gammaX"}),
			dependencies(cli),
		);
		expect({response: await describeResponse(response), keys: cli.keys, mode: cli.mode}).toStrictEqual({
			response: {body: {error: CANT_REWIND}, status: 409},
			keys: ["esc", "esc", "up", "enter", "esc", "esc"],
			mode: "idle",
		});
	});

	it("rejects a body without a positive stepsBack", async () => {
		const response = await handleHerdrRewind(
			postRequest({sessionId: "session-1", stepsBack: 0, text: "Reply gamma"}),
			dependencies(fakeCli(PROMPTS)),
		);
		expect(await describeResponse(response)).toStrictEqual({
			body: {error: "sessionId, text and a positive stepsBack are required"},
			status: 400,
		});
	});
});
