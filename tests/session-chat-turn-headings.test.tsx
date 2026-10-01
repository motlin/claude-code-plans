// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
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

function renderRecords(records: unknown[], showCompactSummaries = true): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries={showCompactSummaries}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
		/>,
	).container;
}

/**
 * The screen-reader heading opening every `group/msg` turn wrapper, as
 * `[className, text]` pairs. A wrapper whose first element child is not a
 * heading contributes `null`, so a missing heading fails loudly.
 */
function turnHeadings(container: HTMLElement): (readonly [string, string] | null)[] {
	return Array.from(container.querySelectorAll("[class*='group/msg']")).map((wrapper) => {
		const first = wrapper.firstElementChild;
		if (!(first instanceof HTMLHeadingElement)) return null;
		return [first.className, first.textContent ?? ""] as const;
	});
}

function heading(text: string): readonly [string, string] {
	return ["sr-only select-none", text] as const;
}

const USER_TEXT = {
	type: "user",
	uuid: "user-1",
	message: {role: "user", content: "Fabricated user message"},
};

const ASSISTANT_TEXT = {
	type: "assistant",
	uuid: "assistant-1",
	message: {
		role: "assistant",
		content: [{type: "text", text: "Fabricated assistant response"}],
	},
};

const TOOL_CALL = {
	type: "assistant",
	uuid: "assistant-tool-1",
	message: {
		role: "assistant",
		content: [{type: "tool_use", id: "t1", name: "Read", input: {file_path: "/a.ts"}}],
	},
};

const STOP_HOOK_FEEDBACK = {
	type: "user",
	uuid: "user-meta-1",
	isMeta: true,
	message: {role: "user", content: "Stop hook feedback: fabricated"},
};

const COMMAND_INVOCATION = {
	type: "user",
	uuid: "user-command-1",
	message: {
		role: "user",
		content: "<command-name>/fabricated</command-name><command-args>--dry-run</command-args>",
	},
};

const COMPACT_SUMMARY = {
	type: "user",
	uuid: "user-compact-1",
	isCompactSummary: true,
	message: {role: "user", content: "Fabricated compact summary"},
};

describe("SessionChat turn headings", () => {
	it("opens the user and assistant turns with upstream's screen-reader headings", () => {
		expect(turnHeadings(renderRecords([USER_TEXT, ASSISTANT_TEXT]))).toStrictEqual([
			heading("You said: Fabricated user message"),
			heading("Claude responded: Fabricated assistant response"),
		]);
	});

	it("labels a tool-only assistant turn as Claude", () => {
		expect(turnHeadings(renderRecords([TOOL_CALL]))).toStrictEqual([heading("Claude responded")]);
	});

	it("quotes only the first 80 characters of the turn, whitespace collapsed", () => {
		const long = `${"word ".repeat(10)}\n\n${"x".repeat(100)}`;
		const record = {...USER_TEXT, message: {role: "user", content: long}};
		expect(turnHeadings(renderRecords([record]))).toStrictEqual([
			heading(`You said: ${"word ".repeat(10)}${"x".repeat(30)}`),
		]);
	});

	it("labels every user-side entry variant as You said", () => {
		const collapsedCompact = renderRecords([COMPACT_SUMMARY], false);
		const expandedCompact = renderRecords([COMPACT_SUMMARY], false);
		fireEvent.click(expandedCompact.querySelector("button")!);

		expect({
			stopHookFeedback: turnHeadings(renderRecords([STOP_HOOK_FEEDBACK])),
			command: turnHeadings(renderRecords([COMMAND_INVOCATION])),
			collapsedCompactSummary: turnHeadings(collapsedCompact),
			expandedCompactSummary: turnHeadings(expandedCompact),
		}).toStrictEqual({
			stopHookFeedback: [heading("You said: Stop hook feedback: fabricated")],
			command: [heading("You said: /fabricated --dry-run")],
			collapsedCompactSummary: [heading("You said: Compacted conversation")],
			expandedCompactSummary: [heading("You said: Compacted conversation")],
		});
	});
});
