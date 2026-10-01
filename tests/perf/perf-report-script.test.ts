import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {formatReport, nearestRank, parseReportArgs, readFieldSamples, splitSample} from "../../scripts/perf-report";
import type {JourneySample, ResourceSample} from "../../src/lib/perf/journey";

const NOW = new Date("2026-10-01T12:00:00Z");

let perfDir: string;

beforeEach(() => {
	perfDir = join(mkdtempSync(join(tmpdir(), "perf-report-test-")), "perf");
	mkdirSync(perfDir);
});

afterEach(() => {
	rmSync(join(perfDir, ".."), {recursive: true, force: true});
});

function resource(startTime: number, responseEnd: number, serverTotal?: number): ResourceSample {
	return {
		name: "http://localhost/api/sessions/abc",
		initiatorType: "fetch",
		startTime,
		duration: responseEnd - startTime,
		requestStart: startTime,
		responseStart: responseEnd,
		responseEnd,
		transferSize: 100,
		serverTiming: serverTotal === undefined ? [] : [{name: "total", duration: serverTotal, description: ""}],
	};
}

function sample(overrides: Partial<JourneySample> = {}): JourneySample {
	const start = overrides.start ?? 1000;
	const duration = overrides.duration ?? 100;
	return {
		journey: "F5",
		trigger: "pointerdown",
		start,
		end: start + duration,
		duration,
		endSource: "raf",
		route: "/session/abc",
		buildSha: "abc1234",
		mode: "prod",
		origin: "localhost",
		formFactor: "desktop",
		hardwareConcurrency: 8,
		resources: [],
		longAnimationFrames: [],
		layoutShifts: [],
		cls: 0,
		events: [],
		...overrides,
	};
}

function writeLog(day: string, lines: string[]): void {
	writeFileSync(join(perfDir, `field-${day}.jsonl`), lines.map((line) => `${line}\n`).join(""));
}

describe("nearestRank", () => {
	it("picks the value at rank ceil(p/100 * n) of the sorted values", () => {
		const values = [50, 10, 40, 20, 30];

		expect([nearestRank(values, 50), nearestRank(values, 75), nearestRank(values, 95)]).toStrictEqual([30, 40, 50]);
		expect(nearestRank([7], 75)).toBe(7);
	});
});

describe("splitSample", () => {
	it("splits the journey into server time, the rest of the request time, and client time", () => {
		const split = splitSample(
			sample({
				start: 1000,
				duration: 200,
				resources: [
					resource(1010, 1060, 30),
					resource(1040, 1090, 20),
					resource(900, 1020),
					resource(1300, 1400, 50),
				],
			}),
		);

		expect(split).toStrictEqual({total: 200, server: 50, network: 40, client: 110});
	});

	it("caps server time at the time the critical-path requests were in flight", () => {
		expect(splitSample(sample({start: 0, duration: 100, resources: [resource(0, 10, 40)]}))).toStrictEqual({
			total: 100,
			server: 10,
			network: 0,
			client: 90,
		});
	});
});

describe("parseReportArgs", () => {
	it("reads --since in days and --sha", () => {
		expect(parseReportArgs(["--since", "7d", "--sha", "abc"])).toStrictEqual({sinceDays: 7, sha: "abc"});
		expect(parseReportArgs([])).toStrictEqual({});
	});

	it("rejects a malformed --since", () => {
		expect(() => parseReportArgs(["--since", "7h"])).toThrow('--since expects a day count like "7d", got "7h"');
	});
});

describe("perf-report", () => {
	beforeEach(() => {
		const switches = Array.from({length: 30}, (_, index) => {
			const duration = 20 * (index + 1);
			return sample({
				duration,
				sizeBucket: "M",
				resources: [resource(1000, 1000 + duration / 2, duration / 4)],
			});
		});
		writeLog("2026-09-30", [
			...switches.slice(0, 15).map((s) => JSON.stringify(s)),
			JSON.stringify(sample({journey: "F1", mode: "dev", origin: "remote", formFactor: "phone", duration: 300})),
			"not json",
		]);
		writeLog("2026-10-01", [
			...switches.slice(15).map((s) => JSON.stringify(s)),
			JSON.stringify(sample({journey: "F1", mode: "dev", origin: "remote", formFactor: "phone", duration: 100})),
			JSON.stringify(sample({journey: "F10", buildSha: "def5678", duration: 900})),
			JSON.stringify({journey: "F2"}),
		]);
		writeLog("2026-09-01", [JSON.stringify(sample({journey: "F2", duration: 5}))]);
		writeFileSync(join(perfDir, "notes.txt"), "ignored");
	});

	it("prints n and nearest-rank p50/p75/p95 per bucket, marking buckets under 30 samples", () => {
		const {samples, invalidLines} = readFieldSamples(perfDir, {now: NOW, sinceDays: 7});

		expect(invalidLines).toBe(2);
		expect(formatReport(samples)).toBe(
			[
				"sha      mode  origin     form     size  metric   n  total p50/p75/p95  server p50/p75/p95  network p50/p75/p95  client p50/p75/p95  baseline",
				"abc1234  dev   remote     phone    -     F1       2        100/300/300               0/0/0                0/0/0         100/300/300  not yet (n < 30)",
				"abc1234  prod  localhost  desktop  M     F5      30        300/460/580          75/115/145           75/115/145         150/230/290  yes",
				"def5678  prod  localhost  desktop  -     F10      1        900/900/900               0/0/0                0/0/0         900/900/900  not yet (n < 30)",
			].join("\n"),
		);
	});

	it("reads every retained file without --since and keeps only builds matching the --sha prefix", () => {
		const {samples} = readFieldSamples(perfDir, {now: NOW, sha: "abc"});

		expect(samples.map((s) => s.journey).sort()).toStrictEqual([
			"F1",
			"F1",
			"F2",
			...Array.from({length: 30}, () => "F5"),
		]);
	});

	it("says so when there are no samples", () => {
		expect(formatReport([])).toBe("No field perf samples recorded.");
	});
});
