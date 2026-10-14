// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {PendingQuestionCard} from "../src/components/approval-card";
import type {PendingQuestionItem, QuestionAnswer} from "../src/lib/hook-events";

afterEach(cleanup);

const QUESTIONS: PendingQuestionItem[] = [
	{
		question: "Which color do you prefer?",
		header: "Color",
		multiSelect: false,
		options: [
			{label: "Red", description: "A warm color."},
			{label: "Blue", description: "A cool color."},
		],
	},
	{
		question: "Which toppings?",
		header: "Toppings",
		multiSelect: true,
		options: [{label: "Cheese"}, {label: "Olives", description: "Black olives."}],
	},
];

function describeCard() {
	const card = screen.getByRole("group", {name: "Waiting for your input"});
	return {
		questions: [...card.querySelectorAll("[data-pending-question]")].map((question) => ({
			pill: question.querySelector("[data-approval-pill]")?.textContent ?? null,
			question: question.querySelector("[data-approval-card-title]")?.textContent,
			icons: [...question.querySelectorAll("[data-pending-question-icon]")].map((icon) => ({
				label: icon.getAttribute("aria-label"),
				disabled: (icon as HTMLButtonElement).disabled,
			})),
			options: [...question.querySelectorAll("[data-pending-question-option]")].map((option) => ({
				label: option.querySelector("[data-option-label]")?.textContent,
				description: option.querySelector("[data-option-description]")?.textContent ?? null,
				key: option.querySelector("kbd")?.textContent,
				disabled: (option as HTMLButtonElement).disabled,
			})),
			other: [...question.querySelectorAll("[data-pending-question-other]")].map((other) => ({
				key: other.querySelector("kbd")?.textContent,
				placeholder: other.querySelector("textarea")?.getAttribute("placeholder"),
				label: other.querySelector("textarea")?.getAttribute("aria-label"),
				disabled: other.querySelector("textarea")?.disabled,
			})),
			multiSelect: question.querySelector("[data-pending-question-multiselect]")?.textContent ?? null,
		})),
		footnote: card.querySelector("[data-pending-question-footnote]")?.textContent,
		actions: [...card.querySelectorAll("[data-approval-card-actions] button")].map((button) => ({
			text: button.firstChild?.textContent,
			keycaps: button.querySelectorAll("kbd").length > 0,
			disabled: (button as HTMLButtonElement).disabled,
		})),
		enabledControls: card.querySelectorAll("button:not(:disabled), textarea:not(:disabled), input").length,
	};
}

const ICONS = [
	{label: "View question options", disabled: true},
	{label: "Dismiss question", disabled: true},
];

describe("PendingQuestionCard", () => {
	it("shows a single question as upstream does: no pill or header caption, keycapped options, an Other row and disabled Skip / Submit", () => {
		render(<PendingQuestionCard questions={[QUESTIONS[0]!]} />);

		expect(describeCard()).toStrictEqual({
			questions: [
				{
					pill: null,
					question: "Which color do you prefer?",
					icons: ICONS,
					options: [
						{label: "Red", description: "A warm color.", key: "1", disabled: true},
						{label: "Blue", description: "A cool color.", key: "2", disabled: true},
					],
					other: [
						{key: "3", placeholder: "Type your own answer here", label: "Other option", disabled: true},
					],
					multiSelect: null,
				},
			],
			footnote: "Answer in the terminal running this session.",
			actions: [
				{text: "Skip", keycaps: false, disabled: true},
				{text: "Submit", keycaps: true, disabled: true},
			],
			enabledControls: 0,
		});
	});

	it("shows several questions one at a time with an i/n pill, paging with Next and Back while Skip and Submit stay disabled", () => {
		render(<PendingQuestionCard questions={QUESTIONS} />);
		const page = () => {
			const card = screen.getByRole("group", {name: "Waiting for your input"});
			return {
				questions: [...card.querySelectorAll("[data-pending-question]")].map((question) => ({
					pill: question.querySelector("[data-approval-pill]")?.textContent,
					title: question.querySelector("[data-approval-card-title]")?.textContent,
				})),
				actions: [...card.querySelectorAll("[data-approval-card-actions] button")].map((button) => ({
					text: button.firstChild?.textContent,
					disabled: (button as HTMLButtonElement).disabled,
				})),
			};
		};
		const first = page();
		fireEvent.click(screen.getByRole("button", {name: /^Next/}));
		const second = page();
		fireEvent.click(screen.getByRole("button", {name: "Back"}));

		expect({first, second, back: page().questions}).toStrictEqual({
			first: {
				questions: [{pill: "1/2", title: "Which color do you prefer?"}],
				actions: [
					{text: "Skip", disabled: true},
					{text: "Next", disabled: false},
				],
			},
			second: {
				questions: [{pill: "2/2", title: "Which toppings?"}],
				actions: [
					{text: "Back", disabled: false},
					{text: "Skip", disabled: true},
					{text: "Submit", disabled: true},
				],
			},
			back: [{pill: "1/2", title: "Which color do you prefer?"}],
		});
	});

	it("pages to the next question on ⌘⏎", () => {
		render(<PendingQuestionCard questions={QUESTIONS} />);
		fireEvent.keyDown(document, {key: "Enter", metaKey: true});

		expect(
			screen.getByRole("group", {name: "Waiting for your input"}).querySelector("[data-approval-pill]")
				?.textContent,
		).toBe("2/2");
	});

	it("keeps a title's line breaks and links its URLs", () => {
		render(
			<PendingQuestionCard
				questions={[
					{
						question: "Which candidate? See https://workflowy.com/#/abc\nCandidates:\n- c03: Talk directly",
						options: [{label: "c03"}],
					},
				]}
			/>,
		);
		const title = screen
			.getByRole("group", {name: "Waiting for your input"})
			.querySelector("[data-approval-card-title]")!;
		const link = title.querySelector("a");

		expect({
			text: title.firstElementChild?.className,
			link: {href: link?.getAttribute("href"), text: link?.textContent, target: link?.getAttribute("target")},
		}).toStrictEqual({
			text: "whitespace-pre-wrap [overflow-wrap:anywhere]",
			link: {href: "https://workflowy.com/#/abc", text: "https://workflowy.com/#/abc", target: "_blank"},
		});
	});

	it("uses upstream's 580 title, 8px option padding on a 3px column, and muted 12/15 descriptions", () => {
		render(<PendingQuestionCard questions={[QUESTIONS[0]!]} />);
		const card = screen.getByRole("group", {name: "Waiting for your input"});
		const option = card.querySelector("[data-pending-question-option]")!;

		expect({
			shell: card.className.split(" ").filter((name) => name.startsWith("gap-")),
			title: card
				.querySelector("[data-approval-card-title]")!
				.className.split(" ")
				.filter((name) => name.startsWith("font-")),
			column: option.parentElement!.className,
			option: option.className.split(" ").filter((name) => /^(rounded|p-|px-|py-)/.test(name)),
			description: card.querySelector("[data-option-description]")!.className,
		}).toStrictEqual({
			shell: ["gap-3"],
			title: ["font-[580]"],
			column: "flex flex-col gap-[3px]",
			option: ["rounded-r4", "p-2"],
			description: "text-[12px]/[15px] text-ink-muted whitespace-pre-wrap",
		});
	});

	it("lays the Other row out as upstream does: the 'Other' label and its keycap on one line, the textarea full width below", () => {
		render(<PendingQuestionCard questions={[QUESTIONS[0]!]} />);
		const other = screen
			.getByRole("group", {name: "Waiting for your input"})
			.querySelector("[data-pending-question-other]")!;
		const [line, textarea] = Array.from(other.children);

		expect({
			row: other.className,
			line: {
				className: line?.className,
				label: line?.firstElementChild?.textContent,
				key: line?.querySelector("kbd")?.textContent,
			},
			textarea: {tag: textarea?.tagName, className: textarea?.className},
		}).toStrictEqual({
			row: "flex w-full flex-col gap-3 rounded-r4 p-2 bg-alpha-1",
			line: {className: "flex items-center gap-2", label: "Other", key: "3"},
			textarea: {
				tag: "TEXTAREA",
				className:
					"w-full resize-none cursor-not-allowed rounded-r5 bg-white/50 px-2 py-1.5 text-body text-primary outline-none ring-1 ring-border placeholder:text-secondary",
			},
		});
	});

	it("draws a multi-select question's options and Other with upstream's 14px checkboxes, no keycaps and no helper line", () => {
		render(<PendingQuestionCard questions={[QUESTIONS[1]!]} />);
		const card = screen.getByRole("group", {name: "Waiting for your input"});
		const options = [...card.querySelectorAll("[data-pending-question-option]")];
		const other = card.querySelector("[data-pending-question-other]");

		expect({
			pressed: options.map((option) => option.getAttribute("aria-pressed")),
			keycaps: [...options, other].reduce((count, row) => count + (row?.querySelectorAll("kbd").length ?? 0), 0),
			checkboxes: [...card.querySelectorAll("[data-pending-question-checkbox]")].map((box) => box.className),
			helper: card.textContent.includes("Select one or more options"),
		}).toStrictEqual({
			pressed: ["false", "false"],
			keycaps: 0,
			checkboxes: Array.from({length: 3}, () => "size-3.5 shrink-0 rounded-r3 border border-primary/20"),
			helper: false,
		});
	});
});

describe("PendingQuestionCard answering", () => {
	function renderAnswerable(
		questions: PendingQuestionItem[],
		submit?: (answers: Array<QuestionAnswer | null>) => Promise<void>,
	) {
		const onSubmit = vi.fn<(answers: Array<QuestionAnswer | null>) => Promise<void>>(
			submit ?? (async () => Promise.resolve()),
		);
		render(<PendingQuestionCard questions={questions} onSubmit={onSubmit} />);
		return {onSubmit, card: within(screen.getByRole("group", {name: "Waiting for your input"}))};
	}

	function actions() {
		return [...document.querySelectorAll("[data-approval-card-actions] button")].map((button) => ({
			text: button.firstChild?.textContent,
			disabled: (button as HTMLButtonElement).disabled,
		}));
	}

	async function settle() {
		await act(async () => Promise.resolve());
	}

	it("enables every control and drops the terminal footnote, with Submit waiting for an answer", () => {
		renderAnswerable([QUESTIONS[0]!]);

		expect({
			footnote: document.querySelector("[data-pending-question-footnote]"),
			disabledControls: document.querySelectorAll(
				"[data-pending-question] button:disabled, [data-pending-question] textarea:disabled",
			).length,
			actions: actions(),
		}).toStrictEqual({
			footnote: null,
			disabledControls: 0,
			actions: [
				{text: "Skip", disabled: false},
				{text: "Submit", disabled: true},
			],
		});
	});

	it("picks a single-select option by click and submits its index", async () => {
		const {onSubmit, card} = renderAnswerable([QUESTIONS[0]!]);

		fireEvent.click(card.getByRole("button", {name: /^Blue/}));
		const pressed = [...document.querySelectorAll("[data-pending-question-option]")].map((option) =>
			option.getAttribute("aria-pressed"),
		);
		fireEvent.click(card.getByRole("button", {name: /^Submit/}));
		await settle();

		expect({pressed, calls: onSubmit.mock.calls}).toStrictEqual({
			pressed: ["false", "true"],
			calls: [[[{selected: [1]}]]],
		});
	});

	it("answers from the keyboard: digits pick, the Other digit focuses its textarea, ⌘⏎ moves on and submits", async () => {
		const {onSubmit} = renderAnswerable(QUESTIONS);

		fireEvent.keyDown(document, {key: "3"});
		const otherFocused = document.activeElement?.getAttribute("aria-label");
		fireEvent.change(document.activeElement!, {target: {value: "Green"}});
		(document.activeElement as HTMLElement).blur();
		fireEvent.keyDown(document, {key: "Enter", metaKey: true});
		const page = document.querySelector("[data-approval-pill]")?.textContent;
		fireEvent.keyDown(document, {key: "1"});
		fireEvent.keyDown(document, {key: "2"});
		fireEvent.keyDown(document, {key: "1"});
		fireEvent.keyDown(document, {key: "2"});
		fireEvent.keyDown(document, {key: "2"});
		fireEvent.keyDown(document, {key: "Enter", metaKey: true});
		await settle();

		expect({otherFocused, page, calls: onSubmit.mock.calls}).toStrictEqual({
			otherFocused: "Other option",
			page: "2/2",
			calls: [[[{selected: [], other: "Green"}, {selected: [1]}]]],
		});
	});

	it("checks multi-select options and Other together", async () => {
		const {onSubmit, card} = renderAnswerable([QUESTIONS[1]!]);

		fireEvent.click(card.getByRole("button", {name: /^Olives/}));
		fireEvent.click(card.getByRole("button", {name: /^Cheese/}));
		fireEvent.change(card.getByRole("textbox", {name: "Other option"}), {target: {value: "Pepper"}});
		const checked = [...document.querySelectorAll("[data-pending-question-checkbox]")].map((box) =>
			box.hasAttribute("data-checked"),
		);
		fireEvent.click(card.getByRole("button", {name: /^Submit/}));
		await settle();

		expect({checked, calls: onSubmit.mock.calls}).toStrictEqual({
			checked: [true, true, true],
			calls: [[[{selected: [0, 1], other: "Pepper"}]]],
		});
	});

	it("skips a question to the next and submits a skipped last question as unanswered", async () => {
		const {onSubmit, card} = renderAnswerable(QUESTIONS);

		fireEvent.click(card.getByRole("button", {name: "Skip"}));
		fireEvent.click(screen.getByRole("button", {name: /^Olives/}));
		fireEvent.click(screen.getByRole("button", {name: "Skip"}));
		await settle();

		expect(onSubmit.mock.calls).toStrictEqual([[[null, null]]]);
	});

	it("shows a failed submission's error and lets the answer be sent again", async () => {
		const {onSubmit, card} = renderAnswerable([QUESTIONS[0]!], async () =>
			Promise.reject(new Error("Fabricated pane is gone")),
		);

		fireEvent.click(card.getByRole("button", {name: /^Red/}));
		fireEvent.click(card.getByRole("button", {name: /^Submit/}));
		await settle();

		expect({
			error: document.querySelector("[data-pending-question-error]")?.textContent,
			actions: actions(),
			calls: onSubmit.mock.calls.length,
		}).toStrictEqual({
			error: "Fabricated pane is gone",
			actions: [
				{text: "Skip", disabled: false},
				{text: "Submit", disabled: false},
			],
			calls: 1,
		});
	});

	it("ignores digits and ⌘⏎ submission while read-only", () => {
		render(<PendingQuestionCard questions={[QUESTIONS[0]!]} />);
		fireEvent.keyDown(document, {key: "1"});

		expect(
			[...document.querySelectorAll("[data-pending-question-option]")].map((option) =>
				option.getAttribute("aria-pressed"),
			),
		).toStrictEqual([null, null]);
	});
});
