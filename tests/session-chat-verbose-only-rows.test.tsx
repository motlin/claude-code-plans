// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
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
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function attachment(uuid: string, payload: Record<string, unknown>) {
	return {
		type: "attachment",
		uuid,
		parentUuid: null,
		isSidechain: false,
		sessionId: "test-session",
		timestamp: "2026-09-30T08:00:00.000Z",
		attachment: payload,
	};
}

const RECORDS: unknown[] = [
	attachment("att-agents", {type: "agent_listing_delta", addedTypes: ["a", "b"], isInitial: true}),
	attachment("att-skills", {type: "skill_listing", skillCount: 4, isInitial: true}),
	attachment("att-batching", {type: "batching_reminder_sent", text: "batch your calls"}),
	attachment("att-tokens", {type: "total_tokens_reminder", text: "<total_tokens>1000 tokens left</total_tokens>"}),
	attachment("att-queued", {type: "queued_command", prompt: "do the thing", commandMode: "prompt"}),
	attachment("att-hook-message", {
		type: "hook_system_message",
		hookName: "PreToolUse:Bash",
		hookEvent: "PreToolUse",
		content: "Run git status first",
	}),
	{
		type: "assistant",
		uuid: "a1",
		timestamp: "2026-09-30T08:01:00.000Z",
		message: {
			role: "assistant",
			content: [{type: "text", text: "Fabricated assistant response"}],
			input_transformations: [
				{type: "thinking_dropped", path: "messages.2.content.0", reason: "model_binding_mismatch"},
			],
		},
	},
	{
		type: "system",
		subtype: "stop_hook_summary",
		uuid: "sys-stop",
		timestamp: "2026-09-30T08:02:00.000Z",
		hookCount: 6,
		hookErrors: ["boom"],
		preventedContinuation: false,
	},
	attachment("att-hook-blocked", {
		type: "hook_blocking_error",
		hookName: "Stop",
		hookEvent: "Stop",
		blockingError: {message: "keep going"},
	}),
];

const DIAGNOSTIC_TEXT = [
	"Agents — initial",
	"Skills (4)",
	"Batching reminder",
	"Token budget reminder",
	"Queued command",
	"stop hooks ran",
	"Hook blocked: Stop",
];

function renderMode(mode: TranscriptMode): HTMLElement {
	const {lines, toolResultMap} = processTranscript(RECORDS);
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

/** Focus the assistant bar's time and return the tooltip it opens. */
function assistantTimeTooltip(container: HTMLElement): string {
	const bars = container.querySelectorAll("[data-message-actions]");
	const bar = bars[bars.length - 1]!;
	fireEvent.focus(bar.querySelector("time")!);
	act(() => {
		vi.advanceTimersByTime(300);
	});
	return bar.querySelector('[role="tooltip"]')?.textContent ?? "";
}

function observe(mode: TranscriptMode) {
	vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
	const container = renderMode(mode);
	const text = container.textContent ?? "";
	const tooltip = assistantTimeTooltip(container);
	return {
		diagnostics: DIAGNOSTIC_TEXT.filter((label) => text.includes(label)),
		hookMessage: text.includes("PreToolUse:Bash says: Run git status first"),
		thinkingDropped: tooltip.includes("1 thinking block dropped"),
	};
}

describe("Verbose-only diagnostic rows", () => {
	it("hides system banners, stop-hook summaries and dropped-thinking counts in Normal mode", () => {
		expect(observe("normal")).toStrictEqual({diagnostics: [], hookMessage: true, thinkingDropped: false});
	});

	it("hides diagnostic reminders in Thinking mode", () => {
		expect(observe("thinking")).toStrictEqual({diagnostics: [], hookMessage: true, thinkingDropped: false});
	});

	it("shows them all in Verbose mode", () => {
		expect(observe("verbose")).toStrictEqual({
			diagnostics: DIAGNOSTIC_TEXT,
			hookMessage: true,
			thinkingDropped: true,
		});
	});
});
