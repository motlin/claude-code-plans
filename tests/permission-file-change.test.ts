import {describe, expect, it} from "vite-plus/test";
import {analyzeFileChange, fileChangeNote, shownFileChangeNote} from "../src/lib/permission-file-change";

describe("analyzeFileChange (upstream's zu)", () => {
	it("marks a Write over an existing file as replaced by its diff, with a one-hunk patch of the file's real lines", () => {
		expect(analyzeFileChange("Write", {file_path: "/repo/a.ts", content: "b\n"}, "a\n")).toStrictEqual({
			diffShowsReplaced: true,
			patch: {
				hunks: [{oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"]}],
				context: 1,
			},
		});
	});

	it("says a Write that only changes line endings does so, with no patch", () => {
		expect(analyzeFileChange("Write", {file_path: "/repo/a.ts", content: "a\r\nb\r\n"}, "a\nb\n")).toStrictEqual({
			replacesFile: true,
			lineEndingsChange: true,
		});
	});

	it("counts a replace_all Edit's matches in the file", () => {
		const analysis = analyzeFileChange(
			"Edit",
			{file_path: "/repo/a.ts", old_string: "x", new_string: "y", replace_all: true},
			"x x x",
		);
		expect({matches: analysis.matches, note: fileChangeNote(analysis, true)}).toStrictEqual({
			matches: 3,
			note: "Replaces all 3 matches in the file.",
		});
	});

	it("says one match in the singular", () => {
		expect(
			fileChangeNote(
				analyzeFileChange(
					"Edit",
					{file_path: "/repo/a.ts", old_string: "x", new_string: "y", replace_all: true},
					"x",
				),
				true,
			),
		).toBe("Replaces 1 match in the file.");
	});

	it("says the file already holds an Edit whose result equals the file", () => {
		const analysis = analyzeFileChange("Edit", {file_path: "/repo/a.ts", old_string: "a", new_string: "a"}, "a\n");
		expect({analysis, note: fileChangeNote(analysis, true)}).toStrictEqual({
			analysis: {alreadySo: true},
			note: "The file already holds this, so nothing would change.",
		});
	});

	it("removes a deleted whole line's newline too (upstream's Iu)", () => {
		expect(
			analyzeFileChange("Edit", {file_path: "/repo/a.ts", old_string: "line", new_string: ""}, "line\nnext\n"),
		).toStrictEqual({
			patch: {
				hunks: [{oldStart: 1, oldLines: 2, newStart: 1, newLines: 1, lines: ["-line", " next"]}],
				context: 1,
			},
		});
	});

	it("draws an Edit's hunk at the file's real line numbers with one line of context", () => {
		const file = ["one", "two", "three", "four", "five"].join("\n") + "\n";
		expect(
			analyzeFileChange("Edit", {file_path: "/repo/a.ts", old_string: "four", new_string: "FOUR"}, file),
		).toStrictEqual({
			patch: {
				hunks: [
					{oldStart: 3, oldLines: 3, newStart: 3, newLines: 3, lines: [" three", "-four", "+FOUR", " five"]},
				],
				context: 1,
			},
		});
	});

	it("drops the context when any line of the file is 200 characters or longer", () => {
		const file = `${"x".repeat(200)}\nold\n`;
		expect(
			analyzeFileChange("Edit", {file_path: "/repo/a.ts", old_string: "old", new_string: "new"}, file).patch,
		).toStrictEqual({
			hunks: [{oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ["-old", "+new"]}],
			context: 0,
		});
	});

	it("keeps the notes but shows no disk patch for a secret file", () => {
		expect(analyzeFileChange("Write", {file_path: "/repo/.env", content: "B=2\n"}, "A=1\n")).toStrictEqual({
			replacesFile: true,
		});
		expect(analyzeFileChange("Write", {file_path: "/repo/.npmrc", content: "b\n"}, "a\n")).toStrictEqual({
			replacesFile: true,
		});
	});

	it("leaves an Edit whose old string isn't in the file without notes or patch", () => {
		expect(
			analyzeFileChange("Edit", {file_path: "/repo/a.ts", old_string: "zz", new_string: "y"}, "a\n"),
		).toStrictEqual({});
	});

	it("strips a leading byte order mark before comparing", () => {
		expect(
			analyzeFileChange("Edit", {file_path: "/repo/a.ts", old_string: "a", new_string: "a"}, "﻿a"),
		).toStrictEqual({alreadySo: true});
	});

	it("notes a Write that keeps the file's lines but swaps their endings alongside a change", () => {
		expect(
			fileChangeNote(
				analyzeFileChange("Write", {file_path: "/repo/a.ts", content: "a\r\nc\r\n"}, "a\nb\n"),
				false,
			),
		).toBe("Replaces the existing file. Also changes line endings.");
	});

	// Upstream's `mw` (2026-11-10): the diff shows the replaced lines itself, so the note goes once it is drawn.
	it("says a Write replaces the file only while its disk diff is not shown", () => {
		const analysis = analyzeFileChange("Write", {file_path: "/repo/a.ts", content: "b\n"}, "a\n");
		expect([fileChangeNote(analysis, true), fileChangeNote(analysis, false)]).toStrictEqual([
			null,
			"Replaces the existing file.",
		]);
	});

	it("keeps the replace note for a Write too large to diff, shown or not", () => {
		const analysis = analyzeFileChange("Write", {file_path: "/repo/a.ts", content: "b".repeat(200_001)}, "a\n");
		expect({
			analysis,
			notes: [fileChangeNote(analysis, true), fileChangeNote(analysis, false)],
		}).toStrictEqual({
			analysis: {replacesFile: true},
			notes: ["Replaces the existing file.", "Replaces the existing file."],
		});
	});
});

describe("shownFileChangeNote (upstream's cx)", () => {
	it("says an unreadable file shows only what Claude sent, unless the copy has its own note", () => {
		expect([
			shownFileChangeNote({kind: "unreadable"}, null, true),
			shownFileChangeNote({kind: "unreadable"}, "Replaces every match in the file.", true),
		]).toStrictEqual([
			"Couldn’t check this file, so this shows only what Claude sent.",
			"Replaces every match in the file.",
		]);
	});

	it("puts the disk note in place of the copy note, and keeps the copy note when the disk has none", () => {
		expect([
			shownFileChangeNote({kind: "read", analysis: {matches: 3}}, "Replaces every match in the file.", true),
			shownFileChangeNote({kind: "read", analysis: {}}, "Replaces every match in the file.", true),
			shownFileChangeNote({kind: "none"}, null, true),
		]).toStrictEqual(["Replaces all 3 matches in the file.", "Replaces every match in the file.", null]);
	});
});
