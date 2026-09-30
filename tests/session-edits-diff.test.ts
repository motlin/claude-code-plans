import {describe, expect, it} from "vite-plus/test";
import {parseJsonlRecord} from "../src/lib/schemas";
import {aggregateSessionEdits} from "../src/lib/session-edits-diff";

function jsonl(...lines: Record<string, unknown>[]): string {
	return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

function parseRecords(text: string) {
	return text.split("\n").flatMap((line) => {
		if (line.trim() === "") return [];
		const record = parseJsonlRecord(line);
		if (record === null) throw new Error(`Invalid JSONL fixture line: ${line}`);
		return [record];
	});
}

function toolResult(
	uuid: string,
	assistantUuid: string,
	toolUseResult: Record<string, unknown> | string,
): Record<string, unknown> {
	return {
		type: "user",
		uuid,
		parentUuid: assistantUuid,
		sessionId: "session-1",
		timestamp: "2026-09-29T00:00:00.000Z",
		message: {
			role: "user",
			content: [{type: "tool_result", tool_use_id: `toolu_${uuid}`, content: "ok"}],
		},
		toolUseResult,
		sourceToolAssistantUUID: assistantUuid,
	};
}

function editResult(
	filePath: string,
	originalFile: string | null,
	oldString: string,
	newString: string,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		filePath,
		oldString,
		newString,
		originalFile,
		structuredPatch: [],
		userModified: false,
		replaceAll: false,
		...extra,
	};
}

function writeResult(filePath: string, originalFile: string | null, content: string): Record<string, unknown> {
	return {
		type: originalFile === null ? "create" : "update",
		filePath,
		content,
		structuredPatch: [],
		originalFile,
		userModified: false,
	};
}

describe("aggregateSessionEdits", () => {
	it("collapses sequential edits to one file into a single diff", () => {
		const original = "one\ntwo\nthree\n";
		const records = parseRecords(
			jsonl(
				toolResult("u1", "a1", editResult("/repo/a.txt", original, "one", "ONE")),
				toolResult("u2", "a2", editResult("/repo/a.txt", "ONE\ntwo\nthree\n", "three", "THREE")),
			),
		);

		expect(aggregateSessionEdits(records)).toStrictEqual([
			{
				path: "/repo/a.txt",
				status: "modified",
				complete: true,
				oldContent: original,
				newContent: "ONE\ntwo\nTHREE\n",
				patch: [
					"diff --git a/repo/a.txt b/repo/a.txt",
					"--- a/repo/a.txt",
					"+++ b/repo/a.txt",
					"@@ -1,3 +1,3 @@",
					"-one",
					"+ONE",
					" two",
					"-three",
					"+THREE",
					"",
				].join("\n"),
				additions: 2,
				deletions: 2,
			},
		]);
	});

	it("applies an edit without an originalFile snapshot on top of tracked content", () => {
		const original = "alpha\nbeta\n";
		const records = parseRecords(
			jsonl(
				toolResult("u1", "a1", editResult("/repo/b.txt", original, "alpha", "ALPHA")),
				toolResult("u2", "a2", editResult("/repo/b.txt", null, "beta", "BETA")),
			),
		);

		const [file] = aggregateSessionEdits(records);
		expect(file?.newContent).toBe("ALPHA\nBETA\n");
		expect(file?.complete).toBe(true);
	});

	it("combines a Write followed by an Edit", () => {
		const records = parseRecords(
			jsonl(
				toolResult("u1", "a1", writeResult("/repo/c.ts", "old\n", "first\nsecond\n")),
				toolResult("u2", "a2", editResult("/repo/c.ts", "first\nsecond\n", "second", "2nd")),
			),
		);

		expect(aggregateSessionEdits(records)).toStrictEqual([
			{
				path: "/repo/c.ts",
				status: "modified",
				complete: true,
				oldContent: "old\n",
				newContent: "first\n2nd\n",
				patch: [
					"diff --git a/repo/c.ts b/repo/c.ts",
					"--- a/repo/c.ts",
					"+++ b/repo/c.ts",
					"@@ -1,1 +1,2 @@",
					"-old",
					"+first",
					"+2nd",
					"",
				].join("\n"),
				additions: 2,
				deletions: 1,
			},
		]);
	});

	it("reports a created file as added", () => {
		const records = parseRecords(
			jsonl(toolResult("u1", "a1", writeResult("/repo/new.md", null, "# Title\nbody\n"))),
		);

		expect(aggregateSessionEdits(records)).toStrictEqual([
			{
				path: "/repo/new.md",
				status: "added",
				complete: true,
				oldContent: null,
				newContent: "# Title\nbody\n",
				patch: [
					"diff --git a/repo/new.md b/repo/new.md",
					"new file mode 100644",
					"--- /dev/null",
					"+++ b/repo/new.md",
					"@@ -0,0 +1,2 @@",
					"+# Title",
					"+body",
					"",
				].join("\n"),
				additions: 2,
				deletions: 0,
			},
		]);
	});

	it("includes edits the user modified before accepting", () => {
		const records = parseRecords(
			jsonl(
				toolResult("u1", "a1", editResult("/repo/d.txt", "x = 1\n", "x = 1", "x = 42", {userModified: true})),
			),
		);

		const [file] = aggregateSessionEdits(records);
		expect(file?.newContent).toBe("x = 42\n");
		expect([file?.additions, file?.deletions]).toStrictEqual([1, 1]);
	});

	it("honors replaceAll", () => {
		const records = parseRecords(
			jsonl(toolResult("u1", "a1", editResult("/repo/e.txt", "a a\na\n", "a", "b", {replaceAll: true}))),
		);

		expect(aggregateSessionEdits(records)[0]?.newContent).toBe("b b\nb\n");
	});

	it("excludes a file that was edited and then reverted", () => {
		const records = parseRecords(
			jsonl(
				toolResult("u1", "a1", editResult("/repo/f.txt", "same\n", "same", "changed")),
				toolResult("u2", "a2", editResult("/repo/f.txt", "changed\n", "changed", "same")),
				toolResult("u3", "a3", writeResult("/repo/g.txt", null, "kept\n")),
			),
		);

		expect(aggregateSessionEdits(records).map((file) => file.path)).toStrictEqual(["/repo/g.txt"]);
	});

	it("ignores failed tool results and non-edit tool results", () => {
		const records = parseRecords(
			jsonl(
				toolResult("u1", "a1", "Error: String to replace not found in file."),
				toolResult("u2", "a2", {stdout: "hi", stderr: "", interrupted: false, isImage: false}),
			),
		);

		expect(aggregateSessionEdits(records)).toStrictEqual([]);
	});

	it("restricts the diff to the given turn uuids", () => {
		const records = parseRecords(
			jsonl(
				toolResult("u1", "a1", editResult("/repo/h.txt", "1\n2\n", "1", "one")),
				toolResult("u2", "a2", editResult("/repo/h.txt", "one\n2\n", "2", "two")),
				toolResult("u3", "a3", writeResult("/repo/i.txt", null, "other turn\n")),
			),
		);

		expect(aggregateSessionEdits(records, {turnUuids: new Set(["a2"])})).toStrictEqual([
			{
				path: "/repo/h.txt",
				status: "modified",
				complete: true,
				oldContent: "one\n2\n",
				newContent: "one\ntwo\n",
				patch: [
					"diff --git a/repo/h.txt b/repo/h.txt",
					"--- a/repo/h.txt",
					"+++ b/repo/h.txt",
					"@@ -1,2 +1,2 @@",
					" one",
					"-2",
					"+two",
					"",
				].join("\n"),
				additions: 1,
				deletions: 1,
			},
		]);
	});

	it("limits context to three lines and splits distant changes into hunks", () => {
		const lines = Array.from({length: 20}, (_, i) => `line${i + 1}`);
		const original = lines.join("\n") + "\n";
		const edited = original.replace("line2\n", "LINE2\n").replace("line19\n", "LINE19\n");
		const records = parseRecords(jsonl(toolResult("u1", "a1", writeResult("/repo/long.txt", original, edited))));

		expect(aggregateSessionEdits(records)[0]?.patch).toBe(
			[
				"diff --git a/repo/long.txt b/repo/long.txt",
				"--- a/repo/long.txt",
				"+++ b/repo/long.txt",
				"@@ -1,5 +1,5 @@",
				" line1",
				"-line2",
				"+LINE2",
				" line3",
				" line4",
				" line5",
				"@@ -16,5 +16,5 @@",
				" line16",
				" line17",
				" line18",
				"-line19",
				"+LINE19",
				" line20",
				"",
			].join("\n"),
		);
	});

	it("falls back to the tool's structured patch when the starting content is unknown", () => {
		const records = parseRecords(
			jsonl(
				toolResult(
					"u1",
					"a1",
					editResult("/repo/big.ts", null, "foo", "bar", {
						structuredPatch: [
							{
								oldStart: 10,
								oldLines: 3,
								newStart: 10,
								newLines: 3,
								lines: [" before", "-foo", "+bar", " after"],
							},
						],
					}),
				),
			),
		);

		expect(aggregateSessionEdits(records)).toStrictEqual([
			{
				path: "/repo/big.ts",
				status: "modified",
				complete: false,
				oldContent: null,
				newContent: null,
				patch: [
					"diff --git a/repo/big.ts b/repo/big.ts",
					"--- a/repo/big.ts",
					"+++ b/repo/big.ts",
					"@@ -10,3 +10,3 @@",
					" before",
					"-foo",
					"+bar",
					" after",
					"",
				].join("\n"),
				additions: 1,
				deletions: 1,
			},
		]);
	});
});
