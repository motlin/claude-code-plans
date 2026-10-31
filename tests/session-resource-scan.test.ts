import {describe, expect, it, beforeEach, afterEach} from "vite-plus/test";
import {appendFileSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {coldScansRunning, forgetScannedResources, readSessionResources} from "../src/lib/session-resource-scan";

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
	forgetScannedResources();
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

/** A complete `api-request` record, written with `type` first as Claude Code writes it. */
function apiRequestRecord(id: string): Record<string, unknown> {
	return {
		type: "api-request",
		sessionId: "s",
		id,
		timestamp: "2026-10-31T00:00:00.000Z",
		version: "2.1.0",
		querySource: "repl_main_thread",
		shapeHash: "h",
		params: {
			model: "claude-opus",
			betas: [],
			max_tokens: 1000,
			thinking: {type: "adaptive", display: "summarized"},
			context_management: {edits: []},
			output_config: {effort: "high"},
		},
		keep: 0,
		tail: [`see ${HOME_ROOT}/projects/never-a-file.txt`],
		cacheControl: [],
		requestDigest: "d",
	};
}

function commandRecord(index: number): Record<string, unknown> {
	return userRecord(index, `<command-name>/check</command-name> ${HOME_ROOT}/projects/cmd.txt`);
}

function occurrenceAnchors(resources: Awaited<ReturnType<typeof readSessionResources>>): Record<string, number[]> {
	return Object.fromEntries(
		resources.files.files.map((file) => [file.path, file.occurrences.map((occurrence) => occurrence.anchorIndex)]),
	);
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

	it("counts api-request records toward every anchor without reading files out of them", async () => {
		seedSession("api", [
			apiRequestRecord("r0"),
			userRecord(1, `See ${HOME_ROOT}/projects/a.txt`),
			apiRequestRecord("r2"),
			userRecord(3, `See ${HOME_ROOT}/projects/b.txt`),
		]);

		const resources = await readSessionResources(db.index, "api", HOME_ROOT);

		expect(occurrenceAnchors(resources)).toStrictEqual({"~/projects/a.txt": [1], "~/projects/b.txt": [3]});
	});

	it("still folds a repeated command across a valid api-request record", async () => {
		seedSession("fold", [commandRecord(0), apiRequestRecord("r1"), commandRecord(2)]);

		const resources = await readSessionResources(db.index, "fold", HOME_ROOT);

		expect(occurrenceAnchors(resources)).toStrictEqual({"~/projects/cmd.txt": [0]});
	});

	it("keeps a repeated command that an invalid api-request record separates", async () => {
		seedSession("barrier", [commandRecord(0), {type: "api-request", id: "r1"}, commandRecord(2)]);

		const resources = await readSessionResources(db.index, "barrier", HOME_ROOT);

		expect(occurrenceAnchors(resources)).toStrictEqual({"~/projects/cmd.txt": [0, 2]});
	});

	it("runs one cold scan at a time", async () => {
		for (const id of ["alice", "bob", "carol"]) {
			seedSession(
				id,
				Array.from({length: 1000}, (_, index) =>
					userRecord(index, `See ${HOME_ROOT}/projects/${id}-${index}.txt`),
				),
			);
		}

		let mostAtOnce = 0;
		let watching = true;
		const watch = (): void => {
			mostAtOnce = Math.max(mostAtOnce, coldScansRunning());
			if (watching) setImmediate(watch);
		};
		setImmediate(watch);
		const results = await Promise.all(
			["alice", "bob", "carol"].map(async (id) => readSessionResources(db.index, id, HOME_ROOT, {sliceMs: 0})),
		);
		watching = false;

		expect({mostAtOnce, totals: results.map((result) => result.files.totalCount)}).toStrictEqual({
			mostAtOnce: 1,
			totals: [1000, 1000, 1000],
		});
	});

	it("answers from the stored scan after a restart while the file's size and mtime are unchanged", async () => {
		const filePath = seedSession("stored", [userRecord(0, `See ${HOME_ROOT}/projects/aaaa.txt`)]);
		// A whole-second mtime survives utimes exactly.
		const mtime = new Date("2026-10-31T12:00:00Z");
		utimesSync(filePath, mtime, mtime);
		const first = await readSessionResources(db.index, "stored", HOME_ROOT);

		// Same size and mtime, different bytes: only a stored result can still say aaaa.
		writeFileSync(filePath, readFileSync(filePath, "utf8").replace("aaaa", "bbbb"));
		utimesSync(filePath, mtime, mtime);
		forgetScannedResources();
		const afterRestart = await readSessionResources(db.index, "stored", HOME_ROOT);

		expect({
			paths: afterRestart.files.files.map((file) => file.path),
			equal: JSON.stringify(afterRestart) === JSON.stringify(first),
		}).toStrictEqual({paths: ["~/projects/aaaa.txt"], equal: true});
	});

	it("gives a session that grows while its scan waits one scan of its newest bytes", async () => {
		seedSession(
			"busy",
			Array.from({length: 3000}, (_, index) => userRecord(index, `See ${HOME_ROOT}/projects/busy-${index}.txt`)),
		);
		const filePath = seedSession("live", [userRecord(0, `See ${HOME_ROOT}/projects/a.txt`)]);

		const busy = readSessionResources(db.index, "busy", HOME_ROOT, {sliceMs: 0});
		const before = readSessionResources(db.index, "live", HOME_ROOT, {sliceMs: 0});
		await new Promise((resolve) => {
			setImmediate(resolve);
		});
		appendFileSync(filePath, JSON.stringify(userRecord(1, `See ${HOME_ROOT}/projects/b.txt`)) + "\n");
		const after = readSessionResources(db.index, "live", HOME_ROOT, {sliceMs: 0});
		const [beforeResult, afterResult] = await Promise.all([before, after, busy]);

		expect({
			before: beforeResult.files.files.map((file) => file.path),
			same: beforeResult === afterResult,
		}).toStrictEqual({before: ["~/projects/a.txt", "~/projects/b.txt"], same: true});
	});
});
