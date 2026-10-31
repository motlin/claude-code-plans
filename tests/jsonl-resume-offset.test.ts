import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {MAX_JSONL_REPLAY_BYTES, jsonlReadOffset, jsonlResumeOffset} from "../src/lib/jsonl-resume-offset";

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

	it("starts a never-indexed transcript longer than the replay bound at its end", async () => {
		const path = join(root, "unindexed-long.jsonl");
		const line = `${JSON.stringify({text: "x".repeat(1000)})}\n`;
		const contents = line.repeat(Math.ceil(MAX_JSONL_REPLAY_BYTES / line.length) + 1);
		writeFileSync(path, contents);

		expect(contents.length).toBeGreaterThan(MAX_JSONL_REPLAY_BYTES);
		expect(await jsonlResumeOffset(db.index, path)).toBe(contents.length);
	});

	it("starts a never-indexed transcript longer than the replay bound at the start of its partial last line", async () => {
		const path = join(root, "unindexed-long-partial.jsonl");
		const line = `${JSON.stringify({text: "x".repeat(1000)})}\n`;
		const complete = line.repeat(Math.ceil(MAX_JSONL_REPLAY_BYTES / line.length) + 1);
		writeFileSync(path, `${complete}{"b`);

		expect(complete.length).toBeGreaterThan(MAX_JSONL_REPLAY_BYTES);
		expect(await jsonlResumeOffset(db.index, path)).toBe(complete.length);
	});

	it("skips to the end when more than the replay bound was appended since the index stopped", async () => {
		const path = join(root, "far-behind.jsonl");
		const line = `${JSON.stringify({text: "x".repeat(1000)})}\n`;
		const contents = line.repeat(Math.ceil(MAX_JSONL_REPLAY_BYTES / line.length) + 2);
		writeFileSync(path, contents);
		recordIndexedSize(path, line.length);

		expect(contents.length - line.length).toBeGreaterThan(MAX_JSONL_REPLAY_BYTES);
		expect(await jsonlResumeOffset(db.index, path)).toBe(contents.length);
	});

	it("starts a rewritten transcript longer than the replay bound at its end", async () => {
		const path = join(root, "rewritten-long.jsonl");
		const line = `${JSON.stringify({text: "x".repeat(1000)})}\n`;
		const contents = line.repeat(Math.ceil(MAX_JSONL_REPLAY_BYTES / line.length) + 1);
		writeFileSync(path, contents);
		recordIndexedSize(path, contents.length * 2);

		expect(contents.length).toBeGreaterThan(MAX_JSONL_REPLAY_BYTES);
		expect(await jsonlResumeOffset(db.index, path)).toBe(contents.length);
	});

	it("starts from the beginning when the transcript is gone", async () => {
		const path = join(root, "missing.jsonl");
		recordIndexedSize(path, 10);

		expect(await jsonlResumeOffset(db.index, path)).toBe(0);
	});
});

describe("jsonlReadOffset", () => {
	let root: string;
	let db: AppDb;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "jsonl-read-offset-"));
		db = openTestDb();
	});

	afterEach(() => {
		db.close();
		rmSync(root, {recursive: true, force: true});
	});

	it("keeps a cached offset inside the transcript", async () => {
		const path = join(root, "grown.jsonl");
		writeFileSync(path, '{"a":1}\n{"b":2}\n');

		expect(await jsonlReadOffset(db.index, path, '{"a":1}\n'.length)).toBe('{"a":1}\n'.length);
	});

	it("falls back to the resume offset without a cached one", async () => {
		const path = join(root, "uncached.jsonl");
		writeFileSync(path, '{"a":1}\n');

		expect(await jsonlReadOffset(db.index, path, undefined)).toBe(0);
	});

	it("moves a cached offset past the end of a rewritten transcript back to its end", async () => {
		const path = join(root, "rewritten.jsonl");
		writeFileSync(path, '{"a":1}\n');

		expect(await jsonlReadOffset(db.index, path, 1000)).toBe('{"a":1}\n'.length);
	});

	it("moves a cached offset past the end of a rewritten transcript back to the start of its partial last line", async () => {
		const path = join(root, "rewritten-partial.jsonl");
		writeFileSync(path, '{"a":1}\n{"b');

		expect(await jsonlReadOffset(db.index, path, 1000)).toBe('{"a":1}\n'.length);
	});
});
