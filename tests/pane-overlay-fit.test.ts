import {describe, expect, it} from "vite-plus/test";

import type {StackNode} from "../src/lib/pane-layout";
import {overlayFit, overlaySpareWidth} from "../src/lib/pane-overlay-fit";

/** Chat and Plan in a line-mode row whose 1000px of tile room (1001 less one 1px gap) splits by flex. */
function split(chatFlex: number, planFlex: number): StackNode
{
	return {
		kind: "stack",
		direction: "row",
		flex: 1,
		children: [
			{
				kind: "tile",
				tileId: "chat",
				flex: chatFlex,
			},
			{
				kind: "tile",
				tileId: "plan",
				flex: planFlex,
			},
		],
	};
}

describe("overlayFit (upstream cc43287c9 FPe)", () =>
{
	it.each([
		[
			"spare 377, split 400",
			split(3, 2),
			377,
			{
				width: 376,
				paneFlex: (3 * 376) / (1000 - 376),
				reservePx: 377,
			},
		],
		[
			"an odd split floored to even",
			split(659, 341),
			1000,
			{
				width: 340,
				paneFlex: (659 * 340) / (1000 - 340),
				reservePx: 341,
			},
		],
		["spare 280 (278 is under the 280 floor)", split(3, 2), 280, null],
	])("%s", (_label, root, spareWidth, expected) =>
	{
		expect(
			overlayFit(
				{
					root,
					tileId: "plan",
					containerWidth: 1001,
					spareWidth,
				},
			),
		).toStrictEqual(expected);
	});

	it("is null when the tile is not in a root row", () =>
	{
		expect(
			overlayFit(
				{
					root:
					{
						...split(3, 2),
						direction: "column",
					},
					tileId: "plan",
					containerWidth: 1001,
					spareWidth: 1000,
				},
			),
		).toBe(null);
	});

	it("measures the spare width beside the lone chat's column", () =>
	{
		expect(
			overlaySpareWidth(
				{
					containerWidth: 2424,
					chatColumnWidth: 1296,
					scrollbarWidth: 15,
				},
			),
		).toBe(2424 - 8 - 1296 - 15);
	});
});
