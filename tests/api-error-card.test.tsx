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

	it("opens View details on the status and request id, and Copy details copies them then shows Copied for 1200ms", async () => {
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
				lines: ["Status: 529", "Request ID: req_011CfHarGaksRjzuQwv2aEni"],
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
			copied: [["Status: 529\nRequest ID: req_011CfHarGaksRjzuQwv2aEni"]],
			label: "Copied",
			status: "Copied",
		});
		act(() => {
			vi.advanceTimersByTime(1200);
		});
		expect(copy?.getAttribute("aria-label")).toBe("Copy details");
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
});
