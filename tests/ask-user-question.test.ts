import {describe, expect, it} from "vite-plus/test";
import {
	answerForQuestion,
	formatAnswerPrompt,
	makeInitialDraft,
	normalizeQuestions,
	OUTCOME_LABEL,
	parseAnswerResult,
	questionOutcome,
	questionOutcomes,
	type QuestionLike,
} from "../src/lib/ask-user-question";

describe("formatAnswerPrompt", () => {
	it("formats a single answer as the canonical Claude Code reply text", () => {
		const result = formatAnswerPrompt("toolu_abc", [{question: "Continue?", answer: "Yes"}]);
		expect(result).toContain("toolu_abc");
		expect(result).toContain('"Continue?"="Yes"');
		expect(result).toContain("Your questions have been answered:");
		expect(result).toContain("with these answers in mind");
	});

	it("joins multiple question/answer pairs with commas", () => {
		const result = formatAnswerPrompt("toolu_xyz", [
			{question: "Q1", answer: "A1"},
			{question: "Q2", answer: "A2"},
		]);
		expect(result).toContain('"Q1"="A1", "Q2"="A2"');
	});

	it("escapes embedded double quotes in question and answer text", () => {
		const result = formatAnswerPrompt("toolu_q", [{question: 'Say "hi"?', answer: 'No "thanks"'}]);
		expect(result).toContain('\\"hi\\"');
		expect(result).toContain('\\"thanks\\"');
	});
});

describe("normalizeQuestions", () => {
	it("returns the multi-question list unchanged when present", () => {
		const input = {
			questions: [
				{
					question: "Pick one",
					options: [{label: "A"}, {label: "B"}],
					multiSelect: false,
				},
			],
		};
		const result = normalizeQuestions(input);
		if (!result) throw new Error("Expected result to be non-null");
		expect(result.map((r) => r.question)).toStrictEqual(["Pick one"]);
	});

	it("wraps a single-question shape into a one-element list", () => {
		const input = {
			question: "Continue?",
			options: [{label: "Yes"}, {label: "No"}],
			multiSelect: true,
			header: "Confirm",
		};
		const result = normalizeQuestions(input);
		expect(result).toStrictEqual([
			{
				question: "Continue?",
				options: [{label: "Yes"}, {label: "No"}],
				multiSelect: true,
				header: "Confirm",
			},
		]);
	});

	it("returns null when input has neither shape", () => {
		expect(normalizeQuestions({})).toBe(null);
		expect(normalizeQuestions({question: "Q", options: []})).toBe(null);
		expect(normalizeQuestions({questions: []})).toBe(null);
	});
});

describe("answerForQuestion", () => {
	const single: QuestionLike = {
		question: "Pick one",
		options: [{label: "A"}, {label: "B"}, {label: "C"}],
	};
	const multi: QuestionLike = {
		question: "Pick any",
		options: [{label: "A"}, {label: "B"}, {label: "C"}],
		multiSelect: true,
	};

	it("returns null when nothing is selected", () => {
		expect(answerForQuestion(single, makeInitialDraft())).toBe(null);
	});

	it("returns the single selected label for non-multi questions", () => {
		const draft = {selected: new Set(["B"]), otherText: "", useOther: false};
		expect(answerForQuestion(single, draft)).toBe("B");
	});

	it("joins selected labels for multi-select questions", () => {
		const draft = {
			selected: new Set(["A", "C"]),
			otherText: "",
			useOther: false,
		};
		const result = answerForQuestion(multi, draft);
		expect(result).not.toBe(null);
		expect(result!.split(", ").toSorted()).toStrictEqual(["A", "C"]);
	});

	it("returns the trimmed Other text when useOther is true", () => {
		const draft = {
			selected: new Set<string>(),
			otherText: "  custom value  ",
			useOther: true,
		};
		expect(answerForQuestion(single, draft)).toBe("custom value");
	});

	it("returns null when Other is selected but the text is empty", () => {
		const draft = {
			selected: new Set<string>(),
			otherText: "   ",
			useOther: true,
		};
		expect(answerForQuestion(single, draft)).toBe(null);
	});
});

describe("parseAnswerResult", () => {
	const q = (question: string, options: Array<{label: string}> = []): QuestionLike => ({
		question,
		options,
	});

	it("parses a single Q/A pair without notes", () => {
		const text =
			'User has answered your questions: "Continue?"="Yes". You can now continue with the user\'s answers in mind.';
		const result = parseAnswerResult(text, [q("Continue?", [{label: "Yes"}, {label: "No"}])]);
		expect(result).toStrictEqual([{question: "Continue?", answer: "Yes", notes: null}]);
	});

	it("parses a single Q/A pair with user notes", () => {
		const text =
			'User has answered your questions: "Continue?"="Other thing" user notes: Other thing.' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q("Continue?", [{label: "Yes"}])]);
		expect(result).toStrictEqual([{question: "Continue?", answer: "Other thing", notes: "Other thing"}]);
	});

	it("parses multiple Q/A pairs separated by commas", () => {
		const text =
			'User has answered your questions: "Q1"="A1", "Q2"="A2".' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q("Q1"), q("Q2")]);
		expect(result).toStrictEqual([
			{question: "Q1", answer: "A1", notes: null},
			{question: "Q2", answer: "A2", notes: null},
		]);
	});

	it("parses multiple Q/A pairs where notes contain commas", () => {
		const text =
			'User has answered your questions: "Q1"="Other" user notes: foo, bar, baz, "Q2"="A2" user notes: hello, world.' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q("Q1"), q("Q2")]);
		expect(result).toStrictEqual([
			{question: "Q1", answer: "Other", notes: "foo, bar, baz"},
			{question: "Q2", answer: "A2", notes: "hello, world"},
		]);
	});

	it("handles questions containing escaped double quotes", () => {
		const text =
			'User has answered your questions: "Say \\"hi\\"?"="No \\"thanks\\"".' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q('Say "hi"?')]);
		expect(result).toStrictEqual([{question: 'Say "hi"?', answer: 'No "thanks"', notes: null}]);
	});

	it("handles questions containing newlines", () => {
		const text =
			'User has answered your questions: "Item 1\nDetails"="Accept", "Item 2\nMore"="Other" user notes: Other.' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q("Item 1\nDetails"), q("Item 2\nMore")]);
		expect(result).toStrictEqual([
			{question: "Item 1\nDetails", answer: "Accept", notes: null},
			{question: "Item 2\nMore", answer: "Other", notes: "Other"},
		]);
	});

	it("returns null when the text does not match the expected envelope", () => {
		expect(parseAnswerResult("garbage text", [q("Q1")])).toBe(null);
		expect(parseAnswerResult("", [q("Q1")])).toBe(null);
	});

	it("returns null when no questions are provided", () => {
		const text =
			'User has answered your questions: "Q1"="A1". You can now continue with the user\'s answers in mind.';
		expect(parseAnswerResult(text, [])).toBe(null);
	});

	it('handles "selected preview:" annotations in the remainder', () => {
		const preview =
			"┌─ user side ──────────────────┐\n│ $ git status                 │\n└──────────────────────────────┘";
		const text =
			'User has answered your questions: "How should it render?"="Combined bubble" selected preview:\n' +
			preview +
			', "How should stderr render?"="Red error styling".' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [
			q("How should it render?", [{label: "Combined bubble"}]),
			q("How should stderr render?", [{label: "Red error styling"}]),
		]);
		expect(result).toStrictEqual([
			{
				question: "How should it render?",
				answer: "Combined bubble",
				notes: null,
			},
			{
				question: "How should stderr render?",
				answer: "Red error styling",
				notes: null,
			},
		]);
	});

	it('handles both "user notes:" and "selected preview:" annotations', () => {
		const text =
			'User has answered your questions: "Pick one?"="Option A" user notes: some detail selected preview:\nfoo.' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q("Pick one?", [{label: "Option A"}])]);
		expect(result).toStrictEqual([{question: "Pick one?", answer: "Option A", notes: "some detail"}]);
	});

	it("handles unknown annotations in the remainder without failing", () => {
		const text =
			'User has answered your questions: "Q1?"="A1" some future annotation: data.' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q("Q1?", [{label: "A1"}])]);
		expect(result).toStrictEqual([{question: "Q1?", answer: "A1", notes: null}]);
	});

	it('parses the real eclipse-collections "Other" answer where notes echo the value', () => {
		// Real example from session 01f99877 - the bug screenshot referenced in
		// task #48. Both questions used 'Other' and the notes are duplicates of
		// the answer values, so the parsed result should mark notes==answer.
		const longAnswer1 =
			"api, eclipse-collections proper, unit-tests and unit-tests-java8. Don't focus on per-package targets" +
			" because compilation is never and has never been split by package. Rather, focus on inheritance." +
			" Count the depth of the number of inheritance, and we can probably compile those in tiers.";
		const longAnswer2 =
			"Per class would be fine. A similar strategy of actions that depend on the parent class/interface" +
			" being compiled first would also work well for test compilation. Running can be done in parallel by class.";
		const text =
			"User has answered your questions:" +
			` "Which target should we focus on splitting?"="${longAnswer1}" user notes: ${longAnswer1},` +
			` "For test sharding, how should shards be generated?"="${longAnswer2}" user notes: ${longAnswer2}.` +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [
			q("Which target should we focus on splitting?"),
			q("For test sharding, how should shards be generated?"),
		]);
		expect(result).not.toBe(null);
		expect(result![0]!.answer).toBe(longAnswer1);
		expect(result![0]!.notes).toBe(longAnswer1);
		expect(result![1]!.answer).toBe(longAnswer2);
		expect(result![1]!.notes).toBe(longAnswer2);
	});
});

describe("parseAnswerResult with the current answer envelope", () => {
	const q = (question: string, options: Array<{label: string}> = []): QuestionLike => ({
		question,
		options,
	});

	it("parses a single Q/A pair", () => {
		const text =
			'Your questions have been answered: "Continue?"="Yes".' +
			" You can now continue with these answers in mind.";
		const result = parseAnswerResult(text, [q("Continue?", [{label: "Yes"}, {label: "No"}])]);
		expect(result).toStrictEqual([{question: "Continue?", answer: "Yes", notes: null}]);
	});

	it("parses multiple Q/A pairs where notes contain commas", () => {
		const text =
			'Your questions have been answered: "Q1"="Other" user notes: foo, bar, baz, "Q2"="A2".' +
			" You can now continue with these answers in mind.";
		const result = parseAnswerResult(text, [q("Q1"), q("Q2")]);
		expect(result).toStrictEqual([
			{question: "Q1", answer: "Other", notes: "foo, bar, baz"},
			{question: "Q2", answer: "A2", notes: null},
		]);
	});

	it('handles " selected preview:" annotations in the remainder', () => {
		const preview = "\u250c\u2500 user side \u2500\u2510\n\u2502 $ git status \u2502\n\u2514\u2500\u2500\u2518";
		const text =
			'Your questions have been answered: "How should it render?"="Combined bubble" selected preview:\n' +
			preview +
			', "How should stderr render?"="Red error styling".' +
			" You can now continue with these answers in mind.";
		const result = parseAnswerResult(text, [
			q("How should it render?", [{label: "Combined bubble"}]),
			q("How should stderr render?", [{label: "Red error styling"}]),
		]);
		expect(result).toStrictEqual([
			{question: "How should it render?", answer: "Combined bubble", notes: null},
			{question: "How should stderr render?", answer: "Red error styling", notes: null},
		]);
	});

	it("returns null when the current prefix appears without its suffix", () => {
		const text = 'Your questions have been answered: "Q1"="A1"';
		expect(parseAnswerResult(text, [q("Q1")])).toBe(null);
	});
});

describe("parseAnswerResult with the read-carefully answer envelope", () => {
	const SUFFIX =
		". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.";
	const q = (question: string): QuestionLike => ({question, options: []});

	it("parses the 45b93197:179 single answer", () => {
		const question = "How do you want to get in without risking a lockout?";
		const text = `The user answered: "${question}"="I think the passkey is NOT getting used, how can I change that"${SUFFIX}`;
		expect(parseAnswerResult(text, [q(question)])).toStrictEqual([
			{question, answer: "I think the passkey is NOT getting used, how can I change that", notes: null},
		]);
	});

	it("parses the 42d634a9 three-question answer set", () => {
		const questions = [
			"What should the new site be built with? You said you'll add content later, so how you'll add it matters.",
			"Where will the new site be hosted? The domain is on Cloudflare now.",
			"What look should the redesign have?",
		];
		const text = `The user answered: "${questions[0]}"="#1, and I want to be able to add guitar tab", "${questions[1]}"="Cloudflare Pages (Recommended)", "${questions[2]}"="all three and let us pick"${SUFFIX}`;
		expect(parseAnswerResult(text, questions.map(q))).toStrictEqual([
			{question: questions[0], answer: "#1, and I want to be able to add guitar tab", notes: null},
			{question: questions[1], answer: "Cloudflare Pages (Recommended)", notes: null},
			{question: questions[2], answer: "all three and let us pick", notes: null},
		]);
	});
});

describe("questionOutcome", () => {
	it("classifies each upstream non-answer sentence and leaves a real answer unclassified", () => {
		const answers = [
			"",
			"[No preference]",
			"The user did not answer this question. Make a reasonable assumption and carry on, but tell the user what assumption you made.",
			"[User did not answer this question — they sent a message instead. Treat that message as their response; do not re-ask.]",
			"[User dismissed — do not proceed, wait for next instruction]",
			"Red",
		];
		expect(answers.map((answer) => questionOutcome(answer))).toStrictEqual([
			"skipped",
			"skipped",
			"skipped",
			"replied",
			"dismissed",
			undefined,
		]);
	});

	it("labels each outcome with upstream's words", () => {
		expect(OUTCOME_LABEL).toStrictEqual({
			skipped: "Skipped",
			replied: "Replied in chat",
			dismissed: "Not answered",
		});
	});
});

describe("questionOutcomes", () => {
	const input = {
		questions: [
			{question: "Q1", header: "First", options: [{label: "Red"}, {label: "Blue"}]},
			{question: "Q2", header: "Second", options: [{label: "Cat"}, {label: "Dog"}]},
		],
	};

	it("gives a question with no recorded answer neither an answer nor an outcome", () => {
		const call = {input, result: "The user did not answer the questions.", resultMeta: {answers: {}}};
		expect(questionOutcomes(call)).toStrictEqual([{question: "Q1"}, {question: "Q2"}]);
	});

	it("splits real answers from classified non-answers", () => {
		const call = {
			input,
			result: 'Your questions have been answered: "Q1"="Red", "Q2"="[No preference]". You can now continue with these answers in mind.',
			resultMeta: {
				answers: {Q1: {answer: "Red", notes: null}, Q2: {answer: "[No preference]", notes: null}},
			},
		};
		expect(questionOutcomes(call)).toStrictEqual([
			{question: "Q1", answer: "Red"},
			{question: "Q2", unanswered: "skipped"},
		]);
	});

	it("falls back to the result text when no structured answers were recorded", () => {
		const call = {
			input,
			result: 'Your questions have been answered: "Q1"="Blue", "Q2"="[User dismissed — do not proceed, wait for next instruction]". You can now continue with these answers in mind.',
		};
		expect(questionOutcomes(call)).toStrictEqual([
			{question: "Q1", answer: "Blue"},
			{question: "Q2", unanswered: "dismissed"},
		]);
	});
});
