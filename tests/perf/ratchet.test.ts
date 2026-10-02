import {spawn} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	createRatchet,
	currentTree,
	DIAGNOSTIC_FAMILIES,
	diagnosticFamily,
	loadCeilings,
	readResults as readStampedResults,
	type Ceilings,
} from "./ratchet";

const ceilings: Ceilings = {
	"server.sessionOpen.large-wide.detail.jsonl.bytesRead": {ceiling: 1000, unit: "bytes", tolerance: 0},
	"lab.sessionSwitch.typical.inp": {ceiling: 200, unit: "ms", tolerance: 0.1},
};

const tree = "tree-a";

let dir: string;
let resultsPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ccb-ratchet-"));
	resultsPath = join(dir, "nested", "results.json");
});

afterEach(() => {
	rmSync(dir, {recursive: true, force: true});
});

function readResultsFile(path: string): unknown {
	const file: unknown = JSON.parse(readFileSync(path, "utf8"));
	expect(file).toMatchObject({tree});
	return (file as {results: unknown}).results;
}

function readResults(): unknown {
	return readResultsFile(resultsPath);
}

describe("ratchet", () => {
	it("passes when the value equals the ceiling", () => {
		const ratchet = createRatchet({ceilings, resultsPath, tree});
		expect(() => ratchet("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 1000)).not.toThrow();
	});

	it("fails with the rise message when the value is above the ceiling", () => {
		const ratchet = createRatchet({ceilings, resultsPath, tree});
		expect(() => ratchet("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 1001)).toThrow(
			"server.sessionOpen.large-wide.detail.jsonl.bytesRead rose from 1000 to 1001; fix the regression or raise the ceiling with a reason",
		);
	});

	it("fails with the lower-the-ceiling message when the value is below the ceiling", () => {
		const ratchet = createRatchet({ceilings, resultsPath, tree});
		expect(() => ratchet("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 999)).toThrow(
			"server.sessionOpen.large-wide.detail.jsonl.bytesRead improved from 1000 to 999; lower the ceiling in tests/perf/ceilings.json in this same commit",
		);
	});

	it("passes within tolerance in both directions", () => {
		const ratchet = createRatchet({ceilings, resultsPath, tree});
		expect(() => ratchet("lab.sessionSwitch.typical.inp", 220)).not.toThrow();
		expect(() => ratchet("lab.sessionSwitch.typical.inp", 180)).not.toThrow();
	});

	it("fails just outside tolerance in both directions", () => {
		const ratchet = createRatchet({ceilings, resultsPath, tree});
		expect(() => ratchet("lab.sessionSwitch.typical.inp", 221)).toThrow(
			"lab.sessionSwitch.typical.inp rose from 200 to 221; fix the regression or raise the ceiling with a reason",
		);
		expect(() => ratchet("lab.sessionSwitch.typical.inp", 179)).toThrow(
			"lab.sessionSwitch.typical.inp improved from 200 to 179; lower the ceiling in tests/perf/ceilings.json in this same commit",
		);
	});

	it("fails for an id missing from the ceilings", () => {
		const ratchet = createRatchet({ceilings, resultsPath, tree});
		expect(() => ratchet("client.unknown.metric", 5)).toThrow(
			"client.unknown.metric has no ceiling; add it to tests/perf/ceilings.json",
		);
	});

	it("records every measurement to results.json, including failing and unknown ones", () => {
		const ratchet = createRatchet({ceilings, resultsPath, tree});
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
		const first = createRatchet({ceilings, resultsPath, tree});
		first("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 1000);
		const second = createRatchet({ceilings, resultsPath, tree});
		expect(() => second("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 1200)).toThrow();
		second("lab.sessionSwitch.typical.inp", 200);
		expect(readResults()).toStrictEqual({
			"lab.sessionSwitch.typical.inp": {value: 200, unit: "ms"},
			"server.sessionOpen.large-wide.detail.jsonl.bytesRead": {value: 1200, unit: "bytes"},
		});
	});
});

describe("diagnostics", () => {
	const diagnostics = {
		"hot.slowPath.<shape>.calls": {unit: "calls", reason: "ρ 0.4 against wall time"},
	};

	function readDiagnostics(): unknown {
		return readResultsFile(join(dir, "nested", "diagnostics.json"));
	}

	it("records a diagnostic id to diagnostics.json without a ceiling and leaves results.json alone", () => {
		const ratchet = createRatchet({ceilings, resultsPath, tree, diagnostics});
		ratchet("hot.slowPath.typical.calls", 640);
		ratchet("hot.slowPath.large-wide.calls", 360);
		ratchet("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 1000);
		expect({diagnostics: readDiagnostics(), results: readResults()}).toStrictEqual({
			diagnostics: {
				"hot.slowPath.large-wide.calls": {value: 360, unit: "calls"},
				"hot.slowPath.typical.calls": {value: 640, unit: "calls"},
			},
			results: {"server.sessionOpen.large-wide.detail.jsonl.bytesRead": {value: 1000, unit: "bytes"}},
		});
	});

	it("fails for a diagnostic id that still has a ceiling", () => {
		const ratchet = createRatchet({
			ceilings: {"hot.slowPath.typical.calls": {ceiling: 640, unit: "calls", tolerance: 0}},
			resultsPath,
			tree,
			diagnostics,
		});
		expect(() => ratchet("hot.slowPath.typical.calls", 640)).toThrow(
			"hot.slowPath.typical.calls is a diagnostic (ρ 0.4 against wall time); remove its ceiling from tests/perf/ceilings.json",
		);
	});

	it("matches the shape placeholder against exactly one id segment", () => {
		expect([
			diagnosticFamily("hot.slowPath.large-long.calls", diagnostics),
			diagnosticFamily("hot.slowPath.calls", diagnostics),
			diagnosticFamily("hot.slowPath.a.b.calls", diagnostics),
			diagnosticFamily("hot.fastPath.typical.calls", diagnostics),
		]).toStrictEqual(["hot.slowPath.<shape>.calls", undefined, undefined, undefined]);
	});

	it("has no ceilings for the checked-in diagnostic families", () => {
		expect(Object.keys(loadCeilings()).filter((id) => diagnosticFamily(id, DIAGNOSTIC_FAMILIES))).toStrictEqual([]);
	});
});

function runRecorder(script: string, worker: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [script, resultsPath, String(worker)], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`recorder ${worker} exited with ${code}: ${stderr}`));
			}
		});
	});
}

describe("concurrent recording", () => {
	it("keeps results.json parseable and holds every id when several processes record at once", async () => {
		const workers = 6;
		const idsPerWorker = 40;
		const script = join(dir, "recorder.mjs");
		const ratchetUrl = pathToFileURL(join(import.meta.dirname, "ratchet.ts")).href;
		writeFileSync(
			script,
			`import {createRatchet} from ${JSON.stringify(ratchetUrl)};
const [resultsPath, worker] = process.argv.slice(2);
const ratchet = createRatchet({ceilings: {}, resultsPath, tree: ${JSON.stringify(tree)}});
for (let index = 0; index < ${idsPerWorker}; index++) {
	try {
		ratchet(\`w\${worker}.m\${String(index).padStart(2, "0")}\`, index);
	} catch (error) {
		if (!String(error).includes("has no ceiling")) throw error;
	}
}
`,
		);
		await Promise.all(Array.from({length: workers}, (_, worker) => runRecorder(script, worker)));
		const expected = Object.fromEntries(
			Array.from({length: workers}, (_, worker) =>
				Array.from({length: idsPerWorker}, (_, index) => [
					`w${worker}.m${String(index).padStart(2, "0")}`,
					{value: index},
				]),
			).flat(),
		);
		expect(readResults()).toStrictEqual(expected);
	});
});

describe("results written by another tree", () => {
	function writeRaw(path: string, contents: unknown): void {
		mkdirSync(join(dir, "nested"), {recursive: true});
		writeFileSync(path, `${JSON.stringify(contents)}\n`);
	}

	const staleFiles: Record<string, unknown> = {
		"another tree": {
			tree: "tree-b",
			results: {"hot.slowPath.typical.calls": {value: 1, unit: "calls", diagnostic: true}},
		},
		"the older unstamped format": {"hot.slowPath.typical.calls": {value: 1, unit: "calls", diagnostic: true}},
		"a non-object": [1, 2, 3],
	};

	for (const [name, contents] of Object.entries(staleFiles)) {
		it(`reads a results file from ${name} as empty`, () => {
			writeRaw(resultsPath, contents);
			expect(readStampedResults(resultsPath, tree)).toStrictEqual({});
		});

		it(`starts results.json and diagnostics.json afresh over a file from ${name}`, () => {
			const diagnosticsPath = join(dir, "nested", "diagnostics.json");
			writeRaw(resultsPath, contents);
			writeRaw(diagnosticsPath, contents);
			const ratchet = createRatchet({
				ceilings,
				resultsPath,
				tree,
				diagnostics: {"hot.slowPath.<shape>.calls": {unit: "calls", reason: "ρ 0.4 against wall time"}},
			});
			ratchet("server.sessionOpen.large-wide.detail.jsonl.bytesRead", 1000);
			ratchet("hot.slowPath.typical.calls", 640);
			expect({
				results: JSON.parse(readFileSync(resultsPath, "utf8")),
				diagnostics: JSON.parse(readFileSync(diagnosticsPath, "utf8")),
			}).toStrictEqual({
				results: {
					tree,
					results: {"server.sessionOpen.large-wide.detail.jsonl.bytesRead": {value: 1000, unit: "bytes"}},
				},
				diagnostics: {tree, results: {"hot.slowPath.typical.calls": {value: 640, unit: "calls"}}},
			});
		});
	}

	it("still rejects an unknown field in a results file stamped with this tree", () => {
		writeRaw(resultsPath, {tree, results: {"a.b": {value: 1, diagnostic: true}}});
		expect(() => readStampedResults(resultsPath, tree)).toThrow();
	});

	it("stamps with the git tree of HEAD", () => {
		expect(currentTree()).toMatch(/^[0-9a-f]{40,64}$/);
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
