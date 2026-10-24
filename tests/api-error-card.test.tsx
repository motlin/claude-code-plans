// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
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

const RAW_529 =
	"API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment. If it persists, check https://status.claude.com.";

/** The workflowy 54b25a00 529 specimen, trimmed to the fields the transcript reads. */
const OVERLOADED_RECORD = {
	type: "assistant",
	uuid: "f5bf77fd-e7e2-40ba-8e87-4b6c42c667b9",
	timestamp: "2026-09-22T01:08:50.253Z",
	message: {
		id: "69f6c760-e79e-4483-bdfe-5fb492ef4838",
		model: "<synthetic>",
		role: "assistant",
		stop_reason: "stop_sequence",
		type: "message",
		content: [{type: "text", text: RAW_529}],
	},
	requestId: "req_011CfHarGaksRjzuQwv2aEni",
	error: "server_error",
	isApiErrorMessage: true,
	apiErrorStatus: 529,
};

let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("innerHeight", 10_000);
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn<HTMLElement["scrollIntoView"]>(),
	});
	writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
	Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function renderRecords(records: unknown[]): HTMLElement {
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries={true}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>,
	).container;
}

/** Whether the raw error text is drawn as transcript prose, outside the card. */
function showsRawProse(container: HTMLElement): boolean {
	return [...container.querySelectorAll("[data-transcript-prose], p, article")].some(
		(element) => element.closest("[data-api-error-card]") === null && element.textContent.includes("Overloaded"),
	);
}

describe("ApiErrorCard", () => {
	it("draws the 529 specimen as upstream's card: busy headline, no-composer hint, no raw prose, closed details", () => {
		const container = renderRecords([OVERLOADED_RECORD]);
		const card = container.querySelector("[data-api-error-card]");
		const [header, hintRow, detailsRow] = [...(card?.children ?? [])];
		const trigger = detailsRow?.querySelector("button");

		expect({
			root: card?.className,
			childCount: card?.children.length,
			header: header?.className,
			icon: header?.querySelector("svg")?.getAttribute("class"),
			headline: header?.textContent,
			hintRow: hintRow?.className,
			hint: hintRow?.textContent,
			detailsRow: detailsRow?.className,
			trigger: {
				text: trigger?.textContent,
				className: trigger?.className,
				expanded: trigger?.getAttribute("aria-expanded"),
			},
			panel: card?.querySelector("[data-api-error-details]") ?? null,
			rawProse: showsRawProse(container),
			legacyCallout: container.textContent.includes("API Error 529"),
		}).toStrictEqual({
			root: "card-outline-layer flex w-fit min-w-[min(480px,100%)] max-w-full flex-col overflow-clip rounded-card select-text",
			childCount: 3,
			header: "flex items-center gap-3 bg-alpha-1 px-3 py-2 contain-inline-size",
			icon: "lucide lucide-triangle-alert size-4 shrink-0 text-danger-000",
			headline: "Service is busy",
			hintRow: "flex flex-col gap-3 px-3 pt-3 pb-2 last:pb-3 empty:hidden contain-inline-size",
			hint: "This is usually temporary.",
			detailsRow: "flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-3 pt-2",
			trigger: {
				text: "View details",
				className:
					"inline-flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap text-footnote text-secondary hover:text-primary",
				expanded: "false",
			},
			panel: null,
			rawProse: false,
			legacyCallout: false,
		});
	});

	it("opens View details on the status, request id and message id, and Copy details copies them then shows Copied for 1200ms", async () => {
		const container = renderRecords([OVERLOADED_RECORD]);
		const card = container.querySelector("[data-api-error-card]");
		const trigger = card?.querySelector("button");
		fireEvent.click(trigger!);

		const panel = card?.querySelector("[data-api-error-details]");
		const box = panel?.firstElementChild;
		const facts = box?.querySelector(".break-all");
		const copy = box?.querySelector("button");

		expect({
			expanded: trigger?.getAttribute("aria-expanded"),
			panel: panel?.className,
			box: box?.className,
			facts: {
				className: facts?.className,
				lines: [...(facts?.children ?? [])].map((line) => line.textContent),
			},
			copy: {label: copy?.getAttribute("aria-label"), slot: copy?.parentElement?.className},
			rawInPanel: box?.textContent.includes("Overloaded"),
		}).toStrictEqual({
			expanded: "true",
			panel: "border-t px-3 py-3",
			box: "relative flex min-h-[32px] flex-col gap-1.5 rounded-card bg-alpha-1 py-1.5 ps-2 pe-[34px] text-footnote text-secondary",
			facts: {
				className: "flex flex-col text-ink-muted break-all select-text",
				lines: [
					"Status: 529",
					"Request ID: req_011CfHarGaksRjzuQwv2aEni",
					"Message ID: 69f6c760-e79e-4483-bdfe-5fb492ef4838",
				],
			},
			copy: {label: "Copy details", slot: "absolute top-1 end-1 flex"},
			rawInPanel: false,
		});

		vi.useFakeTimers();
		await act(async () => {
			fireEvent.click(copy!);
			await Promise.resolve();
		});
		expect({
			copied: writeText.mock.calls,
			label: copy?.getAttribute("aria-label"),
			status: box?.querySelector("[role=status]")?.textContent,
		}).toStrictEqual({
			copied: [
				[
					"Status: 529\nRequest ID: req_011CfHarGaksRjzuQwv2aEni\nMessage ID: 69f6c760-e79e-4483-bdfe-5fb492ef4838",
				],
			],
			label: "Copied",
			status: "Copied",
		});
		act(() => {
			vi.advanceTimersByTime(1200);
		});
		expect(copy?.getAttribute("aria-label")).toBe("Copy details");
	});

	it("leaves out the Message ID line, like upstream, when there is no status or request id", () => {
		const container = renderRecords([
			{
				type: "assistant",
				message: {
					id: "69f6c760-e79e-4483-bdfe-5fb492ef4838",
					role: "assistant",
					content: [{type: "text", text: "API Error: something odd"}],
				},
				isApiErrorMessage: true,
			},
		]);
		const card = container.querySelector("[data-api-error-card]");
		fireEvent.click(card!.querySelector("button")!);
		const box = card?.querySelector("[data-api-error-details]")?.firstElementChild;

		expect({
			facts: box?.querySelector(".break-all") ?? null,
			messageId: box?.textContent.includes("Message ID"),
		}).toStrictEqual({facts: null, messageId: false});
	});

	it("keeps the raw text in the details panel for an unclassified error, with no prose outside the card", () => {
		const container = renderRecords([
			{
				type: "assistant",
				message: {role: "assistant", content: [{type: "text", text: "API Error: something odd"}]},
				isApiErrorMessage: true,
			},
		]);
		const card = container.querySelector("[data-api-error-card]");
		fireEvent.click(card!.querySelector("button")!);

		expect({
			headline: card?.firstElementChild?.textContent,
			hint: card?.children[1]?.textContent,
			body: card?.querySelector("[data-api-error-details] .whitespace-pre-wrap")?.textContent,
			prose: [...container.querySelectorAll("[data-transcript-prose]")].length,
		}).toStrictEqual({
			headline: "An API error occurred",
			hint: "Try sending your message again.",
			body: "API Error: something odd",
			prose: 0,
		});
	});
	it("draws a safeguards refusal whose content is only empty thinking as upstream's Message flagged card", () => {
		const container = renderRecords([
			{
				type: "assistant",
				uuid: "bd5450a5-7772-459c-890a-5b8e3d6a7c10",
				timestamp: "2026-10-22T00:41:12.000Z",
				message: {
					role: "assistant",
					model: "claude-opus-5-5",
					stop_reason: "refusal",
					content: [{type: "thinking", thinking: "", signature: "CAQS2wUKEAgTGAI4AUIIdGhpbmtpbmc"}],
				},
				requestId: "req_011CgGLji7Z5kBsT1veSwPzU",
			},
			{
				type: "user",
				uuid: "2694a1ca-c69d-4610-834f-d8812cfaab62",
				timestamp: "2026-10-22T00:41:12.100Z",
				message: {
					role: "user",
					content:
						"Your response above was stopped by a safety classifier — this is not a tool or API error. The rest of it was withheld, and tool calls in it that had not finished did not run. Do not produce that content again, even reworded.",
				},
				isMeta: true,
				turnCompanion: true,
				refusedMessageId: "msg_011CgEjAfQLavHt3wo5wEY1e",
			},
		]);
		const cards = [...container.querySelectorAll("[data-api-error-card]")];
		const [header, hintRow] = [...(cards[0]?.children ?? [])];

		expect({
			cards: cards.length,
			headline: header?.textContent,
			hint: hintRow?.textContent,
			learnMore: hintRow?.querySelector("a")?.getAttribute("href"),
			companion: container.textContent.includes("stopped by a safety classifier"),
		}).toStrictEqual({
			cards: 1,
			headline: "Message flagged",
			hint: "Claude’s safeguards flagged this message. This sometimes happens in safe, normal sessions. Switch models to continue. Learn more",
			learnMore: "https://www.anthropic.com/legal/aup",
			companion: false,
		});
	});

	it("opens View details on a model refusal's request id and message id", () => {
		const container = renderRecords([
			{
				type: "assistant",
				uuid: "c0d7a3f1-2b6e-4c55-9a1d-7e4f8b2c6d10",
				timestamp: "2026-10-22T00:41:12.000Z",
				message: {
					id: "msg_011CgGLjiNS6ERJgzVqTdSfj",
					role: "assistant",
					model: "claude-opus-5-5",
					stop_reason: "refusal",
					content: [{type: "thinking", thinking: "", signature: "CAQS2wUKEAgTGAI4AUIIdGhpbmtpbmc"}],
				},
				requestId: "req_011CgGLji7Z5kBsT1veSwPzU",
			},
		]);
		const card = container.querySelector("[data-api-error-card]");
		const trigger = card?.querySelector("button");
		fireEvent.click(trigger!);
		const facts = card?.querySelector("[data-api-error-details] .break-all");

		expect({
			trigger: trigger?.textContent,
			lines: [...(facts?.children ?? [])].map((line) => line.textContent),
		}).toStrictEqual({
			trigger: "View details",
			lines: ["Request ID: req_011CgGLji7Z5kBsT1veSwPzU", "Message ID: msg_011CgGLjiNS6ERJgzVqTdSfj"],
		});
	});

	it("replaces the hint with a synthetic refusal's own text, like upstream's passthrough body, and drops it from View details", () => {
		const text =
			"API Error: Sonnet 5.5's safeguards flagged this session (https://www.anthropic.com/legal/aup). You may be seeing this for the first time on a Sonnet model: Sonnet 5.5 is more capable and has stronger safeguards as a result, which can sometimes flag non-cybersecurity work. We're improving these safeguards to reduce the amount of incorrectly flagged messages. Claude Code can't respond to your last message with Sonnet 5.5.\n\nDouble press esc to edit your last message, or try a different model with /model.\n\nYou can learn more: https://support.claude.com/en/articles/8106465\n\nDetails: `[cyber]`\n\nRequest ID: req_011CgFaXu4vBJjAD4zM5mZ3W\n\nMessage ID: msg_011CgFaXuKJXxjEoQpSSFwXn";
		const container = renderRecords([
			{
				type: "assistant",
				uuid: "4a6366a5-adea-4fcc-9e2d-b73ef9fdc323",
				timestamp: "2026-10-23T14:02:31.000Z",
				message: {
					id: "4a6366a5-adea-4fcc-9e2d-b73ef9fdc323",
					model: "<synthetic>",
					role: "assistant",
					stop_reason: "refusal",
					stop_sequence: "",
					type: "message",
					content: [{type: "text", text}],
				},
				requestId: "req_011CgFaXu4vBJjAD4zM5mZ3W",
				error: "invalid_request",
				isApiErrorMessage: true,
				refusedMessageId: "msg_011CgFaXuKJXxjEoQpSSFwXn",
			},
		]);
		const cards = [...container.querySelectorAll("[data-api-error-card]")];
		const [header, hintRow, detailsRow] = [...(cards[0]?.children ?? [])];
		fireEvent.click(detailsRow!.querySelector("button")!);
		const box = cards[0]?.querySelector("[data-api-error-details]")?.firstElementChild;

		expect({
			cards: cards.length,
			headline: header?.textContent,
			hint: hintRow?.textContent,
			learnMore: hintRow?.querySelector("a") === null,
			details: box?.textContent,
		}).toStrictEqual({
			cards: 1,
			headline: "Message flagged",
			hint: "Sonnet 5.5's safeguards flagged this session (https://www.anthropic.com/legal/aup). You may be seeing this for the first time on a Sonnet model: Sonnet 5.5 is more capable and has stronger safeguards as a result, which can sometimes flag non-cybersecurity work. We're improving these safeguards to reduce the amount of incorrectly flagged messages. Claude Code can't respond to your last message with Sonnet 5.5.\n\nDouble press esc to edit your last message, or try a different model with /model.\n\nYou can learn more: https://support.claude.com/en/articles/8106465",
			learnMore: true,
			details: "Request ID: req_011CgFaXu4vBJjAD4zM5mZ3WMessage ID: msg_011CgFaXuKJXxjEoQpSSFwXn",
		});
	});
});
