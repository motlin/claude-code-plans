// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {ApiErrorCard, type ApiErrorRecovery} from "../src/components/api-error-card";
import {preloadErrorRecoveryActions} from "../src/components/error-recovery-actions-entry";
import {SessionChat} from "../src/components/session-chat";
import {errorRecoveryHandlers, type ModelRetry} from "../src/lib/session-error-recovery";
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

	it("collapses an earlier error to upstream's marker form and keeps the full card for the last error", () => {
		const container = renderRecords([
			{...OVERLOADED_RECORD, uuid: "a1", requestId: "req_first"},
			{...OVERLOADED_RECORD, uuid: "a2", parentUuid: "a1"},
		]);
		const markers = [...container.querySelectorAll("[data-api-error-marker]")];
		const cards = [...container.querySelectorAll("[data-api-error-card]")];
		const [row, detailsRow] = [...(markers[0]?.children ?? [])];
		const trigger = detailsRow?.querySelector("button");
		fireEvent.click(trigger!);
		const panel = markers[0]?.querySelector("[data-api-error-details]");

		expect({
			markers: markers.length,
			cards: cards.length,
			order: markers[0]!.compareDocumentPosition(cards[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
			root: markers[0]?.className,
			row: row?.className,
			icon: row?.querySelector("svg")?.getAttribute("class"),
			label: {text: row?.querySelector("span")?.textContent, className: row?.querySelector("span")?.className},
			detailsRow: detailsRow?.className,
			trigger: trigger?.textContent,
			panel: panel?.className,
			facts: panel?.querySelector(".break-all")?.textContent,
			cardHeadline: cards[0]?.firstElementChild?.textContent,
		}).toStrictEqual({
			markers: 1,
			cards: 1,
			order: Node.DOCUMENT_POSITION_FOLLOWING,
			root: "flex w-full max-w-[480px] flex-col items-start gap-1 self-start",
			row: "flex max-w-full min-w-0 items-center gap-1.25 select-text",
			icon: "lucide lucide-triangle-alert size-4 shrink-0 text-danger-000",
			label: {text: "Service was busy", className: "min-w-0 text-body text-secondary break-words"},
			detailsRow: "flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2",
			trigger: "View details",
			panel: "pt-2",
			facts: "Status: 529Request ID: req_firstMessage ID: 69f6c760-e79e-4483-bdfe-5fb492ef4838",
			cardHeadline: "Service is busy",
		});
	});

	it("draws an error followed by a new prompt as the marker, since it is no longer in the last entry", () => {
		const container = renderRecords([
			{...OVERLOADED_RECORD, uuid: "a1"},
			{
				type: "user",
				uuid: "u1",
				parentUuid: "a1",
				timestamp: "2026-09-22T01:09:50.253Z",
				message: {role: "user", content: "try again"},
			},
		]);

		expect({
			markers: [...container.querySelectorAll("[data-api-error-marker]")].map((marker) => marker.textContent),
			cards: container.querySelectorAll("[data-api-error-card]").length,
		}).toStrictEqual({markers: ["Service was busyView details"], cards: 0});
	});
});

describe("ApiErrorCard recovery actions", () => {
	// The page warms the deferred recovery row on idle; load it up front so the card renders it directly.
	beforeAll(async () => {
		await preloadErrorRecoveryActions();
	});

	const OVERLOADED_PROPS = {
		text: RAW_529,
		status: 529,
		requestId: "req_011CfHarGaksRjzuQwv2aEni",
		code: "server_error",
		stopReason: "stop_sequence",
	} as const;

	function actionGroup(card: Element | null): Element | null | undefined {
		return card?.querySelector("[data-api-error-actions]");
	}

	function buttons(group: Element | null | undefined): {text: string; variant: string | null}[] {
		return [...(group?.querySelectorAll(":scope > button, :scope > * > button") ?? [])].map((button) => ({
			text: button.textContent,
			variant: button.getAttribute("data-approval-variant"),
		}));
	}

	it("puts the model trigger before a primary Try again at the trailing edge of the details row for the 529 specimen", () => {
		const onRetry = vi.fn<() => void>();
		const {container} = render(
			<ApiErrorCard
				{...OVERLOADED_PROPS}
				recovery={{
					onRetry,
					onRetryWithModel: vi.fn<(model: string) => Promise<boolean>>(),
					currentModel: "claude-opus-5-5",
				}}
			/>,
		);
		const card = container.querySelector("[data-api-error-card]");
		const group = actionGroup(card);
		const retry = [...(group?.querySelectorAll("button") ?? [])].find(
			(button) => button.textContent === "Try again",
		);

		expect({
			hint: card?.children[1]?.textContent,
			rowClass: group?.parentElement?.className,
			rowFirst: group?.parentElement?.firstElementChild?.textContent,
			groupClass: group?.className,
			buttons: buttons(group),
			retryPrimary: retry?.className.split(" ").includes("bg-primary"),
		}).toStrictEqual({
			hint: "Try again in a moment, or switch to a different model.",
			rowClass: "flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-3 pt-2",
			rowFirst: "View details",
			groupClass: "ms-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2",
			buttons: [
				{text: "Opus 5.5", variant: null},
				{text: "Try again", variant: "primary"},
			],
			retryPrimary: true,
		});
	});

	it("calls onRetry once on Try again, then hides every action and swaps the hint to the without-retry copy", () => {
		const onRetry = vi.fn<() => void>();
		const {container, getByRole} = render(
			<ApiErrorCard
				{...OVERLOADED_PROPS}
				recovery={{
					onRetry,
					onRetryWithModel: vi.fn<(model: string) => Promise<boolean>>(),
					currentModel: "claude-opus-5-5",
				}}
			/>,
		);
		fireEvent.click(getByRole("button", {name: "Try again"}));
		const card = container.querySelector("[data-api-error-card]");

		expect({
			calls: onRetry.mock.calls,
			group: actionGroup(card) ?? null,
			hint: card?.children[1]?.querySelector("span:not(.sr-only)")?.textContent,
			status: card?.querySelector("[role=status].sr-only")?.textContent,
		}).toStrictEqual({
			calls: [[]],
			group: null,
			hint: "You can send a message to try again in a moment, or switch to a different model.",
			status: "You can send a message to try again in a moment, or switch to a different model.",
		});
	});

	it("draws no action group and keeps the details row unchanged without handlers", () => {
		const {container} = render(<ApiErrorCard {...OVERLOADED_PROPS} />);
		const card = container.querySelector("[data-api-error-card]");

		expect({
			group: actionGroup(card) ?? null,
			row: card?.children[2]?.outerHTML.includes("data-api-error-actions"),
			rowChildren: card?.children[2]?.children.length,
			hint: card?.children[1]?.textContent,
		}).toStrictEqual({
			group: null,
			row: false,
			rowChildren: 1,
			hint: "This is usually temporary.",
		});
	});

	it("keeps the details row for the actions alone when there are no details, with a primary Compact session", () => {
		const onCompact = vi.fn<() => void>();
		const {container, getByRole} = render(
			<ApiErrorCard text="Prompt is too long" recovery={{onRetry: vi.fn<() => void>(), onCompact}} />,
		);
		const card = container.querySelector("[data-api-error-card]");
		const group = actionGroup(card);
		const before = {
			headline: card?.children[0]?.textContent,
			rowChildren: group?.parentElement?.children.length,
			buttons: buttons(group),
		};
		fireEvent.click(getByRole("button", {name: "Compact session"}));

		expect({
			before,
			calls: onCompact.mock.calls,
			after: [...(card?.children ?? [])].map((child) => child.className),
		}).toStrictEqual({
			before: {
				headline: "Your context window is full",
				rowChildren: 1,
				buttons: [{text: "Compact session", variant: "primary"}],
			},
			calls: [[]],
			after: [
				"flex items-center gap-3 bg-alpha-1 px-3 py-2 contain-inline-size",
				"flex flex-col gap-3 px-3 pt-3 pb-2 last:pb-3 empty:hidden contain-inline-size",
			],
		});
	});

	it("wraps the action group right-aligned under View details at phone width, like upstream's flex-wrap justify-end row", () => {
		const {container} = render(
			<div style={{width: "390px"}}>
				<ApiErrorCard
					{...OVERLOADED_PROPS}
					recovery={{
						onRetry: vi.fn<() => void>(),
						onRetryWithModel: vi.fn<(model: string) => Promise<boolean>>(),
						currentModel: "claude-opus-5-5",
					}}
				/>
			</div>,
		);
		const card = container.querySelector("[data-api-error-card]");
		const group = actionGroup(card);

		expect({
			card: card?.className.split(" "),
			row: group?.parentElement?.className.split(" "),
			group: group?.className.split(" "),
		}).toStrictEqual({
			card: [
				"card-outline-layer",
				"flex",
				"w-fit",
				"min-w-[min(480px,100%)]",
				"max-w-full",
				"flex-col",
				"overflow-clip",
				"rounded-card",
				"select-text",
			],
			row: [
				"flex",
				"min-w-0",
				"max-w-full",
				"flex-wrap",
				"items-center",
				"gap-x-3",
				"gap-y-2",
				"px-3",
				"pb-3",
				"pt-2",
			],
			group: ["ms-auto", "flex", "min-w-0", "max-w-full", "flex-wrap", "items-center", "justify-end", "gap-2"],
		});
	});

	it("tabs from View details through the secondary model trigger to the primary Try again, each with the focus ring", () => {
		const {container} = render(
			<ApiErrorCard
				{...OVERLOADED_PROPS}
				recovery={{
					onRetry: vi.fn<() => void>(),
					onRetryWithModel: vi.fn<(model: string) => Promise<boolean>>(),
					currentModel: "claude-opus-5-5",
				}}
			/>,
		);
		const card = container.querySelector("[data-api-error-card]");
		// Sequential focus follows DOM order when nothing sets a positive tabindex.
		const order = [...(card?.querySelectorAll<HTMLElement>("button, a[href], [tabindex]") ?? [])]
			.filter((element) => element.tabIndex >= 0)
			.map((element) => ({text: element.textContent, tabIndex: element.tabIndex}));
		const focusRing = [...(actionGroup(card)?.querySelectorAll("button") ?? [])].map((button) => ({
			text: button.textContent,
			ring: button.className.split(" ").includes("focus-visible:shadow-focus"),
			outline: button.className.split(" ").includes("focus-visible:outline-hidden"),
		}));

		expect({order, focusRing}).toStrictEqual({
			order: [
				{text: "View details", tabIndex: 0},
				{text: "Opus 5.5", tabIndex: 0},
				{text: "Try again", tabIndex: 0},
			],
			focusRing: [
				{text: "Opus 5.5", ring: true, outline: true},
				{text: "Try again", ring: true, outline: true},
			],
		});
	});
});

describe("SessionChat error recovery", () => {
	beforeAll(async () => {
		await preloadErrorRecoveryActions();
	});

	const PROMPT_RECORD = {
		type: "user",
		uuid: "8d0f0f8e-0000-4000-8000-000000000001",
		timestamp: "2026-09-22T01:08:40.000Z",
		message: {role: "user", content: "hello"},
	};

	function renderWithRecovery(records: unknown[], recovery: ApiErrorRecovery): HTMLElement {
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
				errorRecovery={recovery}
			/>,
		).container;
	}

	it("gives the last-entry 529 card the session's Try again, which types exactly Try again", async () => {
		const send = vi.fn<(text: string) => Promise<"sent" | "not-ready" | "failed">>(async () =>
			Promise.resolve("sent"),
		);
		const recovery = errorRecoveryHandlers({retryable: true, idle: true}, send, vi.fn<(text: string) => void>());
		const container = renderWithRecovery([PROMPT_RECORD, OVERLOADED_RECORD], recovery!);
		const retry = [...container.querySelectorAll("[data-api-error-actions] button")].find(
			(button) => button.textContent === "Try again",
		);
		fireEvent.click(retry!);
		await Promise.resolve();

		expect(send.mock.calls).toStrictEqual([["Try again"]]);
	});

	it("types exactly /compact from a context-window card's Compact session", async () => {
		const send = vi.fn<(text: string) => Promise<"sent" | "not-ready" | "failed">>(async () =>
			Promise.resolve("sent"),
		);
		const recovery = errorRecoveryHandlers({retryable: true, idle: true}, send, vi.fn<(text: string) => void>());
		const container = renderWithRecovery(
			[
				PROMPT_RECORD,
				{
					...OVERLOADED_RECORD,
					message: {...OVERLOADED_RECORD.message, content: [{type: "text", text: "Prompt is too long"}]},
					error: "invalid_request",
					apiErrorStatus: 400,
				},
			],
			recovery!,
		);
		const compact = [...container.querySelectorAll("[data-api-error-actions] button")].find(
			(button) => button.textContent === "Compact session",
		);
		fireEvent.click(compact!);
		await Promise.resolve();

		expect(send.mock.calls).toStrictEqual([["/compact"]]);
	});

	function recordingRecovery(switchOk: boolean): {
		events: unknown[];
		model: ModelRetry;
		send: (text: string) => Promise<"sent">;
	} {
		const events: unknown[] = [];
		return {
			events,
			model: {
				current: "claude-opus-5-5",
				switchTo: async (model: string) => {
					events.push({liveOption: {kind: "model", model}});
					return Promise.resolve(switchOk);
				},
			},
			send: async (text: string) => {
				events.push({prompt: text});
				return Promise.resolve("sent");
			},
		};
	}

	async function pickModel(container: HTMLElement, name: string) {
		const trigger = [...container.querySelectorAll("[data-api-error-actions] button")].find(
			(button) => button.textContent === "Opus 5.5",
		);
		fireEvent.click(trigger!);
		await waitFor(() => {
			expect(screen.getAllByRole("menu")).toHaveLength(1);
		});
		fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemradio", {name}));
	}

	it("switches the model through the live option, then types Try again, from Switch model and retry", async () => {
		const {events, model, send} = recordingRecovery(true);
		const recovery = errorRecoveryHandlers(
			{retryable: true, idle: true},
			send,
			vi.fn<(text: string) => void>(),
			model,
		);
		const container = renderWithRecovery([PROMPT_RECORD, OVERLOADED_RECORD], recovery!);
		await pickModel(container, "Sonnet 5.5");
		await waitFor(() => {
			expect(container.querySelectorAll("[data-api-error-actions]").length).toBe(0);
		});

		expect(events).toStrictEqual([{liveOption: {kind: "model", model: "sonnet"}}, {prompt: "Try again"}]);
	});

	it("sends no Try again and keeps the actions when the model switch is rejected", async () => {
		const {events, model, send} = recordingRecovery(false);
		const recovery = errorRecoveryHandlers(
			{retryable: true, idle: true},
			send,
			vi.fn<(text: string) => void>(),
			model,
		);
		const container = renderWithRecovery([PROMPT_RECORD, OVERLOADED_RECORD], recovery!);
		await pickModel(container, "Sonnet 5.5");
		await waitFor(() => {
			expect(events).toStrictEqual([{liveOption: {kind: "model", model: "sonnet"}}]);
		});
		await Promise.resolve();

		expect({
			events,
			buttons: [...container.querySelectorAll("[data-api-error-actions] button")].map((b) => b.textContent),
		}).toStrictEqual({
			events: [{liveOption: {kind: "model", model: "sonnet"}}],
			buttons: ["Opus 5.5", "Try again"],
		});
	});

	it("draws no actions on an error a later prompt superseded", () => {
		const container = renderWithRecovery(
			[PROMPT_RECORD, OVERLOADED_RECORD, {...PROMPT_RECORD, uuid: "8d0f0f8e-0000-4000-8000-000000000002"}],
			{onRetry: vi.fn<() => void>()},
		);

		expect(container.querySelectorAll("[data-api-error-actions]").length).toBe(0);
	});
});
