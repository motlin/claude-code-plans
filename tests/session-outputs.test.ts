import {describe, expect, it} from "vite-plus/test";

import type {JsonValue} from "../src/lib/hook-events";
import {extractOutputFiles} from "../src/lib/session-outputs";

type TranscriptRecord = Record<string, JsonValue>;

const CWD = "/Users/alice/projects/avalonlogs";

function toolUse(id: string, name: string, input: Record<string, JsonValue>, timestamp: string): TranscriptRecord {
	return {
		type: "assistant",
		timestamp,
		message: {role: "assistant", content: [{type: "tool_use", id, name, input}]},
	};
}

function toolResult(toolUseId: string, timestamp: string, isError = false): TranscriptRecord {
	return {
		type: "user",
		timestamp,
		message: {
			role: "user",
			content: [{type: "tool_result", tool_use_id: toolUseId, content: "ok", is_error: isError}],
		},
	};
}

function write(id: string, filePath: string, minute: number, isError = false): TranscriptRecord[] {
	const at = `2026-10-01T10:${String(minute).padStart(2, "0")}:00.000Z`;
	return [toolUse(id, "Write", {file_path: filePath, content: "x"}, at), toolResult(id, at, isError)];
}

describe("extractOutputFiles", () => {
	it("keeps completed Writes of deliverables or outside the cwd, plus sent files, newest first", () => {
		const records = [
			...write("w1", "/tmp/report.md", 1),
			...write("w2", `${CWD}/src/app.ts`, 2),
			...write("w3", `${CWD}/docs/chart.png`, 3),
			...write("w4", "/tmp/scratch.ts", 4),
			...write("w5", `${CWD}/notes.txt`, 5, true),
			toolUse("w6", "Write", {file_path: `${CWD}/pending.pdf`, content: "x"}, "2026-10-01T10:06:00.000Z"),
			toolUse("s1", "SendUserFile", {files: ["out/summary.csv"]}, "2026-10-01T10:07:00.000Z"),
			toolResult("s1", "2026-10-01T10:07:00.000Z"),
		];

		expect(extractOutputFiles(records, CWD)).toStrictEqual([
			{path: `${CWD}/out/summary.csv`, at: Date.parse("2026-10-01T10:07:00.000Z")},
			{path: "/tmp/scratch.ts", at: Date.parse("2026-10-01T10:04:00.000Z")},
			{path: `${CWD}/docs/chart.png`, at: Date.parse("2026-10-01T10:03:00.000Z")},
			{path: "/tmp/report.md", at: Date.parse("2026-10-01T10:01:00.000Z")},
		]);
	});

	it("dedupes a rewritten file at its newest write and caps the list at 50", () => {
		const records = [
			...write("first", "/tmp/report.md", 0),
			...Array.from({length: 55}, (_, index) => write(`w${index}`, `/tmp/file-${index}.md`, 1)).flat(),
			...write("again", "/tmp/report.md", 59),
		];
		const files = extractOutputFiles(records, CWD);

		expect({
			count: files.length,
			first: files[0],
			reports: files.filter((file) => file.path === "/tmp/report.md").length,
		}).toStrictEqual({
			count: 50,
			first: {path: "/tmp/report.md", at: Date.parse("2026-10-01T10:59:00.000Z")},
			reports: 1,
		});
	});
});
