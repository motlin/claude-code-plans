import {afterEach, describe, expect, it} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {GENERATOR_VERSION, perfShapes} from "./fixtures/generate-transcript";
import {shapeMetricIds} from "./perf-ids";
import {loadCeilings} from "./ratchet";

const LARGE_SHAPES = ["large-long", "large-wide"] as const;

describe("large perf tier", () => {
	const original = process.env["PERF_LARGE"];

	afterEach(() => {
		if (original === undefined) delete process.env["PERF_LARGE"];
		else process.env["PERF_LARGE"] = original;
	});

	it("runs large-long and large-wide with PERF_LARGE=1", () => {
		process.env["PERF_LARGE"] = "1";
		const names = perfShapes().map((shape) => shape.name);
		expect(LARGE_SHAPES.filter((name) => names.includes(name))).toStrictEqual([...LARGE_SHAPES]);
	});

	it.each(LARGE_SHAPES)("has a ceiling for exactly the ids the perf tests ratchet for %s", (shape) => {
		const ceilingIds = Object.keys(loadCeilings()).filter((id) => id.includes(`.${shape}.`));
		expect(ceilingIds).toStrictEqual(shapeMetricIds(shape).sort());
	});
});

describe("CI workflow", () => {
	const workflow = readFileSync(join(__dirname, "..", "..", ".github", "workflows", "merge-group.yml"), "utf8");
	const testJob = /\n {2}test:\n([\s\S]*?)(?=\n {2}\S)/.exec(workflow)?.[1] ?? "";

	it("runs the large perf tier after just test, with the fixture cache keyed on the generator version", () => {
		const runs = [...testJob.matchAll(/^\s+(?:- )?run: (.+)$/gm)].map((match) => match[1]);
		expect({
			runs: runs.slice(-2),
			cachePath: testJob.includes("path: node_modules/.cache/ccb-perf/fixtures"),
			versionKey: testJob.includes("key: ccb-perf-fixtures-v${{ steps.perf-generator.outputs.version }}"),
			versionStep: testJob.includes("GENERATOR_VERSION"),
		}).toStrictEqual({
			runs: ["just test", "PERF_LARGE=1 just perf"],
			cachePath: true,
			versionKey: true,
			versionStep: true,
		});
		expect(GENERATOR_VERSION).toBeGreaterThan(0);
	});
});
