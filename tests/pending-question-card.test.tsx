// @vitest-environment jsdom

import {cleanup, render, screen, within} from "@testing-library/react";
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
			pill: question.querySelector("[data-approval-pill]")?.textContent,
			header: question.querySelector("[data-pending-question-header]")?.textContent ?? null,
			question: question.querySelector("[data-approval-card-title]")?.textContent,
			options: within(question as HTMLElement)
				.getAllByRole("button")
				.map((option) => ({
					text: option.textContent,
					disabled: (option as HTMLButtonElement).disabled,
				})),
			multiSelect: question.querySelector("[data-pending-question-multiselect]")?.textContent ?? null,
		})),
		footnote: card.querySelector("[data-approval-card-actions]")?.textContent,
		enabledControls: card.querySelectorAll("button:not(:disabled), textarea, input").length,
	};
}

describe("PendingQuestionCard", () => {
	it("shows every question's header, text and options, read-only, with the terminal footnote", () => {
		render(<PendingQuestionCard questions={QUESTIONS} />);

		expect(describeCard()).toStrictEqual({
			questions: [
				{
					pill: "1/2",
					header: "Color",
					question: "Which color do you prefer?",
					options: [
						{text: "RedA warm color.", disabled: true},
						{text: "BlueA cool color.", disabled: true},
					],
					multiSelect: null,
				},
				{
					pill: "2/2",
					header: "Toppings",
					question: "Which toppings?",
					options: [
						{text: "Cheese", disabled: true},
						{text: "OlivesBlack olives.", disabled: true},
					],
					multiSelect: "Select one or more options.",
				},
			],
			footnote: "Answer in the terminal running this session.",
			enabledControls: 0,
		});
	});

	it("leaves out the header line for a question without one", () => {
		render(<PendingQuestionCard questions={[{question: "Proceed?", options: [{label: "Yes"}, {label: "No"}]}]} />);

		expect(describeCard().questions).toStrictEqual([
			{
				pill: "1/1",
				header: null,
				question: "Proceed?",
				options: [
					{text: "Yes", disabled: true},
					{text: "No", disabled: true},
				],
				multiSelect: null,
			},
		]);
	});
});
