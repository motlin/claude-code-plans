import {layoutStackedMeter, meterPercent} from "../src/lib/stacked-meter-layout";

describe("layoutStackedMeter", () => {
	// Upstream's live 246px specimen, with its shares rounded to the hundredths of a percent the dump printed (live drew
	// 1.979/1.841/1.22/1.22/1.22/2.694%): the three small shares floor to exactly 2px plus a 1px seam.
	it("floors tiny shares to 2px plus a 1px seam, taking the mass from the larger shares", () => {
		const layout = layoutStackedMeter([0.0246, 0.021, 0.0117, 0.0064, 0.005, 0.033], 246, 4);
		if (layout.kind !== "segments") throw new Error(`expected segments, got ${layout.kind}`);
		expect(
			layout.segments.map((segment) => ({
				index: segment.index,
				start: meterPercent(segment.start),
				width: meterPercent(segment.width),
				seam: segment.seam,
				radiusStart: segment.radiusStart,
				radiusEnd: segment.radiusEnd,
			})),
		).toStrictEqual([
			{index: 0, start: 0, width: 1.978, seam: 0, radiusStart: 2, radiusEnd: 1},
			{index: 1, start: 1.978, width: 1.842, seam: 1, radiusStart: 1, radiusEnd: 1},
			{index: 2, start: 3.82, width: 1.22, seam: 1, radiusStart: 1, radiusEnd: 1},
			{index: 3, start: 5.04, width: 1.22, seam: 1, radiusStart: 1, radiusEnd: 1},
			{index: 4, start: 6.259, width: 1.22, seam: 1, radiusStart: 1, radiusEnd: 1},
			{index: 5, start: 7.479, width: 2.691, seam: 1, radiusStart: 1, radiusEnd: 2},
		]);
	});

	it("is empty when every share is zero", () => {
		expect(layoutStackedMeter([0, 0, 0], 246, 4)).toStrictEqual({kind: "empty"});
	});

	it("draws a single dot when the run is narrower than the meter is tall", () => {
		expect(layoutStackedMeter([0.005], 246, 4)).toStrictEqual({kind: "dot", index: 0});
	});

	it("dots the largest share when no segment is a pixel wide", () => {
		expect(layoutStackedMeter([0.001, 0.002, 0.001], 246, 4)).toStrictEqual({kind: "dot", index: 1});
	});

	it("keeps the raw shares when the deficit exceeds the surplus", () => {
		expect(layoutStackedMeter([0.005, 0.004], 500, 4)).toStrictEqual({
			kind: "segments",
			segments: [
				{index: 0, start: 0, width: 0.005, seam: 0, radiusStart: 2, radiusEnd: 1},
				{index: 1, start: 0.005, width: 0.004, seam: 1, radiusStart: 1, radiusEnd: 2},
			],
		});
	});

	it("skips zero shares without a seam and keeps placing the rest", () => {
		expect(layoutStackedMeter([0, 0.5, 0.25], 200, 4)).toStrictEqual({
			kind: "segments",
			segments: [
				{index: 1, start: 0, width: 0.5, seam: 0, radiusStart: 2, radiusEnd: 1},
				{index: 2, start: 0.5, width: 0.25, seam: 1, radiusStart: 1, radiusEnd: 2},
			],
		});
	});
});

describe("meterPercent", () => {
	it("rounds a share to a percent with 3 decimals", () => {
		expect([meterPercent(0.019_794_1), meterPercent(0.5), meterPercent(1 / 3)]).toStrictEqual([1.979, 50, 33.333]);
	});
});
