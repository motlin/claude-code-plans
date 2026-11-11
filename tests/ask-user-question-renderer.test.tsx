// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {AskUserQuestionRenderer} from "../src/components/tool-renderers/ask-user-question-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";
import {markQuestionCardSeen, markQuestionCardSent} from "../src/lib/question-card-store";

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

		it("lists a single stopped question alone, with no outcome line and no options card", () => {
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
						lines: [{className: "text-secondary", text: "Which animal do you prefer?"}],
					},
				],
				badges: 0,
				cards: 0,
			});
		});

		it("paints code in the question as upstream's chip and leaves a URL as plain text", () => {
			const {container} = render(
				<AskUserQuestionRenderer
					toolCall={makeCall({
						input: {
							questions: [
								{
									question: "See `docs/a.md` or https://example.com/a",
									header: "Doc",
									options: [{label: "Yes"}, {label: "No"}],
									multiSelect: false,
								},
							],
						},
						result: REJECTION_RESULT,
						isError: true,
						stopped: true,
					})}
				/>,
			);
			const line = container.querySelector(".text-secondary")!;

			expect({
				codes: Array.from(line.querySelectorAll("code")).map((code) => ({
					className: code.className,
					text: code.textContent,
				})),
				links: line.querySelectorAll("a").length,
				text: line.textContent,
			}).toStrictEqual({
				codes: [
					{
						className:
							"rounded-[calc(var(--cds-h-control-nested)/4)] bg-alpha-1 px-xs font-mono text-code font-normal",
						text: "docs/a.md",
					},
				],
				links: 0,
				text: "See docs/a.md or https://example.com/a",
			});
		});

		it("masks a secret in the question as upstream's Asked row does (ME before its chip paint)", () => {
			const fakeToken = `ghp_${"A".repeat(36)}`;
			const masked = `ghp_AAAA${"\u2022".repeat(32)}`;
			const {container} = render(
				<AskUserQuestionRenderer
					toolCall={makeCall({
						input: {
							questions: [
								{
									question: `Rotate ${fakeToken} or \`${fakeToken}\`?`,
									header: "Token",
									options: [{label: "Yes"}, {label: "No"}],
									multiSelect: false,
								},
							],
						},
						result: REJECTION_RESULT,
						isError: true,
						stopped: true,
					})}
				/>,
			);
			const line = container.querySelector(".text-secondary")!;

			expect({
				codes: Array.from(line.querySelectorAll("code")).map((code) => code.textContent),
				text: line.textContent,
			}).toStrictEqual({
				codes: [masked],
				text: `Rotate ${masked} or ${masked}?`,
			});
		});

		it("shows a bidi override in the question and answer as upstream's u9(ME(text)) does", () => {
			const fakeToken = `ghp_${"A".repeat(36)}`;
			const masked = `ghp_AAAA${"•".repeat(32)}`;
			const rlo = String.fromCodePoint(0x202e);
			const question = `Ship ${rlo}exe.txt?`;
			expect(
				outcomeList(
					makeCall({
						input: {
							questions: [
								{
									question,
									header: "Ship",
									options: [{label: "Yes"}, {label: "No"}],
									multiSelect: false,
								},
							],
						},
						result: REJECTION_RESULT,
						resultMeta: {answers: {[question]: {answer: `${rlo}ok ${fakeToken}`, notes: null}}},
						isError: true,
						stopped: true,
					}),
				).items.map((item) => item.lines.map((line) => line.text)),
			).toStrictEqual([["Ship [U+202E]exe.txt?", `[U+202E]ok ${masked}`]]);
		});

		it("draws **text** in the question as upstream's strong.font-medium around its chips, never inside a code span", () => {
			const {container} = render(
				<AskUserQuestionRenderer
					toolCall={makeCall({
						input: {
							questions: [
								{
									question: "Pick **one `cmd` only** of `a**b**` or x**y**",
									header: "Pick",
									options: [{label: "Yes"}, {label: "No"}],
									multiSelect: false,
								},
							],
						},
						result: REJECTION_RESULT,
						isError: true,
						stopped: true,
					})}
				/>,
			);
			const chip = `<code dir="ltr" class="rounded-[calc(var(--cds-h-control-nested)/4)] bg-alpha-1 px-xs font-mono text-code font-normal">`;

			expect(container.querySelector(".text-secondary")!.innerHTML).toStrictEqual(
				`Pick <strong class="font-medium">one ${chip}cmd</code> only</strong> of ${chip}a**b**</code> or x**y**`,
			);
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

	it("renders an answered question as upstream's 480px question receipt: question primary at the control weight, answer secondary", () => {
		const {container} = render(<AskUserQuestionRenderer toolCall={makeCall({result: ANSWERED_RESULT})} />);

		const cards = [...container.querySelectorAll(".card-ring")];
		const card = cards[0]!;
		const paragraphs = [...card.querySelectorAll("[data-answered-question] > div")].map((p) => ({
			className: p.className,
			text: p.textContent,
		}));

		expect({
			cardCount: cards.length,
			cardClassName: card.className,
			rowClassNames: [...card.querySelectorAll("[data-answered-question]")].map((row) => row.className),
			paragraphs,
			mentionsUnchosen: container.textContent.includes("Jest"),
			buttons: container.querySelectorAll("button").length,
		}).toStrictEqual({
			cardCount: 1,
			cardClassName:
				"card-ring mb-[var(--chat-item-gap)] flex w-full max-w-[480px] flex-col divide-y divide-[var(--card-outline)] overflow-clip rounded-r6 select-text",
			rowClassNames: ["flex flex-col gap-0.5 px-lg py-md"],
			paragraphs: [
				{
					className: "text-body font-control text-primary break-words [unicode-bidi:plaintext]",
					text: "Which test runner?",
				},
				{
					className:
						"max-h-[250px] overflow-y-auto whitespace-pre-wrap text-body text-secondary [overflow-wrap:anywhere] [unicode-bidi:plaintext]",
					text: "Vitest",
				},
			],
			mentionsUnchosen: false,
			buttons: 0,
		});
	});

	it("fades the receipt in (upstream's epitaxy-question-receipt-enter) only when its answer was sent from this page", () => {
		const className = (id: string) => {
			const view = render(<AskUserQuestionRenderer toolCall={makeCall({id, result: ANSWERED_RESULT})} />);
			const value = view.container.querySelector(".card-ring")!.className;
			cleanup();
			return value;
		};
		const unseen = className("tool-auq-unseen");
		markQuestionCardSeen("tool-auq-seen");
		const seen = className("tool-auq-seen");
		markQuestionCardSent("tool-auq-sent", {
			page: 0,
			drafts: [{selected: [0], other: "", otherChosen: false}],
			skipped: [false],
		});
		const sent = className("tool-auq-sent");

		expect({unseen, seen, sent}).toStrictEqual({
			unseen: "card-ring mb-[var(--chat-item-gap)] flex w-full max-w-[480px] flex-col divide-y divide-[var(--card-outline)] overflow-clip rounded-r6 select-text",
			seen: "card-ring mb-[var(--chat-item-gap)] flex w-full max-w-[480px] flex-col divide-y divide-[var(--card-outline)] overflow-clip rounded-r6 select-text",
			sent: "card-ring mb-[var(--chat-item-gap)] flex w-full max-w-[480px] flex-col divide-y divide-[var(--card-outline)] overflow-clip rounded-r6 select-text animate-question-receipt-enter motion-reduce:animate-none",
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
				lines: [...pair.children].map((line) => line.textContent),
			})),
		}));

		expect(cards).toStrictEqual([
			{
				className:
					"card-ring mb-[var(--chat-item-gap)] flex w-full max-w-[480px] flex-col divide-y divide-[var(--card-outline)] overflow-clip rounded-r6 select-text",
				pairs: [
					{
						className: "flex flex-col gap-0.5 px-lg py-md",
						lines: ["How should the JOL test treat LinkedHashMap?", "Exact, JDK-version-aware"],
					},
					{
						className: "flex flex-col gap-0.5 px-lg py-md",
						lines: ["Which runner?", "Bun", "Notes: Fastest locally"],
					},
				],
			},
		]);
	});

	it("draws a no-meta (no option selected) result as a receipt with its notes, not the raw result text", () => {
		const result =
			'The user answered: "Java?"=(no option selected) notes: newest 21, "Node?"="LTS". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.';
		const toolCall = makeCall({
			input: {
				questions: [
					{question: "Java?", header: "Java", options: [{label: "17"}, {label: "21"}], multiSelect: false},
					{
						question: "Node?",
						header: "Node",
						options: [{label: "LTS"}, {label: "Current"}],
						multiSelect: false,
					},
				],
			},
			result,
		});
		const {container} = render(<AskUserQuestionRenderer toolCall={toolCall} />);

		expect({
			rawFallback: container.querySelector("p.whitespace-pre-wrap")?.textContent,
			pairs: [...container.querySelectorAll(".card-ring > div")].map((pair) =>
				[...pair.children].map((line) => line.textContent),
			),
		}).toStrictEqual({
			rawFallback: undefined,
			pairs: [
				["Java?", "(notes only)", "Notes: newest 21"],
				["Node?", "LTS"],
			],
		});
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
				[...row.children].map((line) => line.textContent),
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

	it("draws an unanswered question as upstream's _y does: chips over u9(ME(question)), not markdown", () => {
		const rlo = String.fromCodePoint(0x202e);
		const {container} = render(
			<AskUserQuestionRenderer
				toolCall={makeCall({
					input: {
						questions: [
							{
								question: `**Ship** ${rlo}\`exe.txt\` with ghp_${"A".repeat(36)}?`,
								header: "Ship",
								options: [{label: "Yes"}, {label: "No"}],
								multiSelect: false,
							},
						],
					},
					result: "Something else entirely.",
					isError: true,
				})}
			/>,
		);
		const line = container.querySelector(".card-outline > div > div");

		expect({
			className: line?.className,
			text: line?.textContent,
			chips: [...(line?.querySelectorAll("code") ?? [])].map((code) => code.textContent),
			strong: [...(line?.querySelectorAll("strong") ?? [])].map((strong) => strong.textContent),
		}).toStrictEqual({
			className: "text-body text-secondary [overflow-wrap:anywhere]",
			text: `Ship [U+202E]exe.txt with ghp_AAAA${"•".repeat(32)}?`,
			chips: ["exe.txt"],
			strong: ["Ship"],
		});
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
