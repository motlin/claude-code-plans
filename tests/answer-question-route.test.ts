import {describe, expect, it} from "vite-plus/test";

import {answerQuestionBodySchema} from "../src/routes/api/answer-question";

describe("POST /api/answer-question body, as upstream's response payload", () => {
	const body = (response: unknown, extra: Record<string, unknown> = {}) => ({
		sessionId: "s1",
		toolUseId: "toolu_1",
		answers: [{question: "Which?", response, ...extra}],
	});

	it("accepts a string or a non-empty string array response, with an optional preview", () => {
		expect(
			[body(["a", "b"]), body("Grid", {preview: "<grid/>"})].map(
				(entry) => answerQuestionBodySchema.safeParse(entry).success,
			),
		).toStrictEqual([true, true]);
	});

	it("rejects an empty array, the old answer key and unknown keys", () => {
		expect(
			[
				body([]),
				{sessionId: "s1", toolUseId: "toolu_1", answers: [{question: "Which?", answer: "a"}]},
				body("a", {notes: "x"}),
			].map((entry) => answerQuestionBodySchema.safeParse(entry).success),
		).toStrictEqual([false, false, false]);
	});
});
