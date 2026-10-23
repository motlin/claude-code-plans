import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import type {QuestionLike} from "../src/lib/ask-user-question";
import {questionAnswerRoute} from "../src/lib/question-answer-route";
import {labelAnswersToPaneAnswers, submitQuestionAnswer} from "../src/lib/question-answer-submit";
import {labelledAnswers} from "../src/lib/question-card-draft";

const QUESTIONS: QuestionLike[] = [
	{question: "Which runner?", options: [{label: "Vitest"}, {label: "Jest"}]},
	{question: "Which features?", multiSelect: true, options: [{label: "Coverage"}, {label: "Watch"}, {label: "UI"}]},
];

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("questionAnswerRoute", () => {
	it("answers in the live pane when the session has a writable pane", () => {
		expect(questionAnswerRoute({live: true, hasLivePane: true, writesEnabled: true})).toBe("live-pane");
	});

	it("is read-only when the session has a pane but terminal writes are disabled", () => {
		expect(questionAnswerRoute({live: true, hasLivePane: true, writesEnabled: false})).toBe("read-only");
	});

	it("is read-only for a live session without a pane", () => {
		expect(questionAnswerRoute({live: true, hasLivePane: false, writesEnabled: true})).toBe("read-only");
	});

	it("is read-only while liveness is unknown", () => {
		expect(questionAnswerRoute({live: null, hasLivePane: false, writesEnabled: true})).toBe("read-only");
	});

	it("is read-only while the pane list is loading", () => {
		expect(questionAnswerRoute({live: false, hasLivePane: null, writesEnabled: false})).toBe("read-only");
	});

	it("offers the fork only when the session is not running and has no pane", () => {
		expect(questionAnswerRoute({live: false, hasLivePane: false, writesEnabled: true})).toBe("fork");
	});
});

describe("labelledAnswers", () => {
	const TOOLS: QuestionLike[] = [
		{question: "Which tool?", multiSelect: true, options: [{label: "Hammer"}, {label: "Saw"}]},
		{question: "Which runner?", options: [{label: "Vitest"}, {label: "Jest"}]},
	];

	it("puts Other's text before the picked labels and answers a skip with [No preference]", () => {
		expect(labelledAnswers(TOOLS, [{selected: [0], other: "x"}, null])).toStrictEqual([
			{question: "Which tool?", answer: "x, Hammer"},
			{question: "Which runner?", answer: "[No preference]"},
		]);
	});

	it("joins multiple labels in option order", () => {
		expect(labelledAnswers(TOOLS, [{selected: [0, 1]}, {selected: [1]}])).toStrictEqual([
			{question: "Which tool?", answer: "Hammer, Saw"},
			{question: "Which runner?", answer: "Jest"},
		]);
	});
});

describe("labelAnswersToPaneAnswers", () => {
	it("maps [No preference] to a skip", () => {
		expect(
			labelAnswersToPaneAnswers(QUESTIONS, [
				{question: "Which runner?", answer: "[No preference]"},
				{question: "Which features?", answer: "[No preference]"},
			]),
		).toStrictEqual([null, null]);
	});

	it("maps option labels to indices, typed text to Other, and blanks to skips", () => {
		expect(
			labelAnswersToPaneAnswers(QUESTIONS, [
				{question: "Which runner?", answer: "Jest"},
				{question: "Which features?", answer: "UI, Coverage"},
			]),
		).toStrictEqual([{selected: [1]}, {selected: [0, 2]}]);
		expect(
			labelAnswersToPaneAnswers(QUESTIONS, [
				{question: "Which runner?", answer: "Mocha"},
				{question: "Which features?", answer: ""},
			]),
		).toStrictEqual([{selected: [], other: "Mocha"}, null]);
	});

	it("treats a multi-select answer that is not all labels as Other text", () => {
		expect(
			labelAnswersToPaneAnswers(QUESTIONS, [
				{question: "Which runner?", answer: "Vitest"},
				{question: "Which features?", answer: "Coverage, snapshots"},
			]),
		).toStrictEqual([{selected: [0]}, {selected: [], other: "Coverage, snapshots"}]);
	});

	it("skips questions that have no answer entry", () => {
		expect(labelAnswersToPaneAnswers(QUESTIONS, [{question: "Which runner?", answer: "Vitest"}])).toStrictEqual([
			{selected: [0]},
			null,
		]);
	});
});

function okFetch() {
	const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url: string) =>
		Promise.resolve(url === "/api/herdr/question" ? Response.json({ok: true}) : new Response("", {status: 200})),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

const SUBMISSION = {
	sessionId: "s1",
	toolUseId: "toolu_1",
	questions: QUESTIONS,
	answers: [
		{question: "Which runner?", answer: "Vitest"},
		{question: "Which features?", answer: ""},
	],
};

describe("submitQuestionAnswer", () => {
	it("types a live-pane answer into the session's herdr pane", async () => {
		const fetchMock = okFetch();
		await submitQuestionAnswer("live-pane", SUBMISSION);
		expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.body])).toStrictEqual([
			[
				"/api/herdr/question",
				JSON.stringify({sessionId: "s1", toolUseId: "toolu_1", answers: [{selected: [0]}, null]}),
			],
		]);
	});

	it("resumes a fork only on the fork route", async () => {
		const fetchMock = okFetch();
		await submitQuestionAnswer("fork", SUBMISSION);
		expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.body])).toStrictEqual([
			[
				"/api/answer-question",
				JSON.stringify({sessionId: "s1", toolUseId: "toolu_1", answers: SUBMISSION.answers}),
			],
		]);
	});

	it("refuses a read-only answer without posting anything", async () => {
		const fetchMock = okFetch();
		await expect(submitQuestionAnswer("read-only", SUBMISSION)).rejects.toThrow("Answer in the terminal");
		expect(fetchMock.mock.calls).toStrictEqual([]);
	});
});
