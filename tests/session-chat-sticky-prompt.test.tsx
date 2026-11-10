// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {TranscriptOverlayHostContext} from "../src/components/transcript-overlay-host-context";
import type {SessionLine} from "../src/lib/sessions";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize()}));
vi.mock("../src/hooks/use-claude-events", () => ({useClaudeEvents: () => ({failedTools: new Map()})}));

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

function user(lineIndex: number, content: string, extra: Partial<SessionLine> = {}): SessionLine {
	return {
		type: "user",
		uuid: `line-${lineIndex}`,
		lineIndex,
		message: {role: "user", content},
		...extra,
	} as SessionLine;
}

function assistant(lineIndex: number): SessionLine {
	return {
		type: "assistant",
		uuid: `line-${lineIndex}`,
		lineIndex,
		message: {role: "assistant", content: [{type: "text", text: `Fabricated reply ${lineIndex}`}]},
	};
}

function rect(top: number, bottom: number): DOMRect {
	return {top, bottom, height: bottom - top, left: 0, right: 800, width: 800, x: 0, y: top, toJSON: () => ({})};
}

describe("SessionChat sticky prompt bubble", () => {
	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		// Every row has scrolled well above the line.
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
			const index = this.getAttribute("data-transcript-entry-index");
			if (index !== null) return rect(-2000 + Number(index) * 100, -1950 + Number(index) * 100);
			if (this.getAttribute("data-testid") === "scroller") return rect(0, 600);
			return rect(0, 0);
		});
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("pins the latest typed prompt, skipping blank and hook-feedback rows, and clicks back to it", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const lines = [
			user(0, "Fabricated first prompt"),
			assistant(1),
			user(2, "   "),
			assistant(3),
			user(4, "Stop hook feedback: fabricated", {isMeta: true}),
			assistant(5),
		];
		const {container} = render(
			<TranscriptOverlayHostContext.Provider value={host}>
				<div data-testid="scroller" style={{overflowY: "auto"}}>
					<SessionChat
						sessionId="fabricated-session"
						lines={lines}
						toolResultMap={new Map()}
						shouldScrollToEnd={false}
					/>
				</div>
			</TranscriptOverlayHostContext.Provider>,
		);
		const scroller = container.querySelector<HTMLElement>("[data-testid='scroller']")!;
		Object.defineProperty(scroller, "offsetParent", {configurable: true, get: () => document.body});
		Object.defineProperty(scroller, "scrollHeight", {configurable: true, get: () => 4000});
		Object.defineProperty(scroller, "clientHeight", {configurable: true, get: () => 600});
		Object.defineProperty(scroller, "scrollTop", {configurable: true, get: () => 1000});
		const scrollTo = vi.fn<(options: ScrollToOptions) => void>();
		Object.defineProperty(scroller, "scrollTo", {configurable: true, value: scrollTo});
		act(() => {
			fireEvent.scroll(scroller);
		});
		const bubble = await screen.findByRole("button", {name: "Scroll to your message"});
		fireEvent.click(bubble);
		expect({inHost: host.contains(bubble), text: bubble.textContent, scrollTo: scrollTo.mock.calls}).toStrictEqual({
			inHost: true,
			text: "Fabricated first prompt",
			scrollTo: [[{top: 1000, behavior: "smooth"}]],
		});
	});
});
