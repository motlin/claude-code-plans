import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {scanRecordMix} from "../../scripts/perf-record-mix";

function line(record: unknown): string {
	return JSON.stringify(record);
}

function collectStrings(value: unknown, into: Set<string>): void {
	if (typeof value === "string") {
		into.add(value);
	} else if (Array.isArray(value)) {
		for (const item of value) {
			collectStrings(item, into);
		}
	} else if (typeof value === "object" && value !== null) {
		for (const item of Object.values(value)) {
			collectStrings(item, into);
		}
	}
}

// Structural identifiers the profile is allowed to surface as keys. Every other string value is content.
const STRUCTURAL = new Set([
	"user",
	"assistant",
	"system",
	"summary",
	"text",
	"image",
	"base64",
	"image/png",
	"tool_use",
	"tool_result",
	"Bash",
	"Read",
]);

const assistantBash = line({
	type: "assistant",
	uuid: "uuid-secret-a1",
	message: {
		role: "assistant",
		content: [
			{type: "text", text: "secret thinking out loud"},
			{type: "tool_use", id: "toolu-secret-1", name: "Bash", input: {command: "secret-command --flag"}},
		],
	},
});
const userBashResult = line({
	type: "user",
	uuid: "uuid-secret-u1",
	message: {
		role: "user",
		content: [{type: "tool_result", tool_use_id: "toolu-secret-1", content: "secret output ".repeat(20)}],
	},
});
const userPrompt = line({type: "user", uuid: "uuid-secret-u0", message: {role: "user", content: "secret prompt"}});
const summary = line({type: "summary", summary: "secret summary title", leafUuid: "uuid-secret-leaf"});

const assistantRead = line({
	type: "assistant",
	uuid: "uuid-secret-a2",
	message: {
		role: "assistant",
		content: [{type: "tool_use", id: "toolu-secret-2", name: "Read", input: {file_path: "/secret/path.png"}}],
	},
});
const userReadImage = line({
	type: "user",
	uuid: "uuid-secret-u2",
	message: {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "toolu-secret-2",
				content: [
					{type: "image", source: {type: "base64", media_type: "image/png", data: "c2VjcmV0".repeat(300)}},
				],
			},
		],
	},
});

const subagentLine = line({
	type: "system",
	uuid: "uuid-secret-s1",
	content: "secret system note",
	isSidechain: true,
});
const orphanResult = line({
	type: "user",
	uuid: "uuid-secret-u3",
	message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu-secret-missing", content: "secret"}]},
});

const files: Record<string, string[]> = {
	"-Users-me-proj/one.jsonl": [userPrompt, assistantBash, userBashResult, summary],
	"-Users-me-proj/two.jsonl": [assistantRead, userReadImage, "{not json at all secret-garbage"],
	"-Users-me-proj/one/subagents/agent-secret.jsonl": [subagentLine, orphanResult],
};

function bytes(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function bucket(size: number): string {
	return String(2 ** Math.floor(Math.log2(size)));
}

function histogram(sizes: number[]): Record<string, number> {
	const result: Record<string, number> = {};
	for (const size of sizes) {
		const key = bucket(size);
		result[key] = (result[key] ?? 0) + 1;
	}
	return result;
}

describe("scanRecordMix", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "record-mix-"));
		for (const [relative, lines] of Object.entries(files)) {
			const path = join(root, relative);
			mkdirSync(join(path, ".."), {recursive: true});
			writeFileSync(path, `${lines.join("\n")}\n\n`);
		}
		writeFileSync(join(root, "-Users-me-proj", "ignored.json"), "{}");
	});

	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	it("profiles record types, tool names, log2 line-size histograms and the image fraction", () => {
		const garbage = "{not json at all secret-garbage";
		const oneFile = files["-Users-me-proj/one.jsonl"]!;
		const twoFile = files["-Users-me-proj/two.jsonl"]!;
		const subFile = files["-Users-me-proj/one/subagents/agent-secret.jsonl"]!;
		const fileBytes = (lines: string[]) => bytes(`${lines.join("\n")}\n\n`);

		const mix = scanRecordMix(root);

		expect(mix).toStrictEqual({
			totals: {
				files: 3,
				subagentFiles: 1,
				lines: 9,
				bytes: [...oneFile, ...twoFile, ...subFile].reduce((sum, text) => sum + bytes(text), 0),
			},
			fileBytes: histogram([fileBytes(oneFile), fileBytes(twoFile), fileBytes(subFile)]),
			fileLines: histogram([4, 3, 2]),
			recordTypes: {"(unparseable)": 1, assistant: 2, summary: 1, system: 1, user: 4},
			lineBytesByType: {
				"(unparseable)": histogram([bytes(garbage)]),
				assistant: histogram([bytes(assistantBash), bytes(assistantRead)]),
				summary: histogram([bytes(summary)]),
				system: histogram([bytes(subagentLine)]),
				user: histogram([bytes(userPrompt), bytes(userBashResult), bytes(userReadImage), bytes(orphanResult)]),
			},
			toolNames: {Bash: 1, Read: 1},
			toolUseLineBytes: {Bash: histogram([bytes(assistantBash)]), Read: histogram([bytes(assistantRead)])},
			toolResultLineBytes: {
				"(unknown)": histogram([bytes(orphanResult)]),
				Bash: histogram([bytes(userBashResult)]),
				Read: histogram([bytes(userReadImage)]),
			},
			imageLines: 1,
			imageLineFraction: 0.111111,
		});
	});

	it("folds every MCP tool into one key so server names never reach the output", () => {
		const mcpCall = (name: string, id: string) =>
			line({
				type: "assistant",
				message: {role: "assistant", content: [{type: "tool_use", id, name, input: {}}]},
			});
		const mcpRoot = mkdtempSync(join(tmpdir(), "record-mix-mcp-"));
		const lines = [
			mcpCall("mcp__secret-mail-server__search", "toolu-a"),
			mcpCall("Mcp__secret-browser__navigate", "toolu-b"),
			line({
				type: "user",
				message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu-a", content: "x"}]},
			}),
		];
		writeFileSync(join(mcpRoot, "mcp.jsonl"), lines.join("\n"));
		try {
			const mix = scanRecordMix(mcpRoot);

			expect({
				toolNames: mix.toolNames,
				toolUseLineBytes: mix.toolUseLineBytes,
				toolResultLineBytes: mix.toolResultLineBytes,
			}).toStrictEqual({
				toolNames: {"(mcp)": 2},
				toolUseLineBytes: {"(mcp)": histogram([bytes(lines[0]!), bytes(lines[1]!)])},
				toolResultLineBytes: {"(mcp)": histogram([bytes(lines[2]!)])},
			});
		} finally {
			rmSync(mcpRoot, {recursive: true, force: true});
		}
	});

	it("never copies a content string into the output", () => {
		const output = JSON.stringify(scanRecordMix(root));
		const strings = new Set<string>();
		for (const lines of Object.values(files)) {
			for (const text of lines) {
				try {
					collectStrings(JSON.parse(text), strings);
				} catch {
					strings.add(text);
				}
			}
		}

		const leaked = [...strings].filter((value) => !STRUCTURAL.has(value) && output.includes(value));

		expect(leaked).toStrictEqual([]);
		expect(output).not.toContain("secret");
		expect(output).not.toContain(root);
	});
});
