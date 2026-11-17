// @vitest-environment jsdom

import {renderHook} from "@testing-library/react";
import type {RefObject} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	DIFF_HOST_SELECTOR,
	OCCURRENCE_CSS,
	OCCURRENCE_DEBOUNCE_MS,
	OCCURRENCE_HIGHLIGHT,
	OCCURRENCE_MAX_CHARS,
	OCCURRENCE_MAX_MATCHES,
	OCCURRENCE_ROW_CAP,
	adoptOccurrenceSheet,
	occurrenceStateFrom,
	paintOccurrences,
	requestOccurrenceRepaint,
	useDiffOccurrenceHighlight,
} from "../src/components/changes/diff-occurrence-highlight";

class FakeHighlight extends Set<AbstractRange>
{
	priority = 0;
}

const registry = new Map<string, FakeHighlight>();

beforeEach(() =>
{
	registry.clear();
	vi.stubGlobal("Highlight", FakeHighlight);
	Object.defineProperty(
		CSS,
		"highlights",
		{
			configurable: true,
			value: registry,
		},
	);
	document.body.replaceChildren();
});

afterEach(() =>
{
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

const ROWS = '<div data-line="1"><span>const foo</span><span> = foo(1)</span></div><div data-line="2">foo()</div>';

function makeHost(scope: Element, html = ROWS): ShadowRoot
{
	const host = document.createElement("diffs-container");
	scope.append(host);
	// In a shared DOM pool pierre may have registered <diffs-container>, which attaches its own open root.
	const root =
		host.shadowRoot ??
		host.attachShadow(
			{
				mode: "open",
			},
		);
	root.adoptedStyleSheets = [];
	root.innerHTML = html;
	return root;
}

function makeScope():
{
	scope: HTMLDivElement;
	first: ShadowRoot;
	second: ShadowRoot;
}
{
	const scope = document.createElement("div");
	document.body.append(scope);
	return {
		scope,
		first: makeHost(scope),
		second: makeHost(scope),
	};
}

function textOf(root: ShadowRoot, line: number): Text[]
{
	const row = root.querySelector(`[data-line="${line}"]`);
	const walker = document.createTreeWalker(row ?? root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
	{
		if (node instanceof Text) nodes.push(node);
	}
	return nodes;
}

function rangeOver(start: [Node, number], end: [Node, number]): Range
{
	const range = document.createRange();
	range.setStart(...start);
	range.setEnd(...end);
	return range;
}

/** A selection exposing upstream cd9a11070 `f`'s getComposedRanges path. */
function selectionOf(range: Range | null): Selection
{
	return {
		getComposedRanges: () => (range === null ? [] : [range]),
		toString: () => range?.toString() ?? "",
	} as unknown as Selection;
}

/** The second `foo` on row 1 (`" = foo(1)"`, offsets 3..6). */
function secondFoo(root: ShadowRoot): Range
{
	const [, tail] = textOf(root, 1);
	if (tail === undefined) throw new Error("row 1 tail");
	return rangeOver([tail, 3], [tail, 6]);
}

function painted():
{
	text: string;
	row: string | null;
}[]
{
	return [...(registry.get(OCCURRENCE_HIGHLIGHT) ?? [])].map((range) =>
	{
		const node = range.startContainer;
		return {
			text: (range as Range).toString(),
			row:
				(node instanceof Element ? node : node.parentElement)
					?.closest("[data-line]")
					?.getAttribute("data-line") ?? null,
		};
	});
}

const ref = <T>(current: T): RefObject<T> => (
{
	current,
});

describe("diff occurrence highlight constants", () =>
{
	it("copies upstream c44d00c7f's values", () =>
	{
		expect(
			{
				name: OCCURRENCE_HIGHLIGHT,
				maxChars: OCCURRENCE_MAX_CHARS,
				maxMatches: OCCURRENCE_MAX_MATCHES,
				rowCap: OCCURRENCE_ROW_CAP,
				debounce: OCCURRENCE_DEBOUNCE_MS,
				hosts: DIFF_HOST_SELECTOR,
				css: OCCURRENCE_CSS,
			},
		).toStrictEqual(
			{
				name: "epitaxy-diff-occurrence",
				maxChars: 200,
				maxMatches: 100,
				rowCap: 103,
				debounce: 100,
				hosts: "diffs-container:not(diffs-container diffs-container)",
				css: "::highlight(epitaxy-diff-occurrence){background-color:var(--code-theme-selection-match-bg,light-dark(#0073e61a,#0099ff24))}",
			},
		);
	});
});

describe("occurrenceStateFrom + paintOccurrences", () =>
{
	it("paints every other occurrence across hosts, skipping the selection itself, at priority -1", () =>
	{
		const {scope, first} = makeScope();
		const owner = ref(scope);
		const state = occurrenceStateFrom(owner, scope, selectionOf(secondFoo(first)));
		expect(state?.text).toBe("foo");
		if (!state) throw new Error("state");
		paintOccurrences(state);
		expect(registry.get(OCCURRENCE_HIGHLIGHT)?.priority).toBe(-1);
		expect(painted()).toStrictEqual([
			{
				text: "foo",
				row: "1",
			},
			{
				text: "foo",
				row: "2",
			},
			{
				text: "foo",
				row: "1",
			},
			{
				text: "foo",
				row: "1",
			},
			{
				text: "foo",
				row: "2",
			},
		]);
	});

	it("returns null for a selection across two rows", () =>
	{
		const {scope, first} = makeScope();
		const [head] = textOf(first, 1);
		const [next] = textOf(first, 2);
		if (head === undefined || next === undefined) throw new Error("rows");
		expect(occurrenceStateFrom(ref(scope), scope, selectionOf(rangeOver([head, 6], [next, 3])))).toBeNull();
	});

	it("returns null past 200 trimmed chars and for whitespace only", () =>
	{
		const scope = document.createElement("div");
		document.body.append(scope);
		const root = makeHost(scope, `<div data-line="1"> ${"x".repeat(201)} </div><div data-line="2">a    b</div>`);
		const [long] = textOf(root, 1);
		const [spaces] = textOf(root, 2);
		if (long === undefined || spaces === undefined) throw new Error("rows");
		expect(occurrenceStateFrom(ref(scope), scope, selectionOf(rangeOver([long, 0], [long, 203])))).toBeNull();
		expect(occurrenceStateFrom(ref(scope), scope, selectionOf(rangeOver([spaces, 1], [spaces, 5])))).toBeNull();
		expect(occurrenceStateFrom(ref(scope), scope, selectionOf(rangeOver([long, 1], [long, 201])))?.text).toBe(
			"x".repeat(200),
		);
	});

	it("returns undefined when no diff host holds the selection", () =>
	{
		const {scope} = makeScope();
		const outside = document.createElement("p");
		outside.textContent = "foo";
		document.body.append(outside);
		const text = outside.firstChild;
		if (text === null) throw new Error("text");
		expect(occurrenceStateFrom(ref(scope), scope, selectionOf(rangeOver([text, 0], [text, 3])))).toBeUndefined();
	});

	it("matches case-sensitively but not by whole word", () =>
	{
		const scope = document.createElement("div");
		document.body.append(scope);
		const root = makeHost(scope, '<div data-line="1">foo</div><div data-line="2">Foo foobar</div>');
		const [text] = textOf(root, 1);
		if (text === undefined) throw new Error("row");
		const state = occurrenceStateFrom(ref(scope), scope, selectionOf(rangeOver([text, 0], [text, 3])));
		if (!state) throw new Error("state");
		paintOccurrences(state);
		expect(painted()).toStrictEqual([
			{
				text: "foo",
				row: "2",
			},
		]);
	});

	it("paints nothing once the highlight passes 100 ranges", () =>
	{
		const scope = document.createElement("div");
		document.body.append(scope);
		const root = makeHost(scope, `<div data-line="1">e</div><div data-line="2">${"e".repeat(101)}</div>`);
		const [text] = textOf(root, 1);
		if (text === undefined) throw new Error("row");
		registry.set(OCCURRENCE_HIGHLIGHT, new FakeHighlight());
		const state = occurrenceStateFrom(ref(scope), scope, selectionOf(rangeOver([text, 0], [text, 1])));
		if (!state) throw new Error("state");
		paintOccurrences(state);
		expect(registry.has(OCCURRENCE_HIGHLIGHT)).toBe(false);
	});

	it("adopts one shared sheet per window into each host, once", () =>
	{
		const {scope, first, second} = makeScope();
		const [hostA, hostB] = scope.querySelectorAll(DIFF_HOST_SELECTOR);
		if (hostA === undefined || hostB === undefined) throw new Error("hosts");
		adoptOccurrenceSheet(hostA);
		adoptOccurrenceSheet(hostA);
		adoptOccurrenceSheet(hostB);
		expect(first.adoptedStyleSheets).toHaveLength(1);
		expect(first.adoptedStyleSheets[0]).toBe(second.adoptedStyleSheets[0]);
		const css = first.adoptedStyleSheets[0]?.cssRules[0]?.cssText ?? "";
		expect(css).toContain("epitaxy-diff-occurrence");
		expect(css).toContain("#0099ff24");
	});
});

describe("useDiffOccurrenceHighlight", () =>
{
	function select(range: Range | null): void
	{
		vi.spyOn(window, "getSelection").mockReturnValue(selectionOf(range));
		document.dispatchEvent(new Event("selectionchange"));
	}

	it("paints 100ms after the last selectionchange", () =>
	{
		vi.useFakeTimers();
		const {scope, first} = makeScope();
		renderHook(() =>
		{
			useDiffOccurrenceHighlight(ref(scope), "k");
		});
		select(secondFoo(first));
		vi.advanceTimersByTime(50);
		select(secondFoo(first));
		vi.advanceTimersByTime(99);
		expect(registry.has(OCCURRENCE_HIGHLIGHT)).toBe(false);
		vi.advanceTimersByTime(1);
		expect(painted()).toHaveLength(5);
	});

	it("clears when the selection collapses inside the diff", () =>
	{
		vi.useFakeTimers();
		const {scope, first} = makeScope();
		renderHook(() =>
		{
			useDiffOccurrenceHighlight(ref(scope), "k");
		});
		select(secondFoo(first));
		vi.advanceTimersByTime(100);
		expect(registry.has(OCCURRENCE_HIGHLIGHT)).toBe(true);
		select(null);
		vi.advanceTimersByTime(100);
		expect(registry.has(OCCURRENCE_HIGHLIGHT)).toBe(false);
	});

	it("keeps a highlight whose source row is gone until a primary press on a row or outside", () =>
	{
		vi.useFakeTimers();
		const {scope, first, second} = makeScope();
		renderHook(() =>
		{
			useDiffOccurrenceHighlight(ref(scope), "k");
		});
		select(secondFoo(first));
		vi.advanceTimersByTime(100);
		first.querySelector('[data-line="1"]')?.remove();
		select(null);
		vi.advanceTimersByTime(100);
		expect(registry.has(OCCURRENCE_HIGHLIGHT)).toBe(true);
		const row = second.querySelector('[data-line="2"]');
		row?.dispatchEvent(
			new PointerEvent(
				"pointerdown",
				{
					bubbles: true,
					composed: true,
					button: 2,
				},
			),
		);
		expect(registry.has(OCCURRENCE_HIGHLIGHT)).toBe(true);
		row?.dispatchEvent(
			new PointerEvent(
				"pointerdown",
				{
					bubbles: true,
					composed: true,
					button: 0,
				},
			),
		);
		expect(registry.has(OCCURRENCE_HIGHLIGHT)).toBe(false);
	});

	it("removes its listeners and the highlight on unmount", () =>
	{
		vi.useFakeTimers();
		const {scope, first} = makeScope();
		const remove = vi.spyOn(document, "removeEventListener");
		const {unmount} = renderHook(() =>
		{
			useDiffOccurrenceHighlight(ref(scope), "k");
		});
		select(secondFoo(first));
		vi.advanceTimersByTime(100);
		unmount();
		expect(registry.has(OCCURRENCE_HIGHLIGHT)).toBe(false);
		expect(remove.mock.calls.map(([type, , capture]) => [type, capture])).toStrictEqual([
			["selectionchange", undefined],
			["pointerdown", true],
		]);
	});

	it("leaves another owner's state alone on cleanup", () =>
	{
		vi.useFakeTimers();
		const {scope, first} = makeScope();
		const other = document.createElement("div");
		document.body.append(other);
		renderHook(() =>
		{
			useDiffOccurrenceHighlight(ref(scope), "a");
		});
		const b = renderHook(() =>
		{
			useDiffOccurrenceHighlight(ref(other), "b");
		});
		select(secondFoo(first));
		vi.advanceTimersByTime(100);
		b.unmount();
		expect(registry.has(OCCURRENCE_HIGHLIGHT)).toBe(true);
	});

	it("adds no listeners without the Highlight API", () =>
	{
		vi.stubGlobal("Highlight", undefined);
		const add = vi.spyOn(document, "addEventListener");
		const {scope} = makeScope();
		renderHook(() =>
		{
			useDiffOccurrenceHighlight(ref(scope), "k");
		});
		expect(add).not.toHaveBeenCalled();
	});
});

describe("requestOccurrenceRepaint", () =>
{
	it("repaints once per tick when a host inside the active scope renders", async () =>
	{
		vi.useFakeTimers();
		const {scope, first} = makeScope();
		renderHook(() =>
		{
			useDiffOccurrenceHighlight(ref(scope), "k");
		});
		vi.spyOn(window, "getSelection").mockReturnValue(selectionOf(secondFoo(first)));
		document.dispatchEvent(new Event("selectionchange"));
		vi.advanceTimersByTime(100);
		const later = makeHost(scope, '<div data-line="9">foo</div>');
		const set = vi.spyOn(registry, "set");
		const host = later.host;
		requestOccurrenceRepaint(host);
		requestOccurrenceRepaint(host);
		await Promise.resolve();
		expect(set).toHaveBeenCalledTimes(1);
		expect(painted().map(({row}) => row)).toStrictEqual(["1", "2", "1", "1", "2", "9"]);
		expect(later.adoptedStyleSheets).toHaveLength(1);
	});

	it("ignores a host outside the active scope", async () =>
	{
		const {scope} = makeScope();
		const stray = makeHost(document.body);
		const set = vi.spyOn(registry, "set");
		requestOccurrenceRepaint(stray.host);
		await Promise.resolve();
		expect(set).not.toHaveBeenCalled();
		expect(scope.isConnected).toBe(true);
	});
});
