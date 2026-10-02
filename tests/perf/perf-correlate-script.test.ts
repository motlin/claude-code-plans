import {describe, expect, it} from "vite-plus/test";
import {correlate, median, parseSweep, slope, spearman, verdict, type Sweep} from "../../scripts/perf-correlate";

describe("median", () => {
	it("takes the middle of an odd-length list without sorting the input in place", () => {
		const values = [9, 1, 5, 3, 7];
		expect({median: median(values), values}).toStrictEqual({median: 5, values: [9, 1, 5, 3, 7]});
	});

	it("averages the two middle values of an even-length list", () => {
		expect(median([4, 1, 3, 2])).toBe(2.5);
	});

	it("rejects an empty list", () => {
		expect(() => median([])).toThrow("median of an empty list");
	});
});

describe("spearman", () => {
	it("is 1 for any strictly increasing relation", () => {
		expect(spearman([1, 2, 3, 4, 5], [2, 20, 21, 400, 1000])).toBe(1);
	});

	it("is -1 for a strictly decreasing relation", () => {
		expect(spearman([1, 2, 3, 4], [10, 5, 2, 1])).toBe(-1);
	});

	it("matches the textbook value for one swapped pair of four (1 - 6·2 / (4·15))", () => {
		expect(spearman([1, 2, 3, 4], [1, 3, 2, 4])).toBeCloseTo(0.8, 12);
	});

	it("matches the textbook ten-pair example (IQ vs hours of TV, ρ = -29/165)", () => {
		const iq = [106, 100, 86, 101, 99, 103, 97, 113, 112, 110];
		const tv = [7, 27, 2, 50, 28, 29, 20, 12, 6, 17];
		expect(spearman(iq, tv)).toBeCloseTo(-29 / 165, 12);
	});

	it("gives tied values their average rank", () => {
		// Ranks x = [1, 2.5, 2.5, 4], y = [1, 2, 3, 4]: the Pearson correlation of the ranks is 0.9486832980505138.
		expect(spearman([10, 20, 20, 30], [1, 2, 3, 4])).toBeCloseTo(0.9486832980505138, 12);
	});

	it("is undefined when either side is constant or the lists are too short", () => {
		expect([spearman([2, 2, 2], [1, 2, 3]), spearman([1, 2, 3], [5, 5, 5]), spearman([1], [1])]).toStrictEqual([
			undefined,
			undefined,
			undefined,
		]);
	});

	it("rejects lists of different lengths", () => {
		expect(() => spearman([1, 2], [1, 2, 3])).toThrow("spearman needs equal-length lists, got 2 and 3");
	});
});

describe("slope", () => {
	it("is the least-squares slope of y on x", () => {
		expect(slope([1, 2, 3, 4], [3, 5, 7, 9])).toBe(2);
		expect(slope([0, 1, 2], [1, 0, 2])).toBe(0.5);
	});

	it("is undefined when x is constant", () => {
		expect(slope([3, 3, 3], [1, 2, 3])).toBeUndefined();
	});
});

describe("verdict", () => {
	it("keeps a count that moves across the sweep with ρ ≥ 0.9", () => {
		expect(verdict([1, 2, 3, 4], 0.9)).toBe("keep");
	});

	it("demotes a count that moves across the sweep with ρ < 0.9", () => {
		expect([verdict([1, 3, 2, 4], 0.8), verdict([4, 3, 2, 1], -1)]).toStrictEqual(["demote", "demote"]);
	});

	it("leaves a count untested when it moves less than 10% across the sweep", () => {
		expect([
			verdict([2, 2, 2, 2], undefined),
			verdict([100, 105, 109, 100], 0.6),
			verdict([0, 0], undefined),
		]).toStrictEqual(["untested", "untested", "untested"]);
	});
});

const sweep: Sweep = {
	sha: "abc1234",
	node: "v24.0.0",
	measuredAt: "2026-10-01T00:00:00.000Z",
	runs: 3,
	shapes: (["small", "typical", "large-long", "large-wide"] as const).map((shape, index) => ({
		shape,
		fileBytes: (index + 1) * 1000,
		loadBefore: [1, 1, 1],
		loadAfter: [1, 1, 1],
		journeys: [
			{
				journey: `server.sessionOpen.${shape}.detail`,
				counts: {
					[`server.sessionOpen.${shape}.detail.jsonl.bytesRead`]: (index + 1) * 1000,
					[`server.sessionOpen.${shape}.detail.sql.count`]: 12,
					[`server.sessionOpen.${shape}.detail.resp.bytes`]: [400, 600, 500, 700][index]!,
				},
				wallMs: [index + 1, index + 3, index + 2],
			},
		],
	})),
};

describe("correlate", () => {
	it("pairs each count family with its journey's median wall time across the shapes", () => {
		expect(correlate(sweep)).toStrictEqual([
			{
				family: "server.sessionOpen.<shape>.detail.jsonl.bytesRead",
				journey: "server.sessionOpen.<shape>.detail",
				counts: [1000, 2000, 3000, 4000],
				wallMs: [2, 3, 4, 5],
				rho: 1,
				slope: 0.001,
				verdict: "keep",
			},
			{
				family: "server.sessionOpen.<shape>.detail.resp.bytes",
				journey: "server.sessionOpen.<shape>.detail",
				counts: [400, 600, 500, 700],
				wallMs: [2, 3, 4, 5],
				rho: 0.8,
				slope: 0.008,
				verdict: "demote",
			},
			{
				family: "server.sessionOpen.<shape>.detail.sql.count",
				journey: "server.sessionOpen.<shape>.detail",
				counts: [12, 12, 12, 12],
				wallMs: [2, 3, 4, 5],
				rho: undefined,
				slope: undefined,
				verdict: "untested",
			},
		]);
	});
});

describe("parseSweep", () => {
	it("round-trips a sweep and rejects unknown keys", () => {
		expect(parseSweep(JSON.stringify(sweep))).toStrictEqual(sweep);
		expect(() => parseSweep(JSON.stringify({...sweep, extra: 1}))).toThrow();
	});
});
