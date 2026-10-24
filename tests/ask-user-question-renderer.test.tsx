// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {AskUserQuestionRenderer} from "../src/components/tool-renderers/ask-user-question-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";
import {markQuestionCardSeen} from "../src/lib/question-card-store";

afterEach(cleanup);

const REJECTION_RESULT =
	"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

const REJECTION_WITH_FEEDBACK_RESULT =
	"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nJust pick one and keep going.";

const TIMEOUT_RESULT =
	"No response after 60s — the user may be away from keyboard. Proceed using your best judgment based on the context so far; you can re-ask this question later if it's still relevant.";

const ANSWERED_RESULT =
	'Your questions have been answered: "Which test runner?"="Vitest". You can now continue with these answers in mind.';

function makeCall(overrides: Partial<ClientToolCall> = {}): ClientToolCall {
	return {
		id: "tool-auq-1",
		name: "AskUserQuestion",
		param: "",
		sourceUuid: "uuid-1",
		input: {
			question: "Which test runner?",
			options: [
				{label: "Vitest", description: "Vite-native"},
				{label: "Jest", description: "Widely adopted"},
			],
		},
		...overrides,
	};
}

describe("AskUserQuestionRenderer", () => {
	describe("step body for a withdrawn question (upstream's _d)", () => {
		const ANIMAL = {
			questions: [
				{
					question: "Which animal do you prefer?",
					header: "Animal",
					options: [{label: "Cat"}, {label: "Dog"}],
					multiSelect: false,
				},
			],
		};
		const FRUIT_AND_SIZE = {
			questions: [
				{
					question: "Which fruit?",
					header: "Fruit",
					options: [{label: "Apple"}, {label: "Pear"}],
					multiSelect: false,
				},
				{
					question: "Which size?",
					header: "Size",
					options: [{label: "Small"}, {label: "Large"}],
					multiSelect: false,
				},
			],
		};

		function outcomeList(call: ClientToolCall) {
			const {container} = render(<AskUserQuestionRenderer toolCall={call} />);
			const list = container.firstElementChild;
			return {
				listClass: list?.className,
				items: [...(list?.children ?? [])].map((item) => ({
					className: item.className,
					lines: [...item.children].map((line) => ({className: line.className, text: line.textContent})),
				})),
				badges: container.querySelectorAll(".size-\\[30px\\]").length,
				cards: container.querySelectorAll(".card-outline").length,
			};
		}

		it("lists a stopped question with Not answered under it, and no options card", () => {
			expect(
				outcomeList(
					makeCall({
						input: ANIMAL,
						result: REJECTION_RESULT,
						isError: true,
						stopped: true,
					}),
				),
			).toStrictEqual({
				listClass: "flex flex-col gap-3 pt-1",
				items: [
					{
						className: "flex flex-col text-body [overflow-wrap:anywhere]",
						lines: [
							{className: "text-secondary", text: "Which animal do you prefer?"},
							{className: "text-ink-muted", text: "Not answered"},
						],
					},
				],
				badges: 0,
				cards: 0,
			});
		});

		it("prints Skipped under each question of an all-[No preference] call", () => {
			expect(
				outcomeList(
					makeCall({
						input: FRUIT_AND_SIZE,
						result: 'The user answered: "Which fruit?"="[No preference]", "Which size?"="[No preference]". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
						resultMeta: {
							answers: {
								"Which fruit?": {answer: "[No preference]", notes: null},
								"Which size?": {answer: "[No preference]", notes: null},
							},
						},
					}),
				),
			).toStrictEqual({
				listClass: "flex flex-col gap-3 pt-1",
				items: [
					{
						className: "flex flex-col text-body [overflow-wrap:anywhere]",
						lines: [
							{className: "text-secondary", text: "Which fruit?"},
							{className: "text-ink-muted", text: "Skipped"},
						],
					},
					{
						className: "flex flex-col text-body [overflow-wrap:anywhere]",
						lines: [
							{className: "text-secondary", text: "Which size?"},
							{className: "text-ink-muted", text: "Skipped"},
						],
					},
				],
				badges: 0,
				cards: 0,
			});
		});

		it("lists only the questions for the CLI's terminal skip (answers: {})", () => {
			expect(
				outcomeList(
					makeCall({
						input: FRUIT_AND_SIZE,
						result: "The user did not answer the questions.",
						resultMeta: {answers: {}},
					}),
				),
			).toStrictEqual({
				listClass: "flex flex-col gap-3 pt-1",
				items: [
					{
						className: "flex flex-col text-body [overflow-wrap:anywhere]",
						lines: [{className: "text-secondary", text: "Which fruit?"}],
					},
					{
						className: "flex flex-col text-body [overflow-wrap:anywhere]",
						lines: [{className: "text-secondary", text: "Which size?"}],
					},
				],
				badges: 0,
				cards: 0,
			});
		});
	});

	it("renders an answered question as upstream's 480px question receipt: question primary w500, answer secondary", () => {
		const {container} = render(<AskUserQuestionRenderer toolCall={makeCall({result: ANSWERED_RESULT})} />);

		const cards = [...container.querySelectorAll(".card-ring")];
		const card = cards[0]!;
		const paragraphs = [...card.querySelectorAll("p")].map((p) => ({
			className: p.className,
			text: p.textContent,
		}));

		expect({
			cardCount: cards.length,
			cardClassName: card.className,
			paragraphs,
			mentionsUnchosen: container.textContent.includes("Jest"),
			buttons: container.querySelectorAll("button").length,
		}).toStrictEqual({
			cardCount: 1,
			cardClassName:
				"card-ring -mt-[3px] mb-[7px] flex w-full max-w-[480px] flex-col divide-y divide-[var(--card-outline)] overflow-clip rounded-r6 select-text",
			paragraphs: [
				{
					className: "text-body font-medium text-primary break-words [unicode-bidi:plaintext]",
					text: "Which test runner?",
				},
				{
					className: "text-body text-secondary [overflow-wrap:anywhere] [unicode-bidi:plaintext]",
					text: "Vitest",
				},
			],
			mentionsUnchosen: false,
			buttons: 0,
		});
	});

	it("fades the receipt in (upstream's epitaxy-question-receipt-enter) only when it replaces a card seen in this page", () => {
		const unseen = render(
			<AskUserQuestionRenderer toolCall={makeCall({id: "tool-auq-unseen", result: ANSWERED_RESULT})} />,
		);
		const unseenClassName = unseen.container.querySelector(".card-ring")!.className;
		cleanup();
		markQuestionCardSeen("tool-auq-seen");
		const seen = render(
			<AskUserQuestionRenderer toolCall={makeCall({id: "tool-auq-seen", result: ANSWERED_RESULT})} />,
		);

		expect({
			unseen: unseenClassName,
			seen: seen.container.querySelector(".card-ring")!.className,
		}).toStrictEqual({
			unseen: "card-ring -mt-[3px] mb-[7px] flex w-full max-w-[480px] flex-col divide-y divide-[var(--card-outline)] overflow-clip rounded-r6 select-text",
			seen: "card-ring -mt-[3px] mb-[7px] flex w-full max-w-[480px] flex-col divide-y divide-[var(--card-outline)] overflow-clip rounded-r6 select-text animate-question-receipt-enter motion-reduce:animate-none",
		});
	});

	it("stacks every answered question in one card, with the Other text and its notes", () => {
		const result =
			'User has answered your questions: "How should the JOL test treat LinkedHashMap?"="Exact, JDK-version-aware", "Which runner?"="Bun" user notes: Fastest locally. You can now continue with the user\'s answers in mind.';
		const toolCall = makeCall({
			input: {
				questions: [
					{
						question: "How should the JOL test treat LinkedHashMap?",
						header: "LinkedHashMap",
						options: [
							{label: "Exact, JDK-version-aware", description: "Pin per JDK"},
							{label: "Loose bounds", description: "Tolerate drift"},
						],
						multiSelect: false,
					},
					{
						question: "Which runner?",
						header: "Runner",
						options: [
							{label: "Vitest", description: "Vite-native"},
							{label: "Jest", description: "Widely adopted"},
						],
						multiSelect: false,
					},
				],
			},
			result,
		});
		const {container} = render(<AskUserQuestionRenderer toolCall={toolCall} />);

		const cards = [...container.querySelectorAll(".card-ring")].map((card) => ({
			className: card.className,
			pairs: [...card.children].map((pair) => ({
				className: pair.className,
				lines: [...pair.querySelectorAll("p")].map((p) => p.textContent),
			})),
		}));

		expect(cards).toStrictEqual([
			{
				className:
					"card-ring -mt-[3px] mb-[7px] flex w-full max-w-[480px] flex-col divide-y divide-[var(--card-outline)] overflow-clip rounded-r6 select-text",
				pairs: [
					{
						className: "flex flex-col gap-0.5 px-3 py-2",
						lines: ["How should the JOL test treat LinkedHashMap?", "Exact, JDK-version-aware"],
					},
					{
						className: "flex flex-col gap-0.5 px-3 py-2",
						lines: ["Which runner?", "Bun", "Notes: Fastest locally"],
					},
				],
			},
		]);
	});

	describe("receipt rows for unanswered questions (upstream's Wi + BT)", () => {
		const TWO_QUESTIONS = {
			questions: [
				{
					question: "Which color?",
					header: "Color",
					options: [{label: "Red"}, {label: "Blue"}],
					multiSelect: false,
				},
				{
					question: "Which size?",
					header: "Size",
					options: [{label: "Small"}, {label: "Large"}],
					multiSelect: false,
				},
			],
		};

		function receiptRows(answers: Record<string, string>, result: string): string[][] {
			const resultMeta = {
				answers: Object.fromEntries(
					Object.entries(answers).map(([question, answer]) => [question, {answer, notes: null}]),
				),
			};
			const {container} = render(
				<AskUserQuestionRenderer toolCall={makeCall({input: TWO_QUESTIONS, result, resultMeta})} />,
			);
			return [...container.querySelectorAll("[data-answered-question]")].map((row) =>
				[...row.querySelectorAll("p")].map((p) => p.textContent),
			);
		}

		it("prints Skipped as the answer line of a question answered [No preference]", () => {
			expect(
				receiptRows(
					{"Which color?": "Red", "Which size?": "[No preference]"},
					'The user answered: "Which color?"="Red", "Which size?"="[No preference]". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
				),
			).toStrictEqual([
				["Which color?", "Red"],
				["Which size?", "Skipped"],
			]);
		});

		it("prints Not answered as the answer line of a dismissed question", () => {
			expect(
				receiptRows(
					{
						"Which color?": "Red",
						"Which size?": "[User dismissed — do not proceed, wait for next instruction]",
					},
					'The user answered: "Which color?"="Red", "Which size?"="[User dismissed — do not proceed, wait for next instruction]". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
				),
			).toStrictEqual([
				["Which color?", "Red"],
				["Which size?", "Not answered"],
			]);
		});

		it("drops a question with no entry in the recorded answers", () => {
			expect(
				receiptRows(
					{"Which color?": "Red"},
					'The user answered: "Which color?"="Red". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
				),
			).toStrictEqual([["Which color?", "Red"]]);
		});
	});

	it("shows a pink status line when the user dismissed the question", () => {
		const {container} = render(
			<AskUserQuestionRenderer toolCall={makeCall({result: REJECTION_RESULT, isError: true})} />,
		);

		expect({
			status: container.querySelector(".text-extended-pink")?.textContent,
			rawBoilerplate: container.textContent.includes("STOP what you are doing"),
		}).toStrictEqual({status: "Question dismissed", rawBoilerplate: false});
	});

	it("keeps the user's own words when they dismissed the question with feedback", () => {
		const {container} = render(
			<AskUserQuestionRenderer toolCall={makeCall({result: REJECTION_WITH_FEEDBACK_RESULT, isError: true})} />,
		);

		expect(container.querySelector(".text-extended-pink")?.textContent).toStrictEqual(
			"Question dismissedJust pick one and keep going.",
		);
	});

	it("shows a pink status line for the 60s no-response timeout", () => {
		const {container} = render(<AskUserQuestionRenderer toolCall={makeCall({result: TIMEOUT_RESULT})} />);

		expect({
			status: container.querySelector(".text-extended-pink")?.textContent,
			rawBoilerplate: container.textContent.includes("best judgment"),
		}).toStrictEqual({status: "No response after 60s", rawBoilerplate: false});
	});

	it("still falls back to the raw result for an unrecognized envelope", () => {
		const {container} = render(
			<AskUserQuestionRenderer toolCall={makeCall({result: "Something else entirely."})} />,
		);

		expect({
			pink: container.querySelector(".text-extended-pink"),
			text: container.textContent.includes("Something else entirely."),
		}).toStrictEqual({pink: null, text: true});
	});
});
