import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {coalescePerKey, forEachTranscriptLine} from "../src/lib/transcript-stream";

describe("forEachTranscriptLine", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "transcript-stream-"));
	});

	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	async function linesOf(path: string, chunkBytes?: number): Promise<string[]> {
		const lines: string[] = [];
		await forEachTranscriptLine(
			path,
			(line) => {
				lines.push(line);
			},
			chunkBytes,
		);
		return lines;
	}

	it("yields every non-blank line, without api-request records, across chunk boundaries", async () => {
		const path = join(root, "session.jsonl");
		const apiRequest = JSON.stringify({type: "api-request", body: "x".repeat(5000)});
		writeFileSync(
			path,
			[
				'{"type":"user","uuid":"u1"}',
				apiRequest,
				"",
				'{"type":"assistant","uuid":"a1","text":"é"}',
				`{"type":"user","uuid":"u2","note":"mentions {\\"type\\":\\"api-request\\","}`,
				'{"type":"system"}',
			].join("\n"),
		);

		expect(await linesOf(path, 7)).toStrictEqual([
			'{"type":"user","uuid":"u1"}',
			'{"type":"assistant","uuid":"a1","text":"é"}',
			`{"type":"user","uuid":"u2","note":"mentions {\\"type\\":\\"api-request\\","}`,
			'{"type":"system"}',
		]);
	});

	it("rejects when the file is missing", async () => {
		await expect(linesOf(join(root, "missing.jsonl"))).rejects.toThrow("ENOENT");
	});
});

describe("coalescePerKey", () => {
	function deferred(): {promise: Promise<void>; resolve: () => void} {
		let resolve = () => {};
		const promise = new Promise<void>((settle) => {
			resolve = settle;
		});
		return {promise, resolve};
	}

	it("runs a key at most once at a time, folding every caller that arrives mid-run into one follow-up run", async () => {
		const gates = [deferred(), deferred()];
		let runs = 0;
		const read = coalescePerKey(async (key: string) => {
			const run = runs++;
			await gates[run]?.promise;
			return `${key}#${run}`;
		});

		const first = read("a");
		const during = [read("a"), read("a"), read("a")];
		expect(runs).toBe(1);
		gates[0]?.resolve();
		expect(await first).toBe("a#0");
		gates[1]?.resolve();

		expect(await Promise.all(during)).toStrictEqual(["a#1", "a#1", "a#1"]);
		expect(runs).toBe(2);
	});

	it("runs different keys independently and starts afresh once a key is idle", async () => {
		let runs = 0;
		const read = coalescePerKey(async (key: string) => Promise.resolve(`${key}#${runs++}`));

		expect(await Promise.all([read("a"), read("b")])).toStrictEqual(["a#0", "b#1"]);
		expect(await read("a")).toBe("a#2");
	});

	it("still runs the follow-up after the running call rejects", async () => {
		let runs = 0;
		const read = coalescePerKey(async (key: string) => {
			runs++;
			if (runs === 1) throw new Error("boom");
			return Promise.resolve(key);
		});

		const first = read("a");
		const second = read("a");

		await expect(first).rejects.toThrow("boom");
		expect(await second).toBe("a");
	});
});
