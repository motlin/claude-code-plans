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

/** The scroller's scrollTop, which every row's box follows as it would in a real layout. */
let scrollTop = 3000;
let frames: FrameRequestCallback[] = [];
function flushFrames() {
	for (let round = 0; frames.length > 0 && round < 100; round++) {
		act(() => {
			const pending = frames;
			frames = [];
			for (const frame of pending) frame(0);
		});
	}
}

/** Entry i's content sits at document offset 500 + 100i, 50px tall. */
function boxOf(element: Element): DOMRect {
	const row = element.closest("[data-transcript-entry-index]");
	if (row !== null && (row === element || row.firstElementChild === element)) {
		const top = 500 + Number(row.getAttribute("data-transcript-entry-index")) * 100 - scrollTop;
		return rect(top, top + 50);
	}
	if (element.getAttribute("data-testid") === "scroller") return rect(0, 600);
	return rect(0, 0);
}

function renderTranscript(lines: SessionLine[]) {
	const host = document.createElement("div");
	document.body.append(host);
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
	const writes: number[] = [];
	Object.defineProperty(scroller, "offsetParent", {configurable: true, get: () => document.body});
	Object.defineProperty(scroller, "scrollHeight", {configurable: true, get: () => 4000});
	Object.defineProperty(scroller, "clientHeight", {configurable: true, get: () => 600});
	Object.defineProperty(scroller, "scrollTop", {
		configurable: true,
		get: () => scrollTop,
		set: (value: number) => {
			scrollTop = value;
			writes.push(value);
		},
	});
	const scrollTo = vi.fn<(options: ScrollToOptions) => void>();
	Object.defineProperty(scroller, "scrollTo", {configurable: true, value: scrollTo});
	act(() => {
		fireEvent.scroll(scroller);
	});
	flushFrames();
	return {host, scroller, writes, scrollTo};
}

const LINES = [
	user(0, "Fabricated first prompt"),
	assistant(1),
	user(2, "   "),
	assistant(3),
	user(4, "Stop hook feedback: fabricated", {isMeta: true}),
	assistant(5),
];

describe("SessionChat sticky prompt bubble", () => {
	beforeEach(() => {
		scrollTop = 3000;
		frames = [];
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: false,
			media: query,
			addEventListener() {},
			removeEventListener() {},
		}));
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
			return boxOf(this);
		});
	});
	afterEach(() => {
		cleanup();
		document.body.replaceChildren();
		document.documentElement.removeAttribute("data-reduce-motion");
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("pins the latest typed prompt, skipping blank and hook-feedback rows, and glides it to 20px below the top", async () => {
		const {host, writes, scrollTo} = renderTranscript(LINES);
		const bubble = await screen.findByRole("button", {name: "Scroll to your message"});
		const shown = {inHost: host.contains(bubble), text: bubble.textContent};
		writes.length = 0;
		fireEvent.click(bubble);
		flushFrames();
		// Upstream c1c1ec7b9 `ke`: each frame closes a quarter of the way to scrollTop + rowTop - scrollerTop - 20.
		expect({
			...shown,
			firstWrites: writes.slice(0, 3),
			last: writes.at(-1),
			scrollTo: scrollTo.mock.calls,
		}).toStrictEqual({
			inHost: true,
			text: "Fabricated first prompt",
			firstWrites: [2370, 1897.5, 1543.125],
			last: 480,
			scrollTo: [],
		});
	});

	it("jumps straight there under reduced motion", async () => {
		document.documentElement.setAttribute("data-reduce-motion", "true");
		const {writes} = renderTranscript(LINES);
		const bubble = await screen.findByRole("button", {name: "Scroll to your message"});
		writes.length = 0;
		fireEvent.click(bubble);
		flushFrames();
		expect(writes).toStrictEqual([480]);
	});

	it("stops gliding when the user wheels or something else scrolls the transcript", async () => {
		const {scroller, writes} = renderTranscript(LINES);
		const bubble = await screen.findByRole("button", {name: "Scroll to your message"});
		writes.length = 0;
		fireEvent.click(bubble);
		act(() => {
			const pending = frames;
			frames = [];
			for (const frame of pending) frame(0);
		});
		fireEvent.wheel(scroller, {deltaY: 10});
		flushFrames();
		const afterWheel = [...writes];
		writes.length = 0;
		scrollTop = 3000;
		fireEvent.click(bubble);
		act(() => {
			const pending = frames;
			frames = [];
			for (const frame of pending) frame(0);
		});
		scrollTop = 2000;
		flushFrames();
		expect({afterWheel, afterForeignScroll: writes}).toStrictEqual({
			afterWheel: [2370],
			afterForeignScroll: [2370],
		});
	});
});
