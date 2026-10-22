// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";
import type {TranscriptMode} from "../src/lib/transcript-mode";

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
	// A tall viewport, so the virtualized list mounts every row.
	vi.stubGlobal("innerHeight", 10_000);
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn<HTMLElement["scrollIntoView"]>(),
	});
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
	const text = container.textContent;
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
	const text = renderRecords(HOOK_CONTEXT_BETWEEN_COMMANDS, mode).textContent;
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
		const text = renderRecords(HOOK_WARNING, "normal", showHookWarnings).textContent;
		expect(text.includes("PostToolUse:Bash")).toBe(showHookWarnings);
	});
});

function queuedPrompt(uuid: string, prompt: string, origin: Record<string, unknown> = {kind: "human"}) {
	return attachment(uuid, {type: "queued_command", prompt, commandMode: "prompt", origin, humanTurn: true});
}

function userPrompt(uuid: string, text: string) {
	return {
		type: "user",
		uuid,
		timestamp: "2026-09-30T08:03:00.000Z",
		message: {role: "user", content: text},
	};
}

function observeQueued(records: unknown[], mode: TranscriptMode) {
	const container = renderRecords(records, mode);
	return {
		bubbles: Array.from(container.querySelectorAll(".user-message-bubble"), (bubble) => bubble.textContent),
		statuses: Array.from(
			container.querySelectorAll("[data-turn-status] > button > span:first-child"),
			(label) => label.textContent,
		),
		banner: container.textContent.includes("Queued command"),
	};
}

describe("Queued human prompts", () => {
	const records = [...bashCall("first"), queuedPrompt("att-q", "stop and fix the tests"), ...bashCall("second")];

	it("draws a queued human prompt as a user bubble that ends the tool run in Normal mode", () => {
		expect(observeQueued(records, "normal")).toStrictEqual({
			bubbles: ["stop and fix the tests"],
			statuses: [],
			banner: false,
		});
	});

	it("keeps the queued command banner in Verbose mode", () => {
		expect(observeQueued(records, "verbose")).toStrictEqual({bubbles: [], statuses: [], banner: true});
	});

	it("draws the prompt once when the CLI also wrote it as a user record", () => {
		const delivered = [
			queuedPrompt("att-q", "stop and fix the tests"),
			userPrompt("u-1", "stop and fix the tests"),
		];
		expect(observeQueued(delivered, "normal")).toStrictEqual({
			bubbles: ["stop and fix the tests"],
			statuses: [],
			banner: false,
		});
	});

	it("keeps a queued prompt from another origin hidden in Normal mode", () => {
		const peer = [
			...bashCall("first"),
			queuedPrompt("att-q", "do the thing", {kind: "peer"}),
			...bashCall("second"),
		];
		expect(observeQueued(peer, "normal")).toStrictEqual({bubbles: [], statuses: ["Ran 2 commands"], banner: false});
	});
});

function assistantText(uuid: string, text: string) {
	return {
		type: "assistant",
		uuid,
		timestamp: "2026-09-30T08:02:00.000Z",
		message: {role: "assistant", content: [{type: "text", text}]},
	};
}

function absorbedRemove(content: string, ids: {commandUuid?: string; deliveryId?: string} = {}) {
	return {
		type: "queue-operation",
		operation: "remove",
		timestamp: "2026-09-30T08:01:02.000Z",
		sessionId: "test-session",
		content,
		...(ids.commandUuid === undefined ? {} : {reason: "absorbed_mid_turn", ...ids}),
	};
}

const ENQUEUED_AT = "2026-09-30T08:00:45.123Z";

function observeAbsorbed(records: unknown[]) {
	const container = renderRecords(records, "normal");
	const bubble = container.querySelector(".user-message-bubble");
	const order = ["A", "B"].map((text) =>
		Array.from(container.querySelectorAll("p")).find((p) => p.textContent === text),
	);
	return {
		bubbles: Array.from(container.querySelectorAll(".user-message-bubble"), (node) => node.textContent),
		images: container.querySelectorAll("img").length,
		splitsTurn:
			bubble !== null &&
			order.every((node) => node !== undefined) &&
			(order[0]!.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
			(bubble.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
		enqueueTime: Array.from(container.querySelectorAll("time"), (time) => time.dateTime).includes(ENQUEUED_AT),
		sentMidTurn:
			container.textContent.includes("Sent mid-turn") || container.textContent.includes("Queued command"),
	};
}

describe("Absorbed human queued commands", () => {
	it("draws the prompt as a user row between the two halves of the turn, at its enqueue time", () => {
		const records = [
			assistantText("a-A", "A"),
			...bashCall("first"),
			absorbedRemove("fix it", {commandUuid: "cmd-1", deliveryId: "dlv-1"}),
			attachment("att-q", {
				type: "queued_command",
				prompt: "fix it",
				commandMode: "prompt",
				origin: {kind: "human"},
				source_uuid: "cmd-1",
				delivery_id: "dlv-1",
				timestamp: ENQUEUED_AT,
			}),
			assistantText("a-B", "B"),
		];
		expect(observeAbsorbed(records)).toStrictEqual({
			bubbles: ["fix it"],
			images: 0,
			splitsTurn: true,
			enqueueTime: true,
			sentMidTurn: false,
		});
	});

	it("draws a legacy absorbed prompt with no origin or delivery id the same way", () => {
		const records = [
			assistantText("a-A", "A"),
			...bashCall("first"),
			absorbedRemove("fix it"),
			attachment("att-q", {
				type: "queued_command",
				prompt: "fix it",
				commandMode: "prompt",
				timestamp: ENQUEUED_AT,
			}),
			assistantText("a-B", "B"),
		];
		expect(observeAbsorbed(records)).toStrictEqual({
			bubbles: ["fix it"],
			images: 0,
			splitsTurn: true,
			enqueueTime: true,
			sentMidTurn: false,
		});
	});

	it("draws a block-list prompt's text and one image per image block", () => {
		const image = {type: "image", source: {type: "base64", media_type: "image/png", data: "iVBORw0KGgo="}};
		const records = [
			assistantText("a-A", "A"),
			attachment("att-q", {
				type: "queued_command",
				prompt: [{type: "text", text: "[Image #8] look"}, image, image],
				commandMode: "prompt",
				origin: {kind: "human"},
				imagePasteIds: [8, 9],
				timestamp: ENQUEUED_AT,
			}),
			assistantText("a-B", "B"),
		];
		expect(observeAbsorbed(records)).toStrictEqual({
			bubbles: ["[Image #8] look"],
			images: 2,
			splitsTurn: true,
			enqueueTime: true,
			sentMidTurn: false,
		});
	});

	it("keeps a meta queued command out of the transcript", () => {
		const records = [
			assistantText("a-A", "A"),
			attachment("att-q", {type: "queued_command", prompt: "tick", commandMode: "prompt", isMeta: true}),
			assistantText("a-B", "B"),
		];
		expect(observeAbsorbed(records)).toStrictEqual({
			bubbles: [],
			images: 0,
			splitsTurn: false,
			enqueueTime: false,
			sentMidTurn: false,
		});
	});
});

function agentMessageText(from: string): string {
	return `Another Claude session sent a message:\n<agent-message from="${from}">\nDone with ${from}.\n</agent-message>`;
}

function peerMessage(uuid: string, from: string) {
	return {
		type: "user",
		uuid,
		isMeta: true,
		timestamp: "2026-09-30T08:00:30.000Z",
		message: {role: "user", content: agentMessageText(from)},
	};
}

const PROSE = {
	type: "assistant",
	uuid: "a-prose",
	timestamp: "2026-09-30T08:00:10.000Z",
	message: {role: "assistant", content: [{type: "text", text: "Two workers are running."}]},
};

function observePeers(records: unknown[], mode: TranscriptMode) {
	const container = renderRecords(records, mode);
	return {
		statuses: Array.from(
			container.querySelectorAll("[data-turn-status] > button > span:first-child"),
			(label) => label.textContent,
		),
		messageRows: container.querySelectorAll("[data-agent-message-from]").length,
	};
}

describe("Agent messages folded into tool groups", () => {
	it("counts the messages that lead a tool run in its label", () => {
		const records = [PROSE, peerMessage("p-1", "a1"), peerMessage("p-2", "a2"), ...bashCall("first")];
		expect(observePeers(records, "normal")).toStrictEqual({
			statuses: ["Received 2 messages, ran a command"],
			messageRows: 0,
		});
	});

	it("drops a message absorbed mid-turn as a queued_command, which upstream never receives", () => {
		const records = [
			...bashCall("first"),
			attachment("att-peer", {type: "queued_command", prompt: agentMessageText("a1"), commandMode: "prompt"}),
			...bashCall("second"),
		];
		expect({
			normal: observePeers(records, "normal"),
			verbose: observePeers(records, "verbose"),
		}).toStrictEqual({
			normal: {statuses: ["Ran 2 commands"], messageRows: 0},
			verbose: {statuses: [], messageRows: 1},
		});
	});

	it("keeps the message as its own row in Verbose mode", () => {
		const records = [PROSE, peerMessage("p-1", "a1"), ...bashCall("first")];
		expect(observePeers(records, "verbose")).toStrictEqual({statuses: [], messageRows: 1});
	});
});
