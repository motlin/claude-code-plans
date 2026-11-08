// @vitest-environment jsdom

import {EditorView} from "@codemirror/view";
import {cleanup, fireEvent, render} from "@testing-library/react";
import {createRef} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SourceEditor, type SourceEditorHandle, type SourceEditorProps} from "../src/components/files/source-editor";
import type {SaveReason} from "../src/lib/source-save";

afterEach(() => {
	cleanup();
});

function attributesOf(element: Element, names: string[]): Record<string, string | null> {
	return Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]));
}

describe("SourceEditor read-only", () => {
	it("renders a focusable read-only textbox like upstream's File editor", () => {
		const {container} = render(<SourceEditor value={"a\nb\nc"} readOnly />);
		const content = container.querySelector(".cm-content");
		expect(content).not.toBeNull();
		expect(attributesOf(content!, ["contenteditable", "aria-readonly", "role", "aria-label"])).toStrictEqual({
			contenteditable: "true",
			"aria-readonly": "true",
			role: "textbox",
			"aria-label": "File contents",
		});
	});

	it("draws the line number gutter", () => {
		const {container} = render(<SourceEditor value={"a\nb"} readOnly />);
		expect(container.querySelectorAll(".cm-gutter.cm-lineNumbers").length).toBe(1);
	});

	it("marks the first line active before focus", () => {
		const {container} = render(<SourceEditor value={"a\nb"} readOnly />);
		const lines = [...container.querySelectorAll(".cm-line")];
		expect(lines.map((line) => line.classList.contains("cm-activeLine"))).toStrictEqual([true, false]);
	});

	it("wraps lines by default and drops wrapping when wordWrap is false", () => {
		const {container, rerender} = render(<SourceEditor value="a" readOnly />);
		expect(container.querySelector(".cm-content")!.classList.contains("cm-lineWrapping")).toBe(true);
		rerender(<SourceEditor value="a" readOnly wordWrap={false} />);
		expect(container.querySelector(".cm-content")!.classList.contains("cm-lineWrapping")).toBe(false);
	});

	it("sets tab-size on .cm-content and reconfigures it without remounting", () => {
		const {container, rerender} = render(<SourceEditor value="a" readOnly />);
		const content = container.querySelector(".cm-content");
		if (!(content instanceof HTMLElement)) throw new Error("no .cm-content");
		expect(content.style.getPropertyValue("tab-size")).toBe("4");
		rerender(<SourceEditor value="a" readOnly tabSize={2} />);
		expect(container.querySelector(".cm-content")).toBe(content);
		expect(content.style.getPropertyValue("tab-size")).toBe("2");
	});

	it("replaces the document when value changes", () => {
		const {container, rerender} = render(<SourceEditor value="one" readOnly />);
		rerender(<SourceEditor value={"two\nthree"} readOnly />);
		expect([...container.querySelectorAll(".cm-line")].map((line) => line.textContent)).toStrictEqual([
			"two",
			"three",
		]);
	});
});

/** CodeMirror's Mod is Meta on macOS and Ctrl elsewhere. */
function modS(): KeyboardEventInit {
	const mac = navigator.platform.includes("Mac");
	return {key: "s", ctrlKey: !mac, metaKey: mac};
}

function viewOf(container: HTMLElement): EditorView {
	const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!);
	if (!view) throw new Error("no EditorView");
	return view;
}

function type(view: EditorView, text: string): void {
	view.dispatch({changes: {from: view.state.doc.length, insert: text}, userEvent: "input.type"});
}

describe("SourceEditor editing", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	function renderEditor(props: Partial<SourceEditorProps> = {}) {
		const calls: unknown[][] = [];
		const handlers = {
			onChange: (dirty: boolean) => calls.push(["change", dirty]),
			onSave: (text: string, reason: SaveReason) => calls.push(["save", text, reason]),
			onDiscard: () => calls.push(["discard"]),
			onEscape: () => {
				calls.push(["escape"]);
				return true;
			},
		};
		const result = render(<SourceEditor value="disk" ariaLabel="notes.md" {...handlers} {...props} />);
		return {...result, calls, view: viewOf(result.container), handlers};
	}

	it("renders an editable textbox labelled with ariaLabel", () => {
		const {container} = renderEditor();
		expect(
			attributesOf(container.querySelector(".cm-content")!, ["contenteditable", "aria-readonly", "aria-label"]),
		).toStrictEqual({contenteditable: "true", "aria-readonly": null, "aria-label": "notes.md"});
	});

	it("reports dirty on every doc change and clean when the text returns to the disk contents", () => {
		const {view, calls} = renderEditor();
		type(view, "!");
		view.dispatch({changes: {from: 4, to: 5, insert: ""}});
		expect(calls).toStrictEqual([
			["change", true],
			["change", false],
		]);
	});

	it("autosaves 1000 ms after the last change", () => {
		const {view, calls} = renderEditor({autoSave: true});
		type(view, "!");
		vi.advanceTimersByTime(400);
		type(view, "?");
		vi.advanceTimersByTime(999);
		expect(calls.filter((call) => call[0] === "save")).toStrictEqual([]);
		vi.advanceTimersByTime(1);
		expect(calls.filter((call) => call[0] === "save")).toStrictEqual([["save", "disk!?", "idle"]]);
	});

	it("never autosaves in manual mode", () => {
		const {view, calls, container} = renderEditor({autoSave: false});
		type(view, "!");
		fireEvent.blur(container.querySelector(".cm-content")!);
		vi.advanceTimersByTime(5000);
		expect(calls.filter((call) => call[0] === "save")).toStrictEqual([]);
	});

	it("flushes on blur, hidden and pagehide, and only while dirty", () => {
		const {view, calls, container} = renderEditor({autoSave: true});
		const content = container.querySelector(".cm-content")!;
		fireEvent.blur(content);
		type(view, "!");
		fireEvent.blur(content);
		const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		document.dispatchEvent(new Event("visibilitychange"));
		visibility.mockRestore();
		window.dispatchEvent(new Event("pagehide"));
		vi.advanceTimersByTime(5000);
		expect(calls.filter((call) => call[0] === "save")).toStrictEqual([
			["save", "disk!", "blur"],
			["save", "disk!", "hidden"],
			["save", "disk!", "unload"],
		]);
	});

	it("flushes an unmount save and reports clean when unmounted dirty", () => {
		const {view, calls, unmount} = renderEditor({autoSave: true});
		type(view, "!");
		unmount();
		expect(calls).toStrictEqual([
			["change", true],
			["save", "disk!", "unmount"],
			["change", false],
		]);
	});

	it("Mod-s saves explicitly even when clean, and is a no-op when read-only", () => {
		const {container, calls, rerender, handlers} = renderEditor({autoSave: true});
		fireEvent.keyDown(container.querySelector(".cm-content")!, modS());
		rerender(<SourceEditor value="disk" ariaLabel="notes.md" readOnly {...handlers} />);
		fireEvent.keyDown(container.querySelector(".cm-content")!, modS());
		expect(calls).toStrictEqual([["save", "disk", "explicit"]]);
	});

	it("Escape discards in manual mode while dirty", () => {
		const {view, calls, container} = renderEditor({autoSave: false});
		type(view, "!");
		fireEvent.keyDown(container.querySelector(".cm-content")!, {key: "Escape"});
		expect(calls).toStrictEqual([["change", true], ["discard"]]);
	});

	it("Escape keeps the draft when escapeKeepsDraft is set", () => {
		const {view, calls, container} = renderEditor({autoSave: false, escapeKeepsDraft: true});
		type(view, "!");
		fireEvent.keyDown(container.querySelector(".cm-content")!, {key: "Escape"});
		expect(calls).toStrictEqual([["change", true]]);
	});

	it("Escape calls onEscape with autosave on or while clean", () => {
		const {view, calls, container} = renderEditor({autoSave: true});
		fireEvent.keyDown(container.querySelector(".cm-content")!, {key: "Escape"});
		type(view, "!");
		fireEvent.keyDown(container.querySelector(".cm-content")!, {key: "Escape"});
		expect(calls).toStrictEqual([["escape"], ["change", true], ["escape"]]);
	});

	it("keeps a dirty draft when the disk value changes, and replaces a clean one", () => {
		const {view, calls, rerender, handlers, container} = renderEditor();
		type(view, "!");
		rerender(<SourceEditor value="disk2" ariaLabel="notes.md" {...handlers} />);
		expect(view.state.doc.toString()).toBe("disk!");
		const clean = render(<SourceEditor value="a" ariaLabel="b.md" {...handlers} />);
		clean.rerender(<SourceEditor value="b" ariaLabel="b.md" {...handlers} />);
		expect(viewOf(clean.container).state.doc.toString()).toBe("b");
		expect(container.querySelector(".cm-content")).not.toBeNull();
		expect(calls).toStrictEqual([
			["change", true],
			["change", false],
		]);
	});

	it("exposes reset and getValue through its ref", () => {
		const ref = createRef<SourceEditorHandle>();
		const {view, calls} = renderEditor({ref});
		type(view, "!");
		expect(ref.current!.getValue()).toBe("disk!");
		ref.current!.reset("disk");
		expect([ref.current!.getValue(), calls]).toStrictEqual([
			"disk",
			[
				["change", true],
				["change", false],
			],
		]);
	});
});
