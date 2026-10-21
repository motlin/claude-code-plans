// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {getCallRenderer, getToolRenderer} from "../src/components/tool-renderers";
import {InvalidInputRenderer} from "../src/components/tool-renderers/fallback-renderer";
import {buildClientToolCall, type ClientToolCall} from "../src/components/tool-renderers/types";
import {toolLabel} from "../src/lib/tool-labels";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({
		settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("innerHeight", 10_000);
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn<HTMLElement["scrollIntoView"]>(),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const UNPARSED_READ_INPUT = {
	__unparsedToolInput: {
		raw: '{"file_path": "/Users/alice/projects/shop/packages/shared/src/index.ts", "offset": 280,330}',
		len: 92,
	},
};

/** An assistant record as Claude Code writes it: text, a Read whose JSON the model mangled, and a valid Bash. */
function assistantWithMalformedRead(): Record<string, unknown> {
	return {
		parentUuid: "9dd365ce-ea48-4ba2-a8cb-5c927c3bec77",
		isSidechain: false,
		message: {
			model: "claude-sonnet-5",
			id: "msg_011CeGVgxupUAWtSQHu3UryE",
			type: "message",
			role: "assistant",
			content: [
				{type: "text", text: "Checking the shared exports before the build."},
				{
					type: "tool_use",
					id: "toolu_01GECtMcdRzMwGeJZv8TgCu8",
					name: "Read",
					input: UNPARSED_READ_INPUT,
					caller: {type: "direct"},
				},
				{
					type: "tool_use",
					id: "toolu_01Bash00000000000000000",
					name: "Bash",
					input: {command: "pnpm build", description: "Build the shared package"},
					caller: {type: "direct"},
				},
			],
			stop_reason: "tool_use",
			stop_sequence: null,
			stop_details: null,
			usage: {
				input_tokens: 2,
				cache_creation_input_tokens: 697,
				cache_read_input_tokens: 116045,
				output_tokens: 100,
			},
			diagnostics: null,
		},
		requestId: "req_011CeGVgwrpPQNPMVwAeoQkR",
		type: "assistant",
		uuid: "0c5e3c8f-12de-4838-b78e-d8418c0ddd81",
		timestamp: "2026-08-21T20:06:06.943Z",
		userType: "external",
		entrypoint: "cli",
		cwd: "/Users/alice/projects/shop",
		sessionId: "8a7ec5dc-f297-4085-b1a5-9f1f20650bd6",
		version: "2.1.238",
		gitBranch: "main",
	};
}

/** The user record answering both calls: the mangled Read errored, the Bash ran. */
function toolResults(): Record<string, unknown> {
	return {
		parentUuid: "0c5e3c8f-12de-4838-b78e-d8418c0ddd81",
		isSidechain: false,
		type: "user",
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "toolu_01GECtMcdRzMwGeJZv8TgCu8",
					content:
						"<tool_use_error>InputValidationError: Read failed due to the following issue:\nThe required parameter `file_path` is missing</tool_use_error>",
					is_error: true,
				},
				{
					type: "tool_result",
					tool_use_id: "toolu_01Bash00000000000000000",
					content: "Build complete",
					is_error: false,
				},
			],
		},
		uuid: "5b1f6c2e-7d1a-4f4e-9a55-0f1c2d3e4f50",
		timestamp: "2026-08-21T20:06:08.112Z",
		userType: "external",
		entrypoint: "cli",
		cwd: "/Users/alice/projects/shop",
		sessionId: "8a7ec5dc-f297-4085-b1a5-9f1f20650bd6",
		version: "2.1.238",
		gitBranch: "main",
	};
}

describe("a schema-invalid tool input in the transcript", () => {
	it("keeps the assistant record and flags only the invalid call", () => {
		const [line] = processTranscript([assistantWithMalformedRead()]).lines;
		if (line?.type !== "assistant") throw new Error(`expected an assistant line, got ${line?.type}`);
		const fixture = assistantWithMalformedRead()["message"] as {content: unknown[]};
		expect({content: line.message?.content, invalidToolInputIds: line.invalidToolInputIds}).toStrictEqual({
			content: fixture.content,
			invalidToolInputIds: ["toolu_01GECtMcdRzMwGeJZv8TgCu8"],
		});
	});

	it("still rejects the whole record when anything besides a tool input is invalid", () => {
		const record = {...assistantWithMalformedRead(), unknownKey: 1};
		expect(processTranscript([record]).lines.map((line) => line.type)).toStrictEqual(["unparsed"]);
	});

	it("still rejects a tool_use whose input is not an object", () => {
		const record = assistantWithMalformedRead();
		const message = record["message"] as {content: Array<Record<string, unknown>>};
		message.content[1] = {...message.content[1], input: "file_path=/tmp/x"};
		expect(processTranscript([record]).lines.map((line) => line.type)).toStrictEqual(["unparsed"]);
	});

	it("renders the text and both calls instead of an unreadable record", () => {
		const {lines, toolResultMap} = processTranscript([assistantWithMalformedRead(), toolResults()]);
		const text = render(
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				shouldScrollToEnd={false}
				transcriptMode="verbose"
			/>,
		).container.textContent;
		expect({
			unreadable: text.includes("Unreadable"),
			prose: text.includes("Checking the shared exports before the build."),
			read: text.includes("Used Read"),
			bash: text.includes("Built the shared package"),
		}).toStrictEqual({unreadable: false, prose: true, read: true, bash: true});
	});
});

describe("a Workflow call with an args object", () => {
	it("is not flagged as an invalid input", () => {
		const record = assistantWithMalformedRead();
		const message = record["message"] as {content: unknown[]};
		message.content = [
			{
				type: "tool_use",
				id: "toolu_01K9McttAeyyjhG4N5C27hVJ",
				name: "Workflow",
				input: {scriptPath: "/x/wf.js", args: {max: 60}},
				caller: {type: "direct"},
			},
		];
		const [line] = processTranscript([record]).lines;
		expect({
			type: line?.type,
			invalidToolInputIds: line?.type === "assistant" ? line.invalidToolInputIds : null,
		}).toStrictEqual({
			type: "assistant",
			invalidToolInputIds: undefined,
		});
	});
});

describe("an invalid-input tool call", () => {
	const block = {
		type: "tool_use" as const,
		id: "toolu_01GECtMcdRzMwGeJZv8TgCu8",
		name: "Read",
		input: UNPARSED_READ_INPUT,
	};

	it("is built flagged, with no tool-specific param", () => {
		const call = buildClientToolCall(block, "src-uuid", new Map(), undefined, undefined, true);
		expect(call).toStrictEqual({
			id: "toolu_01GECtMcdRzMwGeJZv8TgCu8",
			name: "Read",
			input: UNPARSED_READ_INPUT,
			param: "",
			sourceUuid: "src-uuid",
			invalidInput: true,
		});
	});

	it("takes the generic label from the tool name", () => {
		expect(toolLabel({name: "Read", input: UNPARSED_READ_INPUT, invalidInput: true})).toStrictEqual({
			verb: "Used Read",
		});
	});

	it("renders through the raw-input renderer, not the tool's own", () => {
		const call = buildClientToolCall(block, "src-uuid", new Map(), undefined, undefined, true);
		const valid = buildClientToolCall({...block, input: {file_path: "/tmp/x"}}, "src-uuid", new Map());
		expect({
			invalid: getCallRenderer(call) === getToolRenderer("Read"),
			valid: getCallRenderer(valid) === getToolRenderer("Read"),
		}).toStrictEqual({invalid: false, valid: true});
	});

	it("shows the raw input as formatted JSON", () => {
		const call: ClientToolCall = {
			id: "toolu_01GECtMcdRzMwGeJZv8TgCu8",
			name: "Read",
			input: UNPARSED_READ_INPUT,
			param: "",
			sourceUuid: "src-uuid",
			invalidInput: true,
		};
		const {container} = render(<InvalidInputRenderer toolCall={call} />);
		expect(container.querySelector("pre")?.textContent).toBe(JSON.stringify(UNPARSED_READ_INPUT, null, 2));
	});
});
