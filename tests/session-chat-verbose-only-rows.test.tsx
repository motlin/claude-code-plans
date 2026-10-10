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
	attachment("att-auto-mode", {type: "auto_mode", bashFirst: true, steerOnly: true, bypass: false}),
	attachment("att-hook-context-bash", {
		type: "hook_additional_context",
		hookName: "PostToolUse:Bash",
		hookEvent: "PostToolUse",
		toolUseID: "toolu_x",
		content: ["Git commit detected!"],
	}),
	attachment("att-hook-context-prompt", {
		type: "hook_additional_context",
		hookName: "UserPromptSubmit",
		hookEvent: "UserPromptSubmit",
		content: ["CAVEMAN MODE ACTIVE"],
	}),
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
	"Auto mode",
	"Hook context: PostToolUse:Bash",
	"Hook context: UserPromptSubmit",
];

function renderRecords(records: unknown[], mode: TranscriptMode, showHookWarnings = true): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			shouldScrollToEnd={false}
			transcriptMode={mode}
			showHookWarnings={showHookWarnings}
		/>,
	).container;
}

function renderMode(mode: TranscriptMode): HTMLElement {
	return renderRecords(RECORDS, mode);
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

function bashCall(id: string): unknown[] {
	return [
		{
			type: "assistant",
			uuid: `a-${id}`,
			timestamp: "2026-09-30T08:01:00.000Z",
			message: {
				role: "assistant",
				content: [{type: "tool_use", id, name: "Bash", input: {command: `echo ${id}`}}],
			},
		},
		{
			type: "user",
			uuid: `r-${id}`,
			parentUuid: `a-${id}`,
			timestamp: "2026-09-30T08:01:01.000Z",
			message: {role: "user", content: [{type: "tool_result", tool_use_id: id, content: "ok", is_error: false}]},
		},
	];
}

const HOOK_CONTEXT_BETWEEN_COMMANDS: unknown[] = [
	...bashCall("first"),
	attachment("att-hook-context", {
		type: "hook_additional_context",
		hookName: "PostToolUse:Bash",
		hookEvent: "PostToolUse",
		toolUseID: "first",
		content: ["Git commit detected!"],
	}),
	...bashCall("second"),
];

function observeGrouping(mode: TranscriptMode) {
	const text = renderRecords(HOOK_CONTEXT_BETWEEN_COMMANDS, mode).textContent ?? "";
	return {
		merged: text.includes("Ran 2 commands"),
		hookContext: text.includes("Hook context: PostToolUse:Bash"),
	};
}

describe("Hook context between commands", () => {
	it("merges the surrounding commands into one group in Normal mode", () => {
		expect(observeGrouping("normal")).toStrictEqual({merged: true, hookContext: false});
	});

	it("keeps the hook context row splitting the commands in Verbose mode", () => {
		expect(observeGrouping("verbose")).toStrictEqual({merged: false, hookContext: true});
	});
});

const HOOK_WARNING: unknown[] = [
	attachment("att-hook-warning", {
		type: "hook_non_blocking_error",
		hookName: "PostToolUse:Bash",
		hookEvent: "PostToolUse",
		toolUseID: "toolu_x",
		stderr: "lint failed",
		stdout: "",
		exitCode: 1,
	}),
];

describe("Non-blocking hook errors", () => {
	it.each([true, false])("follow showHookWarnings=%s in Normal mode", (showHookWarnings) => {
		const text = renderRecords(HOOK_WARNING, "normal", showHookWarnings).textContent ?? "";
		expect(text.includes("PostToolUse:Bash")).toBe(showHookWarnings);
	});
});
