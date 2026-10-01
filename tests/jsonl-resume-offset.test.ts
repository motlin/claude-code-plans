import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {jsonlResumeOffset} from "../src/lib/jsonl-resume-offset";

describe("jsonlResumeOffset", () => {
	let root: string;
	let db: AppDb;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "jsonl-resume-offset-"));
		db = openTestDb();
	});

	afterEach(() => {
		db.close();
		rmSync(root, {recursive: true, force: true});
	});

	function recordIndexedSize(path: string, sizeBytes: number): void {
		db.index.insert(schema.indexedFiles).values({path, mtimeMs: 1, sizeBytes, indexedAt: 1}).run();
	}

	it("starts a never-indexed transcript from the beginning", async () => {
		const path = join(root, "new.jsonl");
		writeFileSync(path, '{"a":1}\n');

		expect(await jsonlResumeOffset(db.index, path)).toBe(0);
	});

	it("resumes an indexed transcript where the index stopped", async () => {
		const path = join(root, "indexed.jsonl");
		writeFileSync(path, '{"a":1}\n{"b":2}\n{"c":3}\n');
		recordIndexedSize(path, '{"a":1}\n{"b":2}\n'.length);

		expect(await jsonlResumeOffset(db.index, path)).toBe('{"a":1}\n{"b":2}\n'.length);
	});

	it("backs up to the start of a line the index stopped inside", async () => {
		const path = join(root, "partial.jsonl");
		writeFileSync(path, '{"a":1}\n{"b":2}\n');
		recordIndexedSize(path, '{"a":1}\n{"b'.length);

		expect(await jsonlResumeOffset(db.index, path)).toBe('{"a":1}\n'.length);
	});

	it("backs up across read chunks to find the line start", async () => {
		const path = join(root, "long-line.jsonl");
		const longLine = JSON.stringify({text: "x".repeat(200_000)});
		writeFileSync(path, `{"a":1}\n${longLine}\n`);
		recordIndexedSize(path, '{"a":1}\n'.length + 150_000);

		expect(await jsonlResumeOffset(db.index, path)).toBe('{"a":1}\n'.length);
	});

	it("starts from the beginning when the transcript shrank below its indexed size", async () => {
		const path = join(root, "rewritten.jsonl");
		writeFileSync(path, '{"a":1}\n');
		recordIndexedSize(path, 1000);

		expect(await jsonlResumeOffset(db.index, path)).toBe(0);
	});

	it("starts from the beginning when the transcript is gone", async () => {
		const path = join(root, "missing.jsonl");
		recordIndexedSize(path, 10);

		expect(await jsonlResumeOffset(db.index, path)).toBe(0);
	});
});
