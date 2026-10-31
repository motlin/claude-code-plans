import {describe, expect, it, beforeEach, afterEach} from "vite-plus/test";
import {appendFileSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {readSessionResources} from "../src/lib/session-resource-scan";

/**
 * The whole-session scan behind `/api/sessions/$id/resources` reads, parses
 * and processes the entire JSONL, which on a 400 MB transcript takes seconds.
 * It must hand the event loop back while it works, so a concurrent `/api/file`
 * is served instead of queueing behind it, and it must not repeat itself for a
 * file that has not changed.
 */

const HOME_ROOT = "/home/testuser";

let tempDir: string;
let db: AppDb;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "session-resource-scan-test-"));
	db = openTestDb();
});

afterEach(() => {
	db.close();
	rmSync(tempDir, {recursive: true, force: true});
});

function userRecord(index: number, text: string): Record<string, unknown> {
	return {type: "user", uuid: `u-${index}`, message: {role: "user", content: text}};
}

function seedSession(sessionId: string, records: unknown[]): string {
	const filePath = join(tempDir, `${sessionId}.jsonl`);
	writeFileSync(filePath, records.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
	db.index
		.insert(schema.sessions)
		.values({id: sessionId, projectId: "test-project", title: sessionId, createdAt: 0, mtimeMs: 0, filePath})
		.run();
	return filePath;
}

describe("readSessionResources", () => {
	it("lets other tasks run while a large scan is in flight", async () => {
		const records = Array.from({length: 5000}, (_, index) =>
			userRecord(index, `Step ${index} touched ${HOME_ROOT}/projects/file-${index % 50}.txt`),
		);
		seedSession("large", records);

		let ticks = 0;
		let ticking = true;
		const tick = (): void => {
			ticks++;
			if (ticking) setImmediate(tick);
		};
		setImmediate(tick);

		const resources = await readSessionResources(db.index, "large", HOME_ROOT, {sliceMs: 0});
		ticking = false;
		const ticksDuringScan = ticks;

		expect({totalCount: resources.files.totalCount, yielded: ticksDuringScan > 10}).toStrictEqual({
			totalCount: 50,
			yielded: true,
		});
	});

	it("scans an unchanged file once, sharing one scan between concurrent callers", async () => {
		seedSession("memo", [userRecord(0, `See ${HOME_ROOT}/projects/a.txt`)]);

		const [first, concurrent] = await Promise.all([
			readSessionResources(db.index, "memo", HOME_ROOT),
			readSessionResources(db.index, "memo", HOME_ROOT),
		]);
		const later = await readSessionResources(db.index, "memo", HOME_ROOT);

		expect({concurrent: concurrent === first, later: later === first}).toStrictEqual({
			concurrent: true,
			later: true,
		});
	});

	it("rescans once the file grows", async () => {
		const filePath = seedSession("grows", [userRecord(0, `See ${HOME_ROOT}/projects/a.txt`)]);
		const before = await readSessionResources(db.index, "grows", HOME_ROOT);

		appendFileSync(filePath, JSON.stringify(userRecord(1, `See ${HOME_ROOT}/projects/b.txt`)) + "\n");
		const after = await readSessionResources(db.index, "grows", HOME_ROOT);

		expect({
			before: before.files.files.map((file) => file.path),
			after: after.files.files.map((file) => file.path),
		}).toStrictEqual({
			before: ["~/projects/a.txt"],
			after: ["~/projects/a.txt", "~/projects/b.txt"],
		});
	});

	it("parses a record whose line spans read chunks", async () => {
		const long = "x".repeat(3 * 1024 * 1024);
		seedSession("spans", [userRecord(0, `${long} ${HOME_ROOT}/projects/tail.txt`)]);

		const resources = await readSessionResources(db.index, "spans", HOME_ROOT);

		expect(resources.files.files.map((file) => file.path)).toStrictEqual(["~/projects/tail.txt"]);
	});
});
