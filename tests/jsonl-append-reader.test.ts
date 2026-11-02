import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import
{
	appendFileSync,
	closeSync,
	ftruncateSync,
	mkdtempSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {readAppendedJsonlLines} from "../src/lib/jsonl-append-reader";

function record(uuid: string, text = `Turn ${uuid}`): Record<string, string>
{
	return {
		type: "user",
		uuid,
		text,
	};
}

function jsonl(...records: Record<string, string>[]): string
{
	return records.map((r) => `${JSON.stringify(r)}\n`).join("");
}

/** Removes the line holding `uuid` the way the CLI's `performRemoveByUuid` does: truncate at its start, then write the later bytes back there, on the same inode. */
function removeLineInPlace(path: string, uuid: string): number
{
	const contents = readFileSync(path);
	const at = contents.lastIndexOf(`"uuid":"${uuid}"`);
	const lineStart = contents.lastIndexOf(0x0a, at) + 1;
	const lineEnd = contents.indexOf(0x0a, at) + 1;
	const after = contents.subarray(lineEnd);
	const fd = openSync(path, "r+");
	try
	{
		ftruncateSync(fd, lineStart);
		writeSync(fd, after, 0, after.length, lineStart);
	}
	finally
	{
		closeSync(fd);
	}
	return lineEnd - lineStart;
}

describe("readAppendedJsonlLines", () =>
{
	let root: string;
	let db: AppDb;
	let path: string;
	let offsets: Map<string, number>;

	beforeEach(() =>
	{
		root = mkdtempSync(join(tmpdir(), "jsonl-append-reader-"));
		db = openTestDb();
		path = join(root, "session.jsonl");
		offsets = new Map();
		writeFileSync(path, jsonl(record("u-0"), record("u-1"), record("u-2"), record("u-3"), record("u-4")));
	});

	afterEach(() =>
	{
		db.close();
		rmSync(
			root,
			{
				recursive: true,
				force: true,
			},
		);
	});

	it("reads a plain append without reporting a rewrite", async () =>
	{
		await readAppendedJsonlLines(db.index, path, offsets);
		appendFileSync(path, jsonl(record("u-5"), record("u-6")));

		expect(await readAppendedJsonlLines(db.index, path, offsets)).toStrictEqual(
			{
				lines: [record("u-5"), record("u-6")],
				nextByteOffset: statSync(path).size,
				rewritten: false,
			},
		);
	});

	it("reports a line removed in place followed by a longer append as a rewrite and resumes at the end", async () =>
	{
		await readAppendedJsonlLines(db.index, path, offsets);
		const removed = removeLineInPlace(path, "u-3");
		const longer = record("u-5", "A retried turn that is much longer than the line the CLI removed");
		appendFileSync(path, jsonl(longer));

		expect(Buffer.byteLength(jsonl(longer))).toBeGreaterThan(removed);
		expect(await readAppendedJsonlLines(db.index, path, offsets)).toStrictEqual(
			{
				lines: [],
				nextByteOffset: statSync(path).size,
				rewritten: true,
			},
		);
	});

	it("reports a line removed in place followed by a short append as a rewrite and resumes at the end", async () =>
	{
		await readAppendedJsonlLines(db.index, path, offsets);
		removeLineInPlace(path, "u-3");
		appendFileSync(
			path,
			jsonl(
				{
					u: "5",
				},
			),
		);

		expect(await readAppendedJsonlLines(db.index, path, offsets)).toStrictEqual(
			{
				lines: [],
				nextByteOffset: statSync(path).size,
				rewritten: true,
			},
		);
	});

	it("reports a line removed in place with nothing appended as a rewrite", async () =>
	{
		await readAppendedJsonlLines(db.index, path, offsets);
		removeLineInPlace(path, "u-3");

		expect(await readAppendedJsonlLines(db.index, path, offsets)).toStrictEqual(
			{
				lines: [],
				nextByteOffset: statSync(path).size,
				rewritten: true,
			},
		);
	});

	it("reports a different, larger file renamed over the transcript as a rewrite", async () =>
	{
		await readAppendedJsonlLines(db.index, path, offsets);
		const replacement = join(root, "session.jsonl.compact.tmp.ab12");
		writeFileSync(
			replacement,
			jsonl(
				record("u-0", "A compacted transcript that is longer than the original one was"),
				record("u-1", "with another long record so the new file is larger than the old"),
			),
		);
		renameSync(replacement, path);

		expect(await readAppendedJsonlLines(db.index, path, offsets)).toStrictEqual(
			{
				lines: [],
				nextByteOffset: statSync(path).size,
				rewritten: true,
			},
		);
	});

	it("with no prior read in this map, resumes as before without reporting a rewrite", async () =>
	{
		removeLineInPlace(path, "u-3");

		expect(await readAppendedJsonlLines(db.index, path, offsets)).toStrictEqual(
			{
				lines: [record("u-0"), record("u-1"), record("u-2"), record("u-4")],
				nextByteOffset: statSync(path).size,
				rewritten: false,
			},
		);
	});

	it("does not trust a witness once the offset was dropped from the map", async () =>
	{
		await readAppendedJsonlLines(db.index, path, offsets);
		offsets.delete(path);
		removeLineInPlace(path, "u-3");

		expect(await readAppendedJsonlLines(db.index, path, offsets)).toStrictEqual(
			{
				lines: [record("u-0"), record("u-1"), record("u-2"), record("u-4")],
				nextByteOffset: statSync(path).size,
				rewritten: false,
			},
		);
	});
});
