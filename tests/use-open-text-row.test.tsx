// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {useOpenTextRow} from "../src/hooks/use-open-text-row";
import {ruleStart} from "./css-rule";

afterEach(() =>
{
	cleanup();
	document.getSelection()?.removeAllRanges();
	vi.restoreAllMocks();
});

function Harness({active, close}: {active: boolean; close: () => void})
{
	const {rowProps} = useOpenTextRow(
		{
			active,
			close,
		},
	);
	return (
		<div
			data-testid="row"
			data-cds-row=""
			style={
			{
				paddingTop: "2.5px",
				lineHeight: "19px",
				fontSize: "13px",
			}}
			{...rowProps}
		>
			<button type="button" data-cds-row-toggle="">
				toggle
			</button>
			<div data-cds-row-panel="">
				<p>
					First line of the open text <a href="#x">link</a>
				</p>
				<button type="button" id="inner" data-cds-row-toggle="">
					inner
				</button>
			</div>
		</div>
	);
}

function setup(active = true)
{
	const close = vi.fn<() => void>();
	const {getByTestId} = render(<Harness active={active} close={close} />);
	const row = getByTestId("row");
	vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
		{
			top: 100,
			left: 0,
			right: 300,
			bottom: 160,
			width: 300,
			height: 60,
			x: 0,
			y: 100,
			toJSON: () => ({}),
		},
	);
	const paragraph = row.querySelector("p");
	if (paragraph === null) throw new Error("no paragraph");
	return {
		close,
		row,
		paragraph,
	};
}

interface Gesture
{
	x?: number;
	y?: number;
	dx?: number;
	pointerType?: string;
	detail?: number;
	button?: number;
	metaKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
}

function gesture(target: Element, g: Gesture = {}): void
{
	const x = g.x ?? 20;
	const y = g.y ?? 110;
	fireEvent.pointerDown(
		target,
		{
			clientX: x,
			clientY: y,
			pointerType: g.pointerType ?? "mouse",
		},
	);
	fireEvent.click(
		target,
		{
			clientX: x + (g.dx ?? 0),
			clientY: y,
			detail: g.detail ?? 1,
			button: g.button ?? 0,
			metaKey: g.metaKey ?? false,
			ctrlKey: g.ctrlKey ?? false,
			shiftKey: g.shiftKey ?? false,
			altKey: g.altKey ?? false,
		},
	);
}

describe("useOpenTextRow", () =>
{
	it("adds nothing to the row while inactive", () =>
	{
		const {close, row, paragraph} = setup(false);
		fireEvent.pointerMove(
			paragraph,
			{
				clientY: 110,
			},
		);
		gesture(paragraph);

		expect(
			{
				openText: row.hasAttribute("data-cds-open-text"),
				hot: row.hasAttribute("data-cds-line-hot"),
				calls: close.mock.calls.length,
			},
		).toStrictEqual(
			{
				openText: false,
				hot: false,
				calls: 0,
			},
		);
	});

	it("lights the first line while the pointer is over it and keeps the first-line mark after", () =>
	{
		const {row, paragraph} = setup();
		const snapshot = () => (
		{
			openText: row.getAttribute("data-cds-open-text"),
			hot: row.getAttribute("data-cds-line-hot"),
			firstLine: paragraph.getAttribute("data-cds-first-line"),
		});
		const before = snapshot();
		fireEvent.pointerMove(
			paragraph,
			{
				clientY: 110,
			},
		);
		const hot = snapshot();
		fireEvent.pointerMove(
			paragraph,
			{
				clientY: 125,
			},
		);
		const below = snapshot();
		fireEvent.pointerMove(
			paragraph,
			{
				clientY: 110,
			},
		);
		fireEvent.pointerLeave(row);
		const left = snapshot();

		expect(
			{
				before,
				hot,
				below,
				left,
			},
		).toStrictEqual(
			{
				before:
				{
					openText: "",
					hot: null,
					firstLine: null,
				},
				hot:
				{
					openText: "",
					hot: "",
					firstLine: "",
				},
				below:
				{
					openText: "",
					hot: null,
					firstLine: "",
				},
				left:
				{
					openText: "",
					hot: null,
					firstLine: "",
				},
			},
		);
	});

	it("closes on a plain first-line click, and on small or touch drags", () =>
	{
		const results = [
			{},
			{
				dx: 3,
			},
			{
				dx: 50,
				pointerType: "touch",
			},
		].map((g) =>
		{
			const {close, paragraph} = setup();
			gesture(paragraph, g);
			const calls = close.mock.calls.length;
			cleanup();
			return calls;
		});

		expect(results).toStrictEqual([1, 1, 1]);
	});

	it("stays open below the first line, after a drag, on modified or repeated clicks, and on nested links", () =>
	{
		const cases: Record<
			string,
			Gesture &
			{
				link?: boolean;
			}
		> =
		{
			below:
			{
				y: 125,
			},
			drag:
			{
				dx: 5,
			},
			double:
			{
				detail: 2,
			},
			meta:
			{
				metaKey: true,
			},
			ctrl:
			{
				ctrlKey: true,
			},
			shift:
			{
				shiftKey: true,
			},
			alt:
			{
				altKey: true,
			},
			middle:
			{
				button: 1,
			},
			link:
			{
				link: true,
			},
		};
		const results = Object.fromEntries(
			Object.entries(cases).map(([name, g]) =>
			{
				const {close, paragraph} = setup();
				const target = g.link === true ? paragraph.querySelector("a") : paragraph;
				if (target === null) throw new Error("no target");
				gesture(target, g);
				const calls = close.mock.calls.length;
				cleanup();
				return [name, calls];
			}),
		);

		expect(results).toStrictEqual(
			{
				below: 0,
				drag: 0,
				double: 0,
				meta: 0,
				ctrl: 0,
				shift: 0,
				alt: 0,
				middle: 0,
				link: 0,
			},
		);
	});

	it("stays open while text is selected and when the click was already handled", () =>
	{
		const {close, row, paragraph} = setup();
		const text = paragraph.firstChild;
		if (text === null) throw new Error("no text");
		const range = document.createRange();
		range.setStart(text, 0);
		range.setEnd(text, 3);
		document.getSelection()?.addRange(range);
		gesture(paragraph);
		const selected = close.mock.calls.length;
		document.getSelection()?.removeAllRanges();

		const prevent = (event: Event) =>
		{
			event.preventDefault();
		};
		row.addEventListener(
			"click",
			prevent,
			{
				capture: true,
			},
		);
		gesture(paragraph);
		const prevented = close.mock.calls.length;
		row.removeEventListener(
			"click",
			prevent,
			{
				capture: true,
			},
		);
		gesture(paragraph);

		expect(
			{
				selected,
				prevented,
				after: close.mock.calls.length,
			},
		).toStrictEqual(
			{
				selected: 0,
				prevented: 0,
				after: 1,
			},
		);
	});

	it("hands focus from inside the row to the row's own direct toggle, without scrolling", () =>
	{
		const {close, row, paragraph} = setup();
		const inner = document.getElementById("inner");
		inner?.focus();
		const focus = vi.spyOn(HTMLElement.prototype, "focus");
		gesture(paragraph);
		const direct = row.querySelector(":scope > [data-cds-row-toggle]");

		expect(
			{
				calls: close.mock.calls.length,
				activeIsDirect: document.activeElement === direct,
				activeIsInner: document.activeElement === inner,
				focusArgs: focus.mock.calls,
			},
		).toStrictEqual(
			{
				calls: 1,
				activeIsDirect: true,
				activeIsInner: false,
				focusArgs: [
					[
						{
							preventScroll: true,
						},
					],
				],
			},
		);
	});

	it("leaves focus alone when it was outside the row", () =>
	{
		const {close, paragraph} = setup();
		const focus = vi.spyOn(HTMLElement.prototype, "focus");
		gesture(paragraph);

		expect(
			{
				calls: close.mock.calls.length,
				active: document.activeElement === document.body,
				focusCalls: focus.mock.calls.length,
			},
		).toStrictEqual(
			{
				calls: 1,
				active: true,
				focusCalls: 0,
			},
		);
	});
});

describe("open-text row CSS", () =>
{
	it("gives the hot first line a pointer cursor and primary ink, on hover devices only", () =>
	{
		const css = readFileSync("src/styles/globals.css", "utf8");
		const media = css.indexOf("@media (hover: hover)", css.indexOf("Upstream open text"));
		const blockEnd = css.indexOf("\n}", media);
		const cursorAt = ruleStart(css, "[data-cds-open-text][data-cds-line-hot]");
		const inkAt = ruleStart(css, "[data-cds-open-text][data-cds-line-hot] [data-cds-first-line]::first-line");
		const body = (at: number) => css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at)).trim();

		expect(
			{
				cursorInside: media > 0 && cursorAt > media && cursorAt < blockEnd,
				inkInside: media > 0 && inkAt > media && inkAt < blockEnd,
				cursor: body(cursorAt),
				ink: body(inkAt),
				cursorOnce: ruleStart(css, "[data-cds-open-text][data-cds-line-hot]", cursorAt + 1),
			},
		).toStrictEqual(
			{
				cursorInside: true,
				inkInside: true,
				cursor: "cursor: pointer;",
				ink: "color: var(--color-primary);",
				cursorOnce: -1,
			},
		);
	});
});
