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
import {clearSentQuestionCard, readSentQuestionCard} from "../src/lib/question-card-store";

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

	it("keeps busy Submit focusable with a hidden label and a centred spinner, as upstream's busy primary", async () => {
		const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () => new Promise<void>(() => {}));
		render(<QuestionCard questions={[QUESTIONS[0]!]} onSubmit={onSubmit} />);
		const idle = screen.getByRole("button", {name: /^Submit/});
		const before = {busy: idle.getAttribute("aria-busy"), spinner: idle.querySelector("[data-spinner]") !== null};
		fireEvent.click(screen.getByRole("button", {name: /^Vitest/}));
		idle.focus();
		fireEvent.click(idle);
		await vi.waitFor(() => {
			expect(onSubmit).toHaveBeenCalledTimes(1);
		});
		const submit = screen.getByRole("button", {name: /^Submit/});
		fireEvent.click(submit);
		const overlay = submit.querySelector("[data-spinner]")?.parentElement;

		expect({
			before,
			same: submit === idle,
			busy: submit.getAttribute("aria-busy"),
			ariaDisabled: submit.getAttribute("aria-disabled"),
			disabled: submit.hasAttribute("disabled"),
			focused: document.activeElement === submit,
			relative: submit.classList.contains("relative"),
			label: submit.firstElementChild?.className,
			overlay: overlay?.className,
			overlayHidden: overlay?.getAttribute("aria-hidden"),
			calls: onSubmit.mock.calls.length,
			disabledReason: submit.parentElement?.hasAttribute("aria-describedby"),
		}).toStrictEqual({
			before: {busy: null, spinner: false},
			same: true,
			busy: "true",
			ariaDisabled: "true",
			disabled: false,
			focused: true,
			relative: true,
			label: "inline-flex min-w-0 items-center gap-1 opacity-0",
			overlay: "absolute inset-0 grid place-items-center leading-[0]",
			overlayHidden: "true",
			calls: 1,
			disabledReason: false,
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

		/** Sends ⌘⏎ from the session composer and reports whether the card swallowed it. */
		function pressFromComposer(init: KeyboardEventInit = {}) {
			const composer = screen.getByRole("textbox", {name: "Prompt"});
			composer.focus();
			const event = new KeyboardEvent("keydown", {
				key: "Enter",
				metaKey: true,
				bubbles: true,
				cancelable: true,
				...init,
			});
			composer.dispatchEvent(event);
			return event.defaultPrevented;
		}

		const COMPOSER = (
			<div data-composer-card="">
				<textarea aria-label="Prompt" />
			</div>
		);

		it("lets ⌘⏎ reach the composer while the card can't advance, and always lets ⌥⌘⏎ through", () => {
			const now = vi.spyOn(performance, "now").mockReturnValue(1000);
			const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
			render(
				<>
					<QuestionCard questions={[QUESTIONS[1]!]} onSubmit={onSubmit} />
					{COMPOSER}
				</>,
			);
			now.mockReturnValue(1400);
			const unanswered = pressFromComposer();
			fireEvent.click(screen.getByRole("button", {name: /^Watch/}));
			const withAlt = pressFromComposer({altKey: true});

			expect({unanswered, withAlt, calls: onSubmit.mock.calls}).toStrictEqual({
				unanswered: false,
				withAlt: false,
				calls: [],
			});
		});

		it("swallows ⌘⏎ without acting on key repeat, within the 400ms arm grace, and with ⇧", () => {
			const now = vi.spyOn(performance, "now").mockReturnValue(1000);
			const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
			render(
				<>
					<QuestionCard questions={[QUESTIONS[0]!]} onSubmit={onSubmit} />
					{COMPOSER}
				</>,
			);
			now.mockReturnValue(1100);
			const inGrace = pressFromComposer();
			now.mockReturnValue(1400);
			const repeat = pressFromComposer({repeat: true});
			const shift = pressFromComposer({shiftKey: true});

			expect({inGrace, repeat, shift, calls: onSubmit.mock.calls}).toStrictEqual({
				inGrace: true,
				repeat: true,
				shift: true,
				calls: [],
			});
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

	it("Skip on a page that isn't last advances to the next page instead of submitting", async () => {
		const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
		const single: QuestionLike[] = [QUESTIONS[0]!, {...QUESTIONS[0]!, question: "Which linter?", header: "Linter"}];
		render(<QuestionCard questions={single} onSubmit={onSubmit} />);
		fireEvent.click(screen.getByRole("button", {name: "Skip"}));

		expect({
			page: screen.getByRole("group").getAttribute("aria-label"),
			pager: screen.getByText(/of 2/).textContent,
			calls: onSubmit.mock.calls.length,
		}).toStrictEqual({page: "Which linter?", pager: "2 of 2", calls: 0});

		fireEvent.click(screen.getByRole("button", {name: /^Submit/}));
		await vi.waitFor(() => {
			expect(onSubmit).toHaveBeenCalledTimes(1);
		});

		expect(onSubmit.mock.calls[0]?.[0]).toStrictEqual([null, {selected: [0]}]);
	});

	it("keeps backticks literal in the header question and links its URLs as upstream's TextLink, but keeps option labels plain", () => {
		render(
			<QuestionCard
				questions={[
					{
						question: "Use the docs at https://example.com/guide? Run `npm test`.",
						header: "Docs",
						options: [{label: "Yes, https://example.com/yes", description: "Read https://example.com/d"}],
					},
				]}
				onSubmit={async () => {}}
			/>,
		);
		const card = screen.getByRole("group", {name: /^Use the docs/});
		const header = card.firstElementChild!.firstElementChild!;

		expect({
			headerText: header.textContent,
			headerLinks: [...header.querySelectorAll("a")].map((a) => ({
				href: a.getAttribute("href"),
				text: a.textContent,
				target: a.getAttribute("target"),
				rel: a.getAttribute("rel"),
				dir: a.getAttribute("dir"),
				className: a.className,
			})),
			headerCode: header.querySelectorAll("code").length,
			links: within(card)
				.getAllByRole("link")
				.map((a) => a.getAttribute("href")),
		}).toStrictEqual({
			headerText: "Use the docs at https://example.com/guide? Run `npm test`.",
			headerLinks: [
				{
					href: "https://example.com/guide",
					text: "https://example.com/guide",
					target: "_blank",
					rel: "noreferrer",
					dir: "ltr",
					className: "text-link inline cursor-pointer",
				},
			],
			headerCode: 0,
			links: ["https://example.com/guide"],
		});
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

		expect({unanswered, answered}).toStrictEqual({
			unanswered: "Choose an option or skip this question",
			answered: null,
		});
	});

	it("wraps the primary in a disabled-reason tab stop that stays mounted across enable, as upstream's DisabledReason", () => {
		render(<QuestionCard questions={QUESTIONS} onSubmit={async () => {}} />);
		fireEvent.click(screen.getByRole("button", {name: /^Next/}));
		const state = () => {
			const button = screen.getByRole("button", {name: /^Submit/});
			const wrapper = button.closest("[data-cds-disabled-reason-wrapper]");
			const skip = screen.getByRole("button", {name: "Skip"});
			const tabbable = [...screen.getByRole("group").querySelectorAll<HTMLElement>("button, [tabindex]")].filter(
				(element) => element.tabIndex >= 0 && !(element instanceof HTMLButtonElement && element.disabled),
			);
			const describedBy = wrapper?.getAttribute("aria-describedby") ?? null;
			return {
				elements: [button, wrapper],
				hasWrapper: wrapper !== null,
				afterSkip: tabbable[tabbable.indexOf(skip) + 1] === wrapper,
				tabIndex: wrapper instanceof HTMLElement ? wrapper.tabIndex : null,
				description: describedBy === null ? null : (document.getElementById(describedBy)?.textContent ?? null),
				buttonDescribedBy: button.getAttribute("aria-describedby"),
			};
		};
		const unanswered = state();
		fireEvent.click(screen.getByRole("button", {name: /^Coverage/}));
		const answered = state();

		expect({
			unanswered: {...unanswered, elements: undefined},
			answered: {...answered, elements: undefined},
			sameElements: answered.elements.every((element, at) => element === unanswered.elements[at]),
		}).toStrictEqual({
			unanswered: {
				elements: undefined,
				hasWrapper: true,
				afterSkip: true,
				tabIndex: 0,
				description: "Choose an option or skip this question",
				buttonDescribedBy: null,
			},
			answered: {
				elements: undefined,
				hasWrapper: true,
				afterSkip: false,
				tabIndex: -1,
				description: null,
				buttonDescribedBy: null,
			},
			sameElements: true,
		});
	});

	it("names the first other unanswered page on the last page only once the current page is answered, as upstream", () => {
		vi.useFakeTimers();
		const multi = (header: string): QuestionLike => ({
			question: `Which ${header}?`,
			header,
			multiSelect: true,
			options: [{label: `${header} A`}, {label: `${header} B`}],
		});
		render(<QuestionCard questions={[multi("First"), multi("Second")]} onSubmit={async () => {}} />);
		fireEvent.click(screen.getByRole("button", {name: "Show next question"}));
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
		const bothEmpty = reason();
		fireEvent.click(screen.getByRole("button", {name: /^Second A/}));
		const currentAnswered = reason();
		vi.useRealTimers();

		expect({bothEmpty, currentAnswered}).toStrictEqual({
			bothEmpty: "Choose an option or skip this question",
			currentAnswered: "Question 1 is unanswered",
		});
	});

	describe("keeping drafts and page across remounts, as upstream's per-tool draft store", () => {
		const pickAndType = () => {
			fireEvent.click(screen.getByRole("button", {name: /^Jest/}));
			fireEvent.click(screen.getByRole("button", {name: /^Next/}));
			fireEvent.click(screen.getByRole("button", {name: "Other"}));
			fireEvent.change(screen.getByRole("textbox", {name: "Other option"}), {target: {value: "Mutation"}});
		};
		const snapshot = () => {
			const card = screen.getByRole("group");
			const onPage = {
				question: card.getAttribute("aria-label"),
				other: screen.queryByRole<HTMLTextAreaElement>("textbox", {name: "Other option"})?.value ?? null,
				skipEnter: card.hasAttribute("data-skip-approval-enter"),
			};
			fireEvent.click(screen.getByRole("button", {name: "Show previous question"}));
			return {
				...onPage,
				firstPage: within(screen.getByRole("group"))
					.getAllByRole("button")
					.filter((button) => button.hasAttribute("aria-pressed"))
					.map((button) => button.getAttribute("aria-pressed")),
			};
		};

		const snapshotFresh = () => {
			const card = screen.getByRole("group");
			return {
				question: card.getAttribute("aria-label"),
				skipEnter: card.hasAttribute("data-skip-approval-enter"),
			};
		};

		it("restores picks, Other text and page when a card with the same key remounts", () => {
			const first = render(<QuestionCard draftKey="remount-1" questions={QUESTIONS} onSubmit={async () => {}} />);
			pickAndType();
			first.unmount();
			render(<QuestionCard draftKey="remount-1" questions={QUESTIONS} onSubmit={async () => {}} />);

			expect(snapshot()).toStrictEqual({
				question: "Which features?",
				other: "Mutation",
				skipEnter: true,
				firstPage: ["false", "true", "false"],
			});
		});

		it("restores from session storage when the in-memory store has no entry", () => {
			window.sessionStorage.setItem(
				"question-card-draft:stored-1",
				JSON.stringify({
					page: 1,
					drafts: [
						{selected: [1], other: "", otherChosen: false},
						{selected: [], other: "Mutation", otherChosen: true},
					],
					skipped: [false, false],
				}),
			);
			render(<QuestionCard draftKey="stored-1" questions={QUESTIONS} onSubmit={async () => {}} />);

			expect(snapshot()).toStrictEqual({
				question: "Which features?",
				other: "Mutation",
				skipEnter: true,
				firstPage: ["false", "true", "false"],
			});
		});

		it("starts fresh once the sent answer's result lands", async () => {
			const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () => {});
			const first = render(<QuestionCard draftKey="remount-2" questions={QUESTIONS} onSubmit={onSubmit} />);
			pickAndType();
			fireEvent.click(screen.getByRole("button", {name: /^Submit/}));
			await vi.waitFor(() => {
				expect(onSubmit).toHaveBeenCalledTimes(1);
			});
			first.unmount();
			clearSentQuestionCard("remount-2");
			render(<QuestionCard draftKey="remount-2" questions={QUESTIONS} onSubmit={async () => {}} />);

			expect({
				...snapshotFresh(),
				stored: window.sessionStorage.getItem("question-card-draft:remount-2"),
			}).toStrictEqual({question: "Which test runner?", skipEnter: true, stored: null});
		});

		it("redraws the submitted answers and page, busy, when a card remounts while sending, as upstream's sent store", () => {
			const first = render(
				<QuestionCard
					draftKey="sending-1"
					questions={QUESTIONS}
					onSubmit={async () => new Promise(() => {})}
				/>,
			);
			pickAndType();
			fireEvent.click(screen.getByRole("button", {name: /^Submit/}));
			first.unmount();
			render(<QuestionCard draftKey="sending-1" questions={QUESTIONS} onSubmit={async () => {}} />);
			const card = screen.getByRole("group");
			const submit = screen.getByRole("button", {name: /^Submit/});

			expect({
				question: card.getAttribute("aria-label"),
				skipEnter: card.hasAttribute("data-skip-approval-enter"),
				other: screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Other option"}).value,
				busy: submit.getAttribute("aria-busy"),
				ariaDisabled: submit.getAttribute("aria-disabled"),
				rows: within(card)
					.getAllByRole("button")
					.filter((button) => button.hasAttribute("aria-pressed"))
					.map((button) => [button.getAttribute("aria-pressed"), button.hasAttribute("disabled")]),
			}).toStrictEqual({
				question: "Which features?",
				skipEnter: true,
				other: "Mutation",
				busy: "true",
				ariaDisabled: "true",
				rows: [
					["false", true],
					["false", true],
					["false", true],
					["true", true],
				],
			});
		});

		it("drops the sent entry and restores the draft when sending fails", async () => {
			const onSubmit = vi.fn<(answers: unknown[]) => Promise<void>>(async () =>
				Promise.reject(new Error("pane gone")),
			);
			const first = render(<QuestionCard draftKey="sending-2" questions={QUESTIONS} onSubmit={onSubmit} />);
			pickAndType();
			fireEvent.click(screen.getByRole("button", {name: /^Submit/}));
			await screen.findByText("pane gone");
			first.unmount();
			render(<QuestionCard draftKey="sending-2" questions={QUESTIONS} onSubmit={async () => {}} />);
			const submit = screen.getByRole("button", {name: /^Submit/});

			expect({
				sent: readSentQuestionCard("sending-2", QUESTIONS.length),
				busy: submit.getAttribute("aria-busy"),
				other: screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Other option"}).value,
			}).toStrictEqual({sent: null, busy: null, other: "Mutation"});
		});

		it("leaves the busy state with the restored draft and error when a send fails after the card remounted", async () => {
			let rejectSend: (error: Error) => void = () => {};
			const first = render(
				<QuestionCard
					draftKey="sending-3"
					questions={QUESTIONS}
					onSubmit={async () =>
						new Promise((_, reject) => {
							rejectSend = reject;
						})
					}
				/>,
			);
			pickAndType();
			fireEvent.click(screen.getByRole("button", {name: /^Submit/}));
			first.unmount();
			render(<QuestionCard draftKey="sending-3" questions={QUESTIONS} onSubmit={async () => {}} />);
			rejectSend(new Error("pane gone"));
			await screen.findByText("pane gone");
			const submit = screen.getByRole("button", {name: /^Submit/});

			expect({
				sent: readSentQuestionCard("sending-3", QUESTIONS.length),
				busy: submit.getAttribute("aria-busy"),
				ariaDisabled: submit.getAttribute("aria-disabled"),
				other: screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Other option"}).value,
				otherDisabled: screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Other option"}).disabled,
			}).toStrictEqual({sent: null, busy: null, ariaDisabled: null, other: "Mutation", otherDisabled: false});
		});

		it("ignores a stored draft whose question count no longer matches", () => {
			window.sessionStorage.setItem(
				"question-card-draft:stale-1",
				JSON.stringify({page: 0, drafts: [{selected: [1], other: "", otherChosen: false}], skipped: [false]}),
			);
			render(<QuestionCard draftKey="stale-1" questions={QUESTIONS} onSubmit={async () => {}} />);

			expect(snapshotFresh()).toStrictEqual({question: "Which test runner?", skipEnter: false});
		});
	});

	describe("fading in on first appearance, as upstream's epitaxy-approval-inline-enter", () => {
		const enterClasses = () =>
			screen
				.getByRole("group")
				.className.split(" ")
				.filter((name) => name.includes("animate-"));

		it("fades a fresh card in, without motion under reduced motion", () => {
			render(<QuestionCard questions={QUESTIONS} onSubmit={async () => {}} />);

			expect(enterClasses()).toStrictEqual(["animate-approval-inline-enter", "motion-reduce:animate-none"]);
		});

		it("skips the fade for a card restored from a saved draft", () => {
			const first = render(<QuestionCard draftKey="enter-1" questions={QUESTIONS} onSubmit={async () => {}} />);
			fireEvent.click(screen.getByRole("button", {name: /^Jest/}));
			first.unmount();
			render(<QuestionCard draftKey="enter-1" questions={QUESTIONS} onSubmit={async () => {}} />);

			expect(enterClasses()).toStrictEqual([]);
		});

		describe("remembering cards seen in this page, as upstream's IntersectionObserver-filled seen map", () => {
			const observed: {
				target: Element;
				callback: IntersectionObserverCallback;
				observer: IntersectionObserver;
			}[] = [];

			class TestIntersectionObserver {
				readonly root = null;
				readonly rootMargin = "";
				readonly thresholds: readonly number[] = [];
				constructor(private readonly callback: IntersectionObserverCallback) {}
				observe(target: Element): void {
					observed.push({
						target,
						callback: this.callback,
						observer: this as unknown as IntersectionObserver,
					});
				}
				unobserve(): void {}
				disconnect(): void {}
				takeRecords(): IntersectionObserverEntry[] {
					return [];
				}
			}

			const intersect = (isIntersecting: boolean) => {
				act(() => {
					for (const {target, callback, observer} of observed) {
						callback([{target, isIntersecting} as unknown as IntersectionObserverEntry], observer);
					}
				});
			};

			afterEach(() => {
				observed.length = 0;
				vi.unstubAllGlobals();
			});

			const skipState = () => {
				const card = screen.getByRole("group");
				return {skipEnter: card.hasAttribute("data-skip-approval-enter"), animation: enterClasses()};
			};

			it("skips the fade when a card already seen in this page remounts without a draft", () => {
				vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
				const first = render(
					<QuestionCard draftKey="seen-1" questions={QUESTIONS} onSubmit={async () => {}} />,
				);
				const firstMount = skipState();
				intersect(true);
				first.unmount();
				render(<QuestionCard draftKey="seen-1" questions={QUESTIONS} onSubmit={async () => {}} />);

				expect({firstMount, remount: skipState()}).toStrictEqual({
					firstMount: {
						skipEnter: false,
						animation: ["animate-approval-inline-enter", "motion-reduce:animate-none"],
					},
					remount: {skipEnter: true, animation: []},
				});
			});

			it("still fades a remounted card that never intersected", () => {
				vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
				const first = render(
					<QuestionCard draftKey="seen-2" questions={QUESTIONS} onSubmit={async () => {}} />,
				);
				intersect(false);
				first.unmount();
				render(<QuestionCard draftKey="seen-2" questions={QUESTIONS} onSubmit={async () => {}} />);

				expect(skipState()).toStrictEqual({
					skipEnter: false,
					animation: ["animate-approval-inline-enter", "motion-reduce:animate-none"],
				});
			});

			it("marks the card seen at once where IntersectionObserver is unavailable", () => {
				vi.stubGlobal("IntersectionObserver", undefined);
				const first = render(
					<QuestionCard draftKey="seen-3" questions={QUESTIONS} onSubmit={async () => {}} />,
				);
				first.unmount();
				render(<QuestionCard draftKey="seen-3" questions={QUESTIONS} onSubmit={async () => {}} />);

				expect(skipState()).toStrictEqual({skipEnter: true, animation: []});
			});
		});
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
	it("clears the sent answer once the call's result lands, so the card stops redrawing busy", async () => {
		const submitAnswer = vi.fn<(submission: unknown) => Promise<void>>(async () => {});
		const tree = (toolCall: ClientToolCall) => (
			<AskUserQuestionProvider value={{answerRoute: "live-pane", submitAnswer}}>
				<AskUserQuestionRenderer toolCall={toolCall} />
			</AskUserQuestionProvider>
		);
		const sentCall = {...call, id: "tool-q-sent"};
		const view = render(tree(sentCall));
		fireEvent.click(screen.getByRole("button", {name: /^Next/}));
		fireEvent.click(screen.getByRole("button", {name: /^Coverage/}));
		fireEvent.click(screen.getByRole("button", {name: /^Submit/}));
		await vi.waitFor(() => {
			expect(submitAnswer).toHaveBeenCalledTimes(1);
		});
		const whileSending = readSentQuestionCard("tool-q-sent", QUESTIONS.length) !== null;
		view.rerender(
			tree({
				...sentCall,
				result: 'User has answered your questions: "Which test runner?"="Vitest", "Which features?"="Coverage".',
			}),
		);

		expect({whileSending, afterResult: readSentQuestionCard("tool-q-sent", QUESTIONS.length)}).toStrictEqual({
			whileSending: true,
			afterResult: null,
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
