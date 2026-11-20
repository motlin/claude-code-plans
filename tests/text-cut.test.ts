import {describe, expect, it} from "vite-plus/test";

import {isTextCut} from "../src/lib/text-cut";

interface Box
{
	left: number;
	right: number;
	width: number;
}

/** An element stand-in with fixed scroll/client widths and the bounding boxes of itself and its text range. */
function element(scrollWidth: number, clientWidth: number, box: Box, text: Box | undefined): HTMLElement
{
	return {
		scrollWidth,
		clientWidth,
		getBoundingClientRect: () => box,
		ownerDocument:
		{
			createRange: () => (
			{
				selectNodeContents: () =>
				{
				},
				getBoundingClientRect: () => text,
			}),
		},
	} as unknown as HTMLElement;
}

const BOX =
{
	left: 0,
	right: 100,
	width: 100,
};

// Upstream `JC`: the scope label's tooltip shows only while one of its truncate spans is cut.
describe("isTextCut", () =>
{
	it("reads a scroll overflow, a text range past either edge by more than 0.1px, and nothing else", () =>
	{
		expect(
			{
				none: isTextCut(null),
				scrolls: isTextCut(element(120, 100, BOX, undefined)),
				fits: isTextCut(element(100, 100, BOX, BOX)),
				pastEnd: isTextCut(
					element(
						100,
						100,
						BOX,
						{
							left: 0,
							right: 100.2,
							width: 100.2,
						},
					),
				),
				pastStart: isTextCut(
					element(
						100,
						100,
						BOX,
						{
							left: -0.2,
							right: 100,
							width: 100.2,
						},
					),
				),
				withinTolerance: isTextCut(
					element(
						100,
						100,
						BOX,
						{
							left: -0.05,
							right: 100.05,
							width: 100.1,
						},
					),
				),
				emptyRange: isTextCut(
					element(
						100,
						100,
						BOX,
						{
							left: 0,
							right: 200,
							width: 0,
						},
					),
				),
				noRangeRect: isTextCut(element(100, 100, BOX, undefined)),
			},
		).toEqual(
			{
				none: false,
				scrolls: true,
				fits: false,
				pastEnd: true,
				pastStart: true,
				withinTolerance: false,
				emptyRange: false,
				noRangeRect: false,
			},
		);
	});
});
