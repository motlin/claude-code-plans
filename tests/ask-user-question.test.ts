import {describe, expect, it} from 'vitest';
import {
	answerForQuestion,
	formatAnswerPrompt,
	makeInitialDraft,
	normalizeQuestions,
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
		expect(result).toHaveLength(1);
		expect(result![0]!.question).toBe('Pick one');
	});

	it('wraps a single-question shape into a one-element list', () => {
		const input = {
			question: 'Continue?',
			options: [{label: 'Yes'}, {label: 'No'}],
			multiSelect: true,
			header: 'Confirm',
		};
		const result = normalizeQuestions(input);
		expect(result).toEqual([
			{
				question: 'Continue?',
				options: [{label: 'Yes'}, {label: 'No'}],
				multiSelect: true,
				header: 'Confirm',
			},
		]);
	});

	it('returns null when input has neither shape', () => {
		expect(normalizeQuestions({})).toBeNull();
		expect(normalizeQuestions({question: 'Q', options: []})).toBeNull();
		expect(normalizeQuestions({questions: []})).toBeNull();
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
		expect(answerForQuestion(single, makeInitialDraft())).toBeNull();
	});

	it('returns the single selected label for non-multi questions', () => {
		const draft = {selected: new Set(['B']), otherText: '', useOther: false};
		expect(answerForQuestion(single, draft)).toBe('B');
	});

	it('joins selected labels for multi-select questions', () => {
		const draft = {selected: new Set(['A', 'C']), otherText: '', useOther: false};
		const result = answerForQuestion(multi, draft);
		expect(result).not.toBeNull();
		expect(result!.split(', ').sort()).toEqual(['A', 'C']);
	});

	it('returns the trimmed Other text when useOther is true', () => {
		const draft = {selected: new Set<string>(), otherText: '  custom value  ', useOther: true};
		expect(answerForQuestion(single, draft)).toBe('custom value');
	});

	it('returns null when Other is selected but the text is empty', () => {
		const draft = {selected: new Set<string>(), otherText: '   ', useOther: true};
		expect(answerForQuestion(single, draft)).toBeNull();
	});
});
