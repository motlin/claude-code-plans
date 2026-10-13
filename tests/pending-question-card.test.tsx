// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {PendingQuestionCard} from "../src/components/approval-card";
import type {PendingQuestionItem} from "../src/lib/hook-events";

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

	it("pills each of several questions i/n", () => {
		render(<PendingQuestionCard questions={QUESTIONS} />);

		expect(
			describeCard().questions.map(({pill, question, multiSelect}) => ({pill, question, multiSelect})),
		).toStrictEqual([
			{pill: "1/2", question: "Which color do you prefer?", multiSelect: null},
			{pill: "2/2", question: "Which toppings?", multiSelect: "Select one or more options."},
		]);
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
});
