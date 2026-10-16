// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {AskUserQuestionProvider} from "../src/components/ask-user-question-context";
import {QuestionCard} from "../src/components/question-card";
import {AskUserQuestionRenderer} from "../src/components/tool-renderers/ask-user-question-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";
import {findPendingAskUserQuestion} from "../src/lib/approval-dock";
import type {QuestionLike} from "../src/lib/ask-user-question";

afterEach(cleanup);

const QUESTIONS: QuestionLike[] = [
	{
		question: "Which test runner?",
		header: "Runner",
		options: [
			{label: "Vitest", description: "Vite-native"},
			{label: "Jest", description: "Widely adopted"},
		],
	},
	{
		question: "Which features?",
		header: "Features",
		multiSelect: true,
		options: [{label: "Coverage"}, {label: "Watch"}, {label: "UI"}],
	},
];

function assistantToolUse(id: string, name: string, input: Record<string, unknown>, extra = {}) {
	return {
		type: "assistant",
		message: {content: [{type: "tool_use", id, name, input}]},
		...extra,
	};
}

function toolResult(id: string) {
	return {
		type: "user",
		message: {content: [{type: "tool_result", tool_use_id: id, content: "ok"}]},
	};
}

describe("findPendingAskUserQuestion", () => {
	it("finds an unanswered AskUserQuestion that is the last assistant tool_use", () => {
		const records = [
			assistantToolUse("t1", "Bash", {command: "ls"}),
			toolResult("t1"),
			assistantToolUse("t2", "AskUserQuestion", {questions: QUESTIONS}),
		];
		expect(findPendingAskUserQuestion(records)).toStrictEqual({
			toolUseId: "t2",
			questions: QUESTIONS,
		});
	});

	it("returns null once the question has a tool_result", () => {
		const records = [assistantToolUse("t2", "AskUserQuestion", {questions: QUESTIONS}), toolResult("t2")];
		expect(findPendingAskUserQuestion(records)).toBeNull();
	});

	it("returns null when a later tool_use follows the question", () => {
		const records = [
			assistantToolUse("t2", "AskUserQuestion", {questions: QUESTIONS}),
			assistantToolUse("t3", "Bash", {command: "ls"}),
		];
		expect(findPendingAskUserQuestion(records)).toBeNull();
	});

	it("ignores sidechain records", () => {
		const records = [
			assistantToolUse("t2", "AskUserQuestion", {questions: QUESTIONS}),
			assistantToolUse("s1", "Bash", {command: "ls"}, {isSidechain: true}),
		];
		expect(findPendingAskUserQuestion(records)?.toolUseId).toStrictEqual("t2");
	});

	it("normalizes the single-question form", () => {
		const records = [
			assistantToolUse("t4", "AskUserQuestion", {
				question: "Pick?",
				options: [{label: "A"}, {label: "B"}],
			}),
		];
		expect(findPendingAskUserQuestion(records)).toStrictEqual({
			toolUseId: "t4",
			questions: [{question: "Pick?", options: [{label: "A"}, {label: "B"}]}],
		});
	});
});

describe("QuestionCard", () => {
	it("draws upstream's card: the question in a grey header with an N of M pager, radio rows with descriptions, and Other", () => {
		render(<QuestionCard questions={QUESTIONS} onSubmit={async () => {}} />);
		const card = screen.getByRole("group", {name: "Which test runner?"});

		expect({
			card: card.className
				.split(" ")
				.filter((name) => ["@container", "max-w-[480px]", "card-ring", "rounded-r7"].includes(name)),
			header: card.firstElementChild?.textContent,
			pager: [
				screen.getByRole("button", {name: "Show previous question"}).hasAttribute("disabled"),
				screen.getByRole("button", {name: "Show next question"}).hasAttribute("disabled"),
			],
			options: within(card)
				.getAllByRole("button")
				.filter((button) => button.hasAttribute("aria-pressed"))
				.map((button) => [
					button.getAttribute("aria-label") ?? button.textContent,
					button.getAttribute("aria-pressed"),
				]),
			otherBox: screen.queryByRole("textbox", {name: "Other option"}),
			actions: [
				screen.getByRole("button", {name: "Skip"}).textContent,
				screen.getByRole("button", {name: /^Next/}).hasAttribute("disabled"),
			],
		}).toStrictEqual({
			card: ["card-ring", "@container", "max-w-[480px]", "rounded-r7"],
			header: "Which test runner?1 of 2",
			pager: [true, false],
			options: [
				["VitestVite-native", "true"],
				["JestWidely adopted", "false"],
				["Other", "false"],
			],
			otherBox: null,
			actions: ["Skip", false],
		});
	});

	it("reveals the Other box only once Other is chosen, and sends an empty Other as Something else", async () => {
		const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
		render(<QuestionCard questions={[QUESTIONS[0]!]} onSubmit={onSubmit} />);
		fireEvent.click(screen.getByRole("button", {name: "Other"}));
		const box = screen.getByRole("textbox", {name: "Other option"});
		fireEvent.click(screen.getByRole("button", {name: /^Submit/}));
		await vi.waitFor(() => {
			expect(onSubmit).toHaveBeenCalledTimes(1);
		});

		expect({placeholder: box.getAttribute("placeholder"), answers: onSubmit.mock.calls[0]?.[0]}).toStrictEqual({
			placeholder: "Type your own answer here",
			answers: [{selected: [], other: "Something else"}],
		});
	});

	it("walks Next to the last question, which waits until answered or skipped, then submits one answer each", async () => {
		const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
		render(<QuestionCard questions={QUESTIONS} onSubmit={onSubmit} />);
		fireEvent.click(screen.getByRole("button", {name: /^Next/}));
		const submit = screen.getByRole("button", {name: /^Submit/});
		const waiting = submit.hasAttribute("disabled");
		fireEvent.click(screen.getByRole("button", {name: /^Watch/}));
		fireEvent.click(screen.getByRole("button", {name: /^UI/}));
		fireEvent.keyDown(screen.getByRole("button", {name: /^Submit/}), {key: "Enter", metaKey: true});
		await vi.waitFor(() => {
			expect(onSubmit).toHaveBeenCalledTimes(1);
		});

		expect({waiting, answers: onSubmit.mock.calls[0]?.[0]}).toStrictEqual({
			waiting: true,
			answers: [{selected: [0]}, {selected: [1, 2]}],
		});
	});

	it("Skip on the last open question submits it as null", async () => {
		const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
		render(<QuestionCard questions={QUESTIONS} onSubmit={onSubmit} />);
		fireEvent.click(screen.getByRole("button", {name: /^Next/}));
		fireEvent.click(screen.getByRole("button", {name: "Skip"}));
		await vi.waitFor(() => {
			expect(onSubmit).toHaveBeenCalledTimes(1);
		});

		expect(onSubmit.mock.calls[0]?.[0]).toStrictEqual([{selected: [0]}, null]);
	});

	it("explains a disabled Next or Submit in a tooltip, as upstream's disabled reasons", () => {
		vi.useFakeTimers();
		render(<QuestionCard questions={QUESTIONS} onSubmit={async () => {}} />);
		fireEvent.click(screen.getByRole("button", {name: /^Next/}));
		const reason = () => {
			const anchor = screen.getByRole("button", {name: /^Submit/}).parentElement!;
			fireEvent.pointerEnter(anchor);
			act(() => {
				vi.advanceTimersByTime(1000);
			});
			const tip = screen.queryByRole("tooltip")?.textContent ?? null;
			fireEvent.pointerLeave(anchor);
			return tip;
		};
		const unanswered = reason();
		fireEvent.click(screen.getByRole("button", {name: /^Coverage/}));
		const answered = reason();
		vi.useRealTimers();

		expect({unanswered, answered}).toStrictEqual({unanswered: "Question 2 is unanswered", answered: null});
	});

	it("disables every control without onSubmit", () => {
		render(<QuestionCard questions={QUESTIONS} />);

		expect(
			[
				screen.getByRole("button", {name: /^Vitest/}),
				screen.getByRole("button", {name: "Skip"}),
				screen.getByRole("button", {name: /^Next/}),
			].map((button) => button.hasAttribute("disabled")),
		).toStrictEqual([true, true, true]);
	});
});

describe("AskUserQuestionRenderer pending", () => {
	const call: ClientToolCall = {
		id: "tool-q",
		name: "AskUserQuestion",
		input: {questions: QUESTIONS},
		param: "",
		sourceUuid: "u-q",
	};

	it("draws a pending question inline as upstream's card, with no Asking row, answering through the session", async () => {
		const submitAnswer = vi.fn<(submission: unknown) => Promise<void>>(async () => {});
		render(
			<AskUserQuestionProvider value={{answerRoute: "live-pane", submitAnswer}}>
				<AskUserQuestionRenderer toolCall={call} />
			</AskUserQuestionProvider>,
		);
		const asking = screen.queryByText(/^Asking/);
		fireEvent.click(screen.getByRole("button", {name: /^Next/}));
		fireEvent.click(screen.getByRole("button", {name: /^Coverage/}));
		fireEvent.click(screen.getByRole("button", {name: /^Submit/}));
		await vi.waitFor(() => {
			expect(submitAnswer).toHaveBeenCalledTimes(1);
		});

		expect({
			asking,
			card: screen.queryByRole("group", {name: "Which features?"}) !== null,
			submission: submitAnswer.mock.calls[0]?.[0],
		}).toStrictEqual({
			asking: null,
			card: true,
			submission: {
				toolUseId: "tool-q",
				questions: QUESTIONS,
				answers: [
					{question: "Which test runner?", answer: "Vitest"},
					{question: "Which features?", answer: "Coverage"},
				],
			},
		});
	});
});

describe("question cards by answer route", () => {
	const call: ClientToolCall = {
		id: "tool-q",
		name: "AskUserQuestion",
		input: {questions: [QUESTIONS[0]]},
		param: "",
		sourceUuid: "u-q",
	};
	function renderRoute(answerRoute: "live-pane" | "fork" | "read-only") {
		return render(
			<AskUserQuestionProvider value={{answerRoute, submitAnswer: async () => {}}}>
				<AskUserQuestionRenderer toolCall={call} />
			</AskUserQuestionProvider>,
		);
	}

	it("labels the fork route's submit button explicitly", () => {
		renderRoute("fork");

		expect(screen.getByRole("button", {name: /^Answer in a new fork/}).hasAttribute("disabled")).toBe(false);
	});

	it("disables a read-only route's card and points at the terminal", () => {
		const {container} = renderRoute("read-only");

		expect({
			option: screen.getByRole("button", {name: /^Vitest/}).hasAttribute("disabled"),
			submit: screen.getByRole("button", {name: /^Submit/}).hasAttribute("disabled"),
			hint: container.querySelector("[data-approval-read-only]")?.textContent,
		}).toStrictEqual({option: true, submit: true, hint: "Answer in the terminal"});
	});
});
