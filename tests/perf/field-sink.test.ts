import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import type {JourneySample} from "../../src/lib/perf/journey";
import {handlePerfBeacon} from "../../src/lib/perf/field-sink";

const NOW = new Date("2026-10-01T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

let cacheDir: string;

beforeEach(() => {
	cacheDir = mkdtempSync(join(tmpdir(), "perf-field-sink-test-"));
});

afterEach(() => {
	rmSync(cacheDir, {recursive: true, force: true});
});

function sample(overrides: Partial<JourneySample> = {}): JourneySample {
	return {
		journey: "J3",
		trigger: "click",
		start: 100,
		end: 250,
		duration: 150,
		endSource: "raf",
		route: "/session/session-test-100",
		sizeBucket: "M",
		buildSha: "abc1234",
		mode: "prod",
		origin: "remote",
		formFactor: "phone",
		hardwareConcurrency: 8,
		resources: [
			{
				name: "http://localhost/api/sessions/session-test-100",
				initiatorType: "fetch",
				startTime: 110,
				duration: 40,
				requestStart: 112,
				responseStart: 140,
				responseEnd: 150,
				transferSize: 2048,
				serverTiming: [{name: "db", duration: 5, description: "sqlite"}],
			},
		],
		longAnimationFrames: [
			{
				startTime: 160,
				duration: 60,
				blockingDuration: 10,
				scripts: [{invoker: "click", sourceURL: "app.js", sourceFunctionName: "render", duration: 30}],
			},
		],
		layoutShifts: [{startTime: 200, value: 0.05, hadRecentInput: false}],
		cls: 0.05,
		events: [
			{name: "click", startTime: 100, duration: 48, processingStart: 105, processingEnd: 120, interactionId: 7},
		],
		...overrides,
	};
}

function beaconRequest(body: unknown, headers: HeadersInit = {"Sec-Fetch-Site": "same-origin"}): Request {
	return new Request("http://localhost:7526/api/perf", {
		method: "POST",
		headers: {"Content-Type": "text/plain;charset=UTF-8", ...headers},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

function perfDir(): string {
	return join(cacheDir, "perf");
}

function readLog(name: string): unknown[] {
	return readFileSync(join(perfDir(), name), "utf8")
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => JSON.parse(line) as unknown);
}

async function describeResponse(response: Response): Promise<{status: number; body: string}> {
	return {status: response.status, body: await response.text()};
}

describe("POST /api/perf field sink", () => {
	it("appends each sample of a valid batch as one JSONL line in today's file", async () => {
		const first = sample();
		const second = sample({journey: "J1", origin: "localhost", formFactor: "desktop", endSource: "element-timing"});

		const responses = [
			await describeResponse(
				await handlePerfBeacon(beaconRequest({samples: [first]}), {cacheDir, now: () => NOW}),
			),
			await describeResponse(
				await handlePerfBeacon(beaconRequest({samples: [second]}), {cacheDir, now: () => NOW}),
			),
		];

		expect({responses, files: readdirSync(perfDir()), lines: readLog("field-2026-10-01.jsonl")}).toStrictEqual({
			responses: [
				{status: 204, body: ""},
				{status: 204, body: ""},
			],
			files: ["field-2026-10-01.jsonl"],
			lines: [first, second],
		});
	});

	it("rejects a sample with an unknown key with 400 and writes nothing", async () => {
		const response = await handlePerfBeacon(beaconRequest({samples: [{...sample(), surprise: true}]}), {
			cacheDir,
			now: () => NOW,
		});

		expect({status: response.status, perfDirExists: existsSync(perfDir())}).toStrictEqual({
			status: 400,
			perfDirExists: false,
		});
	});

	it.each([
		{name: "an unknown top-level key", body: {samples: [sample()], extra: 1}},
		{name: "an unknown origin bucket", body: {samples: [{...sample(), origin: "lan"}]}},
		{name: "an unknown formFactor bucket", body: {samples: [{...sample(), formFactor: "tablet"}]}},
		{name: "a missing formFactor", body: {samples: [{...sample(), formFactor: undefined}]}},
		{name: "malformed JSON", body: "{not json"},
	])("rejects $name with 400", async ({body}) => {
		const response = await handlePerfBeacon(beaconRequest(body), {cacheDir, now: () => NOW});

		expect({status: response.status, perfDirExists: existsSync(perfDir())}).toStrictEqual({
			status: 400,
			perfDirExists: false,
		});
	});

	it("rejects a cross-origin request with 403 and writes nothing", async () => {
		const response = await handlePerfBeacon(
			beaconRequest({samples: [sample()]}, {Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site"}),
			{cacheDir, now: () => NOW},
		);

		expect({
			response: await describeResponse(response),
			perfDirExists: existsSync(perfDir()),
		}).toStrictEqual({
			response: {status: 403, body: JSON.stringify({error: "Forbidden"})},
			perfDirExists: false,
		});
	});

	it("prunes field logs older than 30 days and keeps newer ones and unrelated files", async () => {
		mkdirSync(perfDir(), {recursive: true});
		const files = {
			"field-2026-08-31.jsonl": 31,
			"field-2026-09-02.jsonl": 29,
			"notes.txt": 90,
		};
		for (const [name, ageDays] of Object.entries(files)) {
			const path = join(perfDir(), name);
			writeFileSync(path, "{}\n");
			const mtime = new Date(NOW.getTime() - ageDays * DAY_MS);
			utimesSync(path, mtime, mtime);
		}

		const response = await handlePerfBeacon(beaconRequest({samples: [sample()]}), {cacheDir, now: () => NOW});

		expect({status: response.status, files: readdirSync(perfDir()).sort()}).toStrictEqual({
			status: 204,
			files: ["field-2026-09-02.jsonl", "field-2026-10-01.jsonl", "notes.txt"],
		});
	});
});
