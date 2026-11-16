// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";

import
{
	findTruncatingLabel,
	recomputeLabelShift,
	registerTruncatingLabel,
	shiftLabelForActiveMatch,
	truncatingLabelBox,
} from "../src/lib/find-in-page/label-shift";

interface LabelSpec
{
	left?: number;
	width?: number;
	pad?: number;
	band?: number;
	rtl?: boolean;
}

interface Label
{
	box: HTMLElement;
	text: HTMLElement;
	node: Text;
	unregister: () => void;
	setBand: (band: number) => void;
}

const cleanups: (() => void)[] = [];

afterEach(() =>
{
	shiftLabelForActiveMatch(null);
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.replaceChildren();
});

function label({left = 0, width = 200, pad = 0, band = 24, rtl = false}: LabelSpec = {}): Label
{
	const box = document.createElement("span");
	const text = document.createElement("span");
	const node = document.createTextNode("A long session title that runs past the clip");
	text.append(node);
	box.append(text);
	document.body.append(box);
	box.style.direction = rtl ? "rtl" : "ltr";
	box.style.paddingInlineStart = `${pad}px`;
	box.getBoundingClientRect = () => new DOMRect(left, 0, width, 20);
	let currentBand = band;
	const unregister = registerTruncatingLabel(
		{
			box,
			text,
			endBandPx: () => currentBand,
		},
	);
	cleanups.push(unregister);
	return {
		box,
		text,
		node,
		unregister,
		setBand: (next) =>
		{
			currentBand = next;
		},
	};
}

/** A match range whose rect sits at `left` (or ends at `right`) and is `width` wide. */
function match(
	node: Text,
	rect:
	{
		left: number;
		width: number;
	},
): Range
{
	const range = document.createRange();
	range.setStart(node, 0);
	range.setEnd(node, 4);
	range.getBoundingClientRect = () => new DOMRect(rect.left, 0, rect.width, 20);
	return range;
}

function styles(text: HTMLElement):
{
	transform: string;
	maskImage: string;
}
{
	return {
		transform: text.style.transform,
		maskImage: text.style.maskImage,
	};
}

const NONE =
{
	transform: "",
	maskImage: "",
};

describe("shiftLabelForActiveMatch (upstream r6)", () =>
{
	it("slides the text so a match under the end fade starts 28px in, fading the slid-off text over 24px", () =>
	{
		const {node, text} = label();
		shiftLabelForActiveMatch(
			match(
				node,
				{
					left: 190,
					width: 20,
				},
			),
		);
		expect(styles(text)).toStrictEqual(
			{
				transform: "translateX(-162px)",
				maskImage: "linear-gradient(to right, transparent 162px, black 186px)",
			},
		);
	});

	it("leaves a match that already shows, and a label that does not overflow, unshifted", () =>
	{
		const visible = label();
		shiftLabelForActiveMatch(
			match(
				visible.node,
				{
					left: 40,
					width: 20,
				},
			),
		);
		const fits = label(
			{
				band: 0,
			},
		);
		shiftLabelForActiveMatch(
			match(
				fits.node,
				{
					left: 190,
					width: 20,
				},
			),
		);
		expect([styles(visible.text), styles(fits.text)]).toStrictEqual([NONE, NONE]);
	});

	it("mirrors the shift for an RTL label, measuring from the box's right edge", () =>
	{
		const {node, text} = label(
			{
				rtl: true,
			},
		);
		shiftLabelForActiveMatch(
			match(
				node,
				{
					left: -10,
					width: 20,
				},
			),
		);
		expect(styles(text)).toStrictEqual(
			{
				transform: "translateX(162px)",
				maskImage: "linear-gradient(to left, transparent 162px, black 186px)",
			},
		);
	});

	it("takes the box's inline-start padding off the offset", () =>
	{
		const {node, text} = label(
			{
				pad: 8,
			},
		);
		shiftLabelForActiveMatch(
			match(
				node,
				{
					left: 190,
					width: 20,
				},
			),
		);
		expect(text.style.transform).toBe("translateX(-154px)");
	});

	it("measures in unshifted coordinates, so showing the shifted match again keeps the shift", () =>
	{
		const {node, text} = label();
		shiftLabelForActiveMatch(
			match(
				node,
				{
					left: 190,
					width: 20,
				},
			),
		);
		// The text moved 162px left, so the same match now reads 28px into the box.
		shiftLabelForActiveMatch(
			match(
				node,
				{
					left: 28,
					width: 20,
				},
			),
		);
		expect(text.style.transform).toBe("translateX(-162px)");
	});

	it("resets the previous label when the active match moves to another label, and on clear", () =>
	{
		const first = label();
		const second = label();
		shiftLabelForActiveMatch(
			match(
				first.node,
				{
					left: 190,
					width: 20,
				},
			),
		);
		shiftLabelForActiveMatch(
			match(
				second.node,
				{
					left: 190,
					width: 20,
				},
			),
		);
		const afterMove = [styles(first.text), styles(second.text)];
		shiftLabelForActiveMatch(null);
		expect([...afterMove, styles(second.text)]).toStrictEqual([
			NONE,
			{
				transform: "translateX(-162px)",
				maskImage: "linear-gradient(to right, transparent 162px, black 186px)",
			},
			NONE,
		]);
	});

	it("resets when the active match leaves every label", () =>
	{
		const {node, text} = label();
		shiftLabelForActiveMatch(
			match(
				node,
				{
					left: 190,
					width: 20,
				},
			),
		);
		const outside = document.createElement("p");
		outside.textContent = "transcript prose";
		document.body.append(outside);
		const range = document.createRange();
		range.selectNodeContents(outside);
		shiftLabelForActiveMatch(range);
		expect(styles(text)).toStrictEqual(NONE);
	});

	it("drops the shift on recompute once the label stops overflowing (upstream mB)", () =>
	{
		const {node, text, setBand} = label();
		shiftLabelForActiveMatch(
			match(
				node,
				{
					left: 190,
					width: 20,
				},
			),
		);
		setBand(0);
		recomputeLabelShift(text);
		expect(styles(text)).toStrictEqual(NONE);
	});
});

describe("truncating-label registry (upstream yS / uC / mQ)", () =>
{
	it("finds a label from a node inside its text, returns its box, and forgets it once unregistered", () =>
	{
		const {node, box, unregister} = label();
		const found = [findTruncatingLabel(node)?.box === box, truncatingLabelBox(node) === box];
		unregister();
		expect([...found, findTruncatingLabel(node), truncatingLabelBox(document.body)]).toStrictEqual([
			true,
			true,
			undefined,
			undefined,
		]);
	});
});
