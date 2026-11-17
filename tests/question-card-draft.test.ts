import {describe, expect, it} from "vite-plus/test";

import type {QuestionLike} from "../src/lib/ask-user-question";
import {pickDockedOption, type QuestionCardDraft} from "../src/lib/question-card-draft";

const EMPTY: QuestionCardDraft =
{
	selected: [],
	other: "",
	otherChosen: false,
};

const SINGLE: QuestionLike =
{
	question: "Colour?",
	options: [
		{
			label: "Red",
		},
		{
			label: "Blue",
		},
	],
};

describe("pickDockedOption, as upstream's docked handleOptionClick", () =>
{
	it("covers a plain single-select, a previewed one, a multi-select toggle and Other", () =>
	{
		const multi: QuestionLike =
		{
			...SINGLE,
			multiSelect: true,
		};
		const previewed: QuestionLike =
		{
			...SINGLE,
			options: [
				{
					label: "Red",
					preview: "r",
				},
				{
					label: "Blue",
				},
			],
		};
		expect(
			{
				single: pickDockedOption(SINGLE, EMPTY, 1),
				previewed: pickDockedOption(previewed, EMPTY, 1),
				untoggle: pickDockedOption(
					multi,
					{
						...EMPTY,
						selected: [0, 1],
					},
					1,
				),
				other: pickDockedOption(
					SINGLE,
					{
						...EMPTY,
						selected: [0],
					},
					-1,
				),
			},
		).toStrictEqual(
			{
				single:
				{
					draft:
					{
						selected: [1],
						other: "",
						otherChosen: false,
					},
					highlighted: 1,
					answerNow: true,
				},
				previewed:
				{
					draft:
					{
						selected: [1],
						other: "",
						otherChosen: false,
					},
					highlighted: 1,
					answerNow: false,
				},
				untoggle:
				{
					draft:
					{
						selected: [0],
						other: "",
						otherChosen: false,
					},
					highlighted: 1,
					answerNow: false,
				},
				other:
				{
					draft:
					{
						selected: [],
						other: "",
						otherChosen: true,
					},
					highlighted: -1,
					answerNow: false,
				},
			},
		);
	});
});
