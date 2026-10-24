// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {TranscriptSelectionBar} from "../src/components/transcript-selection-bar";
import {type ComposerHandle, getContextChips, registerComposer, takeContextChips} from "../src/lib/context-attach";
import {getSideChat, openSideChat, resetSideChatStore} from "../src/lib/side-chat-store";

const SESSION = "bar-session";

interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

function domRect({left, top, width, height}: Rect): DOMRect {
	return {
		left,
		top,
		width,
		height,
		x: left,
		y: top,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	};
}

const SCROLLER_RECT: Rect = {left: 100, top: 50, width: 800, height: 750};
const BAR_RECT: Rect = {left: 0, top: 0, width: 165, height: 24};
let rangeRect: Rect = {left: 400, top: 368.5, width: 200, height: 19};

let focus: ReturnType<typeof vi.fn<ComposerHandle["focus"]>>;
let unregister: () => void = () => {};

beforeEach(() => {
	vi.useFakeTimers();
	rangeRect = {left: 400, top: 368.5, width: 200, height: 19};
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		callback(0);
		return 0;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(Range.prototype, "getClientRects", {
		configurable: true,
		value: () => [domRect(rangeRect)],
	});
	Object.defineProperty(Range.prototype, "getBoundingClientRect", {
		configurable: true,
		value: () => domRect(rangeRect),
	});
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
		if (this.dataset["testid"] === "scroller") return domRect(SCROLLER_RECT);
		if (this.dataset["transcriptSelectionBar"] !== undefined) return domRect(BAR_RECT);
		return domRect({left: 0, top: 0, width: 0, height: 0});
	});
	focus = vi.fn<ComposerHandle["focus"]>();
	unregister = registerComposer(SESSION, {insertText: vi.fn<ComposerHandle["insertText"]>(), focus});
});

afterEach(() => {
	unregister();
	cleanup();
	window.getSelection()?.removeAllRanges();
	takeContextChips(SESSION);
	resetSideChatStore();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(Range.prototype, "getClientRects");
	Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});

function Harness({sideChatAvailable}: {sideChatAvailable: boolean}) {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div data-testid="scroller" style={{overflowY: "auto"}}>
			<div ref={containerRef}>
				<p>Hermit crabs live in tide pools.</p>
				<p>Tide pools form in rocky hollows.</p>
			</div>
			<TranscriptSelectionBar
				sessionId={SESSION}
				containerRef={containerRef}
				sideChatAvailable={sideChatAvailable}
			/>
		</div>
	);
}

function renderBar(sideChatAvailable = true): void {
	render(<Harness sideChatAvailable={sideChatAvailable} />);
}

function textNodeContaining(text: string): Text {
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (node.textContent?.includes(text) === true && node instanceof Text) return node;
	}
	throw new Error(`no text node containing ${text}`);
}

function select(text: string, length = text.length): void {
	const node = textNodeContaining(text);
	const start = node.data.indexOf(text);
	const range = document.createRange();
	range.setStart(node, start);
	range.setEnd(node, start + length);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	act(() => {
		document.dispatchEvent(new Event("selectionchange"));
	});
}

function advance(ms: number): void {
	act(() => {
		vi.advanceTimersByTime(ms);
	});
}

function host(): HTMLElement | null {
	return document.querySelector<HTMLElement>("[data-transcript-selection-host]");
}

function bar(): HTMLElement | null {
	return document.querySelector<HTMLElement>("[data-transcript-selection-bar]");
}

function labels(): string[] {
	return [...(bar()?.querySelectorAll("button") ?? [])].map((button) => button.textContent);
}

function button(label: string): HTMLButtonElement {
	const found = [...(bar()?.querySelectorAll("button") ?? [])].find((each) => each.textContent === label);
	if (found === undefined) throw new Error(`no ${label} button`);
	return found;
}

describe("transcript selection hook", () => {
	it("shows the bar 250ms after a selection of two or more characters, not before", () => {
		renderBar();
		select("Hermit crabs");

		advance(249);
		const before = host();
		advance(1);

		expect({before, labels: labels()}).toStrictEqual({before: null, labels: ["Start a side chat", "Reply"]});
	});

	it("ignores a selection shorter than two trimmed characters", () => {
		renderBar();
		select("Hermit", 1);
		advance(300);

		expect(host()).toBeNull();
	});

	it("ignores a selection outside the container", () => {
		renderBar();
		const outside = document.createElement("p");
		outside.textContent = "Outside text";
		document.body.append(outside);
		select("Outside text");
		advance(300);
		outside.remove();

		expect(host()).toBeNull();
	});

	it("hides at once when the selection collapses", () => {
		renderBar();
		select("Hermit crabs");
		advance(250);

		act(() => {
			window.getSelection()?.collapseToStart();
			document.dispatchEvent(new Event("selectionchange"));
		});

		expect(host()).toBeNull();
	});

	it("waits for mouseup during a drag", () => {
		renderBar();
		fireEvent.mouseDown(textNodeContaining("Hermit").parentElement ?? document.body);
		select("Hermit crabs");
		advance(500);
		const duringDrag = host();

		act(() => {
			fireEvent.mouseUp(document.body);
		});

		expect({duringDrag, shown: host() !== null}).toStrictEqual({duringDrag: null, shown: true});
	});

	it("suppresses the bar after a touch pointerdown", () => {
		renderBar();
		fireEvent.pointerDown(document.body, {pointerType: "touch"});
		select("Hermit crabs");
		advance(300);

		expect(host()).toBeNull();
	});
});

describe("transcript selection bar", () => {
	it("portals a fixed host centred above the first selection line", () => {
		renderBar();
		select("Hermit crabs");
		advance(250);

		expect({
			className: host()?.className,
			zIndex: host()?.style.zIndex,
			transform: host()?.style.transform,
			parent: host()?.closest("[data-testid=scroller]") ?? null,
		}).toStrictEqual({
			className:
				"text-body text-primary break-words pointer-events-auto fixed left-0 top-0 will-change-transform isolate",
			zIndex: "55",
			transform: "translate(500px, 337px) translateX(-50%)",
			parent: null,
		});
	});

	it("clamps x inside the container and drops below when there is no room above", () => {
		rangeRect = {left: 110, top: 60, width: 20, height: 19};
		renderBar();
		select("Hermit crabs");
		advance(250);

		// x clamps to 100 + 165/2 + 12 = 194.5; y falls to bottom 79 + 8.
		expect(host()?.style.transform).toBe("translate(195px, 87px) translateX(-50%)");
	});

	it("renders upstream's bar, ghost buttons and separator", () => {
		renderBar();
		select("Hermit crabs");
		advance(250);
		const separator = bar()?.querySelector("span[aria-hidden]");

		expect({
			bar: bar()?.className,
			buttons: [...(bar()?.querySelectorAll("button") ?? [])].map((each) => ({
				type: each.type,
				className: each.className,
			})),
			separator: separator?.className,
		}).toStrictEqual({
			bar: "rounded-r5 bg-surface-3 shadow-[var(--menu-shadow)] group/split flex",
			buttons: [
				{
					type: "button",
					className:
						"inline-flex h-6 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-r5 px-2 text-body font-normal text-primary select-none outline-none hover:bg-fill-ghost-hover focus-visible:shadow-focus",
				},
				{
					type: "button",
					className:
						"inline-flex h-6 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-r5 px-2 text-body font-normal text-primary select-none outline-none hover:bg-fill-ghost-hover focus-visible:shadow-focus",
				},
			],
			separator:
				"w-px my-[7px] bg-alpha-2 shrink-0 transition-opacity motion-reduce:transition-none group-hover/split:opacity-0 group-focus-within/split:opacity-0",
		});
	});

	it("keeps the selection on button mousedown", () => {
		renderBar();
		select("Hermit crabs");
		advance(250);

		const prevented = !fireEvent.mouseDown(button("Reply"));

		expect(prevented).toBe(true);
	});

	it("says Send to side chat while the session's side chat is open", () => {
		openSideChat(SESSION);
		renderBar();
		select("Hermit crabs");
		advance(250);

		expect(labels()).toStrictEqual(["Send to side chat", "Reply"]);
	});

	it("offers only Reply without a side chat", () => {
		renderBar(false);
		select("Hermit crabs");
		advance(250);

		expect({labels: labels(), separator: bar()?.querySelector("span[aria-hidden]") ?? null}).toStrictEqual({
			labels: ["Reply"],
			separator: null,
		});
	});

	it("offers only the side chat without a composer", () => {
		unregister();
		renderBar();
		select("Hermit crabs");
		advance(250);

		expect(labels()).toStrictEqual(["Start a side chat"]);
	});

	it("Reply attaches the trimmed selection as an Excerpt, focuses the composer and clears the selection", () => {
		renderBar();
		select("Hermit crabs ");
		advance(250);

		fireEvent.click(button("Reply"));

		expect({
			chips: getContextChips(SESSION).map(({id: _id, ...chip}) => chip),
			focused: focus.mock.calls.length,
			ranges: window.getSelection()?.rangeCount,
			host: host(),
		}).toStrictEqual({chips: [{kind: "excerpt", text: "Hermit crabs"}], focused: 1, ranges: 0, host: null});
	});

	it("Reply truncates a long selection to 1500 characters", () => {
		const long = "x".repeat(1600);
		render(<HarnessWithText text={long} />);
		select(long);
		advance(250);

		fireEvent.click(button("Reply"));

		expect(getContextChips(SESSION).map(({text}) => text)).toStrictEqual([`${"x".repeat(1500)}…`]);
	});

	it("Start a side chat opens the side chat and clears the selection", () => {
		renderBar();
		select("Hermit crabs");
		advance(250);

		fireEvent.click(button("Start a side chat"));

		expect({open: getSideChat(SESSION).open, ranges: window.getSelection()?.rangeCount}).toStrictEqual({
			open: true,
			ranges: 0,
		});
	});

	it("hides once a scroll moves the selection more than 100px", () => {
		renderBar();
		select("Hermit crabs");
		advance(250);

		rangeRect = {...rangeRect, top: rangeRect.top - 100};
		act(() => {
			document.dispatchEvent(new Event("scroll"));
		});
		const within = host()?.style.transform;
		rangeRect = {...rangeRect, top: rangeRect.top - 1};
		act(() => {
			document.dispatchEvent(new Event("scroll"));
		});

		expect({within, after: host()}).toStrictEqual({
			within: "translate(500px, 237px) translateX(-50%)",
			after: null,
		});
	});

	it("stays mounted with visibility hidden while a menu is open", async () => {
		renderBar();
		select("Hermit crabs");
		advance(250);

		const menu = document.createElement("div");
		menu.setAttribute("role", "menu");
		await act(async () => {
			document.body.append(menu);
			await Promise.resolve();
		});
		const hidden = host()?.style.visibility;
		await act(async () => {
			menu.remove();
			await Promise.resolve();
		});

		expect({hidden, after: host()?.style.visibility}).toStrictEqual({hidden: "hidden", after: ""});
	});
});

function HarnessWithText({text}: {text: string}) {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div data-testid="scroller" style={{overflowY: "auto"}}>
			<div ref={containerRef}>
				<p>{text}</p>
			</div>
			<TranscriptSelectionBar sessionId={SESSION} containerRef={containerRef} sideChatAvailable={false} />
		</div>
	);
}
