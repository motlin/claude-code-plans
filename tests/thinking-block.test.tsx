// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";

let showDebug = false;

vi.mock("../src/components/settings-provider", () => ({
	useSettings: () => ({settings: {showDebug}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

class NoopResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords(): ResizeObserverEntry[] {
		return [];
	}
}

globalThis.ResizeObserver = NoopResizeObserver;

afterEach(cleanup);

const THINKING = "Fabricated reasoning about the next step\nSecond line of reasoning";

function renderThinking(options: {showDebug?: boolean} = {}): HTMLElement {
	showDebug = options.showDebug ?? false;
	const {lines, toolResultMap} = processTranscript([
		{
			type: "assistant",
			uuid: "a1",
			message: {
				role: "assistant",
				content: [{type: "thinking", thinking: THINKING}],
			},
		},
	]);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries
			showTranscriptOnly
			showThinking
		/>,
	).container;
}

describe("thinking block", () => {
	it("renders the thinking text inline as italic upstream body type", () => {
		renderThinking();

		expect(screen.getByText(THINKING, {collapseWhitespace: false}).className).toBe(
			"text-body text-t6 italic whitespace-pre-wrap break-words pr-6",
		);
	});

	it("wraps the thinking text in a hover group with no collapsed card chrome", () => {
		renderThinking();

		const wrapper = screen.getByText(THINKING, {collapseWhitespace: false}).parentElement;

		expect(wrapper?.className).toBe("group/body relative");
	});

	it("shows the thinking text without a disclosure toggle", () => {
		const container = renderThinking();

		expect({
			expandables: container.querySelectorAll("[aria-expanded]").length,
			thinkingLabels: screen.queryAllByText("Thinking...").length,
		}).toStrictEqual({expandables: 0, thinkingLabels: 0});
	});

	it("widens the reserved gutter when the debug link shares the overlay", () => {
		const container = renderThinking({showDebug: true});

		expect({
			className: screen.getByText(THINKING, {collapseWhitespace: false}).className,
			debugLinks: container.querySelectorAll('a[href^="/session/test-session/source/"]').length,
		}).toStrictEqual({
			className: "text-body text-t6 italic whitespace-pre-wrap break-words pr-10",
			debugLinks: 1,
		});
	});

	it("draws the upstream left rail around the hover group", () => {
		renderThinking();

		const rail = screen.getByText(THINKING, {collapseWhitespace: false}).parentElement?.parentElement;

		expect(rail?.className).toBe("border-l-2 border-t2 pl-3");
	});

	it("offers a hover-revealed Copy as quote button", () => {
		renderThinking();

		const button = screen.getByLabelText("Copy as quote");
		const rail = screen.getByText(THINKING, {collapseWhitespace: false}).parentElement?.parentElement;

		expect({
			tagName: button.tagName,
			revealClass: button.parentElement?.className.includes("opacity-0 group-hover/body:opacity-100"),
			plainCopyButtons: rail?.querySelectorAll('button[aria-label="Copy"]').length,
		}).toStrictEqual({tagName: "BUTTON", revealClass: true, plainCopyButtons: 0});
	});

	it("copies the thinking text as a markdown quote", () => {
		const writeText = vi.fn(async (_text: string) => {});
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		renderThinking();

		fireEvent.click(screen.getByLabelText("Copy as quote"));

		expect(writeText.mock.calls).toStrictEqual([
			["> Fabricated reasoning about the next step\n> Second line of reasoning"],
		]);
	});
});
