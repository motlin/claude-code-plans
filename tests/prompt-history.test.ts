import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	HistoryLineSchema,
	historyNavigator,
	historyKeyApplies,
	mergePromptHistory,
	parseHistoryJsonl,
} from "../src/lib/prompt-history";
import {readPromptHistory} from "../src/lib/prompt-history.server";

function write(file: string, content: string): void {
	mkdirSync(dirname(file), {recursive: true});
	writeFileSync(file, content);
}

function historyLine(display: string, sessionId: string, timestamp: number): string {
	return JSON.stringify({
		display,
		pastedContents: {},
		timestamp,
		project: "/Users/alice/projects/garden",
		sessionId,
	});
}

describe("HistoryLineSchema", () => {
	it("accepts a history.jsonl line with inline and hashed pasted contents", () => {
		const line = {
			display: "Review this [Pasted text #1 +12 lines] and [Pasted text #2 +40 lines]",
			pastedContents: {
				"1": {id: 1, type: "text", content: "alpha\nbeta"},
				"2": {id: 2, type: "text", contentHash: "3f2a9c"},
			},
			timestamp: 1790725341859,
			project: "/Users/alice/projects/garden",
			sessionId: "649c3fab-5700-45e7-924b-d2a1377079b0",
		};
		expect(HistoryLineSchema.parse(line)).toStrictEqual(line);
	});

	it("rejects unknown keys at the top level and inside pasted contents", () => {
		expect(
			HistoryLineSchema.safeParse({
				display: "hi",
				pastedContents: {},
				timestamp: 1,
				project: "/p",
				sessionId: "s",
				extra: true,
			}).success,
		).toBe(false);
		expect(
			HistoryLineSchema.safeParse({
				display: "hi",
				pastedContents: {"1": {id: 1, type: "text", content: "x", mystery: 1}},
				timestamp: 1,
				project: "/p",
				sessionId: "s",
			}).success,
		).toBe(false);
	});
});

describe("parseHistoryJsonl", () => {
	it("returns prompts newest first, skipping blank and malformed lines", () => {
		const text = [
			historyLine("plant tomatoes", "s-alice", 1),
			"",
			"{not json",
			JSON.stringify({display: "missing fields"}),
			historyLine("water the basil", "s-bob", 2),
		].join("\n");
		expect(parseHistoryJsonl(text)).toStrictEqual([
			{display: "water the basil", sessionId: "s-bob"},
			{display: "plant tomatoes", sessionId: "s-alice"},
		]);
	});
});

describe("mergePromptHistory", () => {
	it("puts session prompts first, then the rest, deduped and capped", () => {
		expect(
			mergePromptHistory(
				["second session prompt", "first session prompt"],
				["global newest", "first session prompt", "  ", "global oldest"],
				3,
			),
		).toStrictEqual(["second session prompt", "first session prompt", "global newest"]);
	});
});

describe("historyNavigator", () => {
	const entries = ["newest prompt", "middle prompt", "oldest prompt"];

	it("walks older with up and newer with down, returning to the draft", () => {
		const start = historyNavigator(entries, "half-typed draft");
		const one = start.up();
		const two = one?.up();
		const three = two?.up();
		expect({
			start: start.text,
			one: one?.text,
			two: two?.text,
			three: three?.text,
			pastOldest: three?.up() ?? null,
			back: three?.down()?.text,
			toDraft: one?.down()?.text,
			toDraftActive: one?.down()?.active,
			pastDraft: start.down(),
		}).toStrictEqual({
			start: "half-typed draft",
			one: "newest prompt",
			two: "middle prompt",
			three: "oldest prompt",
			pastOldest: null,
			back: "middle prompt",
			toDraft: "half-typed draft",
			toDraftActive: false,
			pastDraft: null,
		});
	});

	it("keeps the draft through the walk so escape can restore it", () => {
		const walked = historyNavigator(entries, "my draft").up()?.up();
		expect({active: walked?.active, draft: walked?.draft}).toStrictEqual({
			active: true,
			draft: "my draft",
		});
	});

	it("has nothing to walk without entries", () => {
		expect(historyNavigator([], "draft").up()).toBeNull();
	});
});

describe("historyKeyApplies", () => {
	it("lets ArrowUp act only with the caret on the first line", () => {
		expect([
			historyKeyApplies("ArrowUp", "", 0, 0),
			historyKeyApplies("ArrowUp", "one line", 4, 4),
			historyKeyApplies("ArrowUp", "first\nsecond", 3, 3),
			historyKeyApplies("ArrowUp", "first\nsecond", 8, 8),
			historyKeyApplies("ArrowUp", "first line", 0, 5),
		]).toStrictEqual([true, true, true, false, false]);
	});

	it("lets ArrowDown act only with the caret on the last line", () => {
		expect([
			historyKeyApplies("ArrowDown", "", 0, 0),
			historyKeyApplies("ArrowDown", "first\nsecond", 8, 8),
			historyKeyApplies("ArrowDown", "first\nsecond", 2, 2),
			historyKeyApplies("Enter", "", 0, 0),
		]).toStrictEqual([true, true, false, false]);
	});
});

describe("readPromptHistory", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "prompt-history-"));
	});
	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	it("reads session transcript prompts first, then global history", async () => {
		const sessionId = "a1b2c3d4-0000-4000-8000-000000000001";
		write(
			join(root, "projects", "-Users-alice-projects-garden", `${sessionId}.jsonl`),
			[
				JSON.stringify({type: "user", message: {role: "user", content: "plant tomatoes"}}),
				JSON.stringify({
					type: "assistant",
					message: {role: "assistant", content: [{type: "text", text: "Planted."}]},
				}),
				JSON.stringify({
					type: "user",
					message: {
						role: "user",
						content: [{type: "tool_result", tool_use_id: "t1", content: "ok"}],
					},
				}),
				JSON.stringify({
					type: "user",
					isMeta: true,
					message: {role: "user", content: "injected by the CLI"},
				}),
				JSON.stringify({
					type: "user",
					message: {role: "user", content: [{type: "text", text: "now water them"}]},
				}),
			].join("\n"),
		);
		write(
			join(root, "history.jsonl"),
			[
				historyLine("plant tomatoes", sessionId, 1),
				historyLine("unrelated older prompt", "s-bob", 2),
				historyLine("unrelated newer prompt", "s-bob", 3),
			].join("\n"),
		);

		expect(await readPromptHistory({claudeDir: root, sessionId})).toStrictEqual([
			"now water them",
			"plant tomatoes",
			"unrelated newer prompt",
			"unrelated older prompt",
		]);
		expect(await readPromptHistory({claudeDir: root})).toStrictEqual([
			"unrelated newer prompt",
			"unrelated older prompt",
			"plant tomatoes",
		]);
	});

	it("returns nothing when history.jsonl is missing", async () => {
		expect(await readPromptHistory({claudeDir: root})).toStrictEqual([]);
	});
});
