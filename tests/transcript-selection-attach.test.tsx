// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionChat} from "../src/components/session-chat";
import {type ComposerHandle, getContextChips, registerComposer, takeContextChips} from "../src/lib/context-attach";
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

const MAC_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const RECORDS: unknown[] = [
	{type: "user", uuid: "user-1", message: {role: "user", content: "Tell me about tide pools"}},
	{
		type: "assistant",
		uuid: "assistant-1",
		message: {role: "assistant", content: [{type: "text", text: "Hermit crabs live in tide pools."}]},
	},
];

let unregister: () => void = () => {};
let focus: ReturnType<typeof vi.fn<ComposerHandle["focus"]>>;

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_USER_AGENT);
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn<HTMLElement["scrollIntoView"]>(),
	});
	focus = vi.fn<ComposerHandle["focus"]>();
	unregister = registerComposer("test-session", {insertText: vi.fn<ComposerHandle["insertText"]>(), focus});
});

afterEach(() => {
	unregister();
	cleanup();
	window.getSelection()?.removeAllRanges();
	takeContextChips("test-session");
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function renderChat(): HTMLElement {
	const {lines, toolResultMap} = processTranscript(RECORDS);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>,
	).container;
}

function textNodeContaining(root: Element, text: string): Text {
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (node.textContent?.includes(text) === true && node instanceof Text) return node;
	}
	throw new Error(`no text node containing ${text}`);
}

/** Selects `text` inside the first text node holding it, as a drag would. */
function selectText(root: Element, text: string, length = text.length): Selection {
	const node = textNodeContaining(root, text);
	const start = node.data.indexOf(text);
	const range = document.createRange();
	range.setStart(node, start);
	range.setEnd(node, start + length);
	const selection = window.getSelection();
	if (selection === null) throw new Error("no selection");
	selection.removeAllRanges();
	selection.addRange(range);
	return selection;
}

function pressAttach(target: Element = document.body, init: KeyboardEventInit = {}): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {
		key: "L",
		code: "KeyL",
		metaKey: true,
		shiftKey: true,
		bubbles: true,
		cancelable: true,
		...init,
	});
	fireEvent(target, event);
	return event;
}

function chips(): unknown[] {
	return getContextChips("test-session").map(({id: _id, ...chip}) => chip);
}

describe("⇧⌘L with a transcript selection", () => {
	it("attaches the trimmed selection as an Excerpt, clears it and focuses the composer", () => {
		const container = renderChat();
		const selection = selectText(container, "Hermit crabs ");

		const event = pressAttach();

		expect({
			defaultPrevented: event.defaultPrevented,
			chips: chips(),
			selection: selection.rangeCount,
			focused: focus.mock.calls.length,
		}).toStrictEqual({
			defaultPrevented: true,
			chips: [{kind: "excerpt", text: "Hermit crabs"}],
			selection: 0,
			focused: 1,
		});
	});

	it("ignores a selection shorter than two trimmed characters", () => {
		const container = renderChat();
		const selection = selectText(container, "Hermit", 1);

		const event = pressAttach();

		expect({
			defaultPrevented: event.defaultPrevented,
			chips: chips(),
			selection: selection.rangeCount,
		}).toStrictEqual({defaultPrevented: false, chips: [], selection: 1});
	});

	it("ignores a selection that reaches outside the transcript", () => {
		const container = renderChat();
		const outside = document.createElement("p");
		outside.textContent = "Outside text";
		document.body.append(outside);
		const range = document.createRange();
		range.setStart(textNodeContaining(container, "Hermit"), 0);
		range.setEnd(textNodeContaining(outside, "Outside"), 7);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);

		const event = pressAttach();
		outside.remove();

		expect({defaultPrevented: event.defaultPrevented, chips: chips()}).toStrictEqual({
			defaultPrevented: false,
			chips: [],
		});
	});

	it("ignores the key when it comes from an editable field", () => {
		const container = renderChat();
		selectText(container, "Hermit crabs");
		const editables = ["input", "textarea", "contenteditable"].map((kind) => {
			const element = document.createElement(kind === "contenteditable" ? "div" : kind);
			if (kind === "contenteditable") element.setAttribute("contenteditable", "true");
			document.body.append(element);
			return element;
		});

		const prevented = editables.map((element) => pressAttach(element).defaultPrevented);
		for (const element of editables) element.remove();

		expect({prevented, chips: chips()}).toStrictEqual({prevented: [false, false, false], chips: []});
	});

	it("ignores the key while a dialog is open", () => {
		const container = renderChat();
		selectText(container, "Hermit crabs");
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		document.body.append(dialog);

		const event = pressAttach();
		dialog.remove();

		expect({defaultPrevented: event.defaultPrevented, chips: chips()}).toStrictEqual({
			defaultPrevented: false,
			chips: [],
		});
	});

	it("ignores a repeated key", () => {
		const container = renderChat();
		selectText(container, "Hermit crabs");

		pressAttach(document.body, {repeat: true});

		expect(chips()).toStrictEqual([]);
	});
});

describe("selection bar in the transcript", () => {
	it("shows Reply over a transcript selection", () => {
		vi.useFakeTimers();
		const rect = {
			left: 0,
			top: 200,
			width: 50,
			height: 19,
			x: 0,
			y: 200,
			right: 50,
			bottom: 219,
			toJSON: () => ({}),
		};
		Object.defineProperty(Range.prototype, "getClientRects", {configurable: true, value: () => [rect]});
		Object.defineProperty(Range.prototype, "getBoundingClientRect", {configurable: true, value: () => rect});
		const container = renderChat();
		selectText(container, "Hermit crabs");

		act(() => {
			document.dispatchEvent(new Event("selectionchange"));
			vi.advanceTimersByTime(250);
		});
		const labels = [...document.querySelectorAll("[data-transcript-selection-bar] button")].map(
			(button) => button.textContent,
		);
		vi.useRealTimers();
		Reflect.deleteProperty(Range.prototype, "getClientRects");
		Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");

		expect(labels).toStrictEqual(["Reply"]);
	});
});
