// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import type {ReactNode} from "react";
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
			pagerMargins: screen
				.getByRole("button", {name: "Show previous question"})
				.parentElement?.className.split(" ")
				.filter((name) => name.startsWith("-m")),
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
			actionsGap: screen
				.getByRole("button", {name: "Skip"})
				.parentElement?.className.split(" ")
				.filter((name) => name.startsWith("gap-")),
		}).toStrictEqual({
			card: ["card-ring", "@container", "max-w-[480px]", "rounded-r7"],
			header: "Which test runner?1 of 2",
			pagerMargins: ["-my-1.5", "-me-2"],
			pager: [true, false],
			options: [
				["VitestVite-native", "true"],
				["JestWidely adopted", "false"],
				["Other", "false"],
			],
			otherBox: null,
			actions: ["Skip", false],
			actionsGap: ["gap-2"],
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

	it("focuses the Other box as Other is chosen, single- or multi-select, as upstream's flushSync-then-focus", () => {
		render(<QuestionCard questions={QUESTIONS} onSubmit={async () => {}} />);
		fireEvent.click(screen.getByRole("button", {name: "Other"}));
		const single = document.activeElement === screen.getByRole("textbox", {name: "Other option"});
		fireEvent.click(screen.getByRole("button", {name: /^Next/}));
		fireEvent.click(screen.getByRole("button", {name: "Other"}));
		const multi = document.activeElement === screen.getByRole("textbox", {name: "Other option"});

		expect({single, multi}).toStrictEqual({single: true, multi: true});
	});

	it("styles the Other box as upstream's cds TextArea field: field fill and ring, 6/8 padding, hover ring, focus-visible ring", () => {
		render(<QuestionCard questions={[QUESTIONS[0]!]} onSubmit={async () => {}} />);
		fireEvent.click(screen.getByRole("button", {name: "Other"}));
		const box = screen.getByRole("textbox", {name: "Other option"});

		expect({
			dir: box.getAttribute("dir"),
			classes: box.className
				.split(" ")
				.filter((name) =>
					/^(rounded-|bg-|px-|py-|shadow-|hover:shadow-|focus-visible:shadow-|max-h-|font-|text-)/.test(name),
				),
		}).toStrictEqual({
			dir: "auto",
			classes: [
				"max-h-[calc(4lh+0.75rem)]",
				"rounded-r5",
				"bg-fill-field",
				"px-2",
				"py-1.5",
				"font-sans",
				"text-body",
				"text-primary",
				"shadow-field-ring",
				"hover:shadow-field-hover",
				"focus-visible:shadow-focus",
			],
		});
	});

	it("walks Next to the last question, which waits until answered or skipped, then submits one answer each", async () => {
		const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
		const now = vi.spyOn(performance, "now").mockReturnValue(1000);
		render(<QuestionCard questions={QUESTIONS} onSubmit={onSubmit} />);
		now.mockReturnValue(1400);
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

	describe("Cmd/Ctrl+Enter as upstream's approval hotkey", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		function renderArmed(onSubmit: (answers: unknown[]) => Promise<void>, extra?: ReactNode) {
			const now = vi.spyOn(performance, "now").mockReturnValue(1000);
			const view = render(
				<>
					<QuestionCard questions={[QUESTIONS[0]!]} onSubmit={onSubmit} />
					{extra}
				</>,
			);
			now.mockReturnValue(1400);
			return view;
		}

		it("submits from the page body and from the session composer", () => {
			const fromBody = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
			renderArmed(fromBody);
			document.body.focus();
			fireEvent.keyDown(document.body, {key: "Enter", metaKey: true});
			cleanup();
			const fromComposer = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
			renderArmed(
				fromComposer,
				<div data-composer-card="">
					<textarea aria-label="Prompt" />
				</div>,
			);
			const composer = screen.getByRole("textbox", {name: "Prompt"});
			composer.focus();
			const composerEvent = new KeyboardEvent("keydown", {
				key: "Enter",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			});
			composer.dispatchEvent(composerEvent);

			expect({
				body: fromBody.mock.calls,
				composer: fromComposer.mock.calls,
				prevented: composerEvent.defaultPrevented,
			}).toStrictEqual({
				body: [[[{selected: [0]}]]],
				composer: [[[{selected: [0]}]]],
				prevented: true,
			});
		});

		it("ignores the hotkey within 400ms of mount, on repeat, during IME composition, or with a composer popup open", () => {
			const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
			const now = vi.spyOn(performance, "now").mockReturnValue(1000);
			render(
				<>
					<QuestionCard questions={[QUESTIONS[0]!]} onSubmit={onSubmit} />
					<div data-composer-card="">
						<textarea aria-label="Prompt" aria-controls="slash-menu" />
					</div>
				</>,
			);
			now.mockReturnValue(1399);
			fireEvent.keyDown(document.body, {key: "Enter", metaKey: true});
			now.mockReturnValue(1400);
			fireEvent.keyDown(document.body, {key: "Enter", metaKey: true, repeat: true});
			fireEvent.keyDown(document.body, {key: "Enter", metaKey: true, isComposing: true});
			const composer = screen.getByRole("textbox", {name: "Prompt"});
			composer.focus();
			fireEvent.keyDown(composer, {key: "Enter", metaKey: true});

			expect(onSubmit.mock.calls.length).toBe(0);
		});

		it("ignores the hotkey while the card is scrolled off-screen, or with focus in another field", () => {
			const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
			renderArmed(onSubmit, <input aria-label="Elsewhere" />);
			const elsewhere = screen.getByRole("textbox", {name: "Elsewhere"});
			elsewhere.focus();
			fireEvent.keyDown(elsewhere, {key: "Enter", metaKey: true});
			elsewhere.blur();
			const card = screen.getByRole("group", {name: "Which test runner?"});
			vi.spyOn(card, "getBoundingClientRect").mockReturnValue(
				DOMRect.fromRect({x: 0, y: window.innerHeight + 200, width: 480, height: 300}),
			);
			fireEvent.keyDown(document.body, {key: "Enter", metaKey: true});

			expect(onSubmit.mock.calls.length).toBe(0);
		});
	});

	describe("keeping focus inside the card, as upstream's tabIndex -1 root", () => {
		it("refocuses the card root after paging with focus inside, so ⌘⏎ keeps reaching it", () => {
			render(<QuestionCard questions={QUESTIONS} onSubmit={async () => {}} />);
			const card = screen.getByRole("group", {name: "Which test runner?"});
			screen.getByRole("button", {name: /^Next/}).focus();
			fireEvent.click(screen.getByRole("button", {name: /^Next/}));
			const afterNext = document.activeElement === screen.getByRole("group", {name: "Which features?"});
			fireEvent.click(screen.getByRole("button", {name: "Show previous question"}));
			const afterPrevious = document.activeElement === card;

			expect({tabIndex: card.tabIndex, afterNext, afterPrevious}).toStrictEqual({
				tabIndex: -1,
				afterNext: true,
				afterPrevious: true,
			});
		});

		it("leaves focus alone when paging with focus outside the card", () => {
			render(<QuestionCard questions={QUESTIONS} onSubmit={async () => {}} />);
			fireEvent.click(screen.getByRole("button", {name: /^Next/}));

			expect(document.activeElement).toBe(document.body);
		});

		it("keeps mousedown on Skip, Next and Submit from moving focus", () => {
			render(<QuestionCard questions={QUESTIONS} onSubmit={async () => {}} />);
			const skip = fireEvent.mouseDown(screen.getByRole("button", {name: "Skip"}));
			const next = fireEvent.mouseDown(screen.getByRole("button", {name: /^Next/}));
			fireEvent.click(screen.getByRole("button", {name: /^Next/}));
			fireEvent.click(screen.getByRole("button", {name: /^Coverage/}));
			const submit = fireEvent.mouseDown(screen.getByRole("button", {name: /^Submit/}));

			expect({skip, next, submit}).toStrictEqual({skip: false, next: false, submit: false});
		});

		it("moves focus from the Other box to the card root when Skip submits the last page", async () => {
			const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
			render(<QuestionCard questions={[QUESTIONS[1]!]} onSubmit={onSubmit} />);
			fireEvent.click(screen.getByRole("button", {name: "Other"}));
			fireEvent.click(screen.getByRole("button", {name: "Skip"}));
			await vi.waitFor(() => {
				expect(onSubmit).toHaveBeenCalledTimes(1);
			});

			expect(document.activeElement).toBe(screen.getByRole("group", {name: "Which features?"}));
		});
	});

	describe("ignoring a click that ends a drag-select inside its own row, as upstream", () => {
		afterEach(() => {
			window.getSelection()?.removeAllRanges();
		});

		function select(node: Node) {
			const range = document.createRange();
			range.selectNodeContents(node);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
		}

		it("still picks an option while a selection sits outside the card", () => {
			render(
				<>
					<p>Transcript paragraph</p>
					<QuestionCard questions={[QUESTIONS[0]!]} onSubmit={async () => {}} />
				</>,
			);
			select(screen.getByText("Transcript paragraph"));
			const jest = screen.getByRole("button", {name: /^Jest/});
			fireEvent.click(jest);

			expect(jest.getAttribute("aria-pressed")).toBe("true");
		});

		it("ignores an option or Other click when the selection is inside that row", () => {
			render(<QuestionCard questions={[QUESTIONS[0]!]} onSubmit={async () => {}} />);
			const jest = screen.getByRole("button", {name: /^Jest/});
			select(jest);
			fireEvent.click(jest);
			const other = screen.getByRole("button", {name: "Other"});
			select(other.parentElement!);
			fireEvent.click(other);

			expect({
				jest: jest.getAttribute("aria-pressed"),
				other: other.getAttribute("aria-pressed"),
				box: screen.queryByRole("textbox", {name: "Other option"}),
			}).toStrictEqual({jest: "false", other: "false", box: null});
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
