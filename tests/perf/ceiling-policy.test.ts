import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vite-plus/test";
import {findUnjustifiedRaises} from "./ceiling-policy";
import {loadCeilings, type Ceilings} from "./ratchet";

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

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function git(...args: string[]): string | undefined {
	try {
		return execFileSync("git", args, {cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
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
