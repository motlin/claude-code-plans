import {describe, expect, it} from 'vitest';
import {
	answerForQuestion,
	formatAnswerPrompt,
	makeInitialDraft,
	normalizeQuestions,
	parseAnswerResult,
	type QuestionLike,
} from '../src/lib/ask-user-question';

describe('formatAnswerPrompt', () => {
	it('formats a single answer as the canonical Claude Code reply text', () => {
		const result = formatAnswerPrompt('toolu_abc', [{question: 'Continue?', answer: 'Yes'}]);
		expect(result).toContain('toolu_abc');
		expect(result).toContain('"Continue?"="Yes"');
		expect(result).toContain('User has answered your questions:');
		expect(result).toContain("with the user's answers in mind");
	});

	it('joins multiple question/answer pairs with commas', () => {
		const result = formatAnswerPrompt('toolu_xyz', [
			{question: 'Q1', answer: 'A1'},
			{question: 'Q2', answer: 'A2'},
		]);
		expect(result).toContain('"Q1"="A1", "Q2"="A2"');
	});

	it('escapes embedded double quotes in question and answer text', () => {
		const result = formatAnswerPrompt('toolu_q', [{question: 'Say "hi"?', answer: 'No "thanks"'}]);
		expect(result).toContain('\\"hi\\"');
		expect(result).toContain('\\"thanks\\"');
	});
});

describe('normalizeQuestions', () => {
	it('returns the multi-question list unchanged when present', () => {
		const input = {
			questions: [
				{
					question: 'Pick one',
					options: [{label: 'A'}, {label: 'B'}],
					multiSelect: false,
				},
			],
		};
		const result = normalizeQuestions(input);
		if (!result) throw new Error('Expected result to be non-null');
		expect(result.map((r) => r.question)).toStrictEqual(['Pick one']);
	});

	it('wraps a single-question shape into a one-element list', () => {
		const input = {
			question: 'Continue?',
			options: [{label: 'Yes'}, {label: 'No'}],
			multiSelect: true,
			header: 'Confirm',
		};
		const result = normalizeQuestions(input);
		expect(result).toStrictEqual([
			{
				question: 'Continue?',
				options: [{label: 'Yes'}, {label: 'No'}],
				multiSelect: true,
				header: 'Confirm',
			},
		]);
	});

	it('returns null when input has neither shape', () => {
		expect(normalizeQuestions({})).toBe(null);
		expect(normalizeQuestions({question: 'Q', options: []})).toBe(null);
		expect(normalizeQuestions({questions: []})).toBe(null);
	});
});

describe('answerForQuestion', () => {
	const single: QuestionLike = {question: 'Pick one', options: [{label: 'A'}, {label: 'B'}, {label: 'C'}]};
	const multi: QuestionLike = {
		question: 'Pick any',
		options: [{label: 'A'}, {label: 'B'}, {label: 'C'}],
		multiSelect: true,
	};

	it('returns null when nothing is selected', () => {
		expect(answerForQuestion(single, makeInitialDraft())).toBe(null);
	});

	it('returns the single selected label for non-multi questions', () => {
		const draft = {selected: new Set(['B']), otherText: '', useOther: false};
		expect(answerForQuestion(single, draft)).toBe('B');
	});

	it('joins selected labels for multi-select questions', () => {
		const draft = {selected: new Set(['A', 'C']), otherText: '', useOther: false};
		const result = answerForQuestion(multi, draft);
		expect(result).not.toBe(null);
		expect(result!.split(', ').sort()).toStrictEqual(['A', 'C']);
	});

	it('returns the trimmed Other text when useOther is true', () => {
		const draft = {selected: new Set<string>(), otherText: '  custom value  ', useOther: true};
		expect(answerForQuestion(single, draft)).toBe('custom value');
	});

	it('returns null when Other is selected but the text is empty', () => {
		const draft = {selected: new Set<string>(), otherText: '   ', useOther: true};
		expect(answerForQuestion(single, draft)).toBe(null);
	});
});

describe('parseAnswerResult', () => {
	const q = (question: string, options: Array<{label: string}> = []): QuestionLike => ({
		question,
		options,
	});

	it('parses a single Q/A pair without notes', () => {
		const text =
			'User has answered your questions: "Continue?"="Yes". You can now continue with the user\'s answers in mind.';
		const result = parseAnswerResult(text, [q('Continue?', [{label: 'Yes'}, {label: 'No'}])]);
		expect(result).toStrictEqual([{question: 'Continue?', answer: 'Yes', notes: null}]);
	});

	it('parses a single Q/A pair with user notes', () => {
		const text =
			'User has answered your questions: "Continue?"="Other thing" user notes: Other thing.' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q('Continue?', [{label: 'Yes'}])]);
		expect(result).toStrictEqual([{question: 'Continue?', answer: 'Other thing', notes: 'Other thing'}]);
	});

	it('parses multiple Q/A pairs separated by commas', () => {
		const text =
			'User has answered your questions: "Q1"="A1", "Q2"="A2".' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q('Q1'), q('Q2')]);
		expect(result).toStrictEqual([
			{question: 'Q1', answer: 'A1', notes: null},
			{question: 'Q2', answer: 'A2', notes: null},
		]);
	});

	it('parses multiple Q/A pairs where notes contain commas', () => {
		const text =
			'User has answered your questions: "Q1"="Other" user notes: foo, bar, baz, "Q2"="A2" user notes: hello, world.' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q('Q1'), q('Q2')]);
		expect(result).toStrictEqual([
			{question: 'Q1', answer: 'Other', notes: 'foo, bar, baz'},
			{question: 'Q2', answer: 'A2', notes: 'hello, world'},
		]);
	});

	it('handles questions containing escaped double quotes', () => {
		const text =
			'User has answered your questions: "Say \\"hi\\"?"="No \\"thanks\\"".' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q('Say "hi"?')]);
		expect(result).toStrictEqual([{question: 'Say "hi"?', answer: 'No "thanks"', notes: null}]);
	});

	it('handles questions containing newlines', () => {
		const text =
			'User has answered your questions: "Item 1\nDetails"="Accept", "Item 2\nMore"="Other" user notes: Other.' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q('Item 1\nDetails'), q('Item 2\nMore')]);
		expect(result).toStrictEqual([
			{question: 'Item 1\nDetails', answer: 'Accept', notes: null},
			{question: 'Item 2\nMore', answer: 'Other', notes: 'Other'},
		]);
	});

	it('returns null when the text does not match the expected envelope', () => {
		expect(parseAnswerResult('garbage text', [q('Q1')])).toBe(null);
		expect(parseAnswerResult('', [q('Q1')])).toBe(null);
	});

	it('returns null when no questions are provided', () => {
		const text =
			'User has answered your questions: "Q1"="A1".' + " You can now continue with the user's answers in mind.";
		expect(parseAnswerResult(text, [])).toBe(null);
	});

	it('handles "selected preview:" annotations in the remainder', () => {
		const preview =
			'┌─ user side ──────────────────┐\n│ $ git status                 │\n└──────────────────────────────┘';
		const text =
			'User has answered your questions: "How should it render?"="Combined bubble" selected preview:\n' +
			preview +
			', "How should stderr render?"="Red error styling".' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [
			q('How should it render?', [{label: 'Combined bubble'}]),
			q('How should stderr render?', [{label: 'Red error styling'}]),
		]);
		expect(result).toStrictEqual([
			{question: 'How should it render?', answer: 'Combined bubble', notes: null},
			{question: 'How should stderr render?', answer: 'Red error styling', notes: null},
		]);
	});

	it('handles both "user notes:" and "selected preview:" annotations', () => {
		const text =
			'User has answered your questions: "Pick one?"="Option A" user notes: some detail selected preview:\nfoo.' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q('Pick one?', [{label: 'Option A'}])]);
		expect(result).toStrictEqual([{question: 'Pick one?', answer: 'Option A', notes: 'some detail'}]);
	});

	it('handles unknown annotations in the remainder without failing', () => {
		const text =
			'User has answered your questions: "Q1?"="A1" some future annotation: data.' +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [q('Q1?', [{label: 'A1'}])]);
		expect(result).toStrictEqual([{question: 'Q1?', answer: 'A1', notes: null}]);
	});

	it('parses the real eclipse-collections "Other" answer where notes echo the value', () => {
		// Real example from session 01f99877 - the bug screenshot referenced in
		// task #48. Both questions used 'Other' and the notes are duplicates of
		// the answer values, so the parsed result should mark notes==answer.
		const longAnswer1 =
			"api, eclipse-collections proper, unit-tests and unit-tests-java8. Don't focus on per-package targets" +
			' because compilation is never and has never been split by package. Rather, focus on inheritance.' +
			' Count the depth of the number of inheritance, and we can probably compile those in tiers.';
		const longAnswer2 =
			'Per class would be fine. A similar strategy of actions that depend on the parent class/interface' +
			' being compiled first would also work well for test compilation. Running can be done in parallel by class.';
		const text =
			'User has answered your questions:' +
			` "Which target should we focus on splitting?"="${longAnswer1}" user notes: ${longAnswer1},` +
			` "For test sharding, how should shards be generated?"="${longAnswer2}" user notes: ${longAnswer2}.` +
			" You can now continue with the user's answers in mind.";
		const result = parseAnswerResult(text, [
			q('Which target should we focus on splitting?'),
			q('For test sharding, how should shards be generated?'),
		]);
		expect(result).not.toBe(null);
		expect(result![0]!.answer).toBe(longAnswer1);
		expect(result![0]!.notes).toBe(longAnswer1);
		expect(result![1]!.answer).toBe(longAnswer2);
		expect(result![1]!.notes).toBe(longAnswer2);
	});
});
