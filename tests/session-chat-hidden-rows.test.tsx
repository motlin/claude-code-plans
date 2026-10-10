// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";
import type {TranscriptMode} from "../src/lib/transcript-mode";

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
	// A tall viewport, so the virtualized list mounts every row.
	vi.stubGlobal("innerHeight", 10_000);
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {configurable: true, value: vi.fn()});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function renderRecords(records: unknown[], mode: TranscriptMode): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			shouldScrollToEnd={false}
			transcriptMode={mode}
		/>,
	).container;
}

function entryLines(container: HTMLElement): (string | undefined)[] {
	return Array.from(container.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")).map(
		(row) => row.dataset["perfLine"],
	);
}

function interruptedSession(text: string): unknown[] {
	return [
		{type: "user", uuid: "u-1", message: {role: "user", content: "Fabricated question"}},
		{
			type: "assistant",
			uuid: "a-1",
			message: {role: "assistant", content: [{type: "text", text: "Fabricated answer"}]},
		},
		{type: "user", uuid: "u-2", message: {role: "user", content: [{type: "text", text}]}},
	];
}

describe("Request interrupted records", () => {
	it.each(["[Request interrupted by user]", "[Request interrupted by user for tool use]"])(
		"draw no entry for %s outside Verbose and keep it in Verbose",
		(text) => {
			const observe = (mode: TranscriptMode) => {
				const container = renderRecords(interruptedSession(text), mode);
				const result = {
					entries: entryLines(container),
					interrupted: (container.textContent ?? "").includes("Request interrupted"),
				};
				cleanup();
				return result;
			};

			expect({
				normal: observe("normal"),
				thinking: observe("thinking"),
				verbose: observe("verbose"),
			}).toStrictEqual({
				normal: {entries: ["0", "1"], interrupted: false},
				thinking: {entries: ["0", "1"], interrupted: false},
				verbose: {entries: ["0", "1", "2"], interrupted: true},
			});
		},
	);
});

function boundaryRows(records: unknown[], mode: TranscriptMode) {
	const container = renderRecords(records, mode);
	const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")).map((row) => ({
		line: row.dataset["perfLine"],
		replyBoundary: row.dataset["replyBoundary"],
		turnGap: row.querySelector(":scope > [data-record-index]")?.classList.contains("pb-[var(--chat-turn-gap)]"),
	}));
	cleanup();
	return rows;
}

function promptThenMetaThenReply(meta: unknown): unknown[] {
	return [
		{type: "user", uuid: "u-1", message: {role: "user", content: "Fabricated question"}},
		meta,
		{
			type: "assistant",
			uuid: "a-1",
			message: {role: "assistant", content: [{type: "text", text: "Fabricated answer"}]},
		},
	];
}

const IMAGE_SOURCE_META = {
	type: "user",
	uuid: "u-meta-image",
	isMeta: true,
	message: {role: "user", content: [{type: "text", text: "[Image: source: /fabricated/screenshot.png]"}]},
};

const SKILL_BODY_META = {
	type: "user",
	uuid: "u-meta-skill",
	isMeta: true,
	message: {role: "user", content: [{type: "text", text: "Base directory for this skill: /fabricated/skill"}]},
};

const ORPHAN_TOOL_RESULT = {
	type: "user",
	uuid: "u-orphan-result",
	message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_missing", content: "fabricated"}]},
};

describe("Meta user records between a prompt and its reply", () => {
	it.each([
		["an image-source note", IMAGE_SOURCE_META],
		["a skill body", SKILL_BODY_META],
		["an orphan tool result", ORPHAN_TOOL_RESULT],
	])("leave no empty entry, so %s keeps the reply boundary", (_name, meta) => {
		const records = promptThenMetaThenReply(meta);

		expect({normal: boundaryRows(records, "normal"), verbose: boundaryRows(records, "verbose")}).toStrictEqual({
			normal: [
				{line: "0", replyBoundary: undefined, turnGap: false},
				{line: "2", replyBoundary: "", turnGap: true},
			],
			verbose: [
				{line: "0", replyBoundary: undefined, turnGap: true},
				{line: "2", replyBoundary: undefined, turnGap: true},
			],
		});
	});
});

const STOP_HOOK_SESSION: unknown[] = [
	{type: "user", uuid: "u-1", message: {role: "user", content: "Fabricated question"}},
	{
		type: "assistant",
		uuid: "a-1",
		message: {role: "assistant", content: [{type: "text", text: "Fabricated answer"}]},
	},
	{
		type: "user",
		uuid: "u-stop-hook",
		isMeta: true,
		message: {role: "user", content: "Stop hook feedback:\nFabricated first line\nFabricated second line"},
	},
	{
		type: "assistant",
		uuid: "a-2",
		message: {role: "assistant", content: [{type: "text", text: "Fabricated follow-up"}]},
	},
];

describe("Stop hook feedback", () => {
	it.each<TranscriptMode>(["normal", "verbose"])(
		"collapses into a left-aligned 'Hook re-prompted Claude' disclosure in %s mode",
		(mode) => {
			const container = renderRecords(STOP_HOOK_SESSION, mode);
			const button = screen.getByRole("button", {name: "Hook re-prompted Claude"});
			const collapsed = {
				ariaExpanded: button.getAttribute("aria-expanded"),
				buttonClassName: button.className,
				labelClassName: button.querySelector("span")?.className,
				markerClassName: button.parentElement?.className,
				rightAligned: button.closest(".justify-end") !== null,
				promptBubbleOnly: container.querySelectorAll(".user-message-bubble").length === 1,
				stopHookText: (container.textContent ?? "").includes("Stop hook feedback"),
				feedbackText: (container.textContent ?? "").includes("Fabricated first line"),
			};
			fireEvent.click(button);
			const body = document.getElementById(button.getAttribute("aria-controls")!);
			const feedback = body?.querySelector(".font-mono");

			expect({
				collapsed,
				expanded: {
					ariaExpanded: button.getAttribute("aria-expanded"),
					bodyClassName: body?.className,
					innerClassName: feedback?.parentElement?.className,
					feedbackClassName: feedback?.className,
					feedbackText: feedback?.textContent,
					stopHookText: (container.textContent ?? "").includes("Stop hook feedback"),
				},
			}).toStrictEqual({
				collapsed: {
					ariaExpanded: "false",
					buttonClassName:
						"group/step flex self-stretch min-w-0 me-[52px] items-center gap-g2 px-1 py-0.5 text-left outline-none hide-focus-ring focus:ring-focus rounded-r3",
					labelClassName: "text-body min-w-0 truncate text-ink-muted group-hover/step:text-secondary",
					markerClassName: "flex flex-col w-full min-w-0 py-px",
					rightAligned: false,
					promptBubbleOnly: true,
					stopHookText: false,
					feedbackText: false,
				},
				expanded: {
					ariaExpanded: "true",
					bodyClassName: "break-words ps-1",
					innerClassName: "pt-1",
					feedbackClassName:
						"font-mono text-caption text-secondary whitespace-pre-wrap break-all select-text",
					feedbackText: "Fabricated first line\nFabricated second line",
					stopHookText: false,
				},
			});
		},
	);
});
