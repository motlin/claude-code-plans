// @vitest-environment jsdom

import {EditorView} from "@codemirror/view";
import {foldCode} from "@codemirror/language";
import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {createRef} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SourceEditor, type SourceEditorHandle, type SourceEditorProps} from "../src/components/files/source-editor";
import type {SaveReason} from "../src/lib/source-save";

afterEach(() =>
{
	cleanup();
});

function attributesOf(element: Element, names: string[]): Record<string, string | null>
{
	return Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]));
}

describe("SourceEditor read-only", () =>
{
	it("renders a focusable read-only textbox like upstream's File editor", () =>
	{
		const {container} = render(<SourceEditor value={"a\nb\nc"} readOnly />);
		const content = container.querySelector(".cm-content");
		expect(content).not.toBeNull();
		expect(attributesOf(content!, ["contenteditable", "aria-readonly", "role", "aria-label"])).toStrictEqual(
			{
				contenteditable: "true",
				"aria-readonly": "true",
				role: "textbox",
				"aria-label": "File contents",
			},
		);
	});

	it("draws the line number gutter", () =>
	{
		const {container} = render(<SourceEditor value={"a\nb"} readOnly />);
		expect(container.querySelectorAll(".cm-gutter.cm-lineNumbers").length).toBe(1);
	});

	it("marks the first line active before focus", () =>
	{
		const {container} = render(<SourceEditor value={"a\nb"} readOnly />);
		const lines = [...container.querySelectorAll(".cm-line")];
		expect(lines.map((line) => line.classList.contains("cm-activeLine"))).toStrictEqual([true, false]);
	});

	it("wraps lines by default and drops wrapping when wordWrap is false", () =>
	{
		const {container, rerender} = render(<SourceEditor value="a" readOnly />);
		expect(container.querySelector(".cm-content")!.classList.contains("cm-lineWrapping")).toBe(true);
		rerender(<SourceEditor value="a" readOnly wordWrap={false} />);
		expect(container.querySelector(".cm-content")!.classList.contains("cm-lineWrapping")).toBe(false);
	});

	it("sets tab-size on .cm-content and reconfigures it without remounting", () =>
	{
		const {container, rerender} = render(<SourceEditor value="a" readOnly />);
		const content = container.querySelector(".cm-content");
		if (!(content instanceof HTMLElement)) throw new Error("no .cm-content");
		expect(content.style.getPropertyValue("tab-size")).toBe("4");
		rerender(<SourceEditor value="a" readOnly tabSize={2} />);
		expect(container.querySelector(".cm-content")).toBe(content);
		expect(content.style.getPropertyValue("tab-size")).toBe("2");
	});

	it("replaces the document when value changes", () =>
	{
		const {container, rerender} = render(<SourceEditor value="one" readOnly />);
		rerender(<SourceEditor value={"two\nthree"} readOnly />);
		expect([...container.querySelectorAll(".cm-line")].map((line) => line.textContent)).toStrictEqual([
			"two",
			"three",
		]);
	});
});

/** CodeMirror's Mod is Meta on macOS and Ctrl elsewhere. */
function modS(): KeyboardEventInit
{
	const mac = navigator.platform.includes("Mac");
	return {
		key: "s",
		ctrlKey: !mac,
		metaKey: mac,
	};
}

function viewOf(container: HTMLElement): EditorView
{
	const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!);
	if (!view) throw new Error("no EditorView");
	return view;
}

function type(view: EditorView, text: string): void
{
	view.dispatch(
		{
			changes:
			{
				from: view.state.doc.length,
				insert: text,
			},
			userEvent: "input.type",
		},
	);
}

describe("SourceEditor editing", () =>
{
	beforeEach(() =>
	{
		vi.useFakeTimers();
	});
	afterEach(() =>
	{
		vi.useRealTimers();
	});

	function renderEditor(props: Partial<SourceEditorProps> = {})
	{
		const calls: unknown[][] = [];
		const handlers =
		{
			onChange: (dirty: boolean) => calls.push(["change", dirty]),
			onSave: (text: string, reason: SaveReason) => calls.push(["save", text, reason]),
			onDiscard: () => calls.push(["discard"]),
			onEscape: () =>
			{
				calls.push(["escape"]);
				return true;
			},
		};
		const result = render(<SourceEditor value="disk" ariaLabel="notes.md" {...handlers} {...props} />);
		return {
			...result,
			calls,
			view: viewOf(result.container),
			handlers,
		};
	}

	it("renders an editable textbox labelled with ariaLabel", () =>
	{
		const {container} = renderEditor();
		expect(
			attributesOf(container.querySelector(".cm-content")!, ["contenteditable", "aria-readonly", "aria-label"]),
		).toStrictEqual(
			{
				contenteditable: "true",
				"aria-readonly": null,
				"aria-label": "notes.md",
			},
		);
	});

	it("reports dirty on every doc change and clean when the text returns to the disk contents", () =>
	{
		const {view, calls} = renderEditor();
		type(view, "!");
		view.dispatch(
			{
				changes:
				{
					from: 4,
					to: 5,
					insert: "",
				},
			},
		);
		expect(calls).toStrictEqual([
			["change", true],
			["change", false],
		]);
	});

	it("autosaves 1000 ms after the last change", () =>
	{
		const {view, calls} = renderEditor(
			{
				autoSave: true,
			},
		);
		type(view, "!");
		vi.advanceTimersByTime(400);
		type(view, "?");
		vi.advanceTimersByTime(999);
		expect(calls.filter((call) => call[0] === "save")).toStrictEqual([]);
		vi.advanceTimersByTime(1);
		expect(calls.filter((call) => call[0] === "save")).toStrictEqual([["save", "disk!?", "idle"]]);
	});

	it("never autosaves in manual mode", () =>
	{
		const {view, calls, container} = renderEditor(
			{
				autoSave: false,
			},
		);
		type(view, "!");
		fireEvent.blur(container.querySelector(".cm-content")!);
		vi.advanceTimersByTime(5000);
		expect(calls.filter((call) => call[0] === "save")).toStrictEqual([]);
	});

	it("flushes on blur, hidden and pagehide, and only while dirty", () =>
	{
		const {view, calls, container} = renderEditor(
			{
				autoSave: true,
			},
		);
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

	it("flushes an unmount save and reports clean when unmounted dirty", () =>
	{
		const {view, calls, unmount} = renderEditor(
			{
				autoSave: true,
			},
		);
		type(view, "!");
		unmount();
		expect(calls).toStrictEqual([
			["change", true],
			["save", "disk!", "unmount"],
			["change", false],
		]);
	});

	it("Mod-s saves explicitly even when clean, and is a no-op when read-only", () =>
	{
		const {container, calls, rerender, handlers} = renderEditor(
			{
				autoSave: true,
			},
		);
		fireEvent.keyDown(container.querySelector(".cm-content")!, modS());
		rerender(<SourceEditor value="disk" ariaLabel="notes.md" readOnly {...handlers} />);
		fireEvent.keyDown(container.querySelector(".cm-content")!, modS());
		expect(calls).toStrictEqual([["save", "disk", "explicit"]]);
	});

	it("Escape discards in manual mode while dirty", () =>
	{
		const {view, calls, container} = renderEditor(
			{
				autoSave: false,
			},
		);
		type(view, "!");
		fireEvent.keyDown(
			container.querySelector(".cm-content")!,
			{
				key: "Escape",
			},
		);
		expect(calls).toStrictEqual([["change", true], ["discard"]]);
	});

	it("Escape keeps the draft when escapeKeepsDraft is set", () =>
	{
		const {view, calls, container} = renderEditor(
			{
				autoSave: false,
				escapeKeepsDraft: true,
			},
		);
		type(view, "!");
		fireEvent.keyDown(
			container.querySelector(".cm-content")!,
			{
				key: "Escape",
			},
		);
		expect(calls).toStrictEqual([["change", true]]);
	});

	it("Escape calls onEscape with autosave on or while clean", () =>
	{
		const {view, calls, container} = renderEditor(
			{
				autoSave: true,
			},
		);
		fireEvent.keyDown(
			container.querySelector(".cm-content")!,
			{
				key: "Escape",
			},
		);
		type(view, "!");
		fireEvent.keyDown(
			container.querySelector(".cm-content")!,
			{
				key: "Escape",
			},
		);
		expect(calls).toStrictEqual([["escape"], ["change", true], ["escape"]]);
	});

	it("keeps a dirty draft when the disk value changes, and replaces a clean one", () =>
	{
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

	it("exposes reset and getValue through its ref", () =>
	{
		const ref = createRef<SourceEditorHandle>();
		const {view, calls} = renderEditor(
			{
				ref,
			},
		);
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

function lineFlags(container: HTMLElement, className: string): boolean[]
{
	return [...container.querySelectorAll(".cm-line")].map((line) => line.classList.contains(className));
}

function marks(container: HTMLElement, prefix: string): string[][]
{
	return [...container.querySelectorAll<HTMLElement>(".cm-line span")]
		.filter((span) => [...span.classList].some((name) => name.startsWith(prefix)))
		.map((span) => [span.textContent, span.className]);
}

describe("SourceEditor syntax colors", () =>
{
	it("maps Shiki tokens to cm-shikiColorN marks and labels the language", () =>
	{
		const tokens = [
			[
				{
					content: "const",
					color: "#a",
					fontStyle: 0,
					offset: 0,
				},
				{
					content: " x",
					color: "#b",
					fontStyle: 2,
					offset: 5,
				},
			],
		];
		const {container} = render(<SourceEditor value="const x" readOnly tokens={tokens} language="typescript" />);
		expect(
			{
				marks: marks(container, "cm-shiki"),
				language: container.querySelector(".cm-content")!.getAttribute("data-language"),
			},
		).toStrictEqual(
			{
				marks: [
					["const", "cm-shikiColor1"],
					[" x", "cm-shikiColor2 cm-shikiBold"],
				],
				language: "typescript",
			},
		);
	});
});

describe("SourceEditor line targeting", () =>
{
	const FIVE = "one\ntwo\nthree\nfour\nfive";

	afterEach(() =>
	{
		window.history.replaceState(null, "", "/");
	});

	it("selects line and paints the line..endLine jump range", () =>
	{
		const {container} = render(<SourceEditor value={FIVE} readOnly line={3} endLine={4} />);
		expect(
			{
				jump: lineFlags(container, "cm-epitaxyJumpRange"),
				head: viewOf(container).state.selection.main.head,
			},
		).toStrictEqual(
			{
				jump: [false, false, true, true, false],
				head: 8,
			},
		);
	});

	it("follows #L hashes when hashNavigation is on", () =>
	{
		const {container} = render(<SourceEditor value={FIVE} readOnly hashNavigation />);
		act(() =>
		{
			window.history.replaceState(null, "", "#L2");
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		const single = lineFlags(container, "cm-epitaxyJumpRange");
		act(() =>
		{
			window.history.replaceState(null, "", "#L4-L5");
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		expect([single, lineFlags(container, "cm-epitaxyJumpRange")]).toStrictEqual([
			[false, true, false, false, false],
			[false, false, false, true, true],
		]);
	});
});

describe("SourceEditor folding", () =>
{
	it("folds markdown headings from the gutter chevron and unfolds from the placeholder", () =>
	{
		const {container} = render(<SourceEditor value={"# A\nx\n## B\ny"} readOnly language="markdown" />);
		const markers = [...container.querySelectorAll(".cm-fold-open")].map((marker) => [
			marker.getAttribute("title"),
			marker.querySelector("svg path")?.getAttribute("d"),
		]);
		fireEvent.click(container.querySelector(".cm-fold-open")!);
		const placeholder = container.querySelector(".cm-foldPlaceholder");
		const folded =
		{
			lines: container.querySelectorAll(".cm-line").length,
			placeholder: placeholder && attributesOf(placeholder, ["aria-label", "title"]),
			text: placeholder?.textContent,
		};
		fireEvent.click(placeholder!);
		const unfolded = container.querySelectorAll(".cm-line").length;
		const view = viewOf(container);
		view.dispatch(
			{
				selection:
				{
					anchor: view.state.doc.line(3).from,
				},
			},
		);
		foldCode(view);
		expect(
			{
				markers,
				folded,
				unfolded,
				sectionFolded: container.querySelectorAll(".cm-line").length,
			},
		).toStrictEqual(
			{
				markers: [
					["Fold line", "M6 4L10 8L6 12"],
					["Fold line", "M6 4L10 8L6 12"],
				],
				folded:
				{
					lines: 1,
					placeholder:
					{
						"aria-label": "Folded code",
						title: "Unfold",
					},
					text: "…",
				},
				unfolded: 4,
				sectionFolded: 3,
			},
		);
	});

	it("folds code by indentation", () =>
	{
		const {container} = render(<SourceEditor value={"if (a)\n  b\n  c\nd"} readOnly language="typescript" />);
		expect(container.querySelectorAll(".cm-fold-open").length).toBe(1);
	});
});

describe("SourceEditor go to line", () =>
{
	it("Ctrl-G calls onGoToLine, and goTo moves the caret to line:column", () =>
	{
		const ref = createRef<SourceEditorHandle>();
		const onGoToLine = vi.fn<() => void>();
		const carets: number[][] = [];
		const {container} = render(
			<SourceEditor
				ref={ref}
				value={"one\ntwo\nthree"}
				readOnly
				onGoToLine={onGoToLine}
				onCaretChange={(line, lines) => carets.push([line, lines])}
			/>,
		);
		const notPrevented = fireEvent.keyDown(
			container.querySelector(".cm-content")!,
			{
				key: "g",
				ctrlKey: true,
			},
		);
		act(() =>
		{
			ref.current!.goTo(3, 2);
		});
		expect(
			{
				calls: onGoToLine.mock.calls.length,
				notPrevented,
				head: viewOf(container).state.selection.main.head,
				carets,
			},
		).toStrictEqual(
			{
				calls: 1,
				notPrevented: false,
				head: 9,
				carets: [
					[1, 3],
					[3, 3],
				],
			},
		);
	});

	it("selectAll and selectedLines expose the selection to the context menu", () =>
	{
		const ref = createRef<SourceEditorHandle>();
		const {container} = render(<SourceEditor ref={ref} value={"one\ntwo\nthree"} readOnly />);
		const before = ref.current!.selectedText();
		act(() =>
		{
			ref.current!.selectAll();
		});
		const all =
		{
			main: viewOf(container).state.selection.main.to,
			text: ref.current!.selectedText(),
		};
		const view = viewOf(container);
		view.dispatch(
			{
				selection:
				{
					anchor: 5,
					head: 9,
				},
			},
		);
		expect(
			{
				before,
				all,
				lines: ref.current!.selectedLines(),
			},
		).toStrictEqual(
			{
				before: "",
				all:
				{
					main: 13,
					text: "one\ntwo\nthree",
				},
				lines:
				{
					start: 2,
					end: 3,
					text: "two\nthree",
				},
			},
		);
	});
});

describe("SourceEditor find highlights", () =>
{
	function findMarks(container: HTMLElement): string[][]
	{
		return [...container.querySelectorAll<HTMLElement>(".cm-epitaxyFindMatch")].map((mark) => [
			mark.textContent,
			mark.classList.contains("cm-epitaxyFindMatch-active") ? "active" : "",
		]);
	}

	it("marks every match and moves the active one", () =>
	{
		const {container, rerender} = render(
			<SourceEditor
				value="ab x ab"
				readOnly
				findHighlight={
				{
					query: "ab",
					active: 0,
					nonce: 1,
				}}
			/>,
		);
		const first = findMarks(container);
		rerender(
			<SourceEditor
				value="ab x ab"
				readOnly
				findHighlight={
				{
					query: "ab",
					active: 1,
					nonce: 2,
				}}
			/>,
		);
		const second = findMarks(container);
		rerender(<SourceEditor value="ab x ab" readOnly findHighlight={null} />);
		expect([first, second, findMarks(container)]).toStrictEqual([
			[
				["ab", "active"],
				["ab", ""],
			],
			[
				["ab", ""],
				["ab", "active"],
			],
			[],
		]);
	});
});

describe("SourceEditor brackets and whitespace", () =>
{
	it("colors bracket pairs by depth", () =>
	{
		const {container} = render(<SourceEditor value="f(a[b{c}])" readOnly />);
		expect(marks(container, "cm-epitaxyBracketPair")).toStrictEqual([
			["(", "cm-epitaxyBracketPair0"],
			["[", "cm-epitaxyBracketPair1"],
			["{", "cm-epitaxyBracketPair2"],
			["}", "cm-epitaxyBracketPair2"],
			["]", "cm-epitaxyBracketPair1"],
			[")", "cm-epitaxyBracketPair0"],
		]);
	});

	it("shows whitespace only when showWhitespace is on", () =>
	{
		const {container, rerender} = render(<SourceEditor value="a b" readOnly />);
		const off = container.querySelectorAll(".cm-highlightSpace").length;
		rerender(<SourceEditor value="a b" readOnly showWhitespace />);
		expect([off, container.querySelectorAll(".cm-highlightSpace").length]).toStrictEqual([0, 1]);
	});
});
