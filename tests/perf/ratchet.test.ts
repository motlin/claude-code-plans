import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {createRatchet, loadCeilings, type Ceilings} from "./ratchet";

const ceilings: Ceilings = {
	"server.sessionOpen.large-wide.detail.jsonl.bytesRead": {ceiling: 1000, unit: "bytes", tolerance: 0},
	"lab.sessionSwitch.typical.inp": {ceiling: 200, unit: "ms", tolerance: 0.1},
};

let dir: string;
let resultsPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ccb-ratchet-"));
	resultsPath = join(dir, "nested", "results.json");
});

afterEach(() => {
	rmSync(dir, {recursive: true, force: true});
});

function readResults(): unknown {
	return JSON.parse(readFileSync(resultsPath, "utf8"));
}

describe("ratchet", () => {
	it("passes when the value equals the ceiling", () => {
		const ratchet = createRatchet({ceilings, resultsPath});
		expect(() => ratchet("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 1000)).not.toThrow();
	});

	it("fails with the rise message when the value is above the ceiling", () => {
		const ratchet = createRatchet({ceilings, resultsPath});
		expect(() => ratchet("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 1001)).toThrow(
			"server.sessionOpen.large-wide.detail.jsonl.bytesRead rose from 1000 to 1001; fix the regression or raise the ceiling with a reason",
		);
	});

	it("fails with the lower-the-ceiling message when the value is below the ceiling", () => {
		const ratchet = createRatchet({ceilings, resultsPath});
		expect(() => ratchet("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 999)).toThrow(
			"server.sessionOpen.large-wide.detail.jsonl.bytesRead improved from 1000 to 999; lower the ceiling in tests/perf/ceilings.json in this same commit",
		);
	});

	it("passes within tolerance in both directions", () => {
		const ratchet = createRatchet({ceilings, resultsPath});
		expect(() => ratchet("lab.sessionSwitch.typical.inp", 220)).not.toThrow();
		expect(() => ratchet("lab.sessionSwitch.typical.inp", 180)).not.toThrow();
	});

	it("fails just outside tolerance in both directions", () => {
		const ratchet = createRatchet({ceilings, resultsPath});
		expect(() => ratchet("lab.sessionSwitch.typical.inp", 221)).toThrow(
			"lab.sessionSwitch.typical.inp rose from 200 to 221; fix the regression or raise the ceiling with a reason",
		);
		expect(() => ratchet("lab.sessionSwitch.typical.inp", 179)).toThrow(
			"lab.sessionSwitch.typical.inp improved from 200 to 179; lower the ceiling in tests/perf/ceilings.json in this same commit",
		);
	});

	it("fails for an id missing from the ceilings", () => {
		const ratchet = createRatchet({ceilings, resultsPath});
		expect(() => ratchet("client.unknown.metric", 5)).toThrow(
			"client.unknown.metric has no ceiling; add it to tests/perf/ceilings.json",
		);
	});

	it("records every measurement to results.json, including failing and unknown ones", () => {
		const ratchet = createRatchet({ceilings, resultsPath});
		ratchet("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 1000);
		expect(() => ratchet("lab.sessionSwitch.typical.inp", 500)).toThrow();
		expect(() => ratchet("client.unknown.metric", 5)).toThrow();
		expect(readResults()).toStrictEqual({
			"client.unknown.metric": {value: 5},
			"lab.sessionSwitch.typical.inp": {value: 500, unit: "ms"},
			"server.sessionOpen.large-wide.detail.jsonl.bytesRead": {value: 1000, unit: "bytes"},
		});
	});

	it("overwrites an earlier measurement of the same id and keeps others", () => {
		const first = createRatchet({ceilings, resultsPath});
		first("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 1000);
		const second = createRatchet({ceilings, resultsPath});
		expect(() => second("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 1200)).toThrow();
		second("lab.sessionSwitch.typical.inp", 200);
		expect(readResults()).toStrictEqual({
			"lab.sessionSwitch.typical.inp": {value: 200, unit: "ms"},
			"server.sessionOpen.large-wide.detail.jsonl.bytesRead": {value: 1200, unit: "bytes"},
		});
	});
});

describe("ceilings.json", () => {
	it("parses and keeps its keys sorted", () => {
		const loaded = loadCeilings();
		const keys = Object.keys(loaded);
		expect(keys).toStrictEqual([...keys].sort());
	});

	it("rejects entries with unknown fields", () => {
		expect(() => loadCeilings('{"a.b": {"ceiling": 1, "unit": "count", "tolerance": 0, "extra": 1}}')).toThrow();
	});

	it("rejects keys that are out of order", () => {
		expect(() =>
			loadCeilings(
				'{"b.x": {"ceiling": 1, "unit": "count", "tolerance": 0}, "a.x": {"ceiling": 1, "unit": "count", "tolerance": 0}}',
			),
		).toThrow("tests/perf/ceilings.json keys must be sorted");
	});
});
