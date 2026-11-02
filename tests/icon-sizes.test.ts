import {describe, expect, it} from "vite-plus/test";

import
{
	ICON_SIZE_TABLE,
	iconFontSize,
	iconWght,
	nearestIconSize,
	resolveIconSize,
	type IconSizeProp,
} from "../src/lib/icon-sizes";

describe("icon sizes (upstream cds NY / b3 / Rb / uRr / pT)", () =>
{
	it("copies upstream's NY size and stroke table", () =>
	{
		expect(ICON_SIZE_TABLE).toStrictEqual(
			{
				xs:
				{
					px: 12,
					stroke: 1,
				},
				sm:
				{
					px: 16,
					stroke: 1.25,
					strong: 1.5625,
				},
				md:
				{
					px: 20,
					stroke: 1.25,
					strong: 1.5625,
				},
				lg:
				{
					px: 24,
					stroke: 1.5,
				},
				xl:
				{
					px: 28,
					stroke: 1.6667,
				},
				xxl:
				{
					px: 32,
					stroke: 1.875,
				},
			},
		);
	});

	it("resolves auto sizes from the density the way b3(size, XE()) does", () =>
	{
		const props: (IconSizeProp | undefined)[] = [undefined, "auto", "auto-sm", "auto-lg", "xs", "xxl"];
		expect(
			{
				compact: props.map((size) => resolveIconSize(size, "compact")),
				comfortable: props.map((size) => resolveIconSize(size, "comfortable")),
			},
		).toStrictEqual(
			{
				compact: ["md", "sm", "xs", "md", "xs", "xxl"],
				comfortable: ["md", "md", "sm", "lg", "xs", "xxl"],
			},
		);
	});

	it("picks the nearest table size for a custom px, ties going to the larger (Rb)", () =>
	{
		expect([18, 14, 40, 12, 26].map(nearestIconSize)).toStrictEqual(["md", "sm", "xxl", "xs", "xl"]);
	});

	it("encodes the stroke as upstream's variable wght (uRr)", () =>
	{
		expect([
			iconWght(1.25, 16),
			iconWght(1.25, 20),
			iconWght(1, 12),
			iconWght(1.6667, 28),
			iconWght(1.5625, 20),
			iconWght(1.5625, 16),
			iconWght(1.875, 32),
		]).toStrictEqual([533.3, 433.3, 577.8, 407.9, 566.7, 700, 400]);
	});

	it("sizes the glyph in rem scaled by --cds-rem-scale (qj)", () =>
	{
		expect([iconFontSize(20), iconFontSize(16), iconFontSize(28)]).toStrictEqual([
			"calc(1.25rem * var(--cds-rem-scale, 1))",
			"calc(1rem * var(--cds-rem-scale, 1))",
			"calc(1.75rem * var(--cds-rem-scale, 1))",
		]);
	});
});
