// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
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

function renderRecords(records: unknown[], showCompactSummaries: boolean): HTMLElement {
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

/** The class list of the message column that wraps a user bubble and its footer. */
function userColumnClassName(container: HTMLElement): string | null {
	const column = Array.from(container.querySelectorAll("div")).find((element) =>
		element.className.startsWith("flex flex-col items-"),
	);
	return column?.className ?? null;
}

/** Each hover bar's controls in order: button aria-labels, with the `<time>` as "time". */
function barControls(container: HTMLElement): string[][] {
	return Array.from(container.querySelectorAll("[data-message-actions]")).map((bar) =>
		Array.from(bar.querySelectorAll("button, time")).map((element) =>
			element.tagName === "TIME" ? "time" : (element.getAttribute("aria-label") ?? ""),
		),
	);
}

/** Focus a bar's time and return the tooltip it opens. */
function timeTooltip(container: HTMLElement, barIndex: number): string | null {
	const bar = container.querySelectorAll("[data-message-actions]")[barIndex]!;
	fireEvent.focus(bar.querySelector("time")!);
	act(() => {
		vi.advanceTimersByTime(300);
	});
	return bar.querySelector('[role="tooltip"]')?.textContent ?? null;
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

describe("SessionChat hover toolbars", () => {
	it("gives the assistant turn upstream's action bar and the user turn its mirrored bar", () => {
		const container = renderRecords(
			[
				{...USER_TEXT, timestamp: "2026-09-30T08:00:00.000Z"},
				{...ASSISTANT_TEXT, timestamp: "2026-09-30T08:01:00.000Z"},
			],
			true,
		);

		expect(barControls(container)).toStrictEqual([
			["time", "Copy", "Rewind to here", "Fork from here"],
			["Copy", "Fork from here", "Pin as chapter", "Read aloud", "time"],
		]);
	});
});

describe("SessionChat turn metadata", () => {
	it("moves effort, advisor, the classifier branch and the origin caption into the time tooltips", () => {
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
		const container = renderRecords(
			[
				{
					...USER_TEXT,
					timestamp: "2026-09-30T08:00:00.000Z",
					turnOrigin: "scheduled",
					scheduledTaskId: "ecc5631f",
					queuePriority: "later",
					serverClassifierContext: {
						context: {git_state: {branch: "feature"}, live_cwd: "/repo", platform: "macos"},
					},
				},
				{
					...ASSISTANT_TEXT,
					timestamp: "2026-09-30T08:01:00.000Z",
					perTurnEffort: "medium",
					advisorModel: "claude-opus-5-5",
				},
			],
			true,
		);
		const visible = container.textContent ?? "";
		const userTooltip = timeTooltip(container, 0) ?? "";
		const assistantTooltip = timeTooltip(container, 1) ?? "";
		vi.useRealTimers();

		expect({
			visible: ["Scheduled task", "queued for later", "feature", "medium effort", "advisor"].filter((text) =>
				visible.includes(text),
			),
			user: ["Scheduled task ecc5631f · queued for later", "Branch feature"].every((text) =>
				userTooltip.includes(text),
			),
			assistant: ["medium effort", "advisor Opus 5.5"].every((text) => assistantTooltip.includes(text)),
		}).toStrictEqual({visible: [], user: true, assistant: true});
	});
});

describe("SessionChat user action row", () => {
	it("keeps the user bubble column end-aligned", () => {
		expect(userColumnClassName(renderRecords([USER_TEXT], true))).toBe(
			"flex flex-col items-end gap-g6 max-w-[85%] min-w-0",
		);
	});

	it("uses the same end-aligned column for every user-side entry variant", () => {
		const compactContainer = renderRecords([COMPACT_SUMMARY], false);
		fireEvent.click(compactContainer.querySelector("button")!);

		expect({
			stopHookFeedback: userColumnClassName(renderRecords([STOP_HOOK_FEEDBACK], true)),
			command: userColumnClassName(renderRecords([COMMAND_INVOCATION], true)),
			compactSummary: userColumnClassName(compactContainer),
		}).toStrictEqual({
			stopHookFeedback: "flex flex-col items-end gap-g6 max-w-[85%] min-w-0",
			command: "flex flex-col items-end gap-g6 max-w-[85%] min-w-0",
			compactSummary: "flex flex-col items-end gap-g6 max-w-[85%] min-w-0",
		});
	});
});

/** The row that lays a user-side column out, and whether that column is its right-most child. */
function userRowLayout(container: HTMLElement): {rowClassName: string | null; columnIsRightMost: boolean} {
	const column = Array.from(container.querySelectorAll("div")).find((element) =>
		element.className.startsWith("flex flex-col items-"),
	);
	const row = column?.parentElement ?? null;
	return {rowClassName: row?.className ?? null, columnIsRightMost: row?.lastElementChild === column};
}

describe("SessionChat user turn alignment", () => {
	it("pushes every human bubble to the right edge of the transcript column like upstream", () => {
		const compactContainer = renderRecords([COMPACT_SUMMARY], false);
		fireEvent.click(compactContainer.querySelector("button")!);

		expect({
			user: userRowLayout(renderRecords([USER_TEXT], true)),
			stopHookFeedback: userRowLayout(renderRecords([STOP_HOOK_FEEDBACK], true)),
			command: userRowLayout(renderRecords([COMMAND_INVOCATION], true)),
			compactSummary: userRowLayout(compactContainer),
		}).toStrictEqual({
			user: {rowClassName: "group/msg flex justify-end w-full", columnIsRightMost: true},
			stopHookFeedback: {rowClassName: "group/msg flex justify-end w-full", columnIsRightMost: true},
			command: {rowClassName: "group/msg flex justify-end w-full", columnIsRightMost: true},
			compactSummary: {rowClassName: "flex justify-end pt-p6", columnIsRightMost: true},
		});
	});
});
