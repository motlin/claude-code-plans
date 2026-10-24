import {describe, expect, it} from "vite-plus/test";
import {computeAbandoned} from "../src/lib/transcript-chain";

/**
 * Tests for `computeAbandoned` in `src/lib/transcript-chain.ts`.
 *
 * The CLI keeps abandoned branches (a prompt pulled back and resent, or an
 * interrupted reply followed by a re-parented prompt) in the JSONL. Its resume
 * loader walks `parentUuid` from the leaf, so those rows are off the active
 * chain. These fixtures copy the real record shapes from local sessions
 * (649c3fab, 2dda9ba6, 19713d22, 7e8c9305; see
 * .llm/upstream-sync/features/transcript-active-chain-paging.md) and pin the
 * narrow rule: hide only the subtrees of user-prompt siblings that share a
 * parent with an on-chain prompt, and nothing else.
 */

type Rec = Record<string, unknown>;

const SESSION = "649c3fab-5700-45e7-924b-d2a1377079b0";

function base(type: string, uuid: string, parentUuid: string | null, timestamp: string): Rec {
	return {type, uuid, parentUuid, isSidechain: false, sessionId: SESSION, timestamp};
}

function prompt(uuid: string, parentUuid: string | null, text: string, timestamp: string): Rec {
	return {...base("user", uuid, parentUuid, timestamp), message: {role: "user", content: text}};
}

function attachment(uuid: string, parentUuid: string, timestamp: string): Rec {
	return {
		...base("attachment", uuid, parentUuid, timestamp),
		attachment: {type: "total_tokens_reminder", text: "<total_tokens>15000000 tokens left</total_tokens>"},
	};
}

function assistantText(uuid: string, parentUuid: string, text: string, timestamp: string, id = `msg_${uuid}`): Rec {
	return {
		...base("assistant", uuid, parentUuid, timestamp),
		message: {id, role: "assistant", content: [{type: "text", text}]},
	};
}

function assistantToolUse(uuid: string, parentUuid: string, toolUseId: string, timestamp: string, id: string): Rec {
	return {
		...base("assistant", uuid, parentUuid, timestamp),
		message: {
			id,
			role: "assistant",
			content: [{type: "tool_use", id: toolUseId, name: "Read", input: {file_path: "/tmp/x"}}],
		},
	};
}

function toolResult(uuid: string, parentUuid: string, toolUseId: string, timestamp: string): Rec {
	return {
		...base("user", uuid, parentUuid, timestamp),
		message: {role: "user", content: [{type: "tool_result", tool_use_id: toolUseId, content: "ok"}]},
	};
}

function system(uuid: string, parentUuid: string | null, timestamp: string): Rec {
	return {...base("system", uuid, parentUuid, timestamp), subtype: "turn_duration", durationMs: 1000};
}

/** The head of the 649c3fab session: a reply and the system rows that close its turn. */
function chapterOneHead(): Rec[] {
	return [
		prompt("p1", null, "do chapter 1", "2026-09-30T13:00:00.000Z"),
		assistantText("a1", "p1", "Chapter 1 is ready.", "2026-09-30T13:08:53.592Z"),
		system("s1", "a1", "2026-09-30T13:08:54.044Z"),
		system("s2", "s1", "2026-09-30T13:08:54.051Z"),
		system("s3", "s2", "2026-09-30T13:11:56.909Z"),
	];
}

describe("computeAbandoned", () => {
	it("hides a prompt pulled back and resent, with its attachments (649c3fab L465/468)", () => {
		const records = [
			...chapterOneHead(),
			prompt("ch2", "s3", "do chapter 2", "2026-09-30T13:52:07.635Z"),
			attachment("ch2-att1", "ch2", "2026-09-30T13:52:07.635Z"),
			attachment("ch2-att2", "ch2-att1", "2026-09-30T13:52:07.635Z"),
			prompt("ch3", "s3", "do chapter 3", "2026-09-30T13:52:15.980Z"),
			attachment("ch3-att1", "ch3", "2026-09-30T13:52:15.980Z"),
			assistantText("a3", "ch3-att1", "Chapter 3 is ready.", "2026-09-30T14:00:00.000Z"),
		];

		const result = computeAbandoned(records);

		expect(result).toStrictEqual({
			hidden: new Set(["ch2", "ch2-att1", "ch2-att2"]),
			cuts: [
				{
					parentUuid: "s3",
					replacementUuid: "ch3",
					abandonedUuid: "ch2",
					at: "2026-09-30T13:52:07.635Z",
					count: 3,
				},
			],
		});
	});

	it("hides an interrupted branch whose replacement prompt was re-parented (2dda9ba6 L1928-1938)", () => {
		const records = [
			...chapterOneHead(),
			prompt("ab", "s3", "refactor the loader", "2026-10-01T09:00:00.000Z"),
			attachment("ab-att1", "ab", "2026-10-01T09:00:00.000Z"),
			attachment("ab-att2", "ab-att1", "2026-10-01T09:00:00.000Z"),
			attachment("ab-att3", "ab-att2", "2026-10-01T09:00:00.000Z"),
			attachment("ab-att4", "ab-att3", "2026-10-01T09:00:00.000Z"),
			attachment("ab-att5", "ab-att4", "2026-10-01T09:00:00.000Z"),
			attachment("ab-att6", "ab-att5", "2026-10-01T09:00:00.000Z"),
			assistantText("ab-a1", "ab-att6", "Let me look.", "2026-10-01T09:00:05.000Z", "msg_ab"),
			assistantText("ab-a2", "ab-a1", "Reading the loader.", "2026-10-01T09:00:06.000Z", "msg_ab"),
			assistantToolUse("ab-a3", "ab-a2", "toolu_dangling", "2026-10-01T09:00:07.000Z", "msg_ab"),
			prompt("re", "s3", "actually, refactor the writer", "2026-10-01T09:00:20.000Z"),
			assistantText("re-a1", "re", "On it.", "2026-10-01T09:00:25.000Z"),
		];

		const result = computeAbandoned(records);

		expect(result).toStrictEqual({
			hidden: new Set([
				"ab",
				"ab-att1",
				"ab-att2",
				"ab-att3",
				"ab-att4",
				"ab-att5",
				"ab-att6",
				"ab-a1",
				"ab-a2",
				"ab-a3",
			]),
			cuts: [
				{
					parentUuid: "s3",
					replacementUuid: "re",
					abandonedUuid: "ab",
					at: "2026-10-01T09:00:00.000Z",
					count: 10,
				},
			],
		});
	});

	it("keeps parallel tool results, which are chain siblings by design (19713d22 L77-80)", () => {
		const records = [
			prompt("p1", null, "read three files", "2026-10-02T10:00:00.000Z"),
			assistantToolUse("t1", "p1", "toolu_1", "2026-10-02T10:00:01.000Z", "msg_par"),
			assistantToolUse("t2", "t1", "toolu_2", "2026-10-02T10:00:01.100Z", "msg_par"),
			assistantToolUse("t3", "t2", "toolu_3", "2026-10-02T10:00:01.200Z", "msg_par"),
			toolResult("r1", "t1", "toolu_1", "2026-10-02T10:00:02.000Z"),
			toolResult("r2", "t2", "toolu_2", "2026-10-02T10:00:02.100Z"),
			toolResult("r3", "t3", "toolu_3", "2026-10-02T10:00:02.200Z"),
			assistantText("a2", "r3", "All three read.", "2026-10-02T10:00:03.000Z"),
		];

		expect(computeAbandoned(records)).toStrictEqual({hidden: new Set(), cuts: []});
	});

	it("keeps a compact boundary's preserved segment and does not loop on logicalParentUuid (7e8c9305 L5408)", () => {
		const records = [
			prompt("p1", null, "start", "2026-10-03T08:00:00.000Z"),
			assistantText("a1", "p1", "Started.", "2026-10-03T08:00:01.000Z"),
			prompt("p2", "a1", "continue", "2026-10-03T08:10:00.000Z"),
			assistantText("a2", "p2", "Continued.", "2026-10-03T08:10:01.000Z"),
			{
				...system("cb", null, "2026-10-03T08:20:00.000Z"),
				subtype: "compact_boundary",
				logicalParentUuid: "a2",
				compactMetadata: {trigger: "auto", preTokens: 160000},
			},
			{
				...prompt(
					"sum",
					"cb",
					"This session is being continued from a previous conversation.",
					"2026-10-03T08:20:01.000Z",
				),
				isCompactSummary: true,
			},
			prompt("p3", "sum", "keep going", "2026-10-03T08:30:00.000Z"),
			assistantText("a3", "p3", "Kept going.", "2026-10-03T08:30:01.000Z"),
		];

		expect(computeAbandoned(records)).toStrictEqual({hidden: new Set(), cuts: []});
	});

	it("terminates on a parentUuid cycle and hides nothing", () => {
		const records = [
			prompt("p1", "a2", "loop start", "2026-10-04T08:00:00.000Z"),
			assistantText("a1", "p1", "One.", "2026-10-04T08:00:01.000Z"),
			prompt("p2", "a1", "loop again", "2026-10-04T08:00:02.000Z"),
			assistantText("a2", "p2", "Two.", "2026-10-04T08:00:03.000Z"),
		];

		expect(computeAbandoned(records)).toStrictEqual({hidden: new Set(), cuts: []});
	});

	it("hides nothing in a linear session", () => {
		const records = [
			...chapterOneHead(),
			prompt("p2", "s3", "do chapter 2", "2026-09-30T13:52:07.635Z"),
			attachment("p2-att1", "p2", "2026-09-30T13:52:07.635Z"),
			assistantText("a2", "p2-att1", "Chapter 2 is ready.", "2026-09-30T14:00:00.000Z"),
			{type: "last-prompt", lastPrompt: "do chapter 2", leafUuid: "a2", sessionId: SESSION},
		];

		expect(computeAbandoned(records)).toStrictEqual({hidden: new Set(), cuts: []});
	});

	it("follows a last-prompt leafUuid naming the older branch, hiding the newer one", () => {
		const records = [
			...chapterOneHead(),
			prompt("ch2", "s3", "do chapter 2", "2026-09-30T13:52:07.635Z"),
			attachment("ch2-att1", "ch2", "2026-09-30T13:52:07.635Z"),
			prompt("ch3", "s3", "do chapter 3", "2026-09-30T13:52:15.980Z"),
			attachment("ch3-att1", "ch3", "2026-09-30T13:52:15.980Z"),
			assistantText("a3", "ch3-att1", "Chapter 3 is ready.", "2026-09-30T14:00:00.000Z"),
			{type: "last-prompt", lastPrompt: "do chapter 3", leafUuid: "a3", sessionId: SESSION},
			{type: "last-prompt", lastPrompt: "do chapter 2", leafUuid: "ch2-att1", sessionId: SESSION},
		];

		expect(computeAbandoned(records)).toStrictEqual({
			hidden: new Set(["ch3", "ch3-att1", "a3"]),
			cuts: [
				{
					parentUuid: "s3",
					replacementUuid: "ch2",
					abandonedUuid: "ch3",
					at: "2026-09-30T13:52:15.980Z",
					count: 3,
				},
			],
		});
	});

	it("ignores a last-prompt leafUuid that names no record", () => {
		const records = [
			...chapterOneHead(),
			prompt("ch2", "s3", "do chapter 2", "2026-09-30T13:52:07.635Z"),
			prompt("ch3", "s3", "do chapter 3", "2026-09-30T13:52:15.980Z"),
			{type: "last-prompt", lastPrompt: "gone", leafUuid: "missing", sessionId: SESSION},
		];

		expect(computeAbandoned(records)).toStrictEqual({
			hidden: new Set(["ch2"]),
			cuts: [
				{
					parentUuid: "s3",
					replacementUuid: "ch3",
					abandonedUuid: "ch2",
					at: "2026-09-30T13:52:07.635Z",
					count: 1,
				},
			],
		});
	});

	it("does not treat meta, tool-result, or task-notification siblings as prompts", () => {
		const records = [
			...chapterOneHead(),
			{...prompt("meta", "s3", "Caveat: local command output", "2026-09-30T13:50:00.000Z"), isMeta: true},
			prompt("notif", "s3", "<task-notification>done</task-notification>", "2026-09-30T13:51:00.000Z"),
			prompt("ch2", "s3", "do chapter 2", "2026-09-30T13:52:07.635Z"),
			assistantText("a2", "ch2", "Chapter 2 is ready.", "2026-09-30T14:00:00.000Z"),
		];

		expect(computeAbandoned(records)).toStrictEqual({hidden: new Set(), cuts: []});
	});

	it("never hides sidechain rows or the leaf when the last record is a sidechain", () => {
		const records = [
			...chapterOneHead(),
			prompt("ch2", "s3", "do chapter 2", "2026-09-30T13:52:07.635Z"),
			prompt("ch3", "s3", "do chapter 3", "2026-09-30T13:52:15.980Z"),
			{...prompt("side", "ch3", "subagent prompt", "2026-09-30T13:52:20.000Z"), isSidechain: true},
		];

		expect(computeAbandoned(records)).toStrictEqual({
			hidden: new Set(["ch2"]),
			cuts: [
				{
					parentUuid: "s3",
					replacementUuid: "ch3",
					abandonedUuid: "ch2",
					at: "2026-09-30T13:52:07.635Z",
					count: 1,
				},
			],
		});
	});
});
