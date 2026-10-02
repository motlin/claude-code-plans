import {describe, expect, it} from "vite-plus/test";
import {classifyStability, parseStabilityArgs, STABILITY_LIMIT} from "../../scripts/perf-lab-stability";

describe("classifyStability", () => {
	it("calls identical runs stable at tolerance 0", () => {
		expect(classifyStability([42, 42, 42, 42, 42, 42, 42, 42, 42, 42])).toStrictEqual({
			min: 42,
			median: 42,
			max: 42,
			spread: 0,
			stable: true,
			tolerance: 0,
		});
	});

	it("calls identical all-zero runs stable at tolerance 0", () => {
		expect(classifyStability([0, 0, 0])).toStrictEqual({
			min: 0,
			median: 0,
			max: 0,
			spread: 0,
			stable: true,
			tolerance: 0,
		});
	});

	it("calls a 1% spread stable at the 2% tolerance", () => {
		expect(classifyStability([100, 100.5, 101, 100, 100.2])).toStrictEqual({
			min: 100,
			median: 100.2,
			max: 101,
			spread: 1 / 100.2,
			stable: true,
			tolerance: STABILITY_LIMIT,
		});
		expect(STABILITY_LIMIT).toBe(0.02);
	});

	it("calls a spread of exactly 2% stable", () => {
		expect(classifyStability([99, 100, 101])).toStrictEqual({
			min: 99,
			median: 100,
			max: 101,
			spread: 0.02,
			stable: true,
			tolerance: 0.02,
		});
	});

	it("calls a 10% spread unstable with no tolerance", () => {
		expect(classifyStability([100, 105, 110, 102])).toStrictEqual({
			min: 100,
			median: 103.5,
			max: 110,
			spread: 10 / 103.5,
			stable: false,
			tolerance: null,
		});
	});

	it("calls varying runs around a zero median unstable", () => {
		expect(classifyStability([0, 0, 0.01])).toStrictEqual({
			min: 0,
			median: 0,
			max: 0.01,
			spread: Number.POSITIVE_INFINITY,
			stable: false,
			tolerance: null,
		});
	});

	it("rejects an empty run list", () => {
		expect(() => classifyStability([])).toThrow("no runs to classify");
	});
});

describe("parseStabilityArgs", () => {
	it("defaults to 10 runs on :7538", () => {
		expect(parseStabilityArgs([])).toStrictEqual({
			port: 7538,
			runs: 10,
			journeys: ["J1", "J2", "J3", "J4", "J5", "J6"],
			out: undefined,
		});
	});

	it("reads --runs, --port, --journey and --out", () => {
		expect(
			parseStabilityArgs([
				"--runs",
				"3",
				"--port",
				"7600",
				"--journey",
				"J4",
				"--journey",
				"J1",
				"--out",
				"x.md",
			]),
		).toStrictEqual({
			port: 7600,
			runs: 3,
			journeys: ["J1", "J4"],
			out: "x.md",
		});
	});

	it("refuses the real app port", () => {
		expect(() => parseStabilityArgs(["--port", "7526"])).toThrow("Refusing port 7526");
	});

	it("needs at least two runs to measure a spread", () => {
		expect(() => parseStabilityArgs(["--runs", "1"])).toThrow("--runs must be at least 2");
	});
});
