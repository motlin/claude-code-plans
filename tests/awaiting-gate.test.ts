import {beforeEach, describe, expect, it} from "vite-plus/test";

import {
	clearQuickReplyDraft,
	isQuickReplyQuestion,
	openToAnswerLabel,
	QUICK_REPLY_DRAFT_TTL_MS,
	questionsText,
	readQuickReplyDraft,
	stripInlineMarkdown,
	resolveAwaitingGate,
	truncateCodePoints,
	writeQuickReplyDraft,
} from "../src/lib/awaiting-gate";
import type {PendingQuestionItem} from "../src/lib/hook-events";

const SINGLE: PendingQuestionItem = {
	question: "  How should I proceed?  \n\n  Pick one. ",
	options: [{label: "**Fix** the network"}, {label: "Prime the cache"}],
};

describe("question text", () => {
	it("trims lines, drops blanks and joins every question with newlines", () => {
		expect(questionsText([SINGLE, {question: "And then?", options: []}])).toBe(
			"How should I proceed?\nPick one.\nAnd then?",
		);
	});

	it("caps at 280 code points with an ellipsis", () => {
		const emoji = "😀".repeat(300);

		expect(Array.from(truncateCodePoints(emoji, 280)).length).toBe(281);
		expect(truncateCodePoints("short", 280)).toBe("short");
	});

	it("allows quick reply only for exactly one single-select question", () => {
		expect({
			single: isQuickReplyQuestion([SINGLE]),
			multi: isQuickReplyQuestion([{...SINGLE, multiSelect: true}]),
			two: isQuickReplyQuestion([SINGLE, SINGLE]),
			none: isQuickReplyQuestion([]),
		}).toStrictEqual({single: true, multi: false, two: false, none: false});
	});

	it("pluralises upstream's open-to-answer footer", () => {
		expect([openToAnswerLabel(1), openToAnswerLabel(4)]).toStrictEqual([
			"1 question — open to answer",
			"4 questions — open to answer",
		]);
	});
});

describe("chip labels", () => {
	it("strips inline markdown as upstream's option chips do", () => {
		expect(
			["**Fix** the network", "Use `uv` via _IPv4_", "[Docs](https://example.com) first", "~~old~~ new"].map(
				stripInlineMarkdown,
			),
		).toStrictEqual(["Fix the network", "Use uv via IPv4", "Docs first", "old new"]);
	});
});

describe("resolveAwaitingGate", () => {
	it("prefers the hook's pending question", () => {
		expect(
			resolveAwaitingGate({
				pendingQuestion: {toolUseId: "toolu_1", questions: [SINGLE]},
				approval: undefined,
				permission: null,
			}),
		).toStrictEqual({kind: "question", toolUseId: "toolu_1", questions: [SINGLE], answerable: true});
	});

	it("falls back to the transcript's question, which the hover card cannot answer", () => {
		expect(
			resolveAwaitingGate({
				pendingQuestion: null,
				approval: {
					toolName: "AskUserQuestion",
					toolUseId: "toolu_2",
					planFilename: null,
					questionPreview: "Which database?",
					questionOptions: ["Postgres"],
				},
				permission: null,
			}),
		).toStrictEqual({
			kind: "question",
			toolUseId: "toolu_2",
			questions: [{question: "Which database?", options: [{label: "Postgres"}]}],
			answerable: false,
		});
	});

	it("reads a plan approval, then a permission prompt, then no gate", () => {
		expect([
			resolveAwaitingGate({
				pendingQuestion: null,
				approval: {
					toolName: "ExitPlanMode",
					toolUseId: "toolu_3",
					planFilename: "brave-plan.md",
					questionPreview: null,
					questionOptions: [],
				},
				permission: null,
			}),
			resolveAwaitingGate({
				pendingQuestion: null,
				approval: undefined,
				permission: "Claude needs your permission to use Bash",
			}),
			resolveAwaitingGate({pendingQuestion: null, approval: undefined, permission: null}),
		]).toStrictEqual([
			{kind: "plan", planFilename: "brave-plan.md"},
			{kind: "permission", message: "Claude needs your permission to use Bash"},
			{kind: "none"},
		]);
	});
});

describe("quick reply drafts", () => {
	beforeEach(() => {
		clearQuickReplyDraft("s1\nq");
	});

	it("keeps unsent text for ten minutes per session and question", () => {
		writeQuickReplyDraft("s1\nq", "half a thought", 1000);

		expect({
			soon: readQuickReplyDraft("s1\nq", 1000 + QUICK_REPLY_DRAFT_TTL_MS - 1),
			other: readQuickReplyDraft("s2\nq", 1000),
			expired: readQuickReplyDraft("s1\nq", 1000 + QUICK_REPLY_DRAFT_TTL_MS),
		}).toStrictEqual({soon: "half a thought", other: "", expired: ""});
	});

	it("drops a draft cleared to empty", () => {
		writeQuickReplyDraft("s1\nq", "text", 0);
		writeQuickReplyDraft("s1\nq", "", 1);

		expect(readQuickReplyDraft("s1\nq", 2)).toBe("");
	});
});
