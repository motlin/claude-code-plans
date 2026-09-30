import {getSingularPatch} from "@pierre/diffs";
import {describe, expect, it} from "vite-plus/test";
import {buildUnifiedHunk} from "../src/lib/diff-utils.js";

function parseHunk(hunk: string): {header: string; body: string[]} {
	const lines = hunk.split("\n");
	const headerIndex = lines.findIndex((line) => line.startsWith("@@"));
	return {header: lines[headerIndex]!, body: lines.slice(headerIndex + 1)};
}

function reconstruct(body: string[]): {old: string[]; next: string[]} {
	const old: string[] = [];
	const next: string[] = [];
	for (const line of body) {
		const marker = line[0];
		const text = line.slice(1);
		if (marker === " ") {
			old.push(text);
			next.push(text);
		} else if (marker === "-") {
			old.push(text);
		} else if (marker === "+") {
			next.push(text);
		}
	}
	return {old, next};
}

/** What `@pierre/diffs` (the inline diff renderer) parses out of the patch. */
function parsedByRenderer(oldStr: string, newStr: string, filePath: string) {
	const fileDiff = getSingularPatch(buildUnifiedHunk(oldStr, newStr, filePath));
	return {
		name: fileDiff.name,
		hunks: fileDiff.hunks.map((hunk) => ({
			additionStart: hunk.additionStart,
			additionLines: hunk.additionLines,
			deletionStart: hunk.deletionStart,
			deletionLines: hunk.deletionLines,
		})),
	};
}

describe("buildUnifiedHunk", () => {
	it("uses the git new-file convention when the old side is empty", () => {
		const {header, body} = parseHunk(buildUnifiedHunk("", "alpha\nbeta\n", "notes.md"));
		expect({header, markers: [...new Set(body.map((line) => line[0]))]}).toStrictEqual({
			header: "@@ -0,0 +1,3 @@",
			markers: ["+"],
		});
	});

	it("uses the git deleted-file convention when the new side is empty", () => {
		const {header, body} = parseHunk(buildUnifiedHunk("alpha\nbeta", "", "notes.md"));
		expect({header, markers: [...new Set(body.map((line) => line[0]))]}).toStrictEqual({
			header: "@@ -1,2 +0,0 @@",
			markers: ["-"],
		});
	});

	it("keeps 1-based counts and reconstructable content for a normal edit", () => {
		const oldStr = "one\ntwo\nthree";
		const newStr = "one\ntwo-changed\nthree";
		const {header, body} = parseHunk(buildUnifiedHunk(oldStr, newStr, "file.ts"));
		expect({header, ...reconstruct(body)}).toStrictEqual({
			header: "@@ -1,3 +1,3 @@",
			old: oldStr.split("\n"),
			next: newStr.split("\n"),
		});
	});

	it("emits an empty hunk when both sides are empty", () => {
		const {header, body} = parseHunk(buildUnifiedHunk("", "", "file.ts"));
		expect({header, body}).toStrictEqual({header: "@@ -0,0 +0,0 @@", body: []});
	});

	it("parses as one all-additions hunk when a Write creates a new file", () => {
		expect(parsedByRenderer("", "# Title\n\nBody text\n", "plan.md")).toStrictEqual({
			name: "plan.md",
			hunks: [{additionStart: 1, additionLines: 4, deletionStart: 0, deletionLines: 0}],
		});
	});

	it("parses an Edit fragment as one hunk counting only the changed lines", () => {
		expect(parsedByRenderer("const a = 1;\nconst b = 2;", "const a = 1;\nconst b = 3;", "a.ts")).toStrictEqual({
			name: "a.ts",
			hunks: [{additionStart: 1, additionLines: 1, deletionStart: 1, deletionLines: 1}],
		});
	});
});
