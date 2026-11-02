import
{
	assignMeterColors,
	chartInk,
	chartPaint,
	formatMeterAmount,
	formatPrintedAmount,
	layoutStackedMeter,
	layoutStackedMeterBlocks,
	meterPercent,
	meterRows,
	readoutLabelParts,
} from "../src/lib/stacked-meter-layout";

describe("layoutStackedMeter", () =>
{
	// Upstream's live 246px specimen, with its shares rounded to the hundredths of a percent the dump printed (live drew
	// 1.979/1.841/1.22/1.22/1.22/2.694%): the three small shares floor to exactly 2px plus a 1px seam.
	it("floors tiny shares to 2px plus a 1px seam, taking the mass from the larger shares", () =>
	{
		const layout = layoutStackedMeter([0.0246, 0.021, 0.0117, 0.0064, 0.005, 0.033], 246, 4);
		if (layout.kind !== "segments") throw new Error(`expected segments, got ${layout.kind}`);
		expect(
			layout.segments.map((segment) => (
			{
				index: segment.index,
				start: meterPercent(segment.start),
				width: meterPercent(segment.width),
				seam: segment.seam,
				radiusStart: segment.radiusStart,
				radiusEnd: segment.radiusEnd,
			})),
		).toStrictEqual([
			{
				index: 0,
				start: 0,
				width: 1.978,
				seam: 0,
				radiusStart: 2,
				radiusEnd: 1,
			},
			{
				index: 1,
				start: 1.978,
				width: 1.842,
				seam: 1,
				radiusStart: 1,
				radiusEnd: 1,
			},
			{
				index: 2,
				start: 3.82,
				width: 1.22,
				seam: 1,
				radiusStart: 1,
				radiusEnd: 1,
			},
			{
				index: 3,
				start: 5.04,
				width: 1.22,
				seam: 1,
				radiusStart: 1,
				radiusEnd: 1,
			},
			{
				index: 4,
				start: 6.259,
				width: 1.22,
				seam: 1,
				radiusStart: 1,
				radiusEnd: 1,
			},
			{
				index: 5,
				start: 7.479,
				width: 2.691,
				seam: 1,
				radiusStart: 1,
				radiusEnd: 2,
			},
		]);
	});

	it("is empty when every share is zero", () =>
	{
		expect(layoutStackedMeter([0, 0, 0], 246, 4)).toStrictEqual(
			{
				kind: "empty",
			},
		);
	});

	it("draws a single dot when the run is narrower than the meter is tall", () =>
	{
		expect(layoutStackedMeter([0.005], 246, 4)).toStrictEqual(
			{
				kind: "dot",
				index: 0,
			},
		);
	});

	it("dots the largest share when no segment is a pixel wide", () =>
	{
		expect(layoutStackedMeter([0.001, 0.002, 0.001], 246, 4)).toStrictEqual(
			{
				kind: "dot",
				index: 1,
			},
		);
	});

	it("keeps the raw shares when the deficit exceeds the surplus", () =>
	{
		expect(layoutStackedMeter([0.005, 0.004], 500, 4)).toStrictEqual(
			{
				kind: "segments",
				segments: [
					{
						index: 0,
						start: 0,
						width: 0.005,
						seam: 0,
						radiusStart: 2,
						radiusEnd: 1,
					},
					{
						index: 1,
						start: 0.005,
						width: 0.004,
						seam: 1,
						radiusStart: 1,
						radiusEnd: 2,
					},
				],
			},
		);
	});

	it("skips zero shares without a seam and keeps placing the rest", () =>
	{
		expect(layoutStackedMeter([0, 0.5, 0.25], 200, 4)).toStrictEqual(
			{
				kind: "segments",
				segments: [
					{
						index: 1,
						start: 0,
						width: 0.5,
						seam: 0,
						radiusStart: 2,
						radiusEnd: 1,
					},
					{
						index: 2,
						start: 0.5,
						width: 0.25,
						seam: 1,
						radiusStart: 1,
						radiusEnd: 2,
					},
				],
			},
		);
	});
});

describe("meterPercent", () =>
{
	it("rounds a share to a percent with 3 decimals", () =>
	{
		expect([meterPercent(0.019_794_1), meterPercent(0.5), meterPercent(1 / 3)]).toStrictEqual([1.979, 50, 33.333]);
	});
});

describe("meterRows", () =>
{
	const categories = [
		{
			id: "a",
		},
		{
			id: "b",
		},
	];

	it("divides by the sum when there is no total", () =>
	{
		expect(
			meterRows(
				categories,
				{
					a: 1,
					b: 1,
				},
				undefined,
			),
		).toStrictEqual([
			{
				id: "a",
				amount: 1,
				share: 0.5,
			},
			{
				id: "b",
				amount: 1,
				share: 0.5,
			},
		]);
	});

	it("divides by the sum when it passes the total", () =>
	{
		expect(
			meterRows(
				categories,
				{
					a: 1,
					b: 1,
				},
				1,
			).map((row) => row.share),
		).toStrictEqual([0.5, 0.5]);
	});

	it("divides by the total when it covers the sum", () =>
	{
		expect(
			meterRows(
				categories,
				{
					a: 1,
					b: 1,
				},
				4,
			).map((row) => row.share),
		).toStrictEqual([0.25, 0.25]);
	});

	it("zeroes every share when the total is not a positive number", () =>
	{
		expect(
			meterRows(
				categories,
				{
					a: 1,
					b: 1,
				},
				0,
			).map((row) => row.share),
		).toStrictEqual([0, 0]);
		expect(
			meterRows(
				categories,
				{
					a: 1,
					b: 1,
				},
				Number.NaN,
			).map((row) => row.share),
		).toStrictEqual([0, 0]);
	});

	it("counts negative and non-finite amounts as zero", () =>
	{
		expect(
			meterRows(
				categories,
				{
					a: -3,
					b: Number.NaN,
				},
				undefined,
			),
		).toStrictEqual([
			{
				id: "a",
				amount: 0,
				share: 0,
			},
			{
				id: "b",
				amount: 0,
				share: 0,
			},
		]);
	});

	it("reads a category's own value function before its id", () =>
	{
		expect(
			meterRows(
				[
					{
						id: "a",
						value: (values) => (values["x"] ?? 0) * 2,
					},
					{
						id: "b",
					},
				],
				{
					x: 1,
					b: 2,
				},
				undefined,
			),
		).toStrictEqual([
			{
				id: "a",
				amount: 2,
				share: 0.5,
			},
			{
				id: "b",
				amount: 2,
				share: 0.5,
			},
		]);
	});
});

describe("assignMeterColors", () =>
{
	it("hands uncoloured categories categorical-1 to 8, then muted", () =>
	{
		expect(
			assignMeterColors(
				Array.from(
					{
						length: 9,
					},
					(_, i) => (
					{
						id: `c${i}`,
					}),
				),
			),
		).toStrictEqual([
			"categorical-1",
			"categorical-2",
			"categorical-3",
			"categorical-4",
			"categorical-5",
			"categorical-6",
			"categorical-7",
			"categorical-8",
			"muted",
		]);
	});

	it("skips categorical colours other categories claim", () =>
	{
		expect(
			assignMeterColors([
				{
					id: "a",
				},
				{
					id: "b",
					color: "categorical-1",
				},
				{
					id: "c",
				},
			]),
		).toStrictEqual(["categorical-2", "categorical-1", "categorical-3"]);
	});

	it("paints ghost categories in the reference colour without them claiming a categorical one", () =>
	{
		expect(
			assignMeterColors([
				{
					id: "a",
					ghost: true,
				},
				{
					id: "b",
					ghost: true,
					color: "categorical-1",
				},
				{
					id: "c",
				},
			]),
		).toStrictEqual(["reference", "categorical-1", "categorical-1"]);
	});

	it("maps colours to chart tokens and printed-label ink", () =>
	{
		expect(
			(["categorical-4", "muted", "status-warning", "categorical-1"] as const).map((color) => [
				chartPaint(color),
				chartInk(color),
			]),
		).toStrictEqual([
			["var(--chart-categorical-4)", "text-neutral-900"],
			["var(--chart-muted)", "text-neutral-900"],
			["var(--chart-status-warning)", "text-gray-900"],
			["var(--chart-categorical-1)", "text-gray-0"],
		]);
	});
});

describe("layoutStackedMeterBlocks", () =>
{
	const fixed = (layout: ReturnType<typeof layoutStackedMeterBlocks>) => (
	{
		...layout,
		run: Number(layout.run.toFixed(6)),
		blocks: layout.blocks.map((block) => (
		{
			index: block.index,
			grow: Number(block.grow.toFixed(6)),
		})),
	});

	it("floors small blocks to 2px out of the larger ones", () =>
	{
		expect(fixed(layoutStackedMeterBlocks([0.5, 0.3, 0.001], 300))).toStrictEqual(
			{
				run: 0.801,
				blocks: [
					{
						index: 0,
						grow: 0.619695,
					},
					{
						index: 1,
						grow: 0.371842,
					},
					{
						index: 2,
						grow: 0.008464,
					},
				],
				rest: true,
			},
		);
	});

	it("drops the smallest blocks until the rest fit", () =>
	{
		expect(layoutStackedMeterBlocks([0.004, 0.003, 0.002], 300)).toStrictEqual(
			{
				run: 0.009000000000000001,
				blocks: [
					{
						index: 0,
						grow: 1,
					},
				],
				rest: true,
			},
		);
	});

	it("leaves no rest track when the run fills the meter", () =>
	{
		expect(layoutStackedMeterBlocks([0.6, 0.4], 300)).toStrictEqual(
			{
				run: 1,
				blocks: [
					{
						index: 0,
						grow: 0.6,
					},
					{
						index: 1,
						grow: 0.4,
					},
				],
				rest: false,
			},
		);
	});

	it("has no blocks when every share is zero", () =>
	{
		expect(layoutStackedMeterBlocks([0, 0], 300)).toStrictEqual(
			{
				run: 0,
				blocks: [],
				rest: true,
			},
		);
	});
});

describe("meter number formats", () =>
{
	it("prints amounts with at most 3 significant digits, integers in full", () =>
	{
		expect([12_345, 1.23456, 0.000_123, -0].map(formatMeterAmount)).toStrictEqual([
			"12,345",
			"1.23",
			"0.000123",
			"0",
		]);
	});

	it("prints lg amounts compact from 10,000, else with 4 significant digits", () =>
	{
		expect([9_999, 12_345, 1.23456].map(formatPrintedAmount)).toStrictEqual(["9,999", "12.3K", "1.235"]);
	});
});

describe("readoutLabelParts", () =>
{
	it("keeps a long label's last 8 graphemes apart from its head", () =>
	{
		expect(readoutLabelParts("a".repeat(32) + "12345678")).toStrictEqual(
			{
				head: "a".repeat(32),
				tail: "12345678",
			},
		);
	});

	it("leaves labels of 30 graphemes or fewer whole", () =>
	{
		expect(readoutLabelParts("short label")).toStrictEqual(
			{
				head: "short label",
				tail: "",
			},
		);
	});

	it("leaves the label whole when whitespace splits it at the cut", () =>
	{
		expect(readoutLabelParts(`${"a".repeat(31)} 1234567`)).toStrictEqual(
			{
				head: `${"a".repeat(31)} 1234567`,
				tail: "",
			},
		);
	});
});
