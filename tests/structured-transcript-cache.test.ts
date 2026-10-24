import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {appendFileSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {currentPerfCounters, withPerfScope} from "../src/lib/perf/server-scope";
import {readStructuredTranscript} from "../src/lib/structured-transcript";
import {computeAbandoned} from "../src/lib/transcript-chain";

/**
 * The whole-file chain behind every transcript window is cached per file, so a
 * `before` page or a live refetch parses only the window it serves (and, after
 * an append, only the appended lines).
 */

vi.mock("../src/lib/transcript-chain", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/lib/transcript-chain")>();
	return {...actual, computeAbandoned: vi.fn<typeof actual.computeAbandoned>(actual.computeAbandoned)};
});

const SESSION_ID = "cache-session";

let tempDir: string;
let filePath: string;
let db: AppDb;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "structured-transcript-cache-test-"));
	filePath = join(tempDir, `${SESSION_ID}.jsonl`);
	db = openTestDb();
	db.index
		.insert(schema.sessions)
		.values({id: SESSION_ID, projectId: "test-project", title: SESSION_ID, createdAt: 0, mtimeMs: 0, filePath})
		.run();
	vi.mocked(computeAbandoned).mockClear();
});

afterEach(() => {
	db.close();
	rmSync(tempDir, {recursive: true, force: true});
});

function user(uuid: string, parentUuid: string | null, content: string): Record<string, unknown> {
	return {type: "user", uuid, parentUuid, timestamp: "2026-10-20T10:00:00.000Z", message: {role: "user", content}};
}

function assistant(uuid: string, parentUuid: string): Record<string, unknown> {
	return {type: "assistant", uuid, parentUuid, message: {role: "assistant", content: [{type: "text", text: uuid}]}};
}

function toJsonl(records: unknown[]): string {
	return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function linear(count: number): Record<string, unknown>[] {
	return Array.from({length: count}, (_, i) =>
		i % 2 === 0 ? user(`u-${i}`, i === 0 ? null : `u-${i - 1}`, `prompt ${i}`) : assistant(`u-${i}`, `u-${i - 1}`),
	);
}

function jsonlCounters<T>(fn: () => T): {result: T; bytesRead: number; fullScans: number} {
	return withPerfScope("structured-transcript-cache-test", () => {
		const result = fn();
		const counters = currentPerfCounters();
		return {result, ...counters!.jsonl};
	});
}

/** Bump the mtime so an in-place rewrite is distinguishable from the cached version. */
function touchLater(): void {
	const later = new Date(statSync(filePath).mtimeMs + 10_000);
	utimesSync(filePath, later, later);
}

describe("readStructuredTranscript chain cache", () => {
	it("computes the chain once for two window requests on an unchanged file", () => {
		writeFileSync(filePath, toJsonl(linear(10)));

		const tail = readStructuredTranscript(db.index, SESSION_ID, {maxRecords: 3});
		const page = readStructuredTranscript(db.index, SESSION_ID, {before: tail.startIndex, maxRecords: 3});

		expect(vi.mocked(computeAbandoned)).toHaveBeenCalledTimes(1);
		expect(tail.records).toStrictEqual(linear(10).slice(7));
		expect(page.records).toStrictEqual(linear(10).slice(4, 7));
		expect(page.startIndex).toBe(4);
		expect(page.precedingMessageCount).toBe(4);
	});

	it("reads only the served window's bytes once the file is cached", () => {
		const records = linear(10);
		writeFileSync(filePath, toJsonl(records));
		readStructuredTranscript(db.index, SESSION_ID);

		const {result, bytesRead, fullScans} = jsonlCounters(() =>
			readStructuredTranscript(db.index, SESSION_ID, {before: 9, maxRecords: 2}),
		);

		expect(result.records).toStrictEqual(records.slice(7, 9));
		expect({bytesRead, fullScans}).toStrictEqual({
			bytesRead: Buffer.byteLength(toJsonl(records.slice(7, 9))) - 1,
			fullScans: 0,
		});
	});

	it("extends the cached chain from the old end on append, reading only the appended bytes and the window", () => {
		const records = linear(6);
		writeFileSync(filePath, toJsonl(records));
		readStructuredTranscript(db.index, SESSION_ID);

		const appended = [user("u-6", "u-5", "prompt 6")];
		appendFileSync(filePath, toJsonl(appended));
		const {result, bytesRead, fullScans} = jsonlCounters(() =>
			readStructuredTranscript(db.index, SESSION_ID, {maxRecords: 1}),
		);

		const appendedBytes = Buffer.byteLength(toJsonl(appended));
		expect(result.records).toStrictEqual(appended);
		expect(result.startIndex).toBe(6);
		expect(result.precedingMessageCount).toBe(6);
		expect(result.byteOffset).toBe(statSync(filePath).size);
		// The appended bytes plus the byte before them, which proves the cached
		// prefix still ends on a line break, then the one-line window without its
		// line break.
		expect({bytesRead, fullScans}).toStrictEqual({bytesRead: 1 + appendedBytes + appendedBytes - 1, fullScans: 0});
	});

	it("re-derives the hidden set when an append forks the chain", () => {
		writeFileSync(
			filePath,
			toJsonl([user("u-0", null, "first"), assistant("u-1", "u-0"), user("a-0", "u-1", "abandoned")]),
		);
		const before = readStructuredTranscript(db.index, SESSION_ID);
		expect(before.hiddenUuids).toStrictEqual([]);

		appendFileSync(filePath, toJsonl([user("r", "u-1", "replacement")]));
		const after = readStructuredTranscript(db.index, SESSION_ID);

		expect(after.hiddenUuids).toStrictEqual(["a-0"]);
		expect(after.cuts).toStrictEqual([
			{parentUuid: "u-1", replacementUuid: "r", at: "2026-10-20T10:00:00.000Z", count: 1},
		]);
		expect(after.chainVersion).not.toBe(before.chainVersion);
	});

	it("completes a trailing line that had no newline when the rest of it is appended", () => {
		const first = JSON.stringify(user("u-0", null, "first"));
		const second = JSON.stringify(user("u-1", "u-0", "second"));
		writeFileSync(filePath, `${first}\n${second.slice(0, 10)}`);
		expect(readStructuredTranscript(db.index, SESSION_ID).records).toStrictEqual([user("u-0", null, "first")]);

		appendFileSync(filePath, `${second.slice(10)}\n`);
		const transcript = readStructuredTranscript(db.index, SESSION_ID);

		expect(transcript.records).toStrictEqual([user("u-0", null, "first"), user("u-1", "u-0", "second")]);
	});

	it("rebuilds when the file is rewritten in place", () => {
		writeFileSync(filePath, toJsonl(linear(4)));
		readStructuredTranscript(db.index, SESSION_ID);

		const rewritten = linear(4).map((record) => ({...record, uuid: String(record["uuid"]).replace("u", "w")}));
		writeFileSync(filePath, toJsonl(rewritten));
		touchLater();
		const transcript = readStructuredTranscript(db.index, SESSION_ID);

		expect(transcript.records).toStrictEqual(rewritten);
		expect(vi.mocked(computeAbandoned)).toHaveBeenCalledTimes(2);
	});

	it("rebuilds when the file shrinks", () => {
		writeFileSync(filePath, toJsonl(linear(6)));
		readStructuredTranscript(db.index, SESSION_ID);

		writeFileSync(filePath, toJsonl(linear(2)));
		touchLater();

		expect(readStructuredTranscript(db.index, SESSION_ID).records).toStrictEqual(linear(2));
	});
});
