// @vitest-environment jsdom

// Pierre's index registers its real `diffs-container` element, which opens its own shadow root as the app's diffs do.
import {DIFFS_TAG_NAME} from "@pierre/diffs";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {findLineAnchor, restoreLineAnchor, stickyHeaderOffset} from "../src/components/changes/diff-line-anchor";

/** Puts a fake top on an element (jsdom has no layout). */
function placeAt(element: Element, top: () => number, height = 20): void
{
	element.getBoundingClientRect = () =>
	{
		const y = top();
		return {
			top: y,
			bottom: y + height,
			left: 0,
			right: 100,
			width: 100,
			height,
			x: 0,
			y,
			toJSON: () => ({}),
		};
	};
}

/** A scroller at viewport top 100 holding one diffs-container per file, rows 20px apart starting at `start`. */
function scrollerWith(
	files:
	{
		path: string;
		rows:
		{
			type: string;
			line: number;
		}[];
		start: number;
	}[],
)
{
	const scroller = document.createElement("div");
	let scrollTop = 0;
	Object.defineProperty(
		scroller,
		"scrollTop",
		{
			get: () => scrollTop,
			set: (value: number) =>
			{
				scrollTop = value;
			},
		},
	);
	placeAt(scroller, () => 100, 500);
	for (const file of files)
	{
		const container = document.createElement(DIFFS_TAG_NAME);
		const header = document.createElement("div");
		header.setAttribute("data-diff-file-header", file.path);
		container.append(header);
		const root = container.shadowRoot;
		if (root === null) throw new Error("diffs-container opened no shadow root");
		const content = document.createElement("div");
		content.setAttribute("data-content", "");
		file.rows.forEach((row, index) =>
		{
			const element = document.createElement("div");
			element.setAttribute("data-line", String(row.line));
			element.setAttribute("data-line-type", row.type);
			placeAt(element, () => file.start + index * 20 - scrollTop);
			content.append(element);
		});
		root.append(content);
		scroller.append(container);
	}
	document.body.append(scroller);
	return scroller;
}

afterEach(() =>
{
	document.body.replaceChildren();
});

describe("stickyHeaderOffset (upstream gd)", () =>
{
	it("is 32px at a 16px root font size and scales with it", () =>
	{
		expect([stickyHeaderOffset(16), stickyHeaderOffset(20)]).toStrictEqual([32, 40]);
	});
});

describe("findLineAnchor / restoreLineAnchor (upstream zd, Jt)", () =>
{
	const ROWS = [
		{
			type: "context",
			line: 14,
		},
		{
			type: "change-deletion",
			line: 15,
		},
		{
			type: "change-addition",
			line: 15,
		},
		{
			type: "context",
			line: 16,
		},
	];

	it("anchors on the first line row below the sticky header, skipping rows the filter rejects", () =>
	{
		const scroller = scrollerWith([
			{
				path: "src/a.ts",
				rows: ROWS,
				start: 115,
			},
		]);
		expect([
			findLineAnchor(scroller, 32),
			findLineAnchor(scroller, 32, (_path, side, line) => side === "deletions" && line === 15),
		]).toStrictEqual([
			{
				path: "src/a.ts",
				side: "deletions",
				lineNumber: 15,
				viewportOffset: 35,
			},
			{
				path: "src/a.ts",
				side: "additions",
				lineNumber: 15,
				viewportOffset: 55,
			},
		]);
	});

	it("scrolls the anchored row back to its offset after the rows above it change", () =>
	{
		const scroller = scrollerWith([
			{
				path: "src/a.ts",
				rows: ROWS,
				start: 115,
			},
		]);
		const anchor = findLineAnchor(scroller, 32);
		if (anchor === null) throw new Error("no anchor");
		const container = scroller.querySelector("diffs-container");
		const content = container?.shadowRoot?.querySelector("[data-content]");
		for (const [index, row] of [...(content?.children ?? [])].entries())
		{
			placeAt(row, () => 115 + (index + 10) * 20 - scroller.scrollTop);
		}

		expect(
			{
				restored: restoreLineAnchor(scroller, anchor),
				scrollTop: scroller.scrollTop,
			},
		).toStrictEqual(
			{
				restored: true,
				scrollTop: 200,
			},
		);
	});

	it("finds nothing when no row is below the header", () =>
	{
		expect(
			findLineAnchor(
				scrollerWith([
					{
						path: "src/a.ts",
						rows: ROWS,
						start: -500,
					},
				]),
				32,
			),
		).toBeNull();
	});
});
