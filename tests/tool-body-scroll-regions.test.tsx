// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {BashRenderer} from "../src/components/tool-renderers/bash-renderer";
import {ReadRenderer} from "../src/components/tool-renderers/read-renderer";
import {CopyButton, KeyValueCard, TerminalOutput} from "../src/components/tool-renderers/shared";
import {WriteRenderer} from "../src/components/tool-renderers/write-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
	useSettings: () => ({settings: {showDebug: false}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));
vi.mock("../src/hooks/use-shiki", () => ({
	useHighlightedLines: () => null,
	getHighlighterSync: () => null,
	getHighlighterVersion: () => 0,
	subscribeHighlighter: () => () => {},
}));
vi.mock("../src/components/tool-renderers/inline-diff", () => ({
	InlineDiff: () => <div data-testid="diff-view" />,
}));

class NoopResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords(): ResizeObserverEntry[] {
		return [];
	}
}

globalThis.ResizeObserver = NoopResizeObserver;

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function oneToolCall(name: string, input: Record<string, unknown>, result: string): unknown[] {
	return [
		{
			type: "assistant",
			uuid: "a1",
			message: {role: "assistant", content: [{type: "tool_use", id: "t1", name, input}]},
		},
		{
			type: "user",
			uuid: "r1",
			parentUuid: "a1",
			message: {role: "user", content: [{type: "tool_result", tool_use_id: "t1", content: result}]},
		},
	];
}

function renderTranscript(records: unknown[]): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries
			showTranscriptOnly
			showThinking
			shouldScrollToEnd={false}
		/>,
	).container;
}

function toolCall(name: string, input: Record<string, unknown>, result?: string): ClientToolCall {
	return {id: "tool-call-1", name, input, param: "", result, sourceUuid: "source-1"};
}

interface Region {
	label: string | null;
	tabIndex: number;
	text: string | null;
}

function regions(container: HTMLElement): Region[] {
	return [...container.querySelectorAll<HTMLElement>('[role="group"]')].map((element) => ({
		label: element.getAttribute("aria-label"),
		tabIndex: element.tabIndex,
		text: element.textContent,
	}));
}

describe("expanded tool bodies expose labelled, focusable scroll regions", () => {
	it("names an expanded Skill row's scroller 'Tool call details'", async () => {
		const container = renderTranscript(oneToolCall("Skill", {skill: "alice-skill"}, "Launching skill"));
		fireEvent.click(container.querySelector('[role="button"]') as Element);

		await waitFor(() => {
			expect(regions(container)).toStrictEqual([
				{label: "Tool call details", tabIndex: 0, text: "skill: alice-skillLaunching skill"},
			]);
		});
	});

	it("names an expanded Bash row's output 'Tool output'", async () => {
		const container = renderTranscript(oneToolCall("Bash", {command: "ls"}, "alice.ts"));
		fireEvent.click(container.querySelector('[role="button"]') as Element);

		await waitFor(() => {
			expect(regions(container)).toStrictEqual([{label: "Tool output", tabIndex: 0, text: "alice.ts"}]);
		});
	});

	it("names the Bash, Read, Write and terminal output scrollers 'Tool output'", () => {
		const bash = regions(
			render(<BashRenderer toolCall={toolCall("Bash", {command: "ls"}, "$ ls\nalice.ts")} />).container,
		);
		cleanup();
		const read = regions(
			render(<ReadRenderer toolCall={toolCall("Read", {file_path: "/a.ts"}, "1→const alice = 1;")} />).container,
		);
		cleanup();
		const readError = regions(
			render(<ReadRenderer toolCall={{...toolCall("Read", {file_path: "/a.ts"}, "ENOENT"), isError: true}} />)
				.container,
		);
		cleanup();
		const write = regions(
			render(<WriteRenderer toolCall={toolCall("Write", {file_path: "/a.ts", content: "x"})} />).container,
		);
		cleanup();
		const writeNoContent = regions(
			render(<WriteRenderer toolCall={toolCall("Write", {file_path: "/a.ts"}, "File created")} />).container,
		);
		cleanup();
		const writeError = regions(
			render(
				<WriteRenderer
					toolCall={{...toolCall("Write", {file_path: "/a.ts", content: "x"}, "EACCES"), isError: true}}
				/>,
			).container,
		);
		cleanup();
		const terminal = regions(render(<TerminalOutput content="hello" />).container);

		expect({bash, read, readError, write, writeNoContent, writeError, terminal}).toStrictEqual({
			bash: [{label: "Tool output", tabIndex: 0, text: "alice.ts"}],
			read: [{label: "Tool output", tabIndex: 0, text: "1const alice = 1;"}],
			readError: [{label: "Tool output", tabIndex: 0, text: "ENOENT"}],
			write: [{label: "Tool output", tabIndex: 0, text: ""}],
			writeNoContent: [{label: "Tool output", tabIndex: 0, text: "File created"}],
			writeError: [
				{label: "Tool output", tabIndex: 0, text: ""},
				{label: "Tool output", tabIndex: 0, text: "EACCES"},
			],
			terminal: [{label: "Tool output", tabIndex: 0, text: "hello"}],
		});
	});

	it("renders the key label at 12px mono, opacity .7", () => {
		const {container} = render(<KeyValueCard params={[{key: "pattern", value: "alice"}]} />);
		const label = [...container.querySelectorAll("span")].find((span) => span.textContent === "pattern: ");

		expect(label?.className).toBe("text-[12px] font-mono opacity-70");
	});
});

describe("CopyButton", () => {
	function buttonShape(container: HTMLElement) {
		const button = container.querySelector("button");
		const svg = button?.querySelector("svg");
		return {
			className: button?.className,
			iconWidth: svg?.getAttribute("width"),
			iconHeight: svg?.getAttribute("height"),
		};
	}

	it("shows the dark 'Copy' tooltip on hover", () => {
		vi.useFakeTimers();
		render(<CopyButton text="alice" />);
		const button = screen.getByRole("button", {name: "Copy"});

		fireEvent.pointerEnter(button.parentElement as Element);
		act(() => {
			vi.advanceTimersByTime(300);
		});

		expect(screen.getByRole("tooltip").textContent).toBe("Copy");
	});

	it("sizes the default button 24x24 with a 16px icon", () => {
		const {container} = render(<CopyButton text="alice" />);

		expect(buttonShape(container)).toStrictEqual({
			className:
				"inline-flex size-6 items-center justify-center border-0 cursor-default select-none rounded-r4 text-secondary hover:text-primary hover:bg-t2 transition-colors",
			iconWidth: "16",
			iconHeight: "16",
		});
	});

	it("sizes the xs button 20x20 with a 12px icon", () => {
		const {container} = render(<CopyButton text="alice" size="xs" />);

		expect(buttonShape(container)).toStrictEqual({
			className:
				"inline-flex size-5 items-center justify-center border-0 cursor-default select-none rounded-r4 text-secondary hover:text-primary hover:bg-t2 transition-colors",
			iconWidth: "12",
			iconHeight: "12",
		});
	});

	it("uses the xs size in the Bash command card", () => {
		const {container} = render(<BashRenderer toolCall={toolCall("Bash", {command: "ls"}, "$ ls\nalice.ts")} />);
		const card = container.querySelector("[data-bash-code-card]") as HTMLElement;

		expect(buttonShape(card)).toStrictEqual({
			className:
				"inline-flex size-5 items-center justify-center border-0 cursor-default select-none rounded-r4 text-secondary hover:text-primary hover:bg-t2 transition-colors",
			iconWidth: "12",
			iconHeight: "12",
		});
	});
});
