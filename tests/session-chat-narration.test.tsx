// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {join} from "node:path";
import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {messageText} from "../src/lib/transcript-action-targets";
import {processTranscript, type MessageSessionLine} from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
	useSettings: () => ({settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize()}));
vi.mock("../src/hooks/use-claude-events", () => ({useClaudeEvents: () => ({failedTools: new Map()})}));

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("innerHeight", 4000);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const SIGNATURES = JSON.parse(readFileSync(join(__dirname, "fixtures", "thinking-signatures.json"), "utf8")) as {
	emptyThinking: {signature: string};
	realThinking: {signature: string};
	narrations: {signature: string}[];
};
const NARRATION = SIGNATURES.narrations[1]!.signature;
const REAL_THINKING = SIGNATURES.realThinking.signature;
const EMPTY_THINKING = SIGNATURES.emptyThinking.signature;

const prompt = {type: "user", uuid: "u-prompt", message: {role: "user", content: "Fabricated question"}};
function thinking(uuid: string, text: string, signature: string) {
	return {
		type: "assistant",
		uuid,
		message: {role: "assistant", content: [{type: "thinking", thinking: text, signature}]},
	};
}
function command(uuid: string) {
	return [
		{
			type: "assistant",
			uuid,
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: `toolu-${uuid}`,
						name: "Bash",
						input: {command: "echo fabricated", description: `Fabricated ${uuid}`},
					},
				],
			},
		},
		{
			type: "user",
			uuid: `result-${uuid}`,
			message: {role: "user", content: [{type: "tool_result", tool_use_id: `toolu-${uuid}`, content: "ok"}]},
		},
	];
}

function rows(records: unknown[], showThinking = false) {
	const {lines, toolResultMap} = processTranscript(records);
	const {container} = render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showThinking={showThinking}
			showTools
			shouldScrollToEnd={false}
		/>,
	);
	return Array.from(container.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")).map((row) => ({
		perfRow: row.dataset["perfRow"],
		tools: Array.from(
			row.querySelectorAll('[data-tool-row] > [role="button"], [data-tool-row] > button'),
			(element) => element.textContent,
		),
		prose: Array.from(row.querySelectorAll("[data-transcript-prose]"), (element) => element.textContent?.trim()),
		thinkingBlocks: row.querySelectorAll('button[aria-label="Copy as quote"]').length,
	}));
}

describe("narration thinking blocks", () => {
	it("draws non-empty narration as assistant prose that splits the tool run around it, with thinking hidden", () => {
		const records = [
			prompt,
			...command("first"),
			thinking("a-empty", "", EMPTY_THINKING),
			thinking("a-narration", "Found the fabricated bug.", NARRATION),
			...command("second"),
			...command("third"),
			...command("fourth"),
		];
		const tool = (labels: string[]) => ({perfRow: "assistant_tool", tools: labels, prose: [], thinkingBlocks: 0});
		const expected = [
			{perfRow: "human", tools: [], prose: [], thinkingBlocks: 0},
			tool(["Fabricated first"]),
			{perfRow: "assistant_text", tools: [], prose: ["Found the fabricated bug."], thinkingBlocks: 0},
			tool(["Ran 3 commands"]),
		];
		const hidden = rows(records);
		cleanup();
		expect({hidden, shown: rows(records, true)}).toStrictEqual({hidden: expected, shown: expected});
	});

	it("keeps one tool run across empty narration and across hidden real thinking", () => {
		const emptyNarration = rows([
			prompt,
			...command("first"),
			thinking("a-n", "", NARRATION),
			...command("second"),
		]);
		cleanup();
		const realThinking = rows([
			prompt,
			...command("first"),
			thinking("a-t", "Fabricated pondering.", REAL_THINKING),
			...command("second"),
		]);
		const expected = [
			{perfRow: "human", tools: [], prose: [], thinkingBlocks: 0},
			{perfRow: "assistant_tool", tools: ["Ran 2 commands"], prose: [], thinkingBlocks: 0},
		];
		expect({emptyNarration, realThinking}).toStrictEqual({emptyNarration: expected, realThinking: expected});
	});

	it("keeps a narration block inside a tool line out of the tool run", () => {
		const mixed = {
			type: "assistant",
			uuid: "a-mixed",
			message: {
				role: "assistant",
				content: [
					{type: "thinking", thinking: "Fabricated narration in a tool line.", signature: NARRATION},
					{type: "tool_use", id: "toolu-mixed", name: "Bash", input: {command: "true", description: "Mixed"}},
				],
			},
		};
		const result = {
			type: "user",
			uuid: "r-mixed",
			message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu-mixed", content: "ok"}]},
		};
		expect(
			rows([prompt, ...command("first"), mixed, result]).map(({perfRow, prose}) => ({perfRow, prose})),
		).toStrictEqual([
			{perfRow: "human", prose: []},
			{perfRow: "assistant_tool", prose: []},
			{perfRow: "assistant_text", prose: ["Fabricated narration in a tool line."]},
		]);
	});

	it("counts narration as the message's text for copy and the span footer", () => {
		const {lines} = processTranscript([
			thinking("a-narration", "Found the fabricated bug.", NARRATION),
			thinking("a-real", "Fabricated pondering.", REAL_THINKING),
		]);
		expect(lines.map((line) => messageText(line as MessageSessionLine))).toStrictEqual([
			"Found the fabricated bug.",
			"",
		]);
	});
});
