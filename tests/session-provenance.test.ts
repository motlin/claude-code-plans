import {appendFileSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {currentPerfCounters, withPerfScope} from "../src/lib/perf/server-scope";
import {readSessionProvenance, resetSessionProvenanceCache} from "../src/lib/session-provenance";

const testDir = join(tmpdir(), `session-provenance-test-${process.pid}`);

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
	resetSessionProvenanceCache();
});

afterEach(() => {
	rmSync(testDir, {recursive: true, force: true});
});

function jsonl(...lines: Record<string, unknown>[]): string {
	return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

function user(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {type: "user", message: {role: "user", content: text}, ...extra};
}

function assistant(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {type: "assistant", message: {role: "assistant", content: [{type: "text", text}]}, ...extra};
}

async function measured<T>(fn: () => Promise<T>): Promise<{value: T; fullScans: number; bytesRead: number}> {
	return withPerfScope("test", async () => {
		const value = await fn();
		const counters = currentPerfCounters()!;
		return {value, fullScans: counters.jsonl.fullScans, bytesRead: counters.jsonl.bytesRead};
	});
}

describe("readSessionProvenance", () => {
	it("reads the first entrypoint, sessionKind and forkedFrom, every teamName and the latest valid cost-state", async () => {
		const file = join(testDir, "prov.jsonl");
		writeFileSync(
			file,
			jsonl(
				{type: "cost-state", totalCostUSD: 1, totalLinesAdded: 1},
				user("Hello", {
					entrypoint: "sdk-cli",
					sessionKind: "bg",
					teamName: "alpha",
					forkedFrom: {sessionId: "parent-abc"},
				}),
				assistant("Hi", {teamName: "beta"}),
				{type: "cost-state", totalCostUSD: "malformed"},
				{type: "cost-state", totalCostUSD: 2.5, totalLinesAdded: 10, totalLinesRemoved: 4},
				user("Again", {entrypoint: "sdk-ts", teamName: "alpha", forkedFrom: "ignored-second"}),
				// Nested mentions are not the record's own fields.
				user('{"entrypoint":"nested","teamName":"nested"}'),
			),
		);

		expect(await readSessionProvenance(file)).toStrictEqual({
			entrypoint: "sdk-cli",
			sessionKind: "bg",
			teamNames: ["alpha", "beta"],
			forkedFromSessionId: "parent-abc",
			costState: {totalCostUSD: 2.5, linesAdded: 10, linesRemoved: 4, hasUnknownModelCost: false, models: []},
		});
	});

	it("reads forkedFrom as a plain string", async () => {
		const file = join(testDir, "fork.jsonl");
		writeFileSync(file, jsonl(user("Hi", {forkedFrom: "str-parent"})));

		expect(await readSessionProvenance(file)).toStrictEqual({forkedFromSessionId: "str-parent"});
	});

	it("is empty when the transcript carries none of them", async () => {
		const file = join(testDir, "plain.jsonl");
		writeFileSync(file, jsonl(user("Hi"), assistant("Hello")));

		expect(await readSessionProvenance(file)).toStrictEqual({});
	});

	it("rereads only the appended bytes of a transcript it already read", async () => {
		const file = join(testDir, "live.jsonl");
		writeFileSync(
			file,
			jsonl(user("Hi", {entrypoint: "cli", teamName: "alpha"}), {type: "cost-state", totalCostUSD: 1}),
		);
		const first = await measured(async () => readSessionProvenance(file));
		const unchanged = await measured(async () => readSessionProvenance(file));
		const appended = jsonl(assistant("More", {teamName: "beta"}), {type: "cost-state", totalCostUSD: 3});
		appendFileSync(file, appended);
		const grown = await measured(async () => readSessionProvenance(file));

		expect({
			first: first.fullScans,
			unchanged: {fullScans: unchanged.fullScans, value: unchanged.value},
			grown: {
				fullScans: grown.fullScans,
				readsOnlyTheAppend: grown.bytesRead < Buffer.byteLength(appended) + 100,
				value: grown.value,
			},
		}).toStrictEqual({
			first: 1,
			unchanged: {fullScans: 0, value: first.value},
			grown: {
				fullScans: 0,
				readsOnlyTheAppend: true,
				value: {
					entrypoint: "cli",
					teamNames: ["alpha", "beta"],
					costState: {
						totalCostUSD: 3,
						linesAdded: 0,
						linesRemoved: 0,
						hasUnknownModelCost: false,
						models: [],
					},
				},
			},
		});
	});

	it("is empty for a transcript that does not exist", async () => {
		expect(await readSessionProvenance(join(testDir, "missing.jsonl"))).toStrictEqual({});
	});
});
