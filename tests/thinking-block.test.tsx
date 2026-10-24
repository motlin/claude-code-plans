// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {ToastContext, type ToastOptions} from "../src/components/toast-context";
import {processTranscript} from "../src/lib/transcript";

let showDebug = false;

vi.mock("../src/components/settings-context", () => ({
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

function renderThinking(
	options: {
		showDebug?: boolean;
		thinkingDurationMs?: number;
		thinking?: string;
		toast?: (options: ToastOptions) => void;
	} = {},
): HTMLElement {
	showDebug = options.showDebug ?? false;
	const {lines, toolResultMap} = processTranscript([
		{
			type: "assistant",
			uuid: "a1",
			...(options.thinkingDurationMs === undefined ? {} : {thinkingDurationMs: options.thinkingDurationMs}),
			message: {
				role: "assistant",
				content: [{type: "thinking", thinking: options.thinking ?? THINKING}],
			},
		},
	]);
	const chat = (
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries
			showTranscriptOnly
			showThinking
		/>
	);
	return render(
		options.toast === undefined ? (
			chat
		) : (
			<ToastContext.Provider value={options.toast}>{chat}</ToastContext.Provider>
		),
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
			revealClass: button.closest("div")?.className.includes("opacity-0 group-hover/body:opacity-100"),
			plainCopyButtons: rail?.querySelectorAll('button[aria-label="Copy"]').length,
		}).toStrictEqual({tagName: "BUTTON", revealClass: true, plainCopyButtons: 0});
	});

	it("copies the thinking text as a markdown quote", () => {
		const writeText = vi.fn<Clipboard["writeText"]>(async (_text: string) => {});
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		renderThinking();

		fireEvent.click(screen.getByLabelText("Copy as quote"));

		expect(writeText.mock.calls).toStrictEqual([
			["> **Thinking** (~16 tok)\n>\n> Fabricated reasoning about the next step\n> Second line of reasoning"],
		]);
	});

	it("quotes empty thinking lines as a bare > under the token-estimate header", () => {
		const writeText = vi.fn<Clipboard["writeText"]>(async (_text: string) => {});
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		renderThinking({thinking: "a\n\nb"});

		fireEvent.click(screen.getByLabelText("Copy as quote"));

		expect(writeText.mock.calls).toStrictEqual([["> **Thinking** (~1 tok)\n>\n> a\n>\n> b"]]);
	});

	it("shows a Copied success toast after copying the thinking quote", () => {
		const writeText = vi.fn<Clipboard["writeText"]>(async (_text: string) => {});
		Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
		const toast = vi.fn<(options: ToastOptions) => void>();
		renderThinking({toast});

		fireEvent.click(screen.getByLabelText("Copy as quote"));

		expect(toast.mock.calls).toStrictEqual([[{message: "Copied", kind: "success"}]]);
	});

	it("relabels the thinking quote button Copied with a check icon for 2000ms after a click", () => {
		vi.useFakeTimers();
		try {
			const writeText = vi.fn<Clipboard["writeText"]>(async (_text: string) => {});
			Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
			renderThinking();
			const button = screen.getByLabelText("Copy as quote");
			const state = () => ({
				ariaLabel: button.getAttribute("aria-label"),
				icon: button.querySelector("svg")?.innerHTML,
			});
			const idle = state();

			fireEvent.click(button);
			const copied = state();
			act(() => {
				vi.advanceTimersByTime(1999);
			});
			const beforeReset = state();
			act(() => {
				vi.advanceTimersByTime(1);
			});

			expect({idle, copied, beforeReset, reset: state()}).toStrictEqual({
				idle: {ariaLabel: "Copy as quote", icon: idle.icon},
				copied: {ariaLabel: "Copied", icon: copied.icon},
				beforeReset: {ariaLabel: "Copied", icon: copied.icon},
				reset: {ariaLabel: "Copy as quote", icon: idle.icon},
			});
			expect(copied.icon).not.toBe(idle.icon);
		} finally {
			vi.useRealTimers();
		}
	});

	it("labels how long the model thought above the thinking text", () => {
		renderThinking({thinkingDurationMs: 2600});

		const label = screen.getByText("Thought for 2.6s");
		const rail = screen.getByText(THINKING, {collapseWhitespace: false}).parentElement?.parentElement;

		expect({
			className: label.className,
			inRail: label.parentElement === rail,
			first: rail?.firstElementChild === label,
		}).toStrictEqual({className: "text-xs text-t6 mb-1", inRail: true, first: true});
	});

	it.each([
		[400, "Thought for 0.4s"],
		[59_940, "Thought for 59.9s"],
		[65_000, "Thought for 1m 5s"],
	])("formats a %i ms thinking duration as %s", (thinkingDurationMs, expected) => {
		renderThinking({thinkingDurationMs});

		expect(screen.getByText(expected).textContent).toBe(expected);
	});

	it("omits the duration label when the turn has no thinking duration", () => {
		renderThinking();

		expect(screen.queryAllByText(/^Thought for/).length).toBe(0);
	});
});
