import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../../src/lib/db/connection";
import * as schema from "../../src/lib/db/schema";
import {indexJsonlFile} from "../../src/lib/db/indexer";
import {scanPendingApproval} from "../../src/lib/pending-approvals";
import {readNewJsonlLines, readSession, readSessionRawWindow} from "../../src/lib/sessions";
import {readStructuredTranscript} from "../../src/lib/structured-transcript";
import {currentPerfCounters, withPerfScope} from "../../src/lib/perf/server-scope";
import {trackedCreateReadStream, trackedReadFileSync} from "../../src/lib/perf/tracked-fs";

const SESSION_ID = "0b6f2b4e-1111-4222-8333-944455556666";
const PROJECT = "-tmp-tracked-fs-project";

let tempDir: string;
let projectsDir: string;
let filePath: string;
let db: AppDb;

function userRecord(index: number): Record<string, unknown> {
	return {
		type: "user",
		uuid: `u-${index}`,
		parentUuid: index === 0 ? null : `u-${index - 1}`,
		sessionId: SESSION_ID,
		timestamp: `2026-09-30T00:00:${String(index).padStart(2, "0")}.000Z`,
		cwd: "/tmp/tracked-fs-project",
		message: {role: "user", content: `message ${index}`},
	};
}

function writeTranscript(count: number): number {
	const records = Array.from({length: count}, (_, i) => JSON.stringify(userRecord(i)));
	writeFileSync(filePath, records.join("\n") + "\n");
	return statSync(filePath).size;
}

async function jsonlCounters<T>(fn: () => T | Promise<T>): Promise<{bytesRead: number; fullScans: number}> {
	return withPerfScope("tracked-fs-test", async () => {
		await fn();
		const counters = currentPerfCounters();
		return {...counters!.jsonl};
	});
}

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "tracked-fs-test-"));
	projectsDir = join(tempDir, "projects");
	mkdirSync(join(projectsDir, PROJECT), {recursive: true});
	filePath = join(projectsDir, PROJECT, `${SESSION_ID}.jsonl`);
	db = openTestDb();
});

afterEach(() => {
	db.close();
	rmSync(tempDir, {recursive: true, force: true});
});

describe("tracked read helpers", () => {
	it("trackedReadFileSync counts every byte and one full scan", async () => {
		const size = writeTranscript(3);
		let text = "";
		const counters = await jsonlCounters(() => {
			text = trackedReadFileSync(filePath);
		});
		expect(counters).toStrictEqual({bytesRead: size, fullScans: 1});
		expect(Buffer.byteLength(text)).toBe(size);
	});

	it("trackedCreateReadStream from a mid-file offset counts only the tail and no full scan", async () => {
		const size = writeTranscript(3);
		const counters = await jsonlCounters(async () => {
			const stream = trackedCreateReadStream(filePath, {encoding: "utf-8", start: 10});
			for await (const _chunk of stream) {
				// drain
			}
		});
		expect(counters).toStrictEqual({bytesRead: size - 10, fullScans: 0});
	});

	it("does nothing outside a perf scope", async () => {
		writeTranscript(3);
		expect(trackedReadFileSync(filePath).length).toBeGreaterThan(0);
		expect(currentPerfCounters()).toBeUndefined();
	});
});

describe("JSONL read sites", () => {
	it("readSession reads the whole file once", async () => {
		const size = writeTranscript(5);
		const counters = await jsonlCounters(() => readSession(projectsDir, SESSION_ID));
		expect(counters).toStrictEqual({bytesRead: size, fullScans: 1});
	});

	it("readSessionRawWindow scanning to EOF counts a full scan", async () => {
		const size = writeTranscript(5);
		const counters = await jsonlCounters(() => readSessionRawWindow(projectsDir, SESSION_ID, "missing-uuid"));
		expect(counters).toStrictEqual({bytesRead: size, fullScans: 1});
	});

	it("readNewJsonlLines from offset 0 counts a full scan", async () => {
		const size = writeTranscript(5);
		const counters = await jsonlCounters(() => readNewJsonlLines(filePath, 0));
		expect(counters).toStrictEqual({bytesRead: size, fullScans: 1});
	});

	it("readNewJsonlLines from a mid-file offset counts only the tail bytes", async () => {
		writeTranscript(3);
		const offset = statSync(filePath).size;
		const records = [3, 4].map((i) => JSON.stringify(userRecord(i)));
		writeFileSync(filePath, records.join("\n") + "\n", {flag: "a"});
		const size = statSync(filePath).size;

		const counters = await jsonlCounters(() => readNewJsonlLines(filePath, offset));
		expect(counters).toStrictEqual({bytesRead: size - offset, fullScans: 0});
	});

	it("readStructuredTranscript reads the whole file once", async () => {
		const size = writeTranscript(5);
		db.index
			.insert(schema.sessions)
			.values({id: SESSION_ID, projectId: PROJECT, title: SESSION_ID, createdAt: 0, mtimeMs: 0, filePath})
			.run();
		const counters = await jsonlCounters(() => readStructuredTranscript(db.index, SESSION_ID));
		expect(counters).toStrictEqual({bytesRead: size, fullScans: 1});
	});

	it("indexJsonlFile reads the whole file once", async () => {
		const size = writeTranscript(5);
		const counters = await jsonlCounters(() => indexJsonlFile(db.index, filePath, PROJECT));
		expect(counters).toStrictEqual({bytesRead: size, fullScans: 1});
	});

	it("scanPendingApproval reads the whole file once", async () => {
		const size = writeTranscript(5);
		const counters = await jsonlCounters(() => scanPendingApproval(filePath));
		expect(counters).toStrictEqual({bytesRead: size, fullScans: 1});
	});
});
