// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
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

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn<HTMLElement["scrollIntoView"]>(),
	});
});

afterEach(() => {
	cleanup();
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

function prompt(content: unknown): unknown {
	return {type: "user", uuid: "user-plain-1", message: {role: "user", content}};
}

const UPSTREAM_EXAMPLE =
	"<!-- attach -->\n> Even so, they’re ful\n\n<!-- attach -->\n> Hermit crabs\n\n<!-- attach -->\n> Tide pools form in rocky hollo\n\n[upstream-sync test] In one sentence, what is a tide pool?";

describe("SessionChat user bubble Excerpt tiles", () => {
	it("renders upstream's attach blocks as Excerpt tiles before a bubble holding only the prompt", () => {
		const container = renderRecords([prompt(UPSTREAM_EXAMPLE)]);
		const row = container.querySelector("[data-cds=MessageAttachments]");
		const bubble = container.querySelector(".user-message-bubble");

		expect({
			fit: row?.getAttribute("data-fit"),
			className: row?.className,
			beforeBubble:
				row !== null && bubble !== null
					? (row.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
					: false,
			tiles: Array.from(row?.querySelectorAll("[data-cds=MessageAttachmentsQuote]") ?? []).map((tile) => ({
				className: tile.className,
				quote: tile.querySelector("blockquote")?.textContent,
				badge: tile.querySelector("[data-cds=Badge]")?.textContent,
				remove: tile.querySelector("[data-cds-attachment-remove]") !== null,
			})),
			bubble: bubble?.textContent,
		}).toStrictEqual({
			fit: "natural",
			className: "flex w-full flex-wrap gap-1.5 justify-end items-end empty:hidden",
			beforeBubble: true,
			tiles: ["Even so, they’re ful", "Hermit crabs", "Tide pools form in rocky hollo"].map((quote) => ({
				className: "group/tile relative isolate size-[7.5rem] shrink-0 rounded-r7 self-end select-text",
				quote,
				badge: "Excerpt",
				remove: false,
			})),
			bubble: "[upstream-sync test] In one sentence, what is a tide pool?",
		});
	});

	it("parses attach blocks in a text content block too and omits the bubble when nothing follows", () => {
		const container = renderRecords([prompt([{type: "text", text: "<!-- attach -->\n> Hermit crabs"}])]);

		expect({
			quotes: Array.from(container.querySelectorAll("[data-cds=MessageAttachmentsQuote] blockquote")).map(
				(quote) => quote.textContent,
			),
			bubble: container.querySelector(".user-message-bubble"),
		}).toStrictEqual({quotes: ["Hermit crabs"], bubble: null});
	});
});
