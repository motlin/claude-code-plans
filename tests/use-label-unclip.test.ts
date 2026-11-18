import {describe, expect, it} from "vite-plus/test";

import {labelUnclipState} from "../src/hooks/use-label-unclip";

describe("labelUnclipState", () =>
{
	it("self-expands and unclips a measured, clipped row that wants open", () =>
	{
		expect(
			labelUnclipState(
				{
					measured: true,
					labelClipped: true,
					metaClipped: false,
					hasDisclosure: false,
					wantsOpen: true,
				},
			),
		).toStrictEqual(
			{
				selfExpands: true,
				expandable: true,
				open: true,
				rowUnclipped: true,
			},
		);
	});

	it("self-expands on a clipped meta alone, closed until it wants open", () =>
	{
		expect(
			labelUnclipState(
				{
					measured: true,
					labelClipped: false,
					metaClipped: true,
					hasDisclosure: false,
					wantsOpen: false,
				},
			),
		).toStrictEqual(
			{
				selfExpands: true,
				expandable: true,
				open: false,
				rowUnclipped: false,
			},
		);
	});

	it("never self-expands a row that is not measured, though its disclosure still expands", () =>
	{
		expect(
			labelUnclipState(
				{
					measured: false,
					labelClipped: true,
					metaClipped: true,
					hasDisclosure: true,
					wantsOpen: true,
				},
			),
		).toStrictEqual(
			{
				selfExpands: false,
				expandable: true,
				open: true,
				rowUnclipped: false,
			},
		);
	});

	it("leaves a measured row that fits inert", () =>
	{
		expect(
			labelUnclipState(
				{
					measured: true,
					labelClipped: false,
					metaClipped: false,
					hasDisclosure: false,
					wantsOpen: true,
				},
			),
		).toStrictEqual(
			{
				selfExpands: false,
				expandable: false,
				open: false,
				rowUnclipped: false,
			},
		);
	});
});
