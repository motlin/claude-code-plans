import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {
	type CdpMetricsPayload,
	layoutShiftSum,
	metricsDelta,
	parseLabArgs,
	preflightFailures,
	rafRateHz,
	summarize,
} from "../../scripts/perf-lab";

/** Real `Performance.getMetrics` payloads and a real preflight probe, captured from Playwright's headless Chromium. */
const captured = JSON.parse(
	readFileSync(join(import.meta.dirname, "fixtures", "cdp-performance-metrics.json"), "utf8"),
) as {
	before: CdpMetricsPayload;
	after: CdpMetricsPayload;
	preflight: {visibilityState: string; rafTimestamps: number[]};
};

function withMetric(payload: CdpMetricsPayload, name: string, value: number): CdpMetricsPayload {
	return {metrics: payload.metrics.map((metric) => (metric.name === name ? {name, value} : metric))};
}

describe("metricsDelta", () => {
	it("subtracts the style-recalc and layout counters between two captured payloads", () => {
		expect(metricsDelta(captured.before, captured.after)).toEqual({
			recalcStyleCount: 4,
			layoutCount: 4,
			recalcStyleDurationMs: 0.09,
			layoutDurationMs: 4.032,
		});
	});

	it("is all zeroes when nothing happened between the two reads", () => {
		expect(metricsDelta(captured.after, captured.after)).toEqual({
			recalcStyleCount: 0,
			layoutCount: 0,
			recalcStyleDurationMs: 0,
			layoutDurationMs: 0,
		});
	});

	it("rejects a payload missing a counter", () => {
		const missing = {metrics: captured.after.metrics.filter((metric) => metric.name !== "LayoutCount")};
		expect(() => metricsDelta(captured.before, missing)).toThrow(
			new Error("CDP Performance.getMetrics payload has no LayoutCount metric"),
		);
	});

	it("rejects a counter that went backwards (the renderer was swapped mid-journey)", () => {
		const reset = withMetric(captured.before, "RecalcStyleCount", 9);
		expect(() => metricsDelta(reset, captured.after)).toThrow(
			new Error("RecalcStyleCount went backwards from 9 to 4; the journey crossed a renderer swap"),
		);
	});
});

describe("preflight", () => {
	it("measures the rAF rate from frame timestamps", () => {
		expect(rafRateHz(captured.preflight.rafTimestamps)).toBeCloseTo(60, 6);
		expect(rafRateHz([0, 1000, 2000])).toBe(1);
		expect(rafRateHz([5])).toBe(0);
	});

	it("passes the captured visible 60 Hz probe", () => {
		expect(preflightFailures(captured.preflight)).toEqual([]);
	});

	it("aborts on a hidden, throttled tab", () => {
		expect(preflightFailures({visibilityState: "hidden", rafTimestamps: [0, 1000, 2000]})).toEqual([
			'document.visibilityState is "hidden", expected "visible"',
			"requestAnimationFrame runs at 1.0 Hz, expected at least 50 Hz",
		]);
	});

	it("aborts when rAF is throttled even though the page reports visible", () => {
		const slow = captured.preflight.rafTimestamps.map((timestamp, index) => timestamp + index * 10);
		expect(preflightFailures({visibilityState: "visible", rafTimestamps: slow})).toEqual([
			"requestAnimationFrame runs at 37.5 Hz, expected at least 50 Hz",
		]);
	});
});

describe("layoutShiftSum", () => {
	it("sums layout-shift values, ignoring shifts right after user input", () => {
		expect(
			layoutShiftSum([
				{value: 0.25, hadRecentInput: false},
				{value: 0.5, hadRecentInput: true},
				{value: 0.125, hadRecentInput: false},
			]),
		).toBe(0.375);
		expect(layoutShiftSum([])).toBe(0);
	});
});

describe("summarize", () => {
	it("reports min, median and max", () => {
		expect(summarize([7, 3, 5, 9, 4])).toEqual({min: 3, median: 5, max: 9, values: [7, 3, 5, 9, 4]});
		expect(summarize([4, 2])).toEqual({min: 2, median: 3, max: 4, values: [4, 2]});
	});
});

describe("parseLabArgs", () => {
	it("defaults to five runs on :7538", () => {
		expect(parseLabArgs([])).toEqual({port: 7538, runs: 5, journeys: ["J1", "J2", "J3", "J4", "J5", "J6"]});
	});

	it("accepts a port, a run count and a journey subset", () => {
		expect(parseLabArgs(["--port", "41234", "--runs", "2", "--journey", "J6", "--journey", "J2"])).toEqual({
			port: 41234,
			runs: 2,
			journeys: ["J2", "J6"],
		});
	});

	it("never runs against the real app port", () => {
		expect(() => parseLabArgs(["--port", "7526"])).toThrow(
			new Error("Refusing port 7526: it is the user's real Claude Code Browser server"),
		);
	});

	it("rejects unknown arguments and journeys", () => {
		expect(() => parseLabArgs(["--nope"])).toThrow(new Error("Unknown argument: --nope"));
		expect(() => parseLabArgs(["--journey", "J9"])).toThrow(new Error("Unknown journey: J9"));
		expect(() => parseLabArgs(["--runs", "0"])).toThrow(new Error("--runs must be a positive integer, got 0"));
	});
});
