import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import specimens from "./fixtures/write-update-diff-specimens.json";
import {diffStatsForCall, summarizeToolCallStats, type ToolCallLike} from "../src/lib/session-utils";
import {toolResultMetaFrom} from "../src/lib/tool-labels";
import {processTranscript} from "../src/lib/transcript";
import {parseJsonlRecord} from "../src/lib/schemas";
import {aggregateSessionEdits} from "../src/lib/session-edits-diff";
import {aggregateTurnEdits, collectTurnChanges} from "../src/lib/turn-changes";

const hunk = (lines: string[]) => ({oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines});

describe("toolResultMetaFrom structuredPatch stats", () => {
	const writeInput = {file_path: "/repo/a.txt", content: "b\nc\nd\n"};
	const writeResult = {
		type: "update",
		filePath: "/repo/a.txt",
		content: "b\nc\nd\n",
		structuredPatch: [hunk(["-a", "+b", "+c", " d"])],
		originalFile: "a\nd\n",
	};
	const editInput = {file_path: "/repo/a.txt", old_string: "a", new_string: "b\nc"};
	const editResult = {
		filePath: "/repo/a.txt",
		oldString: "a",
		newString: "b\nc",
		originalFile: "a\nd\n",
		structuredPatch: [hunk(["-a", "+b", "+c", " d"])],
	};

	it("counts the patch's lines when the result reports the call's own file and change", () => {
		expect({
			write: toolResultMetaFrom(writeResult, {name: "Write", input: writeInput}),
			emptiedUpdate: toolResultMetaFrom({...writeResult, content: ""}, {name: "Write", input: writeInput}),
			edit: toolResultMetaFrom(editResult, {name: "Edit", input: editInput}),
			multiEdit: toolResultMetaFrom(
				{
					filePath: "/repo/a.txt",
					edits: [{old_string: "a", new_string: "b\nc"}],
					originalFileContents: "a\nd\n",
					structuredPatch: [hunk(["-a", "+b", "+c", " d"])],
				},
				{name: "MultiEdit", input: {file_path: "/repo/a.txt", edits: [{old_string: "a", new_string: "b\nc"}]}},
			),
		}).toStrictEqual({
			write: {writeType: "update", patchStats: {added: 2, removed: 1}},
			emptiedUpdate: {writeType: "update", patchStats: {added: 2, removed: 1}},
			edit: {patchStats: {added: 2, removed: 1}},
			multiEdit: {patchStats: {added: 2, removed: 1}},
		});
	});

	it("ignores a patch that is empty, marker-only, or not the call's own change", () => {
		expect({
			created: toolResultMetaFrom(
				{type: "create", filePath: "/repo/a.txt", content: "b\n", structuredPatch: [], originalFile: null},
				{name: "Write", input: {file_path: "/repo/a.txt", content: "b\n"}},
			),
			markerOnly: toolResultMetaFrom(
				{...writeResult, structuredPatch: [hunk(["\\ No newline at end of file"])]},
				{name: "Write", input: writeInput},
			),
			stampedContent: toolResultMetaFrom(
				{...writeResult, content: "stamped\nb\nc\nd\n"},
				{name: "Write", input: writeInput},
			),
			otherFile: toolResultMetaFrom(writeResult, {
				name: "Write",
				input: {...writeInput, file_path: "/repo/b.txt"},
			}),
			otherEdit: toolResultMetaFrom(editResult, {name: "Edit", input: {...editInput, old_string: "x"}}),
			noCall: toolResultMetaFrom(writeResult),
		}).toStrictEqual({
			created: {writeType: "create"},
			markerOnly: {writeType: "update"},
			stampedContent: {writeType: "update"},
			otherFile: {writeType: "update"},
			otherEdit: undefined,
			noCall: {writeType: "update"},
		});
	});
});

describe("diffStatsForCall with structuredPatch stats", () => {
	it("prefers the patch's counts over counting the call's input", () => {
		const content = "b\nc\nd\n";
		expect({
			writeUpdate: diffStatsForCall({
				name: "Write",
				input: {file_path: "/repo/a.txt", content},
				resultMeta: {writeType: "update", patchStats: {added: 2, removed: 1}},
			}),
			writeCreate: diffStatsForCall({
				name: "Write",
				input: {file_path: "/repo/a.txt", content},
				resultMeta: {writeType: "create"},
			}),
			edit: diffStatsForCall({
				name: "Edit",
				input: {file_path: "/repo/a.txt", old_string: "x", new_string: "y"},
				resultMeta: {patchStats: {added: 2, removed: 2}},
			}),
		}).toStrictEqual({
			writeUpdate: {added: 2, removed: 1},
			writeCreate: {added: 3, removed: 0},
			edit: {added: 2, removed: 2},
		});
	});
});

/** The tool calls of a processed transcript, each carrying its result's outcome. */
function callsOf(records: unknown[]): ToolCallLike[] {
	const {lines, toolResultMap} = processTranscript(records);
	const calls: ToolCallLike[] = [];
	for (const line of lines) {
		const content = line.type === "assistant" ? line.message?.content : undefined;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block.type !== "tool_use") continue;
			const result = toolResultMap.get(block.id);
			calls.push({
				id: block.id,
				name: block.name,
				input: block.input,
				isError: result?.isError,
				resultMeta: result?.resultMeta,
			});
		}
	}
	return calls;
}

describe("01d132c8:835-841 Write that updated justfile", () => {
	const records = readFileSync(join(import.meta.dirname, "fixtures/01d132c8-write-update.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as unknown);
	const calls = callsOf(records);
	const write = calls.find((call) => call.name === "Write" && call.isError !== true);

	it("reads +46 −3 from the patch on the row, the group header, and the changes card", () => {
		const header = summarizeToolCallStats(calls);
		const card = aggregateTurnEdits(calls);
		expect({
			row: write === undefined ? null : diffStatsForCall(write),
			header: {added: header.added, removed: header.removed},
			card: {added: card.added, removed: card.removed},
		}).toStrictEqual({
			row: {added: 46, removed: 3},
			header: {added: 46, removed: 3},
			card: {added: 46, removed: 3},
		});
	});
});

function fixtureLines(name: string): string[] {
	return readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")
		.trim()
		.split("\n");
}

/** The turn's two Writes: justfile updated (01d132c8:835-841), then sync-template.md created (966-968). */
describe("01d132c8's turn that updated justfile and created sync-template.md", () => {
	const lines = [...fixtureLines("01d132c8-write-update.jsonl"), ...fixtureLines("01d132c8-write-create.jsonl")];
	const justfile = "/Users/craig/projects/playdate-template-sync-project-template/justfile";
	const syncTemplate =
		"/Users/craig/projects/playdate-template-sync-project-template/.claude/commands/sync-template.md";

	it("totals the changes card +193 −3 with justfile +46 −3, as upstream does", () => {
		const transcript = processTranscript(lines.map((line) => JSON.parse(line) as unknown));
		const cards = [...collectTurnChanges(transcript.lines, transcript.toolResultMap).values()];
		expect(cards.map(({files, added, removed}) => ({files, added, removed}))).toStrictEqual([
			{
				files: [
					{path: justfile, added: 46, removed: 3},
					{path: syncTemplate, added: 147, removed: 0},
				],
				added: 193,
				removed: 3,
			},
		]);
	});

	it("counts the same stats in the Changes pane's session-edits diff", () => {
		const records = lines.flatMap((line) => parseJsonlRecord(line) ?? []);
		expect(
			aggregateSessionEdits(records).map(({path, additions, deletions}) => ({path, additions, deletions})),
		).toStrictEqual([
			{path: syncTemplate, additions: 147, deletions: 0},
			{path: justfile, additions: 46, deletions: 3},
		]);
	});
});

interface WriteSpecimen {
	session: string;
	line: number;
	upstream: string;
	input: Record<string, unknown>;
	toolUseResult: unknown;
}

/**
 * Successful Write updates from the 300 newest local transcripts, with the
 * stat upstream draws: the structuredPatch's +/- line counts when the result
 * reports the call's own content, else the content's line count (memory files
 * the CLI stamped). Identical contents are stubbed with one shared hash and
 * patch lines are cut to 24 characters, which keeps both rules intact.
 */
describe("Write update golden specimens", () => {
	it.each(specimens as WriteSpecimen[])("$session:$line reads $upstream", (specimen) => {
		const call = {name: "Write", input: specimen.input};
		const stats = diffStatsForCall({...call, resultMeta: toolResultMetaFrom(specimen.toolUseResult, call)});
		expect(`+${stats.added} −${stats.removed}`).toBe(specimen.upstream);
	});
});
