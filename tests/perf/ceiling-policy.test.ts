import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vite-plus/test";
import {findLargeTierDrift, findUnjustifiedRaises, LARGE_TIER_OFFSETS} from "./ceiling-policy";
import {loadCeilings, type Ceilings} from "./ratchet";
import {runGit} from "../git-fixture";

const previous: Ceilings = {
	"a.bytes": {ceiling: 1000, unit: "bytes", tolerance: 0},
	"b.ms": {ceiling: 200, unit: "ms", tolerance: 0.1},
};

describe("findUnjustifiedRaises", () => {
	it("reports a raise without a reason", () => {
		const current: Ceilings = {...previous, "a.bytes": {ceiling: 1500, unit: "bytes", tolerance: 0}};
		expect(findUnjustifiedRaises(previous, current)).toStrictEqual(["a.bytes"]);
	});

	it("reports a raise with a reason but no raisedAt", () => {
		const current: Ceilings = {
			...previous,
			"a.bytes": {ceiling: 1500, unit: "bytes", tolerance: 0, reason: "bigger fixture"},
		};
		expect(findUnjustifiedRaises(previous, current)).toStrictEqual(["a.bytes"]);
	});

	it("accepts a raise with a reason and raisedAt", () => {
		const current: Ceilings = {
			...previous,
			"a.bytes": {ceiling: 1500, unit: "bytes", tolerance: 0, reason: "bigger fixture", raisedAt: "2026-09-30"},
		};
		expect(findUnjustifiedRaises(previous, current)).toStrictEqual([]);
	});

	it("accepts a lowered ceiling", () => {
		const current: Ceilings = {...previous, "b.ms": {ceiling: 150, unit: "ms", tolerance: 0.1}};
		expect(findUnjustifiedRaises(previous, current)).toStrictEqual([]);
	});

	it("accepts a new key", () => {
		const current: Ceilings = {...previous, "c.count": {ceiling: 5, unit: "count", tolerance: 0}};
		expect(findUnjustifiedRaises(previous, current)).toStrictEqual([]);
	});

	it("accepts a removed key", () => {
		const current: Ceilings = {"b.ms": previous["b.ms"]!};
		expect(findUnjustifiedRaises(previous, current)).toStrictEqual([]);
	});

	it("reports every unjustified raise in key order", () => {
		const current: Ceilings = {
			"a.bytes": {ceiling: 2000, unit: "bytes", tolerance: 0},
			"b.ms": {ceiling: 300, unit: "ms", tolerance: 0.1},
		};
		expect(findUnjustifiedRaises(previous, current)).toStrictEqual(["a.bytes", "b.ms"]);
	});
});

describe("findLargeTierDrift", () => {
	const offsets = {"server.liveAppend.typical.20.sql.count": {"large-long": 2, "large-wide": 0}};
	const ceilings = (typical: number, largeLong: number, largeWide: number): Ceilings => ({
		"server.liveAppend.large-long.20.sql.count": {ceiling: largeLong, unit: "count", tolerance: 0},
		"server.liveAppend.large-wide.20.sql.count": {ceiling: largeWide, unit: "count", tolerance: 0},
		"server.liveAppend.typical.20.sql.count": {ceiling: typical, unit: "count", tolerance: 0},
	});

	it("accepts large-tier ceilings at their pinned offsets from typical", () => {
		expect(findLargeTierDrift(ceilings(23, 25, 23), offsets)).toStrictEqual([]);
	});

	it("reports the large-tier ceilings left behind when the typical ceiling moves", () => {
		expect(findLargeTierDrift(ceilings(22, 25, 23), offsets)).toStrictEqual([
			"server.liveAppend.large-long.20.sql.count is 25, typical + 3; LARGE_TIER_OFFSETS pins typical + 2",
			"server.liveAppend.large-wide.20.sql.count is 23, typical + 1; LARGE_TIER_OFFSETS pins typical + 0",
		]);
	});

	it("reports a large-tier ceiling that moves alone", () => {
		expect(findLargeTierDrift(ceilings(23, 25, 24), offsets)).toStrictEqual([
			"server.liveAppend.large-wide.20.sql.count is 24, typical + 1; LARGE_TIER_OFFSETS pins typical + 0",
		]);
	});

	it("reports a pinned id missing from the ceilings", () => {
		const {"server.liveAppend.large-wide.20.sql.count": _removed, ...rest} = ceilings(23, 25, 23);
		expect(findLargeTierDrift(rest, offsets)).toStrictEqual([
			"server.liveAppend.large-wide.20.sql.count has no ceiling",
		]);
	});
});

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function git(...args: string[]): string | undefined {
	try {
		return runGit(REPO_ROOT, args);
	} catch {
		return undefined;
	}
}

const baseRef = git("merge-base", "HEAD", "@{upstream}")?.trim() || "HEAD~1";
const baseCeilingsJson = git("show", `${baseRef}:tests/perf/ceilings.json`);

describe("tests/perf/ceilings.json", () => {
	it.skipIf(baseCeilingsJson === undefined)(`justifies every raise since ${baseRef}`, () => {
		const current = loadCeilings(readFileSync(join(REPO_ROOT, "tests", "perf", "ceilings.json"), "utf8"));
		expect(findUnjustifiedRaises(loadCeilings(baseCeilingsJson!), current)).toStrictEqual([]);
	});
});

describe("tests/perf/ceilings.json large tier", () => {
	// PERF_LARGE=1 only runs in merge-group CI, so this catches a commit that moves the typical ceilings and not the
	// large ones. When it fails, measure with `PERF_LARGE=1 just perf tests/perf/server-` and update the large-tier
	// ceilings, or LARGE_TIER_OFFSETS when the change moves large and typical by different amounts.
	it("keeps every shape-coupled large-tier ceiling at its pinned offset from typical", () => {
		expect(findLargeTierDrift(loadCeilings(), LARGE_TIER_OFFSETS)).toStrictEqual([]);
	});
});
