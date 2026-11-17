// @vitest-environment jsdom

import {getSingularPatch} from "@pierre/diffs";
import {afterEach, describe, expect, it} from "vite-plus/test";

import
{
	type DiffCopyRow,
	diffCopyText,
	diffHostOf,
	diffRowSide,
	isEditableDeep,
	selectionRangeIn,
	shownDiffRows,
} from "../src/lib/diff-copy";

afterEach(() =>
{
	document.body.replaceChildren();
});

interface Built
{
	host: HTMLElement;
	root: ShadowRoot;
	code: HTMLElement;
	content: HTMLElement;
	row: (line: number, side?: "deletions" | "additions") => HTMLElement;
}

/** A pierre-shaped diff host (pierre registers `diffs-container` with its own shadow root): `pre › code[data-code] › [data-content]` rows inside an open shadow root. */
function build(columns: string[]): Built
{
	const host = document.createElement("div");
	document.body.append(host);
	const root = host.attachShadow(
		{
			mode: "open",
		},
	);
	root.innerHTML = `<pre>${columns.join("")}</pre>`;
	const code = root.querySelector<HTMLElement>("code");
	const content = root.querySelector<HTMLElement>("[data-content]");
	if (code === null || content === null) throw new Error("bad markup");
	return {
		host,
		root,
		code,
		content,
		row: (line, side) =>
		{
			const scope = side === undefined ? "" : `[data-${side}] `;
			const found = root.querySelector<HTMLElement>(`${scope}[data-line="${line}"]`);
			if (found === null) throw new Error(`no row ${line}`);
			return found;
		},
	};
}

const UNIFIED =
	`<code data-code data-unified><div data-content>` +
	`<div data-separator><span>1 unmodified line</span></div>` +
	`<div data-line="1" data-line-type="context"><span>one</span></div>` +
	`<div data-line="2" data-line-type="change-addition"><span>a</span></div>` +
	`<div data-line="3" data-line-type="change-addition"><span>\n</span></div>` +
	`<div data-line-annotation><span>card text</span></div>` +
	`<div data-line="4" data-line-type="change-addition"><span>c</span></div>` +
	`<div data-separator><span>trailing</span></div>` +
	`</div></code>`;

function rangeOver(start: [Node, number], end: [Node, number]): Range
{
	const range = document.createRange();
	range.setStart(...start);
	range.setEnd(...end);
	return range;
}

function textOf(row: Element): Node
{
	const node = row.querySelector("span")?.firstChild;
	if (node === null || node === undefined) throw new Error("no text");
	return node;
}

describe("diffCopyText", () =>
{
	it("joins the selected rows' texts, a blank row as an empty line", () =>
	{
		const {root, content, row} = build([UNIFIED]);
		const range = rangeOver([row(2), 0], [row(4), row(4).childNodes.length]);
		expect(content.childNodes.length).toBe(7);
		expect(diffCopyText(root, range)).toBe("a\n\nc");
	});

	it("clips the edge rows to the selected substring", () =>
	{
		const {root, row} = build([UNIFIED]);
		const range = rangeOver([textOf(row(1)), 1], [textOf(row(2)), 1]);
		expect(diffCopyText(root, range)).toBe("ne\na");
	});

	it("adds a leading newline for a start at the end of the row above, and a trailing one past the last row", () =>
	{
		const {root, content, row} = build([UNIFIED]);
		expect(diffCopyText(root, rangeOver([textOf(row(1)), 3], [row(2), row(2).childNodes.length]))).toBe("\na");
		expect(diffCopyText(root, rangeOver([textOf(row(4)), 0], [content, content.childNodes.length]))).toBe("c\n");
	});

	it("leaves out annotation content between rows", () =>
	{
		const {root, row} = build([UNIFIED]);
		const range = rangeOver([textOf(row(3)), 0], [textOf(row(4)), 1]);
		expect(diffCopyText(root, range)).toBe("\nc");
	});

	it("copies a split diff's deletion column, then its addition column", () =>
	{
		const {root, content} = build([
			`<code data-code data-split><div data-content>` +
				`<div data-deletions>` +
				`<div data-line="5" data-line-type="change-deletion"><span>old5</span></div>` +
				`<div data-line="6" data-line-type="context"><span>same</span></div>` +
				`</div><div data-additions>` +
				`<div data-line="5" data-line-type="change-addition"><span>new5</span></div>` +
				`<div data-line="6" data-line-type="context"><span>same</span></div>` +
				`</div></div></code>`,
		]);
		const range = rangeOver([content, 0], [content, content.childNodes.length]);
		expect(diffCopyText(root, range)).toBe("old5\nsame\nnew5\nsame\n");
	});

	it("copies every shown row from the model for a whole-content range, unless a mounted row is missing", () =>
	{
		const {root, code} = build([
			`<code data-code data-unified><div data-content>` +
				`<div data-line="1" data-line-type="context"><span>r1</span></div>` +
				`<div data-line="2" data-line-type="change-addition"><span>r2</span></div>` +
				`</div></code>`,
		]);
		const range = rangeOver([code, 0], [code, code.childNodes.length]);
		const shown: DiffCopyRow[] = [1, 2, 3, 4, 5].map((line) => (
		{
			side: "additions",
			line,
			text: `r${line}`,
		}));
		expect(diffCopyText(root, range, () => shown)).toBe("r1\nr2\nr3\nr4\nr5\n");
		expect(diffCopyText(root, range, () => shown.slice(1))).toBe("r1\nr2\n");
		expect(diffCopyText(root, range, () => null)).toBe("r1\nr2\n");
	});

	it("puts a split whole-content copy's context rows in both columns", () =>
	{
		const {root, code} = build([
			`<code data-code data-split><div data-content>` +
				`<div data-deletions><div data-line="4" data-line-type="context"><span>ctx</span></div></div>` +
				`<div data-additions><div data-line="5" data-line-type="context"><span>ctx</span></div></div>` +
				`</div></code>`,
		]);
		const range = rangeOver([code, 0], [code, code.childNodes.length]);
		const shown: DiffCopyRow[] = [
			{
				side: "additions",
				line: 5,
				text: "ctx",
				oldLine: 4,
				oldText: "ctx",
			},
			{
				side: "deletions",
				line: 5,
				text: "gone",
			},
			{
				side: "additions",
				line: 6,
				text: "added",
			},
		];
		expect(diffCopyText(root, range, () => shown)).toBe("ctx\ngone\nctx\nadded\n");
	});

	it("gives null for a range over separators only", () =>
	{
		const {root} = build([UNIFIED]);
		const separator = root.querySelector("[data-separator]");
		if (separator === null) throw new Error("no separator");
		expect(diffCopyText(root, rangeOver([separator, 0], [separator, separator.childNodes.length]))).toBeNull();
	});
});

describe("diffRowSide", () =>
{
	it("reads deletions from the row type or the deletions column", () =>
	{
		const {row} = build([
			`<code data-code data-split><div data-content>` +
				`<div data-deletions><div data-line="1" data-line-type="context"><span>x</span></div></div>` +
				`<div data-additions><div data-line="2" data-line-type="change-deletion"><span>y</span></div>` +
				`<div data-line="3" data-line-type="context"><span>z</span></div></div>` +
				`</div></code>`,
		]);
		expect([diffRowSide(row(1)), diffRowSide(row(2)), diffRowSide(row(3))]).toStrictEqual([
			"deletions",
			"deletions",
			"additions",
		]);
	});
});

describe("diffHostOf", () =>
{
	it("returns the outermost diffs-container under the wrapper, or null outside it", () =>
	{
		const wrapper = document.createElement("div");
		const outer = document.createElement("diffs-container");
		const inner = document.createElement("diffs-container");
		const leaf = document.createElement("span");
		inner.append(leaf);
		outer.append(inner);
		wrapper.append(outer);
		const stranger = document.createElement("span");
		expect([diffHostOf(wrapper, leaf), diffHostOf(wrapper, wrapper), diffHostOf(wrapper, stranger)]).toStrictEqual([
			outer,
			null,
			null,
		]);
	});
});

describe("selectionRangeIn", () =>
{
	it("takes the root's own selection range when it is non-collapsed and touches the root", () =>
	{
		const {root, row} = build([UNIFIED]);
		const inside = rangeOver([row(1), 0], [row(2), 1]);
		const ranges: Range[] = [inside];
		Object.defineProperty(
			root,
			"getSelection",
			{
				configurable: true,
				value: () => (
				{
					rangeCount: ranges.length,
					getRangeAt: (index: number) => ranges[index],
				}),
			},
		);
		const selection = document.getSelection();
		if (selection === null) throw new Error("no selection");
		expect(selectionRangeIn(root, selection)).toBe(inside);
		ranges[0] = rangeOver([row(1), 0], [row(1), 0]);
		expect(selectionRangeIn(root, selection)).toBeNull();
		ranges[0] = rangeOver([document.body, 0], [document.body, 0]);
		ranges[0].setEnd(document.body, document.body.childNodes.length);
		expect(selectionRangeIn(root, selection)).toBeNull();
	});
});

describe("isEditableDeep", () =>
{
	it("follows shadow-root focus to an editable element", () =>
	{
		const host = document.createElement("div");
		document.body.append(host);
		const root = host.attachShadow(
			{
				mode: "open",
			},
		);
		const textarea = document.createElement("textarea");
		root.append(textarea);
		textarea.focus();
		const plain = document.createElement("div");
		expect([
			isEditableDeep(host),
			isEditableDeep(textarea),
			isEditableDeep(plain),
			isEditableDeep(null),
		]).toStrictEqual([true, true, false, false]);
	});
});

describe("shownDiffRows", () =>
{
	it("emits a partial diff's hunk rows with context carrying its old line", () =>
	{
		const patch = "--- a/f.ts\r\n+++ b/f.ts\r\n@@ -3,3 +3,3 @@\r\n keep\r\n-old\r\n+new\r\n tail\r\n";
		expect(shownDiffRows(getSingularPatch(patch))).toStrictEqual([
			{
				side: "additions",
				line: 3,
				text: "keep",
				oldLine: 3,
				oldText: "keep",
			},
			{
				side: "deletions",
				line: 4,
				text: "old",
			},
			{
				side: "additions",
				line: 4,
				text: "new",
			},
			{
				side: "additions",
				line: 5,
				text: "tail",
				oldLine: 5,
				oldText: "tail",
			},
		]);
	});
});
