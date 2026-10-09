// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
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
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

/**
 * A four-record session. The transcript endpoint serves only the tail of a long
 * session's JSONL, so the same records are rendered both as the whole file and
 * as a window that starts partway in.
 */
const RECORDS = [
	{type: "user", uuid: "u-1", message: {role: "user", content: "Fabricated first question"}},
	{
		type: "assistant",
		uuid: "a-1",
		message: {role: "assistant", content: [{type: "text", text: "Fabricated first answer"}]},
	},
	{type: "user", uuid: "u-2", message: {role: "user", content: "Fabricated second question"}},
	{
		type: "assistant",
		uuid: "a-2",
		message: {role: "assistant", content: [{type: "text", text: "Fabricated second answer"}]},
	},
];

function renderWindow(records: unknown[], recordStartIndex: number): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records, recordStartIndex);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
		/>,
	).container;
}

function recordIndices(container: HTMLElement): (string | null)[] {
	return Array.from(container.querySelectorAll("[data-record-index]")).map((element) =>
		element.getAttribute("data-record-index"),
	);
}

describe("SessionChat turn rows", () => {
	it("carries each turn's session-absolute record index, so a jump lands on the right row whichever window is loaded", () => {
		const wholeFile = recordIndices(renderWindow(RECORDS, 0));
		cleanup();

		expect({
			wholeFile,
			tailWindow: recordIndices(renderWindow(RECORDS.slice(2), 2)),
		}).toStrictEqual({wholeFile: ["0", "1", "2", "3"], tailWindow: ["2", "3"]});
	});

	it("gives no turn a URL of its own, matching upstream claude.ai/code, which addresses a session and nothing finer", () => {
		const container = renderWindow(RECORDS, 0);

		expect({
			messageAnchors: container.querySelectorAll("[id^='msg-']").length,
			copyLinkButtons: container.querySelectorAll("button[aria-label='Copy link']").length,
			copyMessageButtons: container.querySelectorAll("[data-message-actions] button[aria-label='Copy']").length,
		}).toStrictEqual({messageAnchors: 0, copyLinkButtons: 0, copyMessageButtons: 4});
	});

	it("marks each transcript row with upstream's per-type data-perf-row value", () => {
		const records = [
			{type: "agent-name", agentName: "Alice", sessionId: "test-session"},
			{type: "user", uuid: "u-1", message: {role: "user", content: "Fabricated question"}},
			{
				type: "assistant",
				uuid: "a-tool",
				message: {
					role: "assistant",
					content: [{type: "tool_use", id: "toolu_fabricated", name: "Bash", input: {command: "ls"}}],
				},
			},
			{
				type: "user",
				uuid: "u-result",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "toolu_fabricated", content: "fabricated.txt"}],
				},
			},
			{
				type: "assistant",
				uuid: "a-think",
				message: {
					role: "assistant",
					content: [{type: "thinking", thinking: "Fabricated pondering", signature: ""}],
				},
			},
			{
				type: "assistant",
				uuid: "a-text",
				message: {role: "assistant", content: [{type: "text", text: "Fabricated answer"}]},
			},
		];
		vi.stubGlobal("innerHeight", 4000);
		const {lines, toolResultMap} = processTranscript(records, 0);
		const {container} = render(
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				showSystemBanners
				showThinking
				showTools
				shouldScrollToEnd={false}
			/>,
		);

		expect(
			Array.from(container.querySelectorAll("[data-transcript-entry-index]")).map((row) => ({
				testId: row.getAttribute("data-testid"),
				perfRow: row.getAttribute("data-perf-row"),
			})),
		).toStrictEqual([
			{testId: "transcript-row", perfRow: "marker"},
			{testId: "transcript-row", perfRow: "human"},
			{testId: "transcript-row", perfRow: "assistant_tool"},
			{testId: "transcript-row", perfRow: "assistant_thinking"},
			{testId: "transcript-row", perfRow: "assistant_text"},
		]);
	});

	describe("ordinary prompt reply boundary", () => {
		const BOUNDARY_RECORDS = [
			{type: "user", uuid: "u-prose", message: {role: "user", content: "Fabricated prose question"}},
			{
				type: "assistant",
				uuid: "a-prose",
				message: {role: "assistant", content: [{type: "text", text: "Fabricated prose answer"}]},
			},
			{type: "user", uuid: "u-tool", message: {role: "user", content: "Fabricated tool question"}},
			{
				type: "assistant",
				uuid: "a-tool",
				message: {
					role: "assistant",
					content: [{type: "tool_use", id: "toolu_boundary", name: "Bash", input: {command: "ls"}}],
				},
			},
			{
				type: "user",
				uuid: "u-result",
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: "toolu_boundary", content: "fabricated.txt"}],
				},
			},
			{
				type: "user",
				uuid: "u-command",
				message: {role: "user", content: "<command-name>/fabricated</command-name>"},
			},
			{
				type: "assistant",
				uuid: "a-command",
				message: {role: "assistant", content: [{type: "text", text: "Fabricated command answer"}]},
			},
			{
				type: "user",
				uuid: "u-other-source",
				sessionId: "test-session",
				message: {role: "user", content: "Fabricated delegated question"},
			},
			{
				type: "assistant",
				uuid: "a-other-source",
				sessionId: "other-session",
				message: {role: "assistant", content: [{type: "text", text: "Fabricated delegated answer"}]},
			},
			{type: "user", uuid: "u-last", message: {role: "user", content: "Fabricated unanswered question"}},
		];

		function boundaryRows(transcriptMode: "normal" | "thinking" | "verbose") {
			vi.stubGlobal("innerHeight", 4000);
			const {lines, toolResultMap} = processTranscript(BOUNDARY_RECORDS, 0);
			const {container} = render(
				<SessionChat
					sessionId="test-session"
					lines={lines}
					toolResultMap={toolResultMap}
					showThinking={transcriptMode !== "normal"}
					showTools
					transcriptMode={transcriptMode}
					shouldScrollToEnd={false}
				/>,
			);
			const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")).map(
				(row) => ({
					line: row.dataset["perfLine"],
					perfRow: row.dataset["perfRow"],
					replyBoundary: row.dataset["replyBoundary"],
					className: row.getAttribute("class"),
					turnGap: row
						.querySelector(":scope > [data-record-index]")
						?.classList.contains("pb-[var(--chat-turn-gap)]"),
				}),
			);
			cleanup();
			return rows;
		}

		it("closes an ordinary prompt onto its same-source first reply with upstream's six-pixel boundary in Normal and Thinking, leaving Verbose on the turn gap", () => {
			const unchanged = (line: string, perfRow: string, turnGap: boolean | undefined) => ({
				line,
				perfRow,
				replyBoundary: undefined,
				className: null,
				turnGap,
			});
			const boundary = (line: string, perfRow: string, turnGap: boolean | undefined) => ({
				line,
				perfRow,
				replyBoundary: "",
				className: "pt-p5",
				turnGap,
			});
			const collapsed = [
				unchanged("0", "human", false),
				boundary("1", "assistant_text", true),
				unchanged("2", "human", false),
				boundary("3", "assistant_tool", true),
				unchanged("5", "human", true),
				unchanged("6", "assistant_text", true),
				unchanged("7", "human", true),
				unchanged("8", "assistant_text", true),
				unchanged("9", "human", true),
			];

			expect({
				normal: boundaryRows("normal"),
				thinking: boundaryRows("thinking"),
				verbose: boundaryRows("verbose"),
			}).toStrictEqual({
				normal: collapsed,
				thinking: collapsed,
				verbose: [
					unchanged("0", "human", true),
					unchanged("1", "assistant_text", true),
					unchanged("2", "human", true),
					unchanged("3", "assistant_tool", true),
					unchanged("5", "human", true),
					unchanged("6", "assistant_text", true),
					unchanged("7", "human", true),
					unchanged("8", "assistant_text", true),
					unchanged("9", "human", true),
				],
			});
		});
	});
});
